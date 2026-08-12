/**
 * Exportacao de dados.
 *
 * CSV esta implementado. Excel e PDF ainda nao, e a interface diz isso em vez
 * de oferecer um botao que nao funciona:
 *
 *   XLSX  — exige uma biblioteca (SheetJS, ExcelJS). Enquanto isso, o CSV
 *           gerado aqui abre no Excel com acentos corretos e colunas
 *           separadas, que resolve a maior parte dos casos.
 *   PDF   — o caminho sem dependencia e a impressao do navegador; ha estilo de
 *           impressao pronto em `styles/responsive.css`.
 */

export interface ColunaExport<T> {
  titulo: string;
  valor: (item: T) => string | number | null | undefined;
}

/**
 * Escapa uma celula para CSV: aspas duplicadas e o campo entre aspas quando
 * contem separador, aspas ou quebra de linha.
 */
function celula(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  const texto = String(valor);
  return /[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/**
 * Gera o CSV.
 *
 * Separador `;` e BOM UTF-8 sao deliberados: e o que faz o Excel em portugues
 * abrir o arquivo com as colunas separadas e os acentos certos. Com virgula e
 * sem BOM, o Excel brasileiro joga tudo numa coluna so e escreve "Servi§o".
 */
export function gerarCSV<T>(itens: T[], colunas: ColunaExport<T>[]): string {
  const cabecalho = colunas.map((c) => celula(c.titulo)).join(';');
  const linhas = itens.map((item) => colunas.map((c) => celula(c.valor(item))).join(';'));
  return `﻿${[cabecalho, ...linhas].join('\r\n')}`;
}

export function baixarCSV<T>(nomeArquivo: string, itens: T[], colunas: ColunaExport<T>[]): void {
  const conteudo = gerarCSV(itens, colunas);
  const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `${nomeArquivo}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Sem o revoke, o blob fica na memoria ate a aba fechar.
  URL.revokeObjectURL(url);
}

/** Centavos como número decimal — o Excel precisa reconhecer como valor. */
export function valorParaPlanilha(centavos: number | null | undefined): string {
  if (centavos === null || centavos === undefined) return '';
  return (centavos / 100).toFixed(2).replace('.', ',');
}
