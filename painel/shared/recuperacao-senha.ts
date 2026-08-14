/**
 * Leitura do link de recuperação de senha do Supabase.
 *
 * Parte PURA, sem imports com alias e sem dependência de navegador: recebe a
 * URL como texto e diz o que ela carrega. Assim dá para testar todos os
 * formatos sem abrir um e-mail de verdade.
 *
 * ===========================================================================
 * POR QUE ISTO É MAIS COMPLICADO DO QUE PARECE
 *
 * O Supabase entrega o token de QUATRO jeitos diferentes, dependendo da versão
 * do projeto, do `flowType` do cliente e de o template de e-mail ter sido
 * personalizado ou não:
 *
 *   1. IMPLÍCITO — `#access_token=...&refresh_token=...&type=recovery`
 *      O padrão do supabase-js v2 no navegador. Vem no FRAGMENTO (#), que
 *      nunca chega ao servidor. O próprio cliente consome com
 *      `detectSessionInUrl`.
 *
 *   2. PKCE — `?code=...`
 *      Exige troca explícita por `exchangeCodeForSession`.
 *
 *   3. TOKEN HASH — `?token_hash=...&type=recovery`
 *      Aparece quando o template usa `{{ .TokenHash }}`. Exige `verifyOtp`.
 *
 *   4. ERRO — `#error=access_denied&error_code=otp_expired&...`
 *      Link expirado ou já usado. Precisa de mensagem decente, não de tela
 *      em branco.
 *
 * Tratar só o caso 1 funciona hoje e quebra silenciosamente quando o projeto
 * mudar de flow. Por isso os quatro estão cobertos.
 * ===========================================================================
 */

export type LinkRecuperacao =
  /** Tokens no fragmento: o cliente Supabase já consegue montar a sessão. */
  | { tipo: 'sessao_no_fragmento'; accessToken: string; refreshToken: string }
  /** Fluxo PKCE: trocar o código por sessão. */
  | { tipo: 'codigo'; codigo: string }
  /** Template com TokenHash: validar via verifyOtp. */
  | { tipo: 'token_hash'; tokenHash: string }
  /** O Supabase recusou o link (expirado, já usado, inválido). */
  | { tipo: 'erro'; codigo: string | null; mensagem: string }
  /** Nada de recuperação na URL. */
  | { tipo: 'ausente' };

/**
 * Mensagens em português para os erros que o Supabase devolve no link.
 * O texto original vem em inglês e com `+` no lugar de espaço.
 */
const MENSAGEM_ERRO: Record<string, string> = {
  otp_expired:
    'Este link de recuperação expirou. Peça um novo na tela de login — os links valem por tempo limitado.',
  access_denied:
    'Este link não é mais válido. Ele pode já ter sido usado. Peça um novo na tela de login.',
  invalid_request: 'O link de recuperação está incompleto ou foi alterado. Peça um novo.',
};

function humanizarErro(codigo: string | null, descricao: string | null): string {
  if (codigo && MENSAGEM_ERRO[codigo]) return MENSAGEM_ERRO[codigo];
  if (descricao) {
    // O Supabase manda "Email+link+is+invalid+or+has+expired".
    const limpo = descricao.replace(/\+/g, ' ').trim();
    if (limpo) return limpo;
  }
  return 'Não foi possível validar este link de recuperação. Peça um novo na tela de login.';
}

/**
 * Interpreta a URL completa da página.
 *
 * A ordem importa: erro é verificado ANTES dos tokens. Um link expirado pode
 * trazer os dois, e tratar como sucesso levaria a uma tela de nova senha que
 * falha só no fim, depois da pessoa digitar tudo.
 */
export function interpretarLinkRecuperacao(href: string): LinkRecuperacao {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { tipo: 'ausente' };
  }

  // O fragmento chega como "#a=1&b=2"; URLSearchParams entende sem o "#".
  const fragmento = new URLSearchParams(url.hash.replace(/^#/, ''));
  const busca = url.searchParams;

  const ler = (chave: string): string | null => fragmento.get(chave) ?? busca.get(chave);

  /* ---- 1. Erro tem prioridade ---- */
  const erro = ler('error');
  const erroCodigo = ler('error_code');
  if (erro || erroCodigo) {
    return {
      tipo: 'erro',
      codigo: erroCodigo ?? erro,
      mensagem: humanizarErro(erroCodigo ?? erro, ler('error_description')),
    };
  }

  /* ---- 2. Fluxo implícito ---- */
  const accessToken = fragmento.get('access_token');
  const refreshToken = fragmento.get('refresh_token');
  if (accessToken && refreshToken) {
    return { tipo: 'sessao_no_fragmento', accessToken, refreshToken };
  }

  /* ---- 3. PKCE ---- */
  const codigo = busca.get('code');
  if (codigo) return { tipo: 'codigo', codigo };

  /* ---- 4. TokenHash ---- */
  const tokenHash = ler('token_hash');
  if (tokenHash) return { tipo: 'token_hash', tokenHash };

  return { tipo: 'ausente' };
}

/**
 * Regras da nova senha.
 *
 * O mínimo do Supabase é 6; exigimos 8 porque este painel dá acesso a
 * faturamento e dados de cliente. Devolve a primeira falha, ou `null`.
 */
export function validarNovaSenha(senha: string, confirmacao: string): string | null {
  if (!senha) return 'Informe a nova senha.';
  if (senha.length < 8) return 'A senha precisa de pelo menos 8 caracteres.';
  if (senha.length > 72) {
    // Limite do bcrypt: o que passa de 72 bytes é silenciosamente cortado, e
    // a pessoa ficaria com uma senha diferente da que digitou.
    return 'A senha pode ter no máximo 72 caracteres.';
  }
  if (!confirmacao) return 'Confirme a nova senha.';
  if (senha !== confirmacao) return 'As duas senhas não são iguais.';
  return null;
}

/** Força da senha, só para orientar quem digita. Não bloqueia nada. */
export type ForcaSenha = 'fraca' | 'media' | 'forte';

export function forcaDaSenha(senha: string): ForcaSenha {
  if (senha.length < 8) return 'fraca';

  let variedade = 0;
  if (/[a-z]/.test(senha)) variedade++;
  if (/[A-Z]/.test(senha)) variedade++;
  if (/\d/.test(senha)) variedade++;
  if (/[^a-zA-Z\d]/.test(senha)) variedade++;

  if (senha.length >= 12 && variedade >= 3) return 'forte';
  if (variedade >= 2) return 'media';
  return 'fraca';
}
