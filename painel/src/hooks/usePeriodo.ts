/**
 * Filtro de periodo compartilhado por dashboard, financeiro e relatorios.
 */

import { useCallback, useMemo, useState } from 'react';
import type { DateRange } from '@/types';

export type PresetPeriodo = 'hoje' | '7dias' | '30dias' | 'mes' | 'ano' | 'personalizado';

export const PRESETS: { valor: PresetPeriodo; rotulo: string }[] = [
  { valor: 'hoje', rotulo: 'Hoje' },
  { valor: '7dias', rotulo: '7 dias' },
  { valor: '30dias', rotulo: '30 dias' },
  { valor: 'mes', rotulo: 'Este mês' },
  { valor: 'ano', rotulo: 'Este ano' },
  { valor: 'personalizado', rotulo: 'Personalizado' },
];

function iso(d: Date): string {
  // Fatiar o toISOString() converteria para UTC e, a noite, devolveria ontem.
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

export function intervaloDe(preset: PresetPeriodo): DateRange {
  const hoje = new Date();
  const ate = iso(hoje);

  switch (preset) {
    case 'hoje':
      return { de: ate, ate };
    case '7dias': {
      const d = new Date(hoje);
      d.setDate(d.getDate() - 6);
      return { de: iso(d), ate };
    }
    case '30dias': {
      const d = new Date(hoje);
      d.setDate(d.getDate() - 29);
      return { de: iso(d), ate };
    }
    case 'mes':
      return { de: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), ate };
    case 'ano':
      return { de: iso(new Date(hoje.getFullYear(), 0, 1)), ate };
    case 'personalizado':
    default:
      return { de: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), ate };
  }
}

export function usePeriodo(inicial: PresetPeriodo = '30dias') {
  const [preset, setPreset] = useState<PresetPeriodo>(inicial);
  const [personalizado, setPersonalizado] = useState<DateRange>(() => intervaloDe(inicial));

  const periodo = useMemo(
    () => (preset === 'personalizado' ? personalizado : intervaloDe(preset)),
    [preset, personalizado],
  );

  const escolher = useCallback((novo: PresetPeriodo) => {
    setPreset(novo);
    if (novo !== 'personalizado') setPersonalizado(intervaloDe(novo));
  }, []);

  const definirPersonalizado = useCallback((campo: 'de' | 'ate', valor: string) => {
    setPreset('personalizado');
    setPersonalizado((atual) => {
      const proximo = { ...atual, [campo]: valor };
      // Trocar a data inicial para depois da final produziria período vazio.
      if (proximo.de > proximo.ate) {
        return campo === 'de' ? { de: valor, ate: valor } : { de: valor, ate: valor };
      }
      return proximo;
    });
  }, []);

  return { preset, periodo, escolher, definirPersonalizado };
}
