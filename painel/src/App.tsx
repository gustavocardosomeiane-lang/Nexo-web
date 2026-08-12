/**
 * Rotas.
 *
 * Cada rota de modulo passa por dois portoes: `Protegida` (tem sessao?) e
 * `ExigeModulo` (o papel pode ver isto?). Assim digitar a URL na mao nao
 * contorna a permissao.
 *
 * As paginas sao carregadas sob demanda (`lazy`): quem abre o Dashboard nao
 * baixa o codigo do modulo financeiro junto.
 */

import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ProvedorAuth } from '@/auth/AuthContext';
import { ExigeModulo, Protegida } from '@/auth/RequireAuth';
import { ProvedorToast } from '@/components/ui/Toast';
import { Shell } from '@/components/layout/Shell';
import { Login } from '@/pages/Login';
import { Dashboard } from '@/pages/Dashboard';
import { bancoIndisponivel } from '@/data';
import { Aviso } from '@/components/ui/primitives';
import { MarcaNexo } from '@/components/ui/Icon';

const Leads = lazy(() => import('@/pages/Leads').then((m) => ({ default: m.Leads })));
const Clientes = lazy(() => import('@/pages/Clientes').then((m) => ({ default: m.Clientes })));
const ClienteDetalhe = lazy(() =>
  import('@/pages/ClienteDetalhe').then((m) => ({ default: m.ClienteDetalhe })),
);
const Vendas = lazy(() => import('@/pages/Vendas').then((m) => ({ default: m.Vendas })));
const Pagamentos = lazy(() => import('@/pages/Pagamentos').then((m) => ({ default: m.Pagamentos })));
const Servicos = lazy(() => import('@/pages/Servicos').then((m) => ({ default: m.Servicos })));
const Projetos = lazy(() => import('@/pages/Projetos').then((m) => ({ default: m.Projetos })));
const Financeiro = lazy(() => import('@/pages/Financeiro').then((m) => ({ default: m.Financeiro })));
const Conversas = lazy(() => import('@/pages/Conversas').then((m) => ({ default: m.Conversas })));
const Automacoes = lazy(() => import('@/pages/Automacoes').then((m) => ({ default: m.Automacoes })));
const Campanhas = lazy(() => import('@/pages/Campanhas').then((m) => ({ default: m.Campanhas })));
const Notificacoes = lazy(() =>
  import('@/pages/Notificacoes').then((m) => ({ default: m.Notificacoes })),
);
const Relatorios = lazy(() => import('@/pages/Relatorios').then((m) => ({ default: m.Relatorios })));
const Configuracoes = lazy(() =>
  import('@/pages/Configuracoes').then((m) => ({ default: m.Configuracoes })),
);

function Carregando() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: '80px 20px' }}>
      <span className="spinner" style={{ width: 24, height: 24, color: 'var(--red)' }} />
      <span className="sr-only">Carregando página</span>
    </div>
  );
}

function NaoEncontrada() {
  return (
    <div className="vazio" style={{ paddingTop: 80 }}>
      <MarcaNexo size={40} />
      <h3 style={{ marginTop: 12 }}>Página não encontrada</h3>
      <p>O endereço acessado não existe neste painel.</p>
      <a href="/" className="btn btn-primario" style={{ marginTop: 10 }}>
        Voltar ao início
      </a>
    </div>
  );
}

/**
 * Producao pedida sem Supabase configurado. A aplicacao para aqui de proposito:
 * mostrar dados de demonstracao com o selo "Produção" seria mentira, e mentira
 * sobre faturamento e o pior tipo.
 */
function ConfiguracaoFaltando() {
  return (
    <div className="login">
      <div className="login-caixa">
        <div className="login-marca">
          <MarcaNexo size={44} />
          <h1 className="login-titulo">Configuração incompleta</h1>
        </div>
        <Aviso tom="erro">
          O painel está em <strong>modo produção</strong>, mas o Supabase não foi configurado.
          Defina <code className="mono">VITE_SUPABASE_URL</code> e{' '}
          <code className="mono">VITE_SUPABASE_ANON_KEY</code> no ambiente e publique de novo.
        </Aviso>
        <p className="login-rodape">
          Para navegar com dados de demonstração, use{' '}
          <code className="mono">VITE_DATA_MODE=mock</code>.
        </p>
      </div>
    </div>
  );
}

export function App() {
  if (bancoIndisponivel) return <ConfiguracaoFaltando />;

  return (
    <BrowserRouter
      // Adotadas desde já: são o comportamento padrão do React Router v7 e,
      // sem elas, o console enche de aviso de migração. Ligar agora deixa a
      // atualização futura sem surpresa.
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ProvedorToast>
        <ProvedorAuth>
          <Suspense fallback={<Carregando />}>
            <Routes>
              <Route path="/login" element={<Login />} />

              <Route element={<Protegida />}>
                <Route element={<Shell />}>
                  <Route index element={<Dashboard />} />

                  <Route element={<ExigeModulo modulo="leads" />}>
                    <Route path="leads" element={<Leads />} />
                  </Route>

                  <Route element={<ExigeModulo modulo="clientes" />}>
                    <Route path="clientes" element={<Clientes />} />
                    <Route path="clientes/:id" element={<ClienteDetalhe />} />
                  </Route>

                  <Route element={<ExigeModulo modulo="vendas" />}>
                    <Route path="vendas" element={<Vendas />} />
                  </Route>

                  <Route element={<ExigeModulo modulo="pagamentos" />}>
                    <Route path="pagamentos" element={<Pagamentos />} />
                  </Route>

                  <Route element={<ExigeModulo modulo="servicos" />}>
                    <Route path="servicos" element={<Servicos />} />
                  </Route>

                  <Route element={<ExigeModulo modulo="projetos" />}>
                    <Route path="projetos" element={<Projetos />} />
                  </Route>

                  <Route element={<ExigeModulo modulo="financeiro" />}>
                    <Route path="financeiro" element={<Financeiro />} />
                  </Route>

                  <Route element={<ExigeModulo modulo="conversas" />}>
                    <Route path="conversas" element={<Conversas />} />
                  </Route>

                  <Route element={<ExigeModulo modulo="automacoes" />}>
                    <Route path="automacoes" element={<Automacoes />} />
                    <Route path="campanhas" element={<Campanhas />} />
                  </Route>

                  <Route element={<ExigeModulo modulo="relatorios" />}>
                    <Route path="relatorios" element={<Relatorios />} />
                  </Route>

                  <Route element={<ExigeModulo modulo="notificacoes" />}>
                    <Route path="notificacoes" element={<Notificacoes />} />
                  </Route>

                  <Route element={<ExigeModulo modulo="configuracoes" />}>
                    <Route path="configuracoes" element={<Configuracoes />} />
                  </Route>

                  <Route path="*" element={<NaoEncontrada />} />
                </Route>
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </ProvedorAuth>
      </ProvedorToast>
    </BrowserRouter>
  );
}
