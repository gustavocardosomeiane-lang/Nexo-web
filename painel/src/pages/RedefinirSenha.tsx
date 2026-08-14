/**
 * Redefinição de senha — destino do link enviado pelo Supabase Auth.
 *
 * ROTA PÚBLICA, de propósito. Quem chega aqui ainda não sabe a senha; se a
 * página ficasse atrás de `Protegida`, o guard mandaria para `/login` e
 * levaria junto o fragmento `#access_token=...` da URL — que é justamente o
 * que autentica a pessoa. O token some e o link vira inútil.
 *
 * O QUE ACONTECE, EM ORDEM
 *   1. lê a URL e descobre em qual formato o Supabase mandou o token;
 *   2. estabelece a sessão de recuperação (cada formato exige um caminho);
 *   3. LIMPA a URL — token não pode ficar no histórico do navegador;
 *   4. pede a nova senha, duas vezes;
 *   5. `updateUser({ password })`;
 *   6. encerra a sessão de recuperação e manda para `/login`.
 *
 * O passo 6 é intencional: a sessão criada pelo link é de recuperação. Deixar
 * a pessoa entrar direto com ela significaria que qualquer um com o link do
 * e-mail entra sem nunca provar que sabe a senha nova. Forçar o login prova.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MarcaNexo } from '@/components/ui/Icon';
import { Aviso, Botao, BotaoIcone, CampoTexto } from '@/components/ui/primitives';
import { DATA_MODE, supabaseEnv } from '@/lib/env';
import { getSupabase } from '@/data/supabase/client';
import {
  forcaDaSenha,
  interpretarLinkRecuperacao,
  validarNovaSenha,
  type ForcaSenha,
} from '../../shared/recuperacao-senha';

type Etapa =
  /** Validando o link. */
  | { nome: 'verificando' }
  /** Sessão de recuperação ativa: pode trocar a senha. */
  | { nome: 'pronto'; email: string | null }
  /** Link inválido, expirado ou ausente. */
  | { nome: 'invalido'; mensagem: string }
  /** Senha trocada. */
  | { nome: 'concluido' };

const ROTULO_FORCA: Record<ForcaSenha, string> = {
  fraca: 'Fraca',
  media: 'Média',
  forte: 'Forte',
};

/**
 * Decide o que dá para saber JÁ na primeira renderização, sem efeito e sem
 * rede: modo demonstração, link recusado pelo Supabase, ou nada de token na
 * URL.
 *
 * Fazer isso aqui, e não dentro de um `useEffect`, elimina uma classe inteira
 * de bug de tempo: no StrictMode o efeito monta, desmonta e monta de novo, e
 * um estado definido na primeira passada pode ser descartado — a tela ficava
 * presa em "Validando…" para sempre. O que é síncrono deve ser resolvido de
 * forma síncrona.
 */
function etapaInicial(): Etapa {
  if (DATA_MODE !== 'production' || !supabaseEnv.configurado) {
    return {
      nome: 'invalido',
      mensagem:
        'A redefinição de senha depende do Supabase Auth. Este painel está em modo demonstração, onde não existe senha para redefinir.',
    };
  }

  const link = interpretarLinkRecuperacao(window.location.href);

  if (link.tipo === 'erro') {
    return { nome: 'invalido', mensagem: link.mensagem };
  }

  // Os demais formatos exigem ida ao Supabase: quem resolve é o efeito.
  return { nome: 'verificando' };
}

