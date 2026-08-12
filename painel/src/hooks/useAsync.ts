/**
 * Carga assincrona simples, com descarte de resposta obsoleta.
 *
 * Para tudo que nao e listagem paginada: metricas, series de grafico, um
 * registro unico, o catalogo de servicos para preencher um select.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export function useAsync<T>(
  carregar: () => Promise<T>,
  dependencias: unknown[],
  inicial: T,
): { dado: T; carregando: boolean; erro: string | null; recarregar: () => void } {
  const [dado, setDado] = useState<T>(inicial);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [gatilho, setGatilho] = useState(0);

  const requisicaoAtual = useRef(0);
  const carregarRef = useRef(carregar);
  carregarRef.current = carregar;

  useEffect(() => {
    const id = ++requisicaoAtual.current;
    setCarregando(true);
    setErro(null);

    carregarRef
      .current()
      .then((resultado) => {
        if (id !== requisicaoAtual.current) return;
        setDado(resultado);
      })
      .catch((e: unknown) => {
        if (id !== requisicaoAtual.current) return;
        setErro(e instanceof Error ? e.message : 'Não foi possível carregar.');
      })
      .finally(() => {
        if (id === requisicaoAtual.current) setCarregando(false);
      });
    // A funcao `carregar` vive numa ref de proposito: se entrasse no array,
    // toda arrow function nova do componente pai dispararia outra consulta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencias, gatilho]);

  const recarregar = useCallback(() => setGatilho((n) => n + 1), []);

  return { dado, carregando, erro, recarregar };
}
