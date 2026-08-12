/**
 * KPI. Um numero grande, o que ele significa e, quando ajuda, um contexto
 * embaixo. Nada de sparkline decorativo sem leitura.
 */

import type { ReactNode } from 'react';
import { Icon, type NomeIcone } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/primitives';

interface Props {
  rotulo: string;
  valor: string;
  icone?: NomeIcone;
  /** Só um KPI por grupo recebe o destaque vermelho. */
  destaque?: boolean;
  rodape?: ReactNode;
  carregando?: boolean;
}

export function StatCard({ rotulo, valor, icone, destaque = false, rodape, carregando = false }: Props) {
  return (
    <div className={`stat ${destaque ? 'stat-destaque' : ''}`}>
      <div className="stat-topo">
        <span className="stat-rotulo">{rotulo}</span>
        {icone && (
          <span className={`stat-icone ${destaque ? '' : 'stat-icone-neutro'}`}>
            <Icon nome={icone} />
          </span>
        )}
      </div>

      {carregando ? (
        <Skeleton altura={28} largura="72%" />
      ) : (
        <div className="stat-valor">{valor}</div>
      )}

      {rodape && <div className="stat-rodape">{rodape}</div>}
    </div>
  );
}
