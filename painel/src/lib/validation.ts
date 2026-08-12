/**
 * Validacao e sanitizacao de entrada.
 *
 * Roda no cliente para dar feedback imediato. NAO substitui a validacao do
 * banco: quem realmente barra dado invalido em producao sao as constraints do
 * PostgreSQL e as policies de Row Level Security — o navegador e territorio do
 * usuario e tudo que roda nele pode ser contornado.
 */

export type Erros<T> = Partial<Record<keyof T, string>>;

/* --------------------------------------------------------------------------
   Sanitizacao
   -------------------------------------------------------------------------- */

/**
 * Limpa texto livre antes de guardar: corta espaco sobrando, normaliza quebras
 * de linha, remove caracteres de controle e limita o tamanho.
 *
 * Nao existe escape de HTML aqui de proposito — o React escapa tudo que passa
 * por JSX, e o painel nao usa `dangerouslySetInnerHTML` em lugar nenhum.
 * Escapar duas vezes so produziria `&amp;lt;` na tela.
 */
export function limparTexto(valor: string, maximo = 500): string {
  return valor
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, maximo);
}

/** So digitos. Para telefone, documento e afins. */
export function apenasDigitos(valor: string, maximo = 20): string {
  return valor.replace(/\D/g, '').slice(0, maximo);
}

/* --------------------------------------------------------------------------
   Regras
   -------------------------------------------------------------------------- */

export function obrigatorio(valor: string | null | undefined, campo = 'Este campo'): string | null {
  return valor && valor.trim().length > 0 ? null : `${campo} é obrigatório.`;
}

export function tamanhoMinimo(valor: string, minimo: number, campo = 'Este campo'): string | null {
  return valor.trim().length >= minimo
    ? null
    : `${campo} precisa de pelo menos ${minimo} caracteres.`;
}

/**
 * E-mail: exige texto@dominio.tld, sem espaco e com TLD de 2+ letras.
 * Proposital que seja simples — regex de RFC completa rejeita endereco valido
 * e aceita coisa estranha. Quem valida de verdade e o envio.
 */
export function emailValido(valor: string): string | null {
  if (!valor.trim()) return 'Informe o e-mail.';
  const ok = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(valor.trim());
  return ok ? null : 'E-mail inválido.';
}

/** Celular brasileiro: DDD + 8 ou 9 digitos, com ou sem o 55. */
export function telefoneValido(valor: string, opcional = false): string | null {
  const d = valor.replace(/\D/g, '');
  if (d.length === 0) return opcional ? null : 'Informe o telefone.';
  const nacional = d.startsWith('55') && d.length > 11 ? d.slice(2) : d;
  return nacional.length === 10 || nacional.length === 11
    ? null
    : 'Telefone inválido. Use DDD + número.';
}

export function senhaValida(valor: string): string | null {
  if (!valor) return 'Informe a senha.';
  if (valor.length < 8) return 'A senha precisa de pelo menos 8 caracteres.';
  return null;
}

/** Valor monetario em centavos. */
export function valorValido(centavos: number, opcoes: { min?: number; max?: number } = {}): string | null {
  const { min = 0, max = 100_000_000_00 } = opcoes;
  if (!Number.isFinite(centavos)) return 'Valor inválido.';
  if (centavos < min) return 'Valor não pode ser negativo.';
  if (centavos > max) return 'Valor acima do limite permitido.';
  return null;
}

export function inteiroEntre(valor: number, min: number, max: number, campo = 'Valor'): string | null {
  if (!Number.isInteger(valor)) return `${campo} precisa ser um número inteiro.`;
  if (valor < min || valor > max) return `${campo} precisa estar entre ${min} e ${max}.`;
  return null;
}

export function dataValida(valor: string, opcional = false): string | null {
  if (!valor) return opcional ? null : 'Informe a data.';
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? 'Data inválida.' : null;
}

/** Junta as regras e devolve so o que falhou. */
export function coletarErros<T>(regras: Partial<Record<keyof T, string | null>>): Erros<T> {
  const erros: Erros<T> = {};
  for (const [campo, erro] of Object.entries(regras) as [keyof T, string | null][]) {
    if (erro) erros[campo] = erro;
  }
  return erros;
}

export function temErro<T>(erros: Erros<T>): boolean {
  return Object.keys(erros).length > 0;
}
