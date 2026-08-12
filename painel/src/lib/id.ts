/**
 * Geracao de identificadores.
 *
 * Em producao quem gera o id e o PostgreSQL (`gen_random_uuid()`). Estas
 * funcoes servem ao modo mock e a chaves de UI.
 */

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Navegador antigo ou contexto sem HTTPS: suficiente para uso local.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Codigo legivel de venda: NX-0042. */
export function codigoVenda(sequencial: number): string {
  return `NX-${String(sequencial).padStart(4, '0')}`;
}
