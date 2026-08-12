/**
 * Busca, filtro, ordenacao e paginacao em memoria.
 *
 * Usado pelo provider mock. O provider do Supabase faz o mesmo trabalho no
 * banco (WHERE / ORDER BY / RANGE), que e onde ele deve ser feito quando os
 * dados sao reais.
 */

import type { Page, QueryOptions } from '@/types';

/** Remove acento e caixa: procurar "traco" precisa achar "TRAÇO". */
export function normalizar(valor: unknown): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function dentroDoPeriodo(valor: unknown, de: string, ate: string): boolean {
  if (typeof valor !== 'string' || valor === '') return false;
  const dia = valor.slice(0, 10);
  return dia >= de && dia <= ate;
}

export interface QueryConfig<T> {
  /** Colunas varridas pela busca livre. */
  camposBusca: (keyof T)[];
  /** Coluna usada pelo filtro de periodo. */
  campoData?: keyof T;
  ordenarPorPadrao?: keyof T;
  ordemPadrao?: 'asc' | 'desc';
}

export function aplicarQuery<T extends Record<string, unknown>>(
  dados: T[],
  opcoes: QueryOptions<T> = {},
  config: QueryConfig<T>,
): { itens: T[]; total: number } {
  let itens = [...dados];

  // Filtros exatos. `undefined`, string vazia e 'todos' significam "sem filtro",
  // o que deixa o componente de filtro simples: ele so joga o valor cru aqui.
  if (opcoes.filtros) {
    for (const [campo, valor] of Object.entries(opcoes.filtros)) {
      if (valor === undefined || valor === null || valor === '' || valor === 'todos') continue;
      if (Array.isArray(valor)) {
        if (valor.length === 0) continue;
        itens = itens.filter((item) => valor.includes(item[campo]));
      } else {
        itens = itens.filter((item) => item[campo] === valor);
      }
    }
  }

  if (opcoes.periodo && config.campoData) {
    const { de, ate } = opcoes.periodo;
    const campo = config.campoData;
    itens = itens.filter((item) => dentroDoPeriodo(item[campo], de, ate));
  }

  const busca = normalizar(opcoes.busca).trim();
  if (busca) {
    itens = itens.filter((item) =>
      config.camposBusca.some((campo) => normalizar(item[campo]).includes(busca)),
    );
  }

  const ordenarPor = opcoes.ordenarPor ?? config.ordenarPorPadrao;
  if (ordenarPor) {
    const direcao = (opcoes.ordem ?? config.ordemPadrao ?? 'desc') === 'asc' ? 1 : -1;
    itens.sort((a, b) => {
      const va = a[ordenarPor];
      const vb = b[ordenarPor];
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * direcao;
      return normalizar(va).localeCompare(normalizar(vb), 'pt-BR') * direcao;
    });
  }

  const total = itens.length;

  if (opcoes.porPagina && opcoes.porPagina > 0) {
    const pagina = Math.max(1, opcoes.pagina ?? 1);
    const inicio = (pagina - 1) * opcoes.porPagina;
    itens = itens.slice(inicio, inicio + opcoes.porPagina);
  }

  return { itens, total };
}

export function paginar<T>(itens: T[], total: number, opcoes: QueryOptions<T> = {}): Page<T> {
  return {
    itens,
    total,
    pagina: Math.max(1, opcoes.pagina ?? 1),
    porPagina: opcoes.porPagina ?? total,
  };
}
