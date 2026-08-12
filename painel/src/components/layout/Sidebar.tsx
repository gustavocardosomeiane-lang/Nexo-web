/**
 * Navegacao lateral.
 *
 * Em telas >= 1024px fica fixa e pode ser recolhida a so icones. Abaixo disso
 * vira painel deslizante com fundo escurecido, fechando por Esc, por clique no
 * fundo e ao trocar de rota.
 */

import { useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Icon, MarcaNexo, type NomeIcone } from '@/components/ui/Icon';
import { BotaoIcone, Avatar } from '@/components/ui/primitives';
import { useAuth } from '@/auth/AuthContext';
import type { Modulo } from '@/auth/permissions';
import { PAPEL } from '@/components/dominio/StatusBadge';

interface ItemNav {
  para: string;
  rotulo: string;
  icone: NomeIcone;
  modulo: Modulo;
}

const GRUPOS: { titulo: string; itens: ItemNav[] }[] = [
  {
    titulo: 'Operação',
    itens: [
      { para: '/', rotulo: 'Dashboard', icone: 'dashboard', modulo: 'dashboard' },
      { para: '/leads', rotulo: 'Leads', icone: 'leads', modulo: 'leads' },
      { para: '/clientes', rotulo: 'Clientes', icone: 'clientes', modulo: 'clientes' },
      { para: '/conversas', rotulo: 'Conversas', icone: 'conversas', modulo: 'conversas' },
      { para: '/campanhas', rotulo: 'Campanhas', icone: 'enviar', modulo: 'automacoes' },
    ],
  },
  {
    titulo: 'Comercial',
    itens: [
      { para: '/vendas', rotulo: 'Vendas', icone: 'vendas', modulo: 'vendas' },
      { para: '/pagamentos', rotulo: 'Pagamentos', icone: 'pagamentos', modulo: 'pagamentos' },
      { para: '/servicos', rotulo: 'Serviços', icone: 'servicos', modulo: 'servicos' },
      { para: '/financeiro', rotulo: 'Financeiro', icone: 'financeiro', modulo: 'financeiro' },
    ],
  },
  {
    titulo: 'Entrega',
    itens: [{ para: '/projetos', rotulo: 'Projetos', icone: 'projetos', modulo: 'projetos' }],
  },
  {
    titulo: 'Sistema',
    itens: [
      { para: '/automacoes', rotulo: 'Automações', icone: 'automacoes', modulo: 'automacoes' },
      { para: '/relatorios', rotulo: 'Relatórios', icone: 'relatorios', modulo: 'relatorios' },
      { para: '/notificacoes', rotulo: 'Notificações', icone: 'notificacoes', modulo: 'notificacoes' },
      { para: '/configuracoes', rotulo: 'Configurações', icone: 'configuracoes', modulo: 'configuracoes' },
    ],
  },
];

interface Props {
  aberta: boolean;
  recolhida: boolean;
  aoFechar: () => void;
  aoAlternarRecolhida: () => void;
  naoLidas: number;
}

export function Sidebar({ aberta, recolhida, aoFechar, aoAlternarRecolhida, naoLidas }: Props) {
  const { usuario, podeVer, sair } = useAuth();
  const local = useLocation();
  const primeiraRenderizacao = useRef(true);

  /* Fecha o painel ao navegar — no celular a rota muda e a sidebar precisa sair
     da frente sozinha. */
  useEffect(() => {
    if (primeiraRenderizacao.current) {
      primeiraRenderizacao.current = false;
      return;
    }
    aoFechar();
    // Depende so da rota: incluir aoFechar aqui reexecutaria a cada render do pai.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local.pathname]);

  useEffect(() => {
    if (!aberta) return;
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') aoFechar();
    }
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [aberta, aoFechar]);

  return (
    <>
      {aberta && <div className="sidebar-fundo" onClick={aoFechar} aria-hidden="true" />}

      <aside
        id="menu-lateral"
        className={`sidebar ${aberta ? 'aberta' : ''}`}
        aria-label="Navegação principal"
      >
        <div className="sidebar-topo">
          <span className="marca">
            <MarcaNexo className="marca-simbolo" size={28} />
            <span className="marca-nome">NEXO WEB</span>
          </span>
          <BotaoIcone
            icone="painelEsquerdo"
            rotulo={recolhida ? 'Expandir menu' : 'Recolher menu'}
            onClick={aoAlternarRecolhida}
            className="btn-recolher"
          />
        </div>

        <nav className="sidebar-nav">
          {GRUPOS.map((grupo) => {
            const visiveis = grupo.itens.filter((i) => podeVer(i.modulo));
            if (visiveis.length === 0) return null;

            return (
              <div key={grupo.titulo}>
                <div className="sidebar-grupo">{recolhida ? '·' : grupo.titulo}</div>
                {visiveis.map((item) => (
                  <NavLink
                    key={item.para}
                    to={item.para}
                    end={item.para === '/'}
                    className={({ isActive }) => `nav-item ${isActive ? 'ativo' : ''}`}
                    title={recolhida ? item.rotulo : undefined}
                  >
                    <Icon nome={item.icone} />
                    <span>{item.rotulo}</span>
                    {item.para === '/notificacoes' && naoLidas > 0 && (
                      <span className="nav-selo" aria-label={`${naoLidas} não lidas`}>
                        {naoLidas > 99 ? '99+' : naoLidas}
                      </span>
                    )}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-rodape">
          <div className="usuario-bloco">
            <Avatar nome={usuario?.nome ?? '?'} url={usuario?.avatar_url} tamanho="sm" />
            <span className="usuario-info truncar">
              <span className="usuario-nome truncar">{usuario?.nome}</span>
              <span className="usuario-papel">{usuario ? PAPEL[usuario.role] : ''}</span>
            </span>
            <BotaoIcone icone="sair" rotulo="Sair da conta" onClick={() => void sair()} />
          </div>
        </div>
      </aside>
    </>
  );
}
