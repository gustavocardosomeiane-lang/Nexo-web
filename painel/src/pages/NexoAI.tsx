/**
 * NEXO AI — a aba da assistente interna.
 *
 * Sem título, sem subtítulo, sem texto de marca: a presença da NEXO AI é
 * comunicada só pelo ORBE, que é o elemento central. Esta tela é apresentação;
 * a inteligência mora no servidor (`api/nexo-ai/*`) e a orquestração em
 * `useNexoAI` — nada disso foi tocado.
 *
 * Identidade da NEXO WEB: preto + vermelho, contida em `.nexo-ai`.
 */

import { useEffect, useRef, useState } from 'react';
import { Aviso } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { useNexoAI } from '@/nexo-ai/useNexoAI';
import { Orbe } from '@/nexo-ai/Orbe';

export function NexoAI() {
  const ai = useNexoAI();
  const [texto, setTexto] = useState('');
  const fimRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [ai.mensagens, ai.estado]);

  const submeter = () => {
    const t = texto.trim();
    if (!t || ai.estado === 'thinking') return;
    setTexto('');
    void ai.enviar(t);
  };

  return (
    <div className="nexo-ai">
      <div className="nexo-ai-palco">
        {/* Controles funcionais, mínimos, no canto — sem texto de identidade. */}
        <div className="nexo-ai-controles">
          <button
            type="button"
            className={`nexo-ai-btn ${ai.vozLigada ? 'ativo' : ''}`}
            onClick={ai.alternarVoz}
            title={ai.vozLigada ? 'Desligar a voz' : 'Ligar a voz'}
            aria-label={ai.vozLigada ? 'Desligar a voz' : 'Ligar a voz'}
            aria-pressed={ai.vozLigada}
          >
            <Icon nome={ai.vozLigada ? 'som' : 'som-off'} tamanho={20} />
          </button>
          {ai.mensagens.length > 0 && (
            <button
              type="button"
              className="nexo-ai-btn"
              onClick={ai.limpar}
              title="Limpar a conversa"
              aria-label="Limpar a conversa"
            >
              <Icon nome="lixeira" tamanho={18} />
            </button>
          )}
        </div>

        <Orbe estado={ai.estado} nivel={ai.nivelVoz} tamanho={340} />

        {ai.erro && (
          <div style={{ maxWidth: 460, width: '100%' }}>
            <Aviso tom="erro">{ai.erro}</Aviso>
          </div>
        )}

        {(ai.mensagens.some((m) => m.papel === 'assistant') || ai.parcialEscuta) && (
          <div className="nexo-ai-conversa" aria-live="polite">
            {ai.mensagens.filter((m) => m.papel === 'assistant').map((m) => (
              <div key={m.id} className="nexo-ai-bolha de-assistant">
                {m.conteudo}
              </div>
            ))}
            {ai.parcialEscuta && (
              <div className="nexo-ai-bolha parcial" aria-live="off">
                {ai.parcialEscuta}
              </div>
            )}
            <div ref={fimRef} />
          </div>
        )}
      </div>

      <div className="nexo-ai-compositor">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submeter();
            }
          }}
          placeholder={ai.podeOuvir ? 'Escreva ou toque no microfone…' : 'Escreva sua mensagem…'}
          rows={1}
          aria-label="Mensagem para a NEXO AI"
        />

        {ai.podeOuvir && (
          <button
            type="button"
            className={`nexo-ai-btn ${ai.estado === 'listening' ? 'ativo escutando' : ''}`}
            onClick={ai.alternarEscuta}
            title={ai.estado === 'listening' ? 'Parar de ouvir' : 'Falar'}
            aria-label={ai.estado === 'listening' ? 'Parar de ouvir' : 'Falar'}
            aria-pressed={ai.estado === 'listening'}
          >
            <Icon nome="microfone" tamanho={20} />
          </button>
        )}

        <button
          type="button"
          className="nexo-ai-btn enviar"
          onClick={submeter}
          disabled={!texto.trim() || ai.estado === 'thinking'}
          title="Enviar"
          aria-label="Enviar"
        >
          <Icon nome="enviar" tamanho={20} />
        </button>
      </div>
    </div>
  );
}
