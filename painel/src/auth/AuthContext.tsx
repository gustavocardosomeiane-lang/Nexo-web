/**
 * Autenticacao.
 *
 * Duas implementacoes atras da mesma interface:
 *
 *   PRODUCTION MODE — Supabase Auth (`signInWithPassword`). O perfil (nome e
 *   papel) e lido da tabela `users`, ligada ao usuario do Auth pelo mesmo id.
 *
 *   MOCK MODE — nenhuma senha e verificada, e isso esta escrito na tela de
 *   login. Preferi ser explicito a fingir seguranca: uma senha "correta"
 *   guardada no frontend nao protege nada e ensina o habito errado. Digitar o
 *   e-mail de um dos usuarios de demonstracao entra com aquele papel, o que
 *   permite conferir as permissoes de cada perfil.
 *
 * NENHUMA CREDENCIAL ADMINISTRATIVA EXISTE NESTE CODIGO.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { User, UserRole } from '@/types';
import { DATA_MODE, urlDoPainel } from '@/lib/env';
import { getSupabase } from '@/data/supabase/client';
import { usuariosMock } from '@/data/mock/seed';
import { pode, podeVer, type Acao, type Modulo } from './permissions';

const CHAVE_SESSAO = 'nexo.painel.sessao';

interface ContextoAuth {
  usuario: User | null;
  carregando: boolean;
  entrar(email: string, senha: string, lembrar: boolean): Promise<void>;
  sair(): Promise<void>;
  recuperarSenha(email: string): Promise<void>;
  pode(modulo: Modulo, acao?: Acao): boolean;
  podeVer(modulo: Modulo): boolean;
}

const Contexto = createContext<ContextoAuth | null>(null);

/* --------------------------------------------------------------------------
   Sessão do modo demonstração
   -------------------------------------------------------------------------- */

/** sessionStorage por padrao; localStorage so quando "lembrar acesso" marcado. */
function guardarSessaoMock(usuario: User, lembrar: boolean): void {
  try {
    const alvo = lembrar ? localStorage : sessionStorage;
    alvo.setItem(CHAVE_SESSAO, JSON.stringify(usuario));
    (lembrar ? sessionStorage : localStorage).removeItem(CHAVE_SESSAO);
  } catch {
    /* segue so em memoria */
  }
}

function lerSessaoMock(): User | null {
  try {
    const bruto = sessionStorage.getItem(CHAVE_SESSAO) ?? localStorage.getItem(CHAVE_SESSAO);
    return bruto ? (JSON.parse(bruto) as User) : null;
  } catch {
    return null;
  }
}

function limparSessaoMock(): void {
  try {
    sessionStorage.removeItem(CHAVE_SESSAO);
    localStorage.removeItem(CHAVE_SESSAO);
  } catch {
    /* nada a fazer */
  }
}

/* --------------------------------------------------------------------------
   Tradução dos erros de login
   -------------------------------------------------------------------------- */

/** O que o supabase-js entrega num erro de autenticação. */
interface ErroSupabase {
  message?: string;
  code?: string;
  status?: number;
}

/**
 * Traduz o erro do Supabase para algo acionável.
 *
 * POR QUE NÃO COMPARAR `error.message` COM UM TEXTO FIXO — a versão anterior
 * fazia `error.message === 'Invalid login credentials'` e mandava TODO o resto
 * para "Não foi possível entrar. Tente novamente.". Isso escondeu por dias um
 * erro de configuração: com `VITE_SUPABASE_URL` apontando para `/rest/v1`, a
 * chamada de login batia no PostgREST e voltava
 * "Invalid path specified in request URL" — que a interface exibia como se
 * fosse problema de senha. Mensagem genérica demais não é discrição, é ruído.
 *
 * A ordem é intencional: erro de CONFIGURAÇÃO primeiro, porque ele não é culpa
 * de quem está tentando entrar e precisa aparecer inteiro.
 */
export function traduzirErroLogin(erro: ErroSupabase): string {
  const codigo = (erro.code ?? '').toLowerCase();
  const mensagem = (erro.message ?? '').toLowerCase();
  const status = erro.status ?? 0;

  /* ---- Configuração errada ---- */
  // PGRST* = a requisição chegou no PostgREST em vez do serviço de auth.
  if (codigo.startsWith('pgrst') || mensagem.includes('invalid path specified')) {
    return (
      'Configuração inválida: VITE_SUPABASE_URL precisa ser a raiz do projeto ' +
      '(https://SEU-PROJETO.supabase.co), sem /rest/v1 no fim.'
    );
  }
  if (status === 404) {
    return 'O endereço do Supabase está incorreto. Confira VITE_SUPABASE_URL.';
  }
  if (mensagem.includes('failed to fetch') || mensagem.includes('networkerror')) {
    return 'Não foi possível alcançar o Supabase. Verifique a conexão e a CSP do painel.';
  }
  if (status === 401 && !codigo) {
    return 'A chave pública do Supabase foi recusada. Confira VITE_SUPABASE_ANON_KEY.';
  }

  /* ---- Credencial ----
     Genérico de propósito: distinguir "e-mail não existe" de "senha errada"
     entregaria a um atacante quais contas são válidas. */
  if (codigo === 'invalid_credentials' || mensagem.includes('invalid login credentials')) {
    return 'E-mail ou senha incorretos.';
  }
  if (codigo === 'email_not_confirmed' || mensagem.includes('email not confirmed')) {
    return 'Confirme seu e-mail antes de entrar. Procure a mensagem de confirmação do Supabase.';
  }
  if (codigo === 'user_banned') return 'Este acesso está suspenso. Fale com um administrador.';

  /* ---- Limite de tentativas ---- */
  if (status === 429 || codigo.includes('rate_limit')) {
    return 'Muitas tentativas seguidas. Aguarde um minuto e tente de novo.';
  }

  /* ---- Resto ----
     Inclui o detalhe do Supabase: sem ele, o próximo problema volta a ser
     invisível. */
  const detalhe = erro.message ? ` (${erro.message})` : '';
  return `Não foi possível entrar. Tente novamente.${detalhe}`;
}

