/** NEXO AI — interface limpa: o orbe é o foco e a conversa não é exibida. */
import { useState } from 'react';
import { Aviso } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { useNexoAI } from '@/nexo-ai/useNexoAI';
import { Orbe } from '@/nexo-ai/Orbe';

export function NexoAI() {
  const ai = useNexoAI();
  const [texto, setTexto] = useState('');

  const submeter = () => {
    const t = texto.trim();
    if (!t || ai.estado === 'thinking') return;
    setTexto('');
    void ai.enviar(t);
  };

  return (
    <div className="nexo-ai">
      <div className="nexo-ai-palco">
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
        </div>

        <Orbe estado={ai.estado} nivel={ai.nivelVoz} tamanho={340} />

        {ai.erro && (
          <div style={{ maxWidth: 460, width: '100%' }}>
            <Aviso tom="erro">{ai.erro}</Aviso>
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
          placeholder="Escreva ou toque no microfone…"
          rows={1}
          aria-label="Mensagem para a NEXO AI"
        />

        <button
          type="button"
          className={`nexo-ai-btn ${ai.estado === 'listening' ? 'ativo escutando' : ''}`}
          onClick={ai.alternarEscuta}
          title={ai.estado === 'listening' ? 'Parar de ouvir' : 'Falar com a NEXO'}
          aria-label={ai.estado === 'listening' ? 'Parar de ouvir' : 'Falar com a NEXO'}
          aria-pressed={ai.estado === 'listening'}
        >
          <Icon nome="microfone" tamanho={20} />
        </button>

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
