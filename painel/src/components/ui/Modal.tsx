/**
 * Modal, Drawer e confirmacao.
 *
 * Acessibilidade que estes componentes garantem, e que e facil esquecer:
 *   - foco vai para dentro ao abrir e volta para o gatilho ao fechar;
 *   - Tab circula so entre os focaveis internos (focus trap);
 *   - Esc fecha;
 *   - o fundo nao rola enquanto estiver aberto;
 *   - role="dialog" + aria-modal + titulo ligado por aria-labelledby.
 */

import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BotaoIcone, Botao } from './primitives';

const FOCAVEIS =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useDialogo(aberto: boolean, aoFechar: () => void) {
  const caixaRef = useRef<HTMLDivElement>(null);
  const gatilhoRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!aberto) return;

    gatilhoRef.current = document.activeElement;

    // Trava o scroll do fundo compensando a largura da barra, senao o layout
    // "pula" no instante em que o modal abre.
    const larguraBarra = window.innerWidth - document.documentElement.clientWidth;
    const overflowAnterior = document.body.style.overflow;
    const paddingAnterior = document.body.style.paddingRight;
    document.body.style.overflow = 'hidden';
    if (larguraBarra > 0) document.body.style.paddingRight = `${larguraBarra}px`;

    const primeiro = caixaRef.current?.querySelector<HTMLElement>(FOCAVEIS);
    (primeiro ?? caixaRef.current)?.focus();

    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        aoFechar();
        return;
      }
      if (e.key !== 'Tab') return;

      const focaveis = caixaRef.current?.querySelectorAll<HTMLElement>(FOCAVEIS);
      if (!focaveis || focaveis.length === 0) return;

      const inicio = focaveis[0];
      const fim = focaveis[focaveis.length - 1];

      if (e.shiftKey && document.activeElement === inicio) {
        e.preventDefault();
        fim.focus();
      } else if (!e.shiftKey && document.activeElement === fim) {
        e.preventDefault();
        inicio.focus();
      }
    }

    document.addEventListener('keydown', aoTeclar, true);

    return () => {
      document.removeEventListener('keydown', aoTeclar, true);
      document.body.style.overflow = overflowAnterior;
      document.body.style.paddingRight = paddingAnterior;
      (gatilhoRef.current as HTMLElement | null)?.focus?.();
    };
  }, [aberto, aoFechar]);

  return caixaRef;
}

/* --------------------------------------------------------------------------
   Modal
   -------------------------------------------------------------------------- */

interface ModalProps {
  aberto: boolean;
  aoFechar: () => void;
  titulo: string;
  descricao?: string;
  children: ReactNode;
  rodape?: ReactNode;
  largo?: boolean;
}

export function Modal({ aberto, aoFechar, titulo, descricao, children, rodape, largo }: ModalProps) {
  const idTitulo = useId();
  const caixaRef = useDialogo(aberto, aoFechar);

  if (!aberto) return null;

  return createPortal(
    <>
      <div className="overlay" onClick={aoFechar} aria-hidden="true" />
      <div className="modal">
        <div
          ref={caixaRef}
          className={`modal-caixa ${largo ? 'largo' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={idTitulo}
          tabIndex={-1}
        >
          <div className="modal-cabeca">
            <div>
              <h2 id={idTitulo} style={{ fontSize: '1.0625rem' }}>
                {titulo}
              </h2>
              {descricao && <p className="card-sub" style={{ marginTop: 4 }}>{descricao}</p>}
            </div>
            <BotaoIcone icone="x" rotulo="Fechar" onClick={aoFechar} />
          </div>
          <div className="modal-corpo">{children}</div>
          {rodape && <div className="modal-rodape">{rodape}</div>}
        </div>
      </div>
    </>,
    document.body,
  );
}

/* --------------------------------------------------------------------------
   Drawer
   -------------------------------------------------------------------------- */

export function Drawer({
  aberto,
  aoFechar,
  titulo,
  descricao,
  children,
  rodape,
}: Omit<ModalProps, 'largo'>) {
  const idTitulo = useId();
  const caixaRef = useDialogo(aberto, aoFechar);

  if (!aberto) return null;

  return createPortal(
    <>
      <div className="overlay" onClick={aoFechar} aria-hidden="true" />
      <div
        ref={caixaRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        tabIndex={-1}
      >
        <div className="modal-cabeca">
          <div style={{ minWidth: 0 }}>
            <h2 id={idTitulo} style={{ fontSize: '1.0625rem' }}>
              {titulo}
            </h2>
            {descricao && <p className="card-sub" style={{ marginTop: 4 }}>{descricao}</p>}
          </div>
          <BotaoIcone icone="x" rotulo="Fechar" onClick={aoFechar} />
        </div>
        <div className="drawer-corpo">{children}</div>
        {rodape && <div className="modal-rodape">{rodape}</div>}
      </div>
    </>,
    document.body,
  );
}

/* --------------------------------------------------------------------------
   Confirmação
   -------------------------------------------------------------------------- */

export function Confirmacao({
  aberto,
  aoFechar,
  aoConfirmar,
  titulo,
  mensagem,
  textoConfirmar = 'Confirmar',
  perigo = false,
  processando = false,
}: {
  aberto: boolean;
  aoFechar: () => void;
  aoConfirmar: () => void;
  titulo: string;
  mensagem: string;
  textoConfirmar?: string;
  perigo?: boolean;
  processando?: boolean;
}) {
  const confirmar = useCallback(() => aoConfirmar(), [aoConfirmar]);

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      titulo={titulo}
      rodape={
        <>
          <Botao variante="fantasma" onClick={aoFechar} disabled={processando}>
            Cancelar
          </Botao>
          <Botao
            variante={perigo ? 'perigo' : 'primario'}
            onClick={confirmar}
            carregando={processando}
          >
            {textoConfirmar}
          </Botao>
        </>
      }
    >
      <p style={{ fontSize: '.875rem', lineHeight: 1.65 }}>{mensagem}</p>
    </Modal>
  );
}