/* --------------------------------------------------------------------------
   Provider
   -------------------------------------------------------------------------- */

export function ProvedorAuth({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<User | null>(null);
  const [carregando, setCarregando] = useState(true);

  /* ---- Restaura a sessão ao abrir ---- */
  useEffect(() => {
    let vivo = true;

    async function restaurar() {
      if (DATA_MODE === 'mock') {
        if (vivo) {
          setUsuario(lerSessaoMock());
          setCarregando(false);
        }
        return;
      }

      try {
        const supabase = getSupabase();
        const { data } = await supabase.auth.getSession();
        if (!vivo) return;

        if (data.session?.user) {
          setUsuario(await carregarPerfil(data.session.user.id, data.session.user.email ?? ''));
        }
      } catch {
        // Supabase inacessivel: segue deslogado. A tela de login mostra o erro
        // quando a pessoa tentar entrar.
      } finally {
        if (vivo) setCarregando(false);
      }
    }

    restaurar();
    return () => {
      vivo = false;
    };
  }, []);

  /* ---- Mantém o estado em sincronia com o Supabase (logout em outra aba,
         token expirado, refresh) ---- */
  useEffect(() => {
    if (DATA_MODE === 'mock') return;

    let assinatura: { unsubscribe(): void } | undefined;
    try {
      const { data } = getSupabase().auth.onAuthStateChange((evento, sessao) => {
        if (evento === 'SIGNED_OUT' || !sessao?.user) {
          setUsuario(null);
          return;
        }
        carregarPerfil(sessao.user.id, sessao.user.email ?? '').then(setUsuario);
      });
      assinatura = data.subscription;
    } catch {
      /* sem Supabase configurado */
    }

    return () => assinatura?.unsubscribe();
  }, []);

  const entrar = useCallback(async (email: string, senha: string, lembrar: boolean) => {
    if (DATA_MODE === 'mock') {
      // A senha nao e verificada — e isto esta declarado na tela de login.
      if (senha.length < 8) throw new Error('A senha precisa de pelo menos 8 caracteres.');

      const alvo =
        usuariosMock.find((u) => u.email.toLowerCase() === email.trim().toLowerCase()) ??
        usuariosMock[0];

      guardarSessaoMock(alvo, lembrar);
      setUsuario(alvo);
      return;
    }

    const supabase = getSupabase();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: senha,
    });

    if (error) throw new Error(traduzirErroLogin(error));
    if (!data.user) throw new Error('Não foi possível entrar. Tente novamente.');

    setUsuario(await carregarPerfil(data.user.id, data.user.email ?? ''));
  }, []);

  const sair = useCallback(async () => {
    if (DATA_MODE === 'mock') {
      limparSessaoMock();
      setUsuario(null);
      return;
    }
    try {
      await getSupabase().auth.signOut();
    } finally {
      setUsuario(null);
    }
  }, []);

  const recuperarSenha = useCallback(async (email: string) => {
    if (DATA_MODE === 'mock') {
      throw new Error(
        'A recuperação de senha depende do Supabase Auth, que ainda não está configurado.',
      );
    }
    // Este endereço PRECISA estar na lista de Redirect URLs do Supabase
    // (Authentication → URL Configuration). Não basta o Site URL: sem ele na
    // lista, o clique no e-mail devolve {"error":"requested path is invalid"}.
    const { error } = await getSupabase().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: urlDoPainel('/redefinir-senha'),
    });
    if (error) throw new Error('Não foi possível enviar o e-mail de recuperação.');
  }, []);

  const valor = useMemo<ContextoAuth>(
    () => ({
      usuario,
      carregando,
      entrar,
      sair,
      recuperarSenha,
      pode: (modulo, acao) => pode(usuario?.role, modulo, acao),
      podeVer: (modulo) => podeVer(usuario?.role, modulo),
    }),
    [usuario, carregando, entrar, sair, recuperarSenha],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

/**
 * Le o perfil da tabela `users`.
 *
 * Se a linha nao existir, o usuario entra com o papel mais restrito em vez de
 * ser barrado. Falhar fechado, e nunca aberto: um perfil ausente jamais pode
 * resultar em acesso de administrador.
 */
async function carregarPerfil(id: string, email: string): Promise<User> {
  const minimo: User = {
    id,
    nome: email.split('@')[0] || 'Usuário',
    email,
    role: 'colaborador' as UserRole,
    avatar_url: null,
    ativo: true,
    criado_em: new Date().toISOString(),
  };

  try {
    const { data, error } = await getSupabase().from('users').select('*').eq('id', id).maybeSingle();
    if (error || !data) return minimo;
    return data as User;
  } catch {
    return minimo;
  }
}

export function useAuth(): ContextoAuth {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <ProvedorAuth>.');
  return ctx;
}
