/**
 * `useNexoAI` — a máquina de estados da assistente, do lado do navegador.
 *
 * Junta quatro coisas que precisam andar em sincronia: as mensagens da sessão,
 * o estado visual (para o orbe), a chamada à API e a voz. As telas não tocam
 * em nenhuma dessas peças direto — pedem a este hook.
 *
 * A transição de estado passa por `podeTransitar` (regra pura, testada): a
 * interface nunca cai num estado impossível, tipo "falando" logo após "erro".
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { podeTransitar, type EstadoNexoAI } from '../../shared/regras-nexo-ai';
import { conversar } from './cliente';
import { criarProvedorVoz, type ProvedorVoz } from './voz';

export interface MensagemUI {
  id: string;
  papel: 'user' | 'assistant';
  conteudo: string;
  em: string;
}

export interface UseNexoAI {
  estado: EstadoNexoAI;
  mensagens: MensagemUI[];
  nivelVoz: number;
  vozLigada: boolean;
  erro: string | null;
  podeOuvir: boolean;
  podeFalar: boolean;
  parcialEscuta: string;
  enviar: (texto: string) => Promise<void>;
  alternarEscuta: () => void;
  alternarVoz: () => void;
  silenciar: () => void;
  limpar: () => void;
}

const idLocal = () =>
  `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export function useNexoAI(): UseNexoAI {
  const [estado, setEstado] = useState<EstadoNexoAI>('idle');
  const [mensagens, setMensagens] = useState<MensagemUI[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [nivelVoz, setNivelVoz] = useState(0);
  const [vozLigada, setVozLigada] = useState(true);
  const [parcialEscuta, setParcialEscuta] = useState('');

  const conversaId = useRef<string | undefined>(undefined);
  const voz = useRef<ProvedorVoz | null>(null);
  const vozLigadaRef = useRef(vozLigada);
  vozLigadaRef.current = vozLigada;

  if (voz.current === null && typeof window !== 'undefined') {
    voz.current = criarProvedorVoz();
  }

  /** Transição guardada: só muda se a regra pura permitir. */
  const irPara = useCallback((proximo: EstadoNexoAI) => {
    setEstado((atual) => (podeTransitar(atual, proximo) ? proximo : atual));
  }, []);

  useEffect(() => {
    return () => {
      voz.current?.pararFala();
      voz.current?.pararEscuta();
    };
  }, []);

  const falar = useCallback(
    (texto: string) => {
      const v = voz.current;
      if (!v || !vozLigadaRef.current || !v.podeFalar) {
        setEstado('idle');
        return;
      }
      irPara('speaking');
      v.falar(texto, {
        aoNivel: setNivelVoz,
        aoTerminar: () => {
          setNivelVoz(0);
          setEstado('idle');
        },
        aoErro: (motivo) => {
          setNivelVoz(0);
          setErro(motivo);
          setEstado('error');
          setTimeout(() => setEstado((s) => (s === 'error' ? 'idle' : s)), 60);
        },
      });
    },
    [irPara],
  );

  const enviar = useCallback(
    async (texto: string) => {
      const limpo = texto.trim();
      if (!limpo) return;

      voz.current?.pararFala();
      setParcialEscuta('');
      setErro(null);
      setMensagens((m) => [
        ...m,
        { id: idLocal(), papel: 'user', conteudo: limpo, em: new Date().toISOString() },
      ]);
      setEstado('thinking');

      try {
        const r = await conversar(limpo, conversaId.current);
        conversaId.current = r.conversaId;
        setMensagens((m) => [
          ...m,
          { id: idLocal(), papel: 'assistant', conteudo: r.resposta, em: new Date().toISOString() },
        ]);
        setEstado('responding');
        falar(r.resposta);
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'A NEXO AI encontrou um problema.');
        setEstado('error');
        // Volta para idle sozinho: 'error' só transita para 'idle'.
        setTimeout(() => setEstado((s) => (s === 'error' ? 'idle' : s)), 60);
      }
    },
    [falar],
  );

  const alternarEscuta = useCallback(() => {
    const v = voz.current;
    if (!v?.podeOuvir) {
      setErro('Este navegador não reconhece voz. Use o teclado.');
      return;
    }
    if (estado === 'listening') {
      v.pararEscuta();
      setEstado('idle');
      return;
    }
    v.pararFala();
    setErro(null);
    setParcialEscuta('');
    irPara('listening');
    v.ouvir({
      aoParcial: setParcialEscuta,
      aoFinal: (t) => {
        setParcialEscuta('');
        void enviar(t);
      },
      aoErro: (motivo) => {
        setErro(motivo);
        setEstado((s) => (s === 'listening' ? 'idle' : s));
      },
      aoFim: () => setEstado((s) => (s === 'listening' ? 'idle' : s)),
    });
  }, [estado, enviar, irPara]);

  const alternarVoz = useCallback(() => {
    setVozLigada((v) => {
      if (v) voz.current?.pararFala();
      return !v;
    });
  }, []);

  const silenciar = useCallback(() => {
    voz.current?.pararFala();
    setNivelVoz(0);
    setEstado((s) => (s === 'speaking' ? 'idle' : s));
  }, []);

  const limpar = useCallback(() => {
    voz.current?.pararFala();
    voz.current?.pararEscuta();
    conversaId.current = undefined;
    setMensagens([]);
    setErro(null);
    setParcialEscuta('');
    setNivelVoz(0);
    setEstado('idle');
  }, []);

  return {
    estado,
    mensagens,
    nivelVoz,
    vozLigada,
    erro,
    parcialEscuta,
    podeOuvir: voz.current?.podeOuvir ?? false,
    podeFalar: voz.current?.podeFalar ?? false,
    enviar,
    alternarEscuta,
    alternarVoz,
    silenciar,
    limpar,
  };
}
