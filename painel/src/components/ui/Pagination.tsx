/**
 * Paginacao.
 *
 * Mostra no maximo 5 botoes de pagina e usa reticencias no resto: com 40
 * paginas, uma fileira de 40 botoes e pior do que nao ter paginacao.
 */

import { Icon } from './Icon';

interface Props {
  pagina: number;
  porPagina: number;
  total: number;
  aoMudar: (pagina: number) => void;
  rotuloItem?: string;
}

function janela(atual: number, ultima: number): (number | '…')[] {
  if (ultima <= 7) return Array.from({ length: ultima }, (_, i) => i + 1);

  const paginas: (number | '…')[] = [1];
  const inicio = Math.max(2, atual - 1);
  const fim = Math.min(ultima - 1, atual + 1);

  if (inicio > 2) paginas.push('…');
  for (let p = inicio; p <= fim; p++) paginas.push(p);
  if (fim < ultima - 1) paginas.push('…');
  paginas.push(ultima);

  return paginas;
}

export function Paginacao({ pagina, porPagina, total, aoMudar, rotuloItem = 'registros' }: Props) {
  const ultima = Math.max(1, Math.ceil(total / porPagina));
  if (total === 0) return null;

  const de = (pagina - 1) * porPagina + 1;
  const ate = Math.min(total, pagina * porPagina);

  return (
    <nav className="paginacao" aria-label="Paginação">
      <span>
        <strong style={{ color: 'var(--fg-muted)' }}>
          {de}–{ate}
        </strong>{' '}
        de {total} {rotuloItem}
      </span>

      {ultima > 1 && (
        <div className="paginacao-controles">
          <button
            className="pag-num"
            onClick={() => aoMudar(pagina - 1)}
            disabled={pagina <= 1}
            aria-label="Página anterior"
          >
            <Icon nome="esquerda" tamanho={15} />
          </button>

          {janela(pagina, ultima).map((p, i) =>
            p === '…' ? (
              <span key={`gap-${i}`} className="pag-num" aria-hidden="true">
                …
              </span>
            ) : (
              <button
                key={p}
                className="pag-num"
                aria-current={p === pagina ? 'page' : undefined}
                aria-label={`Página ${p}`}
                onClick={() => aoMudar(p)}
              >
                {p}
              </button>
            ),
          )}

          <button
            className="pag-num"
            onClick={() => aoMudar(pagina + 1)}
            disabled={pagina >= ultima}
            aria-label="Próxima página"
          >
            <Icon nome="direita" tamanho={15} />
          </button>
        </div>
      )}
    </nav>
  );
}
