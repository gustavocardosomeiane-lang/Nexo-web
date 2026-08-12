/**
 * Primitivas de interface.
 *
 * Componentes pequenos, sem estado e sem opiniao sobre dominio. Tudo que
 * aparece mais de uma vez na aplicacao mora aqui.
 */

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { forwardRef, useId } from 'react';
import { Icon, type NomeIcone } from './Icon';

/* --------------------------------------------------------------------------
   Botão
   -------------------------------------------------------------------------- */

type VarianteBotao = 'primario' | 'secundario' | 'fantasma' | 'perigo';

interface BotaoProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBotao;
  tamanho?: 'sm' | 'md' | 'lg';
  icone?: NomeIcone;
  carregando?: boolean;
  bloco?: boolean;
}

export function Botao({
  variante = 'secundario',
  tamanho = 'md',
  icone,
  carregando = false,
  bloco = false,
  children,
  className = '',
  disabled,
  ...resto
}: BotaoProps) {
  const classes = [
    'btn',
    `btn-${variante}`,
    tamanho !== 'md' ? `btn-${tamanho}` : '',
    bloco ? 'btn-bloco' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={classes} disabled={disabled || carregando} {...resto}>
      {carregando ? <span className="spinner" /> : icone ? <Icon nome={icone} /> : null}
      {children}
    </button>
  );
}

interface BotaoIconeProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icone: NomeIcone;
  /** Obrigatorio: botao sem texto precisa de nome acessivel. */
  rotulo: string;
}

export function BotaoIcone({ icone, rotulo, className = '', ...resto }: BotaoIconeProps) {
  return (
    <button className={`btn-icone ${className}`} aria-label={rotulo} title={rotulo} {...resto}>
      <Icon nome={icone} />
    </button>
  );
}

/* --------------------------------------------------------------------------
   Card
   -------------------------------------------------------------------------- */

export function Card({
  children,
  className = '',
  padding = true,
}: {
  children: ReactNode;
  className?: string;
  padding?: boolean;
}) {
  return <div className={`card ${padding ? 'card-p' : ''} ${className}`}>{children}</div>;
}

