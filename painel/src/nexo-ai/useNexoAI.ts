/**
 * `useNexoAI` — a máquina de estados da assistente, do lado do navegador.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { podeTransitar, segmentarParaFala, finalizarSegmentacao, type EstadoNexoAI } from '../../shared/regras-nexo-ai';
import { conversarStream } from './cliente';
import { criarProvedorVoz, type ProvedorVoz } from './voz';

export interface MensagemUI { id: string; papel: 'user' | 'assistant'; conteudo: string; em: string; }
export interface UseNexoAI {
  estado: EstadoNexoAI; mensagens: MensagemUI[]; nivelVoz: number; vozLigada: boolean; erro: string | null;
  podeOuvir: boolean; podeFalar: boolean; parcialEscuta: string; enviar: (texto: string) => Promise<void>;
  alternarEscuta: () => void; alternarVoz: () => void; silenciar: () => void; limpar: () => void;
}
const idLocal = () => `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

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
  if (voz.current === null && typeof window !== 'undefined') voz.current = criarProvedorVoz();
  const irPara = useCallback((proximo: EstadoNexoAI) => {
    setEstado((atual) => (podeTransitar(atual, proximo) ? proximo : atual));
  }, []);
  useEffect(() => () => { voz.current?.pararFala(); voz.current?.pararEscuta(); }, []);

  const enviar = useCallback(async (texto: string) => {
    const limpo = texto.trim();
    if (!limpo) return;
    const v = voz.current;
    // null quando a voz está desligada/indisponível — os `if (vozTts)`
    // abaixo então só cuidam do texto, sem tentar falar nada.
    const vozTts: ProvedorVoz | null = v && vozLigadaRef.current && v.podeFalar ? v : null;

    v?.pararFala(); setParcialEscuta(''); setErro(null);

    const idAssistente = idLocal();
    const agora = new Date().toISOString();
    // A mensagem do assistente entra vazia, na hora, com um id fixo — todo
    // chunk que chegar depois atualiza ESSA mesma mensagem (por id), nunca
    // adiciona uma nova. É isso que impede duplicação.
    setMensagens((m) => [
      ...m,
      { id: idLocal(), papel: 'user', conteudo: limpo, em: agora },
      { id: idAssistente, papel: 'assistant', conteudo: '', em: agora },
    ]);
    setEstado('thinking');

    const tEnviar = performance.now();
    if (vozTts) {
      vozTts.iniciarFilaFala({
        aoIniciar: () => {
          console.log('[NEXO LATENCIA] primeiro_audio', Math.round(performance.now() - tEnviar), 'ms');
          irPara('speaking');
        },
        aoNivel: setNivelVoz,
        aoTerminar: () => { setNivelVoz(0); setEstado('idle'); },
        // Erro num segmento de TTS não é erro de conversa — não mexe em
        // `erro`/estado além de zerar o nível, os outros segmentos continuam.
        aoErro: (motivo) => { setNivelVoz(0); setErro(motivo); },
      });
    }

    // Texto bruto completo (pra ai.mensagens/persistência/memória) e o
    // "restante" da segmentação (pra fila de fala) são acumulados à parte —
    // só a REPRODUÇÃO é incremental, o texto continua sempre completo.
    let acumulado = '';
    let bufferFala = '';
    let recebeuChunk = false;
    let logouPrimeiroBloco = false;

    await conversarStream(limpo, conversaId.current, {
      aoIniciar: (novaConversaId) => {
        if (novaConversaId) conversaId.current = novaConversaId;
      },
      aoChunk: (delta) => {
        if (!recebeuChunk) {
          recebeuChunk = true;
          console.log('[NEXO LATENCIA] primeiro_chunk_frontend', Math.round(performance.now() - tEnviar), 'ms');
          irPara('responding');
        }
        acumulado += delta;
        const textoAtual = acumulado;
        setMensagens((m) => m.map((msg) => (msg.id === idAssistente ? { ...msg, conteudo: textoAtual } : msg)));

        // Chunks continuam sendo processados normalmente mesmo depois que o
        // estado já virou 'speaking' — nada aqui é gateado por `estado`.
        if (vozTts) {
          const { segmentos, restante } = segmentarParaFala(bufferFala, delta);
          bufferFala = restante;
          for (const segmento of segmentos) {
            if (!logouPrimeiroBloco) {
              logouPrimeiroBloco = true;
              console.log('[NEXO LATENCIA] primeiro_bloco_tts', Math.round(performance.now() - tEnviar), 'ms');
            }
            vozTts.enfileirarFala(segmento);
          }
        }
      },
      aoFim: (info) => {
        if (info.conversaId) conversaId.current = info.conversaId;

        if (!acumulado.trim()) {
          // Nada foi gerado — mesmo fallback que o backend usa ao persistir.
          const fallback = 'Não consegui formular uma resposta agora.';
          setMensagens((m) => m.map((msg) => (msg.id === idAssistente ? { ...msg, conteudo: fallback } : msg)));
          if (vozTts) vozTts.enfileirarFala(fallback);
        } else if (vozTts) {
          // Sobra do buffer de segmentação sem pontuação final (frase que
          // fecha a resposta sem ".") ainda precisa ser falada.
          const ultimo = finalizarSegmentacao(bufferFala);
          if (ultimo) vozTts.enfileirarFala(ultimo);
        }

        if (vozTts) {
          vozTts.encerrarFilaFala(); // aoTerminar (acima) leva a UI de volta a 'idle' quando a fila esvaziar
        } else {
          setEstado('idle');
        }
      },
      aoErro: (motivo) => {
        setErro(motivo);
        // Remove a bolha provisória em vez de deixar uma resposta quebrada
        // ou incompleta parecendo definitiva — e cala qualquer fala já
        // enfileirada dessa mesma resposta (não faz sentido continuar
        // falando um turno que o próprio streaming marcou como falho).
        setMensagens((m) => m.filter((msg) => msg.id !== idAssistente));
        if (vozTts) vozTts.pararFilaFala();
        setEstado('error'); setTimeout(() => setEstado((s) => (s === 'error' ? 'idle' : s)), 60);
      },
    });
  }, [irPara]);

  const alternarEscuta = useCallback(() => {
    const v = voz.current;
    if (!v?.podeOuvir) { setErro('Este navegador não reconhece voz. Use o teclado.'); return; }
    // 2º clique durante 'listening' = finalizar e enviar, nunca cancelar. A
    // transição de estado vem dos callbacks de ouvir() (aoProcessando/aoFinal
    // /aoFim), os mesmos que o encerramento automático da gravação usa —
    // mesmo caminho para os dois casos, sem estado especial aqui.
    if (estado === 'listening') { v.finalizarEscuta(); return; }
    v.pararFala(); setErro(null); setParcialEscuta(''); irPara('listening');
    // Só aoFim precisa desse flag: aoErro e aoFinal nunca disparam juntos
    // (concluirGravacao em voz.ts é um try/catch), então quando aoErro roda
    // enviar() nunca foi chamado. O caso ambíguo é só aoFim depois de aoFinal
    // ter passado a bola pra enviar() — sem o flag, o reset abaixo apagaria o
    // 'thinking' real do envio, achando que ainda era o da transcrição.
    let enviouTexto = false;
    v.ouvir({
      aoParcial: setParcialEscuta,
      // Gravação encerrada, upload + transcrição em andamento — texto final
      // ainda não existe, mas a NEXO já está "ocupada" com o pedido do
      // usuário. Mesmo estado visual de 'thinking' (mic desabilitado,
      // orbe em modo de processamento), sem precisar de um estado novo.
      aoProcessando: () => setEstado('thinking'),
      aoFinal: (t) => { enviouTexto = true; setParcialEscuta(''); void enviar(t); },
      aoErro: (motivo) => { setErro(motivo); setEstado((s) => (s === 'listening' || s === 'thinking' ? 'idle' : s)); },
      aoFim: () => { if (!enviouTexto) setEstado((s) => (s === 'listening' || s === 'thinking' ? 'idle' : s)); },
    });
  }, [estado, enviar, irPara]);

  const alternarVoz = useCallback(() => { setVozLigada((v) => { if (v) voz.current?.pararFala(); return !v; }); }, []);
  const silenciar = useCallback(() => { voz.current?.pararFala(); setNivelVoz(0); setEstado((s) => (s === 'speaking' ? 'idle' : s)); }, []);
  const limpar = useCallback(() => { voz.current?.pararFala(); voz.current?.pararEscuta(); conversaId.current = undefined; setMensagens([]); setErro(null); setParcialEscuta(''); setNivelVoz(0); setEstado('idle'); }, []);
  return { estado, mensagens, nivelVoz, vozLigada, erro, parcialEscuta, podeOuvir: voz.current?.podeOuvir ?? false, podeFalar: voz.current?.podeFalar ?? false, enviar, alternarEscuta, alternarVoz, silenciar, limpar };
}
