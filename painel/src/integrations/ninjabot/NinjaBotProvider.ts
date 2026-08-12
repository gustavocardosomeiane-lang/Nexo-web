/**
 * NinjaBotProvider — contrato da integracao com o NinjaBot.
 *
 * A API DO NINJABOT NAO FOI FORNECIDA. Nada aqui foi inventado: este arquivo
 * declara apenas o que o painel precisa RECEBER para exibir a area de
 * Conversas, na forma em que ja modelamos o dominio. Quando a API real
 * aparecer, escreva um adaptador que satisfaca esta interface — se o formato
 * dela for diferente (e vai ser), a traducao acontece dentro do adaptador e as
 * telas nao mudam.
 *
 * O painel consome estes dados por lead: telefone, campanha, data do disparo,
 * status da conversa, ultima mensagem, etapa do funil, interesse, valor
 * potencial e status da venda.
 *
 * O token do NinjaBot e credencial de SERVIDOR. Nao deve existir uma variavel
 * VITE_NINJABOT_API_KEY: ela iria parar no bundle.
 */

import type { Conversation, LeadStatus } from '@/types';

export interface ResumoConversa {
  /** Id da conversa no NinjaBot. */
  externoId: string;
  telefone: string;
  campanha: string | null;
  disparadoEm: string;
  status: Conversation['status'];
  etapaFunil: LeadStatus;
  ultimaMensagem: string | null;
  ultimaMensagemEm: string | null;
  mensagensEnviadas: number;
  mensagensRecebidas: number;
  /** Nome do serviço declarado pelo lead, quando a IA conseguir identificar. */
  interesse: string | null;
  /** Centavos. */
  valorPotencial: number | null;
}

export interface PedidoDisparo {
  telefones: string[];
  campanha: string;
  /** Identificador do roteiro de mensagem no NinjaBot. */
  roteiro: string;
}

export interface ResultadoDisparo {
  campanhaId: string;
  enfileirados: number;
  rejeitados: { telefone: string; motivo: string }[];
}

export interface NinjaBotProvider {
  readonly nome: string;
  readonly configurado: boolean;

  /** Conversas atualizadas desde um instante. */
  listarConversas(desde?: string): Promise<ResumoConversa[]>;
  obterConversa(externoId: string): Promise<ResumoConversa | null>;

  /** OPERAÇÃO DE SERVIDOR — exige o token do NinjaBot. */
  dispararCampanha(pedido: PedidoDisparo): Promise<ResultadoDisparo>;

  /**
   * Avisa o NinjaBot que a venda foi confirmada, para ele conduzir o pós-venda.
   * É o passo final do fluxo descrito em painel/README.md.
   * OPERAÇÃO DE SERVIDOR.
   */
  notificarVendaConfirmada(externoId: string, vendaId: string): Promise<void>;
}

class NinjaBotNaoConfigurado extends Error {
  constructor(operacao: string) {
    super(
      `NinjaBot não configurado — "${operacao}" não pode ser executado. ` +
        'A API ainda não foi fornecida; quando for, crie o adaptador em ' +
        'src/integrations/ninjabot/ e defina VITE_NINJABOT_PROVIDER e VITE_NINJABOT_API_URL.',
    );
    this.name = 'NinjaBotNaoConfigurado';
  }
}

export const nullNinjaBotProvider: NinjaBotProvider = {
  nome: 'none',
  configurado: false,

  // Lista vazia em vez de erro: a tela de Conversas precisa abrir e explicar
  // que a integração não existe, e não quebrar.
  async listarConversas() {
    return [];
  },
  async obterConversa() {
    return null;
  },
  async dispararCampanha() {
    throw new NinjaBotNaoConfigurado('disparar campanha');
  },
  async notificarVendaConfirmada() {
    throw new NinjaBotNaoConfigurado('notificar venda confirmada');
  },
};
