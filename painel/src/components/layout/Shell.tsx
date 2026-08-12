/**
 * Casca da aplicacao: sidebar + topbar + area de conteudo.
 *
 * Tambem e o dono do contador de notificacoes nao lidas, porque tanto a
 * sidebar quanto o sino da topbar precisam do mesmo numero.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Icon } from '@/components/ui/Icon';
import { BotaoIcone } from '@/components/ui/primitives';
import { useAuth } from '@/auth/AuthContext';
import { db, emModoDemonstracao } from '@/data';

const CHAVE_RECOLHIDA = 'nexo.painel.sidebar.recolhida';

const TITULOS: Record<string, string> = {
  '/': 'Dashboard',
  '/leads': 'Leads',
  '/clientes': 'Clientes',
  '/vendas': 'Vendas',
  '/pagamentos': 'Pagamentos',
  '/servicos': 'Serviços',
  '/projetos': 'Projetos',
  '/financeiro': 'Financeiro',
  '/conversas': 'Conversas',
  '/automacoes': 'Automações',
  '/notificacoes': 'Notificações',
  '/relatorios': 'Relatórios',
  '/configuracoes': 'Configurações',
};

function tituloDa(caminho: string): string {
  if (TITULOS[caminho]) return TITULOS[caminho];
  // Rota filha: /clientes/abc -> Clientes
  const raiz = `/${caminho.split('/')[1] ?? ''}`;
  return TITULOS[raiz] ?? 'Painel';
}

export function Shell() {
  const [aberta, setAberta] = useState(false);
  const [recolhida, setRecolhida] = useState(() => {
    try {
      return localStorage.getItem(CHAVE_RECOLHIDA) === '1';
    } catch {
      return false;
    }
  });
  const [naoLidas, setNaoLidas] = useState(0);

  const local = useLocation();
  const navegar = useNavigate();
  const { usuario } = useAuth();

  const alternarRecolhida = useCallback(() => {
    setRecolhida((atual) => {
      const proximo = !atual;
      try {
        localStorage.setItem(CHAVE_RECOLHIDA, proximo ? '1' : '0');
      } catch {
        /* preferencia nao persiste, sem impacto */
      }
      return proximo;
    });
  }, []);

  const fechar = useCallback(() => setAberta(false), []);

  /* Contador de não lidas. Recarrega a cada troca de rota — barato e mantém o
     número honesto sem abrir conexão em tempo real. */
  useEffect(() => {
    let vivo = true;
    db.notificacoes
      .todos({ filtros: { lida: false } })
      .then((itens) => {
        if (vivo) setNaoLidas(itens.length);
      })
      .catch(() => {
        if (vivo) setNaoLidas(0);
      });
    return () => {
      vivo = false;
    };
  }, [local.pathname]);

  return (
    <div className={`shell ${recolhida ? 'recolhida' : ''}`}>
      <Sidebar
        aberta={aberta}
        recolhida={recolhida}
        aoFechar={fechar}
        aoAlternarRecolhida={alternarRecolhida}
        naoLidas={naoLidas}
      />

      <div className="conteudo">
        <header className="topbar">
          {/* Visível abaixo de 1024px — exatamente onde a sidebar deixa de ser
              fixa e vira painel deslizante. As duas regras usam o mesmo
              breakpoint de propósito: com valores diferentes, o tablet ficaria
              sem sidebar e sem botão para abri-la. */}
          <BotaoIcone
            icone="menu"
            rotulo="Abrir menu"
            onClick={() => setAberta(true)}
            className="btn-menu"
            aria-expanded={aberta}
            aria-controls="menu-lateral"
          />

          <span className="topbar-titulo">{tituloDa(local.pathname)}</span>
          <span className="topbar-espaco" />

          <div className="topbar-acoes">
            {emModoDemonstracao ? (
              <span className="selo-modo demo" title="Nenhum banco conectado: os dados são fictícios">
                <Icon nome="alerta" />
                <span>Demonstração</span>
              </span>
            ) : (
              <span className="selo-modo producao" title="Conectado ao Supabase">
                <Icon nome="banco" />
                <span>Produção</span>
              </span>
            )}

            <Link to="/notificacoes" className="btn-icone sino" aria-label="Notificações">
              <Icon nome="notificacoes" />
              {naoLidas > 0 && (
                <span className="sino-ponto" aria-hidden="true">
                  {naoLidas > 9 ? '9+' : naoLidas}
                </span>
              )}
            </Link>

            <BotaoIcone
              icone="configuracoes"
              rotulo="Configurações"
              onClick={() => navegar('/configuracoes')}
              className="esconder-mobile"
            />
          </div>
        </header>

        <main className="pagina" id="conteudo-principal" key={usuario?.id ?? 'anon'}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
