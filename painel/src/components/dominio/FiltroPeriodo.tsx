/**
 * Seletor de periodo: presets numa linha e, ao escolher "Personalizado",
 * dois campos de data. Os controles ficam em uma linha unica acima dos
 * graficos, e nao espalhados por cima deles.
 */

import type { DateRange } from '@/types';
import { PRESETS, type PresetPeriodo } from '@/hooks/usePeriodo';
import { formatarData } from '@/lib/format';

interface Props {
  preset: PresetPeriodo;
  periodo: DateRange;
  aoEscolher: (preset: PresetPeriodo) => void;
  aoDefinirPersonalizado: (campo: 'de' | 'ate', valor: string) => void;
}

export function FiltroPeriodo({ preset, periodo, aoEscolher, aoDefinirPersonalizado }: Props) {
  const hoje = new Date().toISOString().slice(0, 10);

  return (
    <div className="filtro-periodo">
      <div className="chips" role="group" aria-label="Período">
        {PRESETS.map((p) => (
          <button
            key={p.valor}
            type="button"
            className="chip"
            aria-pressed={preset === p.valor}
            onClick={() => aoEscolher(p.valor)}
          >
            {p.rotulo}
          </button>
        ))}
      </div>

      {preset === 'personalizado' ? (
        <div className="linha" style={{ gap: 8 }}>
          <input
            type="date"
            className="input"
            style={{ width: 'auto', minHeight: 34, padding: '5px 10px' }}
            value={periodo.de}
            max={periodo.ate}
            onChange={(e) => aoDefinirPersonalizado('de', e.target.value)}
            aria-label="Data inicial"
          />
          <span style={{ color: 'var(--fg-dim)', fontSize: '.8125rem' }}>até</span>
          <input
            type="date"
            className="input"
            style={{ width: 'auto', minHeight: 34, padding: '5px 10px' }}
            value={periodo.ate}
            min={periodo.de}
            max={hoje}
            onChange={(e) => aoDefinirPersonalizado('ate', e.target.value)}
            aria-label="Data final"
          />
        </div>
      ) : (
        <span className="filtro-periodo-resumo">
          {formatarData(periodo.de)} — {formatarData(periodo.ate)}
        </span>
      )}
    </div>
  );
}
