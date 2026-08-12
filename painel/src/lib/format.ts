/**
 * Formatacao para leitura humana. pt-BR em tudo.
 *
 * Convencao do projeto: dinheiro trafega em CENTAVOS (inteiro) e so vira
 * decimal na hora de exibir. Ponto flutuante em dinheiro produz aquele
 * classico R$ 1.399,99 no lugar de R$ 1.400,00.
 */

const moeda = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const moedaCompacta = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const dataCurta = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const dataLonga = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

const dataHora = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Centavos -> "R$ 1.400,00" */
export function brl(centavos: number): string {
  return moeda.format((centavos ?? 0) / 100);
}

/** Centavos -> "R$ 18,5 mil". Para eixos de grafico, onde espaco e escasso. */
export function brlCompacto(centavos: number): string {
  return moedaCompacta.format((centavos ?? 0) / 100);
}

/** "1.400,00" -> 140000. Aceita o que o usuario digitar num input. */
export function paraCentavos(entrada: string | number): number {
  if (typeof entrada === 'number') return Math.round(entrada * 100);
  const limpo = entrada.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number.parseFloat(limpo);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Centavos -> "1400,00", para preencher campo de formulario. */
export function centavosParaCampo(centavos: number): string {
  return ((centavos ?? 0) / 100).toFixed(2).replace('.', ',');
}

export function formatarData(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dataCurta.format(d);
}

export function formatarDataLonga(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dataLonga.format(d);
}

export function formatarDataHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dataHora.format(d);
}

/** "há 3 dias", "agora há pouco". */
export function tempoRelativo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';

  const segundos = Math.round((Date.now() - d.getTime()) / 1000);
  if (segundos < 60) return 'agora há pouco';

  const minutos = Math.round(segundos / 60);
  if (minutos < 60) return `há ${minutos} min`;

  const horas = Math.round(minutos / 60);
  if (horas < 24) return `há ${horas}h`;

  const dias = Math.round(horas / 24);
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;

  const meses = Math.round(dias / 30);
  if (meses < 12) return `há ${meses} ${meses === 1 ? 'mês' : 'meses'}`;

  const anos = Math.round(meses / 12);
  return `há ${anos} ${anos === 1 ? 'ano' : 'anos'}`;
}

/** Dias ate a data. Negativo = ja venceu. */
export function diasAte(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - hoje.getTime()) / 86_400_000);
}

/** "5562984747979" -> "(62) 98474-7979" */
export function formatarTelefone(valor: string | null | undefined): string {
  if (!valor) return '—';
  const d = valor.replace(/\D/g, '');
  const nacional = d.startsWith('55') && d.length > 11 ? d.slice(2) : d;

  if (nacional.length === 11) {
    return `(${nacional.slice(0, 2)}) ${nacional.slice(2, 7)}-${nacional.slice(7)}`;
  }
  if (nacional.length === 10) {
    return `(${nacional.slice(0, 2)}) ${nacional.slice(2, 6)}-${nacional.slice(6)}`;
  }
  return valor;
}

/** Numero para link do WhatsApp: so digitos, com 55 na frente. */
export function whatsappLink(telefone: string | null | undefined, mensagem?: string): string | null {
  if (!telefone) return null;
  const d = telefone.replace(/\D/g, '');
  if (d.length < 10) return null;
  const completo = d.startsWith('55') ? d : `55${d}`;
  const texto = mensagem ? `?text=${encodeURIComponent(mensagem)}` : '';
  return `https://wa.me/${completo}${texto}`;
}

export function percentual(valor: number, casas = 1): string {
  return `${valor.toFixed(casas).replace('.', ',')}%`;
}

/** "em_conversa" -> "Em conversa". Rotulo generico para qualquer enum. */
export function humanizar(chave: string): string {
  const t = chave.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Iniciais para avatar: "Gustavo Cardoso" -> "GC". */
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}
