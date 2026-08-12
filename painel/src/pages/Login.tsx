/**
 * Tela de login.
 *
 * Sobre o modo demonstracao: o aviso amarelo diz, com todas as letras, que
 * nenhuma senha e verificada. Nao existe senha "correta" escondida no codigo —
 * seria uma credencial administrativa hardcoded, exatamente o que nao pode
 * haver, e nao protegeria nada num arquivo que qualquer visitante baixa.
 */

import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { MarcaNexo } from '@/components/ui/Icon';
import { Aviso, Botao, BotaoIcone, CampoTexto, Checkbox } from '@/components/ui/primitives';
import { useAuth } from '@/auth/AuthContext';
import { emailValido, senhaValida } from '@/lib/validation';
import { emModoDemonstracao } from '@/data';
import { usuariosMock } from '@/data/mock/seed';

interface Local {
  de?: string;
}

export function Login() {
  const { usuario, carregando, entrar, recuperarSenha } = useAuth();
  const navegar = useNavigate();
  const local = useLocation();

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [lembrar, setLembrar] = useState(false);

  const [erros, setErros] = useState<{ email?: string; senha?: string }>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (carregando) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>
        <span className="spinner" style={{ width: 26, height: 26, color: 'var(--red)' }} />
      </div>
    );
  }

  if (usuario) {
    const destino = (local.state as Local | null)?.de ?? '/';
    return <Navigate to={destino} replace />;
  }

  async function aoEnviar(e: FormEvent) {
    e.preventDefault();
    setErroGeral(null);
    setAviso(null);

    const erroEmail = emailValido(email);
    const erroSenha = senhaValida(senha);
    if (erroEmail || erroSenha) {
      setErros({ email: erroEmail ?? undefined, senha: erroSenha ?? undefined });
      return;
    }

    setErros({});
    setEnviando(true);
    try {
      await entrar(email, senha, lembrar);
      navegar((local.state as Local | null)?.de ?? '/', { replace: true });
    } catch (e) {
      setErroGeral(e instanceof Error ? e.message : 'Não foi possível entrar.');
    } finally {
      setEnviando(false);
    }
  }

  async function aoRecuperar() {
    setErroGeral(null);
    setAviso(null);

    const erroEmail = emailValido(email);
    if (erroEmail) {
      setErros({ email: 'Informe o e-mail para receber o link de recuperação.' });
      return;
    }

    try {
      await recuperarSenha(email);
      setAviso('Se este e-mail estiver cadastrado, o link de recuperação chegará em instantes.');
    } catch (e) {
      setErroGeral(e instanceof Error ? e.message : 'Não foi possível enviar o e-mail.');
    }
  }

  return (
    <div className="login">
      <div className="login-caixa">
        <div className="login-marca">
          <MarcaNexo className="marca-simbolo" size={44} />
          <div>
            <h1 className="login-titulo">NEXO WEB</h1>
            <p className="login-sub">Painel administrativo</p>
          </div>
        </div>

        {emModoDemonstracao && (
          <Aviso tom="alerta" className="login-aviso">
            <strong>Modo demonstração.</strong> Nenhum banco está conectado e{' '}
            <strong>a senha não é verificada</strong> — qualquer senha com 8+ caracteres entra.
            Use um dos e-mails abaixo para testar os perfis de acesso:
            <ul style={{ marginTop: 8, display: 'grid', gap: 3 }}>
              {usuariosMock.map((u) => (
                <li key={u.id} className="mono" style={{ fontSize: '.75rem' }}>
                  {u.email} · {u.role}
                </li>
              ))}
            </ul>
          </Aviso>
        )}

        {erroGeral && (
          <Aviso tom="erro" className="login-aviso">
            {erroGeral}
          </Aviso>
        )}
        {aviso && (
          <Aviso tom="ok" className="login-aviso">
            {aviso}
          </Aviso>
        )}

        <form className="login-form" onSubmit={aoEnviar} noValidate style={{ marginTop: 18 }}>
          <CampoTexto
            rotulo="E-mail"
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            placeholder="voce@nexoweb.com.br"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            erro={erros.email}
            iconeEsquerda="email"
            maxLength={120}
            autoFocus
            obrigatorio
          />

          <CampoTexto
            rotulo="Senha"
            type={mostrarSenha ? 'text' : 'password'}
            name="senha"
            autoComplete="current-password"
            placeholder="••••••••"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            erro={erros.senha}
            iconeEsquerda="cadeado"
            maxLength={128}
            obrigatorio
            acaoDireita={
              <BotaoIcone
                type="button"
                icone={mostrarSenha ? 'olhoFechado' : 'olho'}
                rotulo={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                onClick={() => setMostrarSenha((v) => !v)}
              />
            }
          />

          <div className="login-linha">
            <Checkbox
              rotulo="Lembrar acesso"
              checked={lembrar}
              onChange={(e) => setLembrar(e.target.checked)}
            />
            <button type="button" className="login-link" onClick={() => void aoRecuperar()}>
              Esqueci minha senha
            </button>
          </div>

          <Botao type="submit" variante="primario" tamanho="lg" bloco carregando={enviando}>
            {enviando ? 'Entrando…' : 'Entrar'}
          </Botao>
        </form>

        <p className="login-rodape">
          Acesso restrito à equipe NEXO WEB.
          <br />
          {emModoDemonstracao
            ? 'A autenticação real usará Supabase Auth quando o banco for conectado.'
            : 'Autenticação protegida por Supabase Auth.'}
        </p>
      </div>
    </div>
  );
}
