/**
 * Estado de uma listagem: busca, filtros, ordenacao, paginacao e recarga.
 *
 * Todas as telas de lista usam este hook. Ele resolve tres coisas que sempre
 * dao errado quando escritas de novo a cada tela:
 *
 *   1. busca com atraso (debounce), para nao consultar a cada tecla;
 *   2. volta para a pagina 1 quando busca ou filtro mudam — senao a pessoa fica
 *      olhando a pagina 7 de um resultado que agora tem 2;
 *   3. descarte de resposta obsoleta: se uma consulta antiga chegar depois de
 *      uma nova, ela e ignorada em vez de sobrescrever a tela.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { QueryOptions } from '@/types';
import type { Repository } from '@/data/provider';

interface Opcoes<T> {
  porPagina?: number;
  ordenarPor?: keyof T & string;
  ordem?: 'asc' | 'desc';
  filtrosIniciais?: Record<string, unknown>;
  buscaInicial?: string;
  periodo?: { de: string; ate: string };
  /** `false` adia a consulta (ex.: esperando o id da rota). */
  ativo?: boolean;
}

const ATRASO_BUSCA = 280;

export function useColecao<T>(repositorio: Repository<T>, opcoes: Opcoes<T> = {}) {
  const {
    porPagina = 20,
    ordenarPor: ordenarPorInicial,
    ordem: ordemInicial = 'desc',
    filtrosIniciais = {},
    buscaInicial = '',
    periodo,
    ativo = true,
  } = opcoes;

  const [itens, setItens] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [busca, setBusca] = useState(buscaInicial);
  const [buscaAtrasada, setBuscaAtrasada] = useState(buscaInicial);
  const [filtros, setFiltros] = useState<Record<string, unknown>>(filtrosIniciais);
  const [pagina, setPagina] = useState(1);
  const [ordenarPor, setOrdenarPor] = useState<string | undefined>(ordenarPorInicial);
  const [ordem, setOrdem] = useState<'asc' | 'desc'>(ordemInicial);
  const [gatilho, setGatilho] = useState(0);

  /* ---- Debounce da busca ---- */
  useEffect(() => {
    const t = window.setTimeout(() => setBuscaAtrasada(busca), ATRASO_BUSCA);
    return () => window.clearTimeout(t);
  }, [busca]);

  /* ---- Volta para a primeira página quando o recorte muda ---- */
  const assinaturaFiltros = JSON.stringify(filtros);
  const assinaturaPeriodo = periodo ? `${periodo.de}|${periodo.ate}` : '';
  useEffect(() => {
    setPagina(1);
  }, [buscaAtrasada, assinaturaFiltros, assinaturaPeriodo]);

  /* ---- Consulta ---- */
  const requisicaoAtual = useRef(0);

  useEffect(() => {
    if (!ativo) {
      setCarregando(false);
      return;
    }

    const id = ++requisicaoAtual.current;
    setCarregando(true);
    setErro(null);

    const consulta: QueryOptions<T> = {
      busca: buscaAtrasada,
      filtros: filtros as QueryOptions<T>['filtros'],
      periodo,
      ordenarPor: ordenarPor as keyof T | undefined,
      ordem,
      pagina,
      porPagina,
    };

    repositorio
      .listar(consulta)
      .then((pagina) => {
        if (id !== requisicaoAtual.current) return; // resposta obsoleta
        setItens(pagina.itens);
        setTotal(pagina.total);
      })
      .catch((e: unknown) => {
        if (id !== requisicaoAtual.current) return;
        setErro(e instanceof Error ? e.message : 'Não foi possível carregar os dados.');
        setItens([]);
        setTotal(0);
      })
      .finally(() => {
        if (id === requisicaoAtual.current) setCarregando(false);
      });
    // `filtros` e `periodo` entram pela assinatura serializada: comparar por
    // referencia dispararia consulta a cada render do componente pai.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    repositorio,
    buscaAtrasada,
    assinaturaFiltros,
    assinaturaPeriodo,
    ordenarPor,
    ordem,
    pagina,
    porPagina,
    ativo,
    gatilho,
  ]);

  const recarregar = useCallback(() => setGatilho((n) => n + 1), []);

  /** Clique no cabeçalho: mesma coluna inverte a direção, outra coluna reinicia. */
  const alternarOrdem = useCallback(
    (campo: string) => {
      if (ordenarPor === campo) {
        setOrdem((atual) => (atual === 'asc' ? 'desc' : 'asc'));
      } else {
        setOrdenarPor(campo);
        setOrdem('desc');
      }
    },
    [ordenarPor],
  );

  const definirFiltro = useCallback((campo: string, valor: unknown) => {
    setFiltros((atual) => ({ ...atual, [campo]: valor }));
  }, []);

  const limparFiltros = useCallback(() => {
    setFiltros(filtrosIniciais);
    setBusca('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const temFiltroAtivo = useMemo(
    () =>
      busca.trim() !== '' ||
      Object.values(filtros).some((v) => v !== undefined && v !== '' && v !== 'todos'),
    [busca, filtros],
  );

  return {
    itens,
    total,
    carregando,
    erro,
    busca,
    setBusca,
    filtros,
    definirFiltro,
    limparFiltros,
    temFiltroAtivo,
    pagina,
    setPagina,
    porPagina,
    ordenarPor,
    ordem,
    alternarOrdem,
    recarregar,
  };
}