export function CardCabeca({
  titulo,
  descricao,
  acoes,
}: {
  titulo: string;
  descricao?: string;
  acoes?: ReactNode;
}) {
  return (
    <div className="card-cabeca">
      <div>
        <div className="card-titulo">{titulo}</div>
        {descricao && <div className="card-sub">{descricao}</div>}
      </div>
      {acoes && <div className="linha">{acoes}</div>}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Campos de formulário
   -------------------------------------------------------------------------- */

interface BaseCampo {
  rotulo?: string;
  erro?: string;
  ajuda?: string;
  obrigatorio?: boolean;
}

function Envolucro({
  id,
  rotulo,
  erro,
  ajuda,
  obrigatorio,
  children,
  className = '',
}: BaseCampo & { id: string; children: ReactNode; className?: string }) {
  return (
    <div className={`campo ${className}`}>
      {rotulo && (
        <label className="campo-rotulo" htmlFor={id}>
          {rotulo}
          {obrigatorio && <span className="obrigatorio" aria-hidden="true">*</span>}
        </label>
      )}
      {children}
      {erro ? (
        // role="alert" faz o leitor de tela anunciar o erro assim que aparece.
        <span className="campo-erro" id={`${id}-erro`} role="alert">
          <Icon nome="alerta" />
          {erro}
        </span>
      ) : ajuda ? (
        <span className="campo-ajuda" id={`${id}-ajuda`}>
          {ajuda}
        </span>
      ) : null}
    </div>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement>, BaseCampo {
  className?: string;
  iconeEsquerda?: NomeIcone;
  acaoDireita?: ReactNode;
}

export const CampoTexto = forwardRef<HTMLInputElement, InputProps>(function CampoTexto(
  { rotulo, erro, ajuda, obrigatorio, className = '', iconeEsquerda, acaoDireita, id, ...resto },
  ref,
) {
  const gerado = useId();
  const idCampo = id ?? gerado;

  const input = (
    <input
      ref={ref}
      id={idCampo}
      className={`input ${erro ? 'input-erro' : ''}`}
      aria-invalid={erro ? true : undefined}
      aria-describedby={erro ? `${idCampo}-erro` : ajuda ? `${idCampo}-ajuda` : undefined}
      aria-required={obrigatorio || undefined}
      {...resto}
    />
  );

  return (
    <Envolucro id={idCampo} rotulo={rotulo} erro={erro} ajuda={ajuda} obrigatorio={obrigatorio} className={className}>
      {iconeEsquerda || acaoDireita ? (
        <div className="campo-com-icone">
          {iconeEsquerda && <Icon nome={iconeEsquerda} />}
          {input}
          {acaoDireita && <div className="campo-acao-direita">{acaoDireita}</div>}
        </div>
      ) : (
        input
      )}
    </Envolucro>
  );
});

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement>, BaseCampo {
  className?: string;
  opcoes: { valor: string; rotulo: string }[];
}

export function CampoSelect({
  rotulo,
  erro,
  ajuda,
  obrigatorio,
  className = '',
  opcoes,
  id,
  ...resto
}: SelectProps) {
  const gerado = useId();
  const idCampo = id ?? gerado;

  return (
    <Envolucro id={idCampo} rotulo={rotulo} erro={erro} ajuda={ajuda} obrigatorio={obrigatorio} className={className}>
      <select
        id={idCampo}
        className={`select ${erro ? 'select-erro' : ''}`}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? `${idCampo}-erro` : undefined}
        {...resto}
      >
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
    </Envolucro>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, BaseCampo {
  className?: string;
}

export function CampoTextarea({
  rotulo,
  erro,
  ajuda,
  obrigatorio,
  className = '',
  id,
  ...resto
}: TextareaProps) {
  const gerado = useId();
  const idCampo = id ?? gerado;

  return (
    <Envolucro id={idCampo} rotulo={rotulo} erro={erro} ajuda={ajuda} obrigatorio={obrigatorio} className={className}>
      <textarea
        id={idCampo}
        className={`textarea ${erro ? 'textarea-erro' : ''}`}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? `${idCampo}-erro` : undefined}
        {...resto}
      />
    </Envolucro>
  );
}

export function Checkbox({
  rotulo,
  ...resto
}: InputHTMLAttributes<HTMLInputElement> & { rotulo: string }) {
  return (
    <label className="check">
      <input type="checkbox" {...resto} />
      <span>{rotulo}</span>
    </label>
  );
}

export function Switch({
  rotulo,
  descricao,
  ...resto
}: InputHTMLAttributes<HTMLInputElement> & { rotulo: string; descricao?: string }) {
  return (
    <label className="switch linha-entre" style={{ width: '100%' }}>
      <span className="pilha" style={{ gap: 2 }}>
        <span style={{ fontSize: '.875rem', color: 'var(--fg)' }}>{rotulo}</span>
        {descricao && <span style={{ fontSize: '.75rem', color: 'var(--fg-dim)' }}>{descricao}</span>}
      </span>
      <span className="linha" style={{ flexShrink: 0 }}>
        <input type="checkbox" {...resto} />
        <span className="switch-trilho" aria-hidden="true" />
      </span>
    </label>
  );
}

/* --------------------------------------------------------------------------
   Sinalização
   -------------------------------------------------------------------------- */

export type TomBadge = 'ok' | 'alerta' | 'erro' | 'info' | 'neutro';

export function Badge({
  tom = 'neutro',
  children,
  ponto = true,
}: {
  tom?: TomBadge;
  children: ReactNode;
  ponto?: boolean;
}) {
  return <span className={`badge badge-${tom} ${ponto ? '' : 'badge-sem-ponto'}`}>{children}</span>;
}

export function Aviso({
  tom = 'info',
  children,
  className = '',
}: {
  tom?: 'erro' | 'alerta' | 'info' | 'ok';
  children: ReactNode;
  className?: string;
}) {
  const icone: NomeIcone = tom === 'erro' ? 'erro' : tom === 'alerta' ? 'alerta' : tom === 'ok' ? 'sucesso' : 'info';
  return (
    <div className={`aviso aviso-${tom} ${className}`} role={tom === 'erro' ? 'alert' : undefined}>
      <Icon nome={icone} />
      <div>{children}</div>
    </div>
  );
}

export function Progresso({ valor, rotulo }: { valor: number; rotulo?: string }) {
  const pct = Math.max(0, Math.min(100, valor));
  return (
    <div
      className="progresso"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={rotulo ?? `${pct}% concluído`}
    >
      <div
        className={`progresso-barra ${pct >= 100 ? 'completo' : ''}`}
        style={{ transform: `scaleX(${pct / 100})`, width: '100%' }}
      />
    </div>
  );
}

export function Avatar({
  nome,
  url,
  tamanho = 'md',
}: {
  nome: string;
  url?: string | null;
  tamanho?: 'sm' | 'md' | 'lg';
}) {
  const classe = tamanho === 'lg' ? 'avatar avatar-lg' : tamanho === 'sm' ? 'avatar avatar-sm' : 'avatar';
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  const letras =
    partes.length === 0
      ? '?'
      : partes.length === 1
        ? partes[0].slice(0, 2).toUpperCase()
        : (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();

  return (
    <span className={classe} aria-hidden="true">
      {url ? <img src={url} alt="" /> : letras}
    </span>
  );
}

/* --------------------------------------------------------------------------
   Estados
   -------------------------------------------------------------------------- */

export function Vazio({
  icone = 'caixaEntrada',
  titulo,
  descricao,
  acao,
}: {
  icone?: NomeIcone;
  titulo: string;
  descricao?: string;
  acao?: ReactNode;
}) {
  return (
    <div className="vazio">
      <div className="vazio-icone">
        <Icon nome={icone} />
      </div>
      <h3>{titulo}</h3>
      {descricao && <p>{descricao}</p>}
      {acao && <div style={{ marginTop: 8 }}>{acao}</div>}
    </div>
  );
}

export function Skeleton({
  altura = 16,
  largura = '100%',
  className = '',
}: {
  altura?: number | string;
  largura?: number | string;
  className?: string;
}) {
  return <div className={`skeleton ${className}`} style={{ height: altura, width: largura }} />;
}

export function SkeletonTabela({ linhas = 6, colunas = 5 }: { linhas?: number; colunas?: number }) {
  return (
    <div className="card" style={{ padding: 16 }} aria-busy="true" aria-label="Carregando dados">
      <div className="pilha" style={{ gap: 12 }}>
        {Array.from({ length: linhas }).map((_, i) => (
          <div key={i} className="linha" style={{ gap: 12 }}>
            {Array.from({ length: colunas }).map((_, j) => (
              <Skeleton key={j} altura={14} largura={j === 0 ? '26%' : `${Math.round(74 / (colunas - 1))}%`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="eyebrow">{children}</span>;
}
