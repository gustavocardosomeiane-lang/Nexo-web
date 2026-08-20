/**
 * `useNexoAI` — a máquina de estados da assistente, do lado do navegador.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { podeTransitar, segmentarParaFala, finalizarSegmentacao, type EstadoNexoAI } from '../../shared/regras-nexo-ai';
import { conversarStream, criarNovaConversa } from './cliente';
import { criarProvedorVoz, type ProvedorVoz } from './voz';

export interface MensagemUI { id: string; papel: 'user' | 'assistant'; conteudo: string; em: string; }
export interface UseNexoAI {
  estado: EstadoNexoAI; mensagens: MensagemUI[]; nivelVoz: number; vozLigada: boolean; erro: string | null;
  podeOuvir: boolean; podeFalar: boolean; parcialEscuta: string; enviar: (texto: string) => Promise<void>;
  alternarEscuta: () => void; alternarVoz: () => void; silenciar: () => void; limpar: () => void;
  /** Cria e troca para uma conversa nova (botão "Nova conversa") — não apaga nada. */
  novaConversa: () => Promise<void>;
  /** Enquanto a nova conversa está sendo criada — pra desabilitar o botão e evitar duplo clique. */
  criandoConversa: boolean;
}
const idLocal = () => `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export function useNexoAI(): UseNexoAI {
  const [estado, setEstado] = useState<EstadoNexoAI>('idle');
  const [mensagens, setMensagens] = useState<MensagemUI[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [nivelVoz, setNivelVoz] = useState(0);
  const [vozLigada, setVozLigada] = useState(true);
  const [parcialEscuta, setParcialEscuta] = useState('');
  const [criandoConversa, setCriandoConversa] = useState(false);
  const conversaId = useRef<string | undefined>(undefined);
  // Incrementada a cada `novaConversa()` bem-sucedida — invalida os
  // callbacks (`aoIniciar`/`aoFim`) de um `enviar()` que ainda estivesse em
  // andamento na conversa ANTERIOR: sem isso, uma resposta que já estava a
  // caminho escreveria o `conversaId` antigo de volta por cima da conversa
  // nova assim que chegasse, desfazendo a troca silenciosamente. Mesmo
  // desenho de `geracaoFala` em voz.ts, pro mesmo problema.
  const conversaGeracao = useRef(0);
  // Guarda de duplo clique em REF, não em state: `criandoConversa` (state)
  // só atualiza no próximo render, então dois cliques na mesma "tick" ainda
  // veriam o state antigo (false) e passariam os dois pela checagem. Ref
  // muda na hora, então o 2º clique síncrono já vê `true`.
  const criandoConversaRef = useRef(false);
  // Controlador da requisição de /conversar em voo — "Nova conversa" chama
  // .abort() nele antes de trocar de conversa, pra não deixar uma resposta
  // velha gerando (e gastando token) por baixo da conversa nova. `null`
  // quando não há requisição em andamento (nunca aborta algo que já
  // terminou nem deixa uma referência velha por engano).
  const controladorAtual = useRef<AbortController | null>(null);
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
    // Capturado ANTES do fetch — se `novaConversa()` rodar enquanto esta
    // resposta ainda está a caminho, a geração muda e os callbacks abaixo
    // param de gravar em `conversaId.current` (ver comentário no `useRef`).
    // Continua valendo mesmo com o cancelamento por AbortController abaixo —
    // defesa em camada: se por algum motivo o abort não interromper a tempo
    // (ex.: um frame que já estava no buffer de decodificação), a geração
    // ainda impede a escrita indevida.
    const geracaoDoEnvio = conversaGeracao.current;
    const controlador = new AbortController();
    controladorAtual.current = controlador;

    await conversarStream(limpo, conversaId.current, {
      aoIniciar: (novaConversaId) => {
        if (novaConversaId && conversaGeracao.current === geracaoDoEnvio) conversaId.current = novaConversaId;
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
        if (info.conversaId && conversaGeracao.current === geracaoDoEnvio) conversaId.current = info.conversaId;

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
    }, controlador.signal);

    // Terminou (sucesso, erro ou aborto) — solta a referência pra
    // `novaConversa()` nunca abortar um controlador de uma requisição que já
    // não está mais em andamento.
    if (controladorAtual.current === controlador) controladorAtual.current = null;
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

  /**
   * Botão "Nova conversa": cria a conversa no servidor ANTES de trocar
   * qualquer estado local — só mexe em `conversaId`/`mensagens`/estado
   * DEPOIS de confirmar a criação, então uma falha (rede, sessão expirada)
   * nunca apaga a conversa atual (histórico continua intacto, o usuário só
   * vê o erro e pode tentar de novo). Nenhuma mensagem, conversa ou memória
   * antiga é removida — isso só cria mais uma linha em `ai_conversations`.
   */
  const novaConversa = useCallback(async () => {
    if (criandoConversaRef.current) return;
    criandoConversaRef.current = true;
    setCriandoConversa(true);
    setErro(null);
    try {
      const id = await criarNovaConversa();
      voz.current?.pararFala();
      voz.current?.pararEscuta();
      // Cancela a resposta em voo (se houver) ANTES de trocar de conversa —
      // sem isso ela continua gerando por baixo, gastando token à toa, e só
      // a guarda de geração abaixo evitaria ela contaminar o estado novo.
      // `ehAbortoIntencional` (shared/regras-nexo-ai.ts) garante que isto
      // NUNCA aparece como erro pro usuário.
      controladorAtual.current?.abort();
      controladorAtual.current = null;
      // Invalida os callbacks de qualquer enviar() ainda em voo na conversa
      // anterior — defesa adicional, ver o comentário no useRef de
      // conversaGeracao acima.
      conversaGeracao.current += 1;
      conversaId.current = id;
      setMensagens([]);
      setParcialEscuta('');
      setNivelVoz(0);
      setEstado('idle');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível criar uma nova conversa. Tente de novo.');
    } finally {
      criandoConversaRef.current = false;
      setCriandoConversa(false);
    }
  }, []);

  return {
    estado, mensagens, nivelVoz, vozLigada, erro, parcialEscuta,
    podeOuvir: voz.current?.podeOuvir ?? false, podeFalar: voz.current?.podeFalar ?? false,
    enviar, alternarEscuta, alternarVoz, silenciar, limpar, novaConversa, criandoConversa,
  };
}