export function RedefinirSenha() {
  const navegar = useNavigate();

  const [etapa, setEtapa] = useState<Etapa>(etapaInicial);
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // StrictMode monta duas vezes em desenvolvimento. Sem esta trava, o token
  // seria consumido no primeiro efeito e o segundo encontraria a URL já limpa,
  // concluindo (erradamente) que o link é inválido.
  const jaProcessou = useRef(false);

  /* ------------------------------------------------------------------
     1 a 3 — ler a URL, abrir a sessão e limpar o endereço
     ------------------------------------------------------------------ */
  useEffect(() => {
    // O que era resolvível de forma síncrona já foi: só sobra o que precisa
    // conversar com o Supabase.
    if (etapa.nome !== 'verificando') return;
    if (jaProcessou.current) return;
    jaProcessou.current = true;

    let resolvido = false;

    /**
     * Sem guarda de "componente ainda montado", de propósito.
     *
     * A tentação é usar um `vivo = false` na limpeza do efeito. Aqui isso
     * QUEBRA a tela: no StrictMode o efeito roda duas vezes; a limpeza da
     * primeira passada marcaria `vivo = false`, e a segunda passada sai cedo
     * por causa do `jaProcessou`. Resultado: ninguém atualiza o estado e a
     * tela fica presa em "Validando…" para sempre.
     *
     * No React 18 atualizar estado de componente desmontado é inofensivo e
     * não gera aviso — então a proteção certa é não ter proteção nenhuma.
     */
    const encerrar = (proxima: Etapa) => {
      resolvido = true;
      setEtapa(proxima);
    };

    /**
     * Rede de segurança. Se o Supabase não responder — projeto pausado, DNS
     * fora, rede caída — a pessoa fica olhando um spinner sem fim, que é o
     * pior desfecho possível: parece travado e não diz o que fazer.
     */
    const limite = window.setTimeout(() => {
      if (!resolvido) {
        encerrar({
          nome: 'invalido',
          mensagem:
            'O Supabase não respondeu a tempo. Verifique sua conexão e abra o link do e-mail de novo.',
        });
      }
    }, 15_000);

    /** Tira token e código da barra de endereço, sem recarregar a página. */
    const limparUrl = () => {
      window.history.replaceState(null, '', window.location.pathname);
    };

    async function processar() {
      const link = interpretarLinkRecuperacao(window.location.href);



      try {
        // Dentro do try: se a construção falhar, a tela mostra erro em vez de
        // ficar presa no "Validando…".
        const supabase = getSupabase();

        switch (link.tipo) {
          case 'sessao_no_fragmento': {
            // `detectSessionInUrl` normalmente já resolveu isto sozinho, mas
            // depende de o cliente ter sido criado DEPOIS da navegação. Definir
            // a sessão à mão torna o comportamento previsível nos dois casos.
            const { error } = await supabase.auth.setSession({
              access_token: link.accessToken,
              refresh_token: link.refreshToken,
            });
            if (error) throw error;
            break;
          }

          case 'codigo': {
            const { error } = await supabase.auth.exchangeCodeForSession(link.codigo);
            if (error) throw error;
            break;
          }

          case 'token_hash': {
            const { error } = await supabase.auth.verifyOtp({
              token_hash: link.tokenHash,
              type: 'recovery',
            });
            if (error) throw error;
            break;
          }

          case 'ausente': {
            // Pode ser alguém que abriu /redefinir-senha na mão. Mas também
            // pode ser o caso em que o cliente já consumiu o fragmento antes
            // deste efeito rodar — então vale conferir se há sessão ativa.
            const { data } = await supabase.auth.getSession();
            if (!data.session) {
              encerrar({
                nome: 'invalido',
                mensagem:
                  'Abra esta página pelo link enviado no e-mail de recuperação. Se o link expirou, peça um novo na tela de login.',
              });
              return;
            }
            break;
          }
        }

        limparUrl();

        const { data } = await supabase.auth.getUser();
        encerrar({ nome: 'pronto', email: data.user?.email ?? null });
      } catch (e) {
        limparUrl();
        const detalhe = e instanceof Error ? e.message : '';
        encerrar({
          nome: 'invalido',
          mensagem:
            /expired|invalid/i.test(detalhe)
              ? 'Este link expirou ou já foi usado. Peça um novo na tela de login.'
              : 'Não foi possível validar o link de recuperação. Peça um novo na tela de login.',
        });
      }
    }

    // `catch` no fim: qualquer falha que escape de `processar` vira mensagem
    // na tela, nunca um spinner eterno.
    void processar()
      .catch(() => {
        encerrar({
          nome: 'invalido',
          mensagem: 'Não foi possível validar o link de recuperação. Peça um novo na tela de login.',
        });
      })
      .finally(() => window.clearTimeout(limite));

    return () => window.clearTimeout(limite);
  }, []);

  /* ------------------------------------------------------------------
     4 a 6 — trocar a senha, encerrar a sessão e ir para o login
     ------------------------------------------------------------------ */
  const enviar = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setErro(null);

      const problema = validarNovaSenha(senha, confirmacao);
      if (problema) {
        setErro(problema);
        return;
      }

      setSalvando(true);
      try {
        const supabase = getSupabase();
        const { error } = await supabase.auth.updateUser({ password: senha });

        if (error) {
          // O Supabase recusa senha igual à anterior e senha vazada.
          const msg = /same.*password|should be different/i.test(error.message)
            ? 'A nova senha precisa ser diferente da anterior.'
            : /weak|pwned|compromised/i.test(error.message)
              ? 'Esta senha é muito comum e foi recusada. Escolha outra.'
              : 'Não foi possível atualizar a senha. Peça um novo link e tente de novo.';
          setErro(msg);
          return;
        }

        setEtapa({ nome: 'concluido' });

        // Encerra a sessão de recuperação: a pessoa precisa entrar com a senha
        // nova para provar que a conhece.
        await supabase.auth.signOut();

        window.setTimeout(() => {
          navegar('/login', {
            replace: true,
            state: { aviso: 'Senha atualizada. Entre com a nova senha.' },
          });
        }, 1600);
      } catch {
        setErro('Não foi possível atualizar a senha. Tente novamente.');
      } finally {
        setSalvando(false);
      }
    },
    [senha, confirmacao, navegar],
  );

  const forca = senha ? forcaDaSenha(senha) : null;

  return (
    <div className="login">
      <div className="login-caixa">
        <div className="login-marca">
          <MarcaNexo className="marca-simbolo" size={44} />
          <div>
            <h1 className="login-titulo">Nova senha</h1>
            <p className="login-sub">NEXO WEB · Painel administrativo</p>
          </div>
        </div>

        {etapa.nome === 'verificando' && (
          <div style={{ display: 'grid', placeItems: 'center', padding: '28px 0', gap: 12 }}>
            <span className="spinner" style={{ width: 24, height: 24, color: 'var(--red)' }} />
            <span style={{ fontSize: '.8438rem', color: 'var(--fg-dim)' }}>
              Validando o link de recuperação…
            </span>
          </div>
        )}

        {etapa.nome === 'invalido' && (
          <>
            <Aviso tom="erro">{etapa.mensagem}</Aviso>
            <Link to="/login" className="btn btn-primario btn-bloco" style={{ marginTop: 18 }}>
              Voltar para o login
            </Link>
          </>
        )}

        {etapa.nome === 'concluido' && (
          <>
            <Aviso tom="ok">
              <strong>Senha atualizada.</strong> Redirecionando para o login…
            </Aviso>
            <Link to="/login" className="btn btn-secundario btn-bloco" style={{ marginTop: 18 }}>
              Ir agora
            </Link>
          </>
        )}

        {etapa.nome === 'pronto' && (
          <>
            {etapa.email && (
              <p className="login-sub" style={{ marginBottom: 4 }}>
                Definindo a senha de <strong style={{ color: 'var(--fg)' }}>{etapa.email}</strong>
              </p>
            )}

            {erro && (
              <Aviso tom="erro" className="login-aviso">
                {erro}
              </Aviso>
            )}

            <form className="login-form" onSubmit={enviar} noValidate style={{ marginTop: 18 }}>
              <CampoTexto
                rotulo="Nova senha"
                type={mostrar ? 'text' : 'password'}
                name="nova-senha"
                autoComplete="new-password"
                placeholder="Pelo menos 8 caracteres"
                value={senha}
                onChange={(ev) => setSenha(ev.target.value)}
                iconeEsquerda="cadeado"
                maxLength={72}
                autoFocus
                obrigatorio
                acaoDireita={
                  <BotaoIcone
                    type="button"
                    icone={mostrar ? 'olhoFechado' : 'olho'}
                    rotulo={mostrar ? 'Ocultar senha' : 'Mostrar senha'}
                    onClick={() => setMostrar((v) => !v)}
                  />
                }
                ajuda={forca ? `Força: ${ROTULO_FORCA[forca]}` : undefined}
              />

              <CampoTexto
                rotulo="Confirme a nova senha"
                type={mostrar ? 'text' : 'password'}
                name="confirmar-senha"
                autoComplete="new-password"
                placeholder="Digite de novo"
                value={confirmacao}
                onChange={(ev) => setConfirmacao(ev.target.value)}
                iconeEsquerda="cadeado"
                maxLength={72}
                obrigatorio
                erro={
                  confirmacao && senha !== confirmacao ? 'As duas senhas não são iguais.' : undefined
                }
              />

              <Botao type="submit" variante="primario" tamanho="lg" bloco carregando={salvando}>
                {salvando ? 'Salvando…' : 'Salvar nova senha'}
              </Botao>
            </form>

            <p className="login-rodape">
              Depois de salvar, você entra de novo com a senha nova.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
