/**
 * Notificacoes efemeras (toast).
 *
 * Anunciadas por `role="status"` + `aria-live="polite"`: quem usa leitor de
 * tela ouve o resultado da acao sem que o foco seja roubado.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type NomeIcone } from './Icon';

type TomToast = 'ok' | 'erro' | 'info';

interface Toast {
  id: number;
  tom: TomToast;
  mensagem: string;
}

interface ContextoToast {
  sucesso(mensagem: string): void;
  erro(mensagem: string): void;
  info(mensagem: string): void;
}

const Contexto = createContext<ContextoToast | null>(null);

const ICONE: Record<TomToast, NomeIcone> = { ok: 'sucesso', erro: 'erro', info: 'info' };
const DURACAO = 4200;

export function ProvedorToast({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const proximoId = useRef(1);

  const remover = useCallback((id: number) => {
    setToasts((atual) => atual.filter((t) => t.id !== id));
  }, []);

  const adicionar = useCallback(
    (tom: TomToast, mensagem: string) => {
      const id = proximoId.current++;
      setToasts((atual) => [...atual, { id, tom, mensagem }]);
      window.setTimeout(() => remover(id), DURACAO);
    },
    [remover],
  );

  const api = useMemo<ContextoToast>(
    () => ({
      sucesso: (m) => adicionar('ok', m),
      erro: (m) => adicionar('erro', m),
      info: (m) => adicionar('info', m),
    }),
    [adicionar],
  );

  return (
    <Contexto.Provider value={api}>
      {children}
      {createPortal(
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.tom}`}>
              <Icon nome={ICONE[t.tom]} />
              <span>{t.mensagem}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </Contexto.Provider>
  );
}

export function useToast(): ContextoToast {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error('useToast precisa estar dentro de <ProvedorToast>.');
  return ctx;
}
