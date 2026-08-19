/**
 * Dados de DEMONSTRACAO.
 *
 * ==========================================================================
 * TUDO NESTE ARQUIVO E FICTICIO, com uma unica excecao: os precos dos tres
 * planos (R$ 1.400 / R$ 2.500 / R$ 4.000), que sao os valores reais da NEXO
 * WEB e por isso aparecem corretos no catalogo de servicos.
 *
 * Nomes de clientes, empresas, telefones, e-mails, vendas, faturamento e
 * projetos NAO representam pessoas ou negocios reais. Nenhum cliente real da
 * NEXO WEB foi usado aqui de proposito: seria atribuir receita inventada a
 * cliente de verdade.
 *
 * Este arquivo nunca e carregado em VITE_DATA_MODE=production.
 * ==========================================================================
 */

import type {
  Campaign,
  CampaignSlot,
  CampaignTarget,
  Client,
  Conversation,
  Installment,
  Lead,
  LeadStatus,
  Notification,
  Payment,
  PaymentMethod,
  Project,
  ProjectStatus,
  Sale,
  Service,
  Settings,
  Tag,
  User,
  WebhookEvent,
} from '@/types';
import { codigoVenda } from '@/lib/id';

/* --------------------------------------------------------------------------
   Aleatoriedade determinística
   -------------------------------------------------------------------------- */

/** mulberry32: mesma semente, mesma sequencia. O demo nao muda a cada F5. */
function prng(semente: number) {
  let a = semente;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = prng(20260812);

const inteiro = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const escolher = <T,>(lista: readonly T[]): T => lista[Math.floor(rand() * lista.length)];
const chance = (p: number) => rand() < p;

const HOJE = new Date();

/** Data ISO deslocada N dias a partir de hoje. Negativo = passado. */
function dia(offset: number): string {
  const d = new Date(HOJE);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** Timestamp ISO completo, com hora comercial plausivel. */
function instante(offset: number): string {
  const d = new Date(HOJE);
  d.setDate(d.getDate() + offset);
  d.setHours(inteiro(8, 19), inteiro(0, 59), 0, 0);
  return d.toISOString();
}

/* --------------------------------------------------------------------------
   Usuários da equipe (contas de demonstração)
   -------------------------------------------------------------------------- */

export const usuariosMock: User[] = [
  {
    id: 'usr-admin',
    nome: 'Gustavo Cardoso',
    email: 'gustavo@nexoweb.com.br',
    role: 'administrador',
    avatar_url: null,
    ativo: true,
    criado_em: instante(-420),
  },
  {
    id: 'usr-vendas',
    nome: 'Marina Alves',
    email: 'vendas@nexoweb.com.br',
    role: 'vendedor',
    avatar_url: null,
    ativo: true,
    criado_em: instante(-260),
  },
  {
    id: 'usr-financeiro',
    nome: 'Rafael Lima',
    email: 'financeiro@nexoweb.com.br',
    role: 'financeiro',
    avatar_url: null,
    ativo: true,
    criado_em: instante(-190),
  },
  {
    id: 'usr-colaborador',
    nome: 'Beatriz Nunes',
    email: 'design@nexoweb.com.br',
    role: 'colaborador',
    avatar_url: null,
    ativo: true,
    criado_em: instante(-120),
  },
];

/* --------------------------------------------------------------------------
   Catálogo de serviços
   -------------------------------------------------------------------------- */

export const servicosMock: Service[] = [
  {
    id: 'svc-basico',
    nome: 'Plano Básico',
    descricao:
      'Site de até 5 páginas, design responsivo, botão WhatsApp, formulário de contato, SEO básico, Google Maps e integração com redes sociais.',
    preco: 140_000,
    preco_promocional: null,
    categoria: 'site_institucional',
    max_parcelas: 3,
    ativo: true,
    criado_em: instante(-400),
    atualizado_em: instante(-30),
  },
  {
    id: 'svc-profissional',
    nome: 'Plano Profissional',
    descricao:
      'Site de até 10 páginas, design personalizado, SEO avançado, Google Analytics, CMS, integrações personalizadas, otimização para conversão e 30 dias de suporte pós-entrega.',
    preco: 250_000,
    preco_promocional: null,
    categoria: 'site_institucional',
    max_parcelas: 6,
    ativo: true,
    criado_em: instante(-400),
    atualizado_em: instante(-30),
  },
  {
    id: 'svc-premium',
    nome: 'Plano Premium',
    descricao:
      'Site completo, design exclusivo, e-commerce ou funcionalidades avançadas, SEO avançado, Google Analytics e relatórios, automações, integração com IA/WhatsApp e 60 dias de suporte pós-entrega.',
    preco: 400_000,
    preco_promocional: null,
    categoria: 'ecommerce',
    max_parcelas: 12,
    ativo: true,
    criado_em: instante(-400),
    atualizado_em: instante(-30),
  },
  {
    id: 'svc-landing',
    nome: 'Landing Page Express',
    descricao: 'Página única focada em conversão, entrega em 72 horas. (Preço de demonstração.)',
    preco: 90_000,
    preco_promocional: 75_000,
    categoria: 'landing_page',
    max_parcelas: 2,
    ativo: true,
    criado_em: instante(-320),
    atualizado_em: instante(-45),
  },
  {
    id: 'svc-personalizado',
    nome: 'Projeto Personalizado',
    descricao: 'Sistemas, dashboards e integrações sob medida. (Preço de demonstração.)',
    preco: 650_000,
    preco_promocional: null,
    categoria: 'personalizado',
    max_parcelas: 12,
    ativo: true,
    criado_em: instante(-280),
    atualizado_em: instante(-60),
  },
  {
    id: 'svc-manutencao',
    nome: 'Manutenção Mensal',
    descricao: 'Suporte e manutenção contratados à parte, após o período incluído no plano. (Preço de demonstração.)',
    preco: 30_000,
    preco_promocional: null,
    categoria: 'manutencao',
    max_parcelas: 1,
    ativo: false,
    criado_em: instante(-150),
    atualizado_em: instante(-15),
  },
];

/* --------------------------------------------------------------------------
   Sementes de nome (ficção)
   -------------------------------------------------------------------------- */

const PESSOAS = [
  'Ana Beatriz Souza', 'Carlos Eduardo Ramos', 'Fernanda Prado', 'João Vitor Teixeira',
  'Larissa Moreira', 'Bruno Sacramento', 'Patrícia Andrade', 'Diego Fontenele',
  'Camila Barros', 'Rodrigo Peixoto', 'Juliana Castro', 'Marcelo Tavares',
  'Renata Vasques', 'Thiago Bittencourt', 'Aline Cordeiro', 'Vinícius Palma',
  'Débora Fagundes', 'Leandro Muniz', 'Priscila Rocha', 'Gabriel Assunção',
  'Sabrina Klein', 'Otávio Bezerra', 'Natália Furtado', 'Henrique Salles',
  'Vanessa Coelho', 'Douglas Amaral', 'Isabela Nogueira', 'Fábio Quintela',
  'Tatiane Marques', 'Rogério Vilela', 'Manuela Estrela', 'Caio Bandeira',
  'Elaine Torres', 'Wesley Aragão', 'Cristiane Bomfim', 'Alexandre Pontes',
  'Michele Duarte', 'Gustavo Henrique Reis', 'Simone Vasconcelos', 'Igor Bandeira',
];

const EMPRESAS = [
  'Clínica Vida Plena', 'Ateliê Raiz', 'Studio Fotografia Norte', 'Mecânica Precisa',
  'Advocacia Prado & Associados', 'Padaria Grão Dourado', 'Academia Movimento',
  'Pet Shop Focinho Feliz', 'Consultório Odonto Sorriso', 'Marcenaria Cedro',
  'Buffet Encanto', 'Transportadora Rota Certa', 'Ótica Visão Clara', 'Doceria Açúcar Fino',
  'Imobiliária Alicerce', 'Barbearia Navalha', 'Escola Semente', 'Contabilidade Exata',
  'Distribuidora Sul Verde', 'Salão Beleza Real', 'Serralheria Aço Firme',
  'Consultoria Vetor', 'Floricultura Botão', 'Lava-Jato Cristal',
];

const CAMPANHAS = [
  'Prospecção NinjaBot — Comércio Local',
  'Prospecção NinjaBot — Clínicas',
  'Google Ads — Criação de Sites',
  'Instagram — Portfólio',
  'Indicação de cliente',
  null,
];

/**
 * Tags/listas de prospecção. São elas que definem o público de uma campanha:
 * um lead só recebe disparo se carregar a tag escolhida.
 */
export const tagsMock: Tag[] = [
  { id: 'tag-comercio', nome: 'Comércio local', descricao: 'Lojas e serviços de bairro', criado_em: instante(-200) },
  { id: 'tag-clinicas', nome: 'Clínicas e consultórios', descricao: 'Saúde e bem-estar', criado_em: instante(-180) },
  { id: 'tag-servicos', nome: 'Prestadores de serviço', descricao: 'Profissionais liberais', criado_em: instante(-150) },
  { id: 'tag-sem-site', nome: 'Sem site', descricao: 'Negócios sem presença digital', criado_em: instante(-120) },
];

const IDS_TAGS = tagsMock.map((t) => t.id);

const ORIGENS = ['site', 'whatsapp', 'indicacao', 'instagram', 'google', 'ninjabot'] as const;

const PROXIMAS_ACOES = [
  'Enviar proposta comercial',
  'Retornar ligação',
  'Confirmar recebimento da proposta',
  'Agendar reunião de briefing',
  'Enviar link de pagamento',
  'Follow-up de 7 dias',
];

const MENSAGENS = [
  'Bom dia! Quanto fica um site para minha empresa?',
  'Legal, me manda a proposta por aqui mesmo.',
  'Vou conversar com meu sócio e te retorno.',
  'Consegue fazer em quantos dias?',
  'Achei o valor justo, quero fechar.',
  'Prefiro parcelar no cartão, dá pra fazer?',
  'Obrigado, vou avaliar com calma.',
  'Já recebi o link, vou pagar hoje ainda.',
];

const OBSERVACOES_PROJETO = [
  'Cliente enviou o material de identidade visual.',
  'Aguardando textos definitivos.',
  'Homologação marcada para o fim da semana.',
  'Domínio já apontado.',
  'Ajustes de responsividade em andamento.',
];

/* --------------------------------------------------------------------------
   Geração: leads, clientes, vendas, pagamentos, parcelas, projetos
   -------------------------------------------------------------------------- */

const telefone = () => `55${escolher([62, 61, 11, 31, 41, 47, 21])}9${inteiro(80000000, 99999999)}`;

const emailDe = (nome: string, empresa: string | null) => {
  const usuario = nome.split(' ')[0].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const dominio = empresa
    ? `${empresa.split(' ')[0].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}.com.br`
    : 'email.com';
  return `${usuario}@${dominio}`;
};

const STATUS_LEAD_ABERTO: LeadStatus[] = [
  'novo', 'contatado', 'em_conversa', 'qualificado', 'proposta_enviada', 'negociacao', 'pagamento_pendente',
];

interface Gerado {
  leads: Lead[];
  clientes: Client[];
  vendas: Sale[];
  pagamentos: Payment[];
  parcelas: Installment[];
  projetos: Project[];
  conversas: Conversation[];
  notificacoes: Notification[];
}

function gerar(): Gerado {
  const leads: Lead[] = [];
  const clientes: Client[] = [];
  const vendas: Sale[] = [];
  const pagamentos: Payment[] = [];
  const parcelas: Installment[] = [];
  const projetos: Project[] = [];
  const conversas: Conversation[] = [];
  const notificacoes: Notification[] = [];

  let sequencialVenda = 1;
  const servicosVendaveis = servicosMock.filter((s) => s.ativo);

  // 44 leads espalhados pelos ultimos 12 meses. Os 14 primeiros converteram.
  const TOTAL_LEADS = 44;
  const CONVERTIDOS = 14;

  for (let i = 0; i < TOTAL_LEADS; i++) {
    const convertido = i < CONVERTIDOS;
    const nome = PESSOAS[i % PESSOAS.length];
    const empresa = chance(0.8) ? EMPRESAS[i % EMPRESAS.length] : null;
    const tel = telefone();
    const origem = escolher(ORIGENS);
    const campanha = origem === 'ninjabot' ? escolher(CAMPANHAS.slice(0, 2)) : escolher(CAMPANHAS);

    // Convertidos entram mais cedo: precisam de tempo para virar venda e projeto.
    //
    // Os seis primeiros ficam nas ultimas semanas de proposito. Sem isso, o
    // filtro padrao do dashboard (30 dias) abriria com todos os graficos
    // vazios, e um painel de demonstracao vazio parece um painel quebrado.
    const entradaOffset = convertido
      ? i < 6
        ? -inteiro(14, 40)
        : -inteiro(45, 340)
      : -inteiro(0, 120);
    const servico = escolher(servicosVendaveis);

    const status: LeadStatus = convertido
      ? 'cliente'
      : chance(0.18)
        ? 'perdido'
        : escolher(STATUS_LEAD_ABERTO);

    const leadId = `lead-${String(i + 1).padStart(3, '0')}`;
    const clienteId = convertido ? `cli-${String(i + 1).padStart(3, '0')}` : null;
    const ultimaInteracao = instante(entradaOffset + inteiro(0, 20));

    leads.push({
      id: leadId,
      nome,
      empresa,
      telefone: tel,
      whatsapp: tel,
      email: emailDe(nome, empresa),
      origem,
      // Um a três rótulos por lead, para as campanhas terem público real.
      tags: IDS_TAGS.filter(() => chance(0.4)).slice(0, 3),
      // ~4% marcados como contato pessoal / não perturbe. Existem para provar
      // que a trava funciona: eles nunca entram em lote nenhum.
      nao_contatar: chance(0.04),
      campanha,
      data_entrada: dia(entradaOffset),
      responsavel_id: escolher(['usr-admin', 'usr-vendas']),
      status,
      observacoes: chance(0.45)
        ? 'Demonstrou interesse, pediu para retomar o contato depois do fechamento do mês.'
        : null,
      ultima_interacao: ultimaInteracao,
      proxima_acao: status === 'cliente' || status === 'perdido' ? null : escolher(PROXIMAS_ACOES),
      proxima_acao_em: status === 'cliente' || status === 'perdido' ? null : dia(inteiro(-3, 12)),
      valor_potencial: servico.preco_promocional ?? servico.preco,
      servico_interesse_id: servico.id,
      cliente_id: clienteId,
      // Dados de demonstração vêm de cadastro manual, não de prospecção
      // automática — nenhum destes campos se aplica.
      cidade: null,
      endereco: null,
      nicho: null,
      site: null,
      place_id: null,
      score_oportunidade: null,
      motivo_score: null,
      analise_site: null,
      analisado_em: null,
      criado_em: instante(entradaOffset),
      atualizado_em: ultimaInteracao,
    });

    // Conversa do NinjaBot: so existe para lead que veio de disparo.
    if (origem === 'ninjabot') {
      const respondeu = status !== 'novo';
      conversas.push({
        id: `cnv-${String(i + 1).padStart(3, '0')}`,
        lead_id: leadId,
        cliente_id: clienteId,
        telefone: tel,
        campanha,
        canal: 'whatsapp',
        status: !respondeu
          ? chance(0.5) ? 'aguardando_resposta' : 'sem_resposta'
          : status === 'cliente'
            ? 'encerrada'
            : status === 'qualificado' || status === 'negociacao'
              ? 'qualificado'
              : 'em_atendimento',
        etapa_funil: status,
        ultima_mensagem: respondeu ? escolher(MENSAGENS) : null,
        ultima_mensagem_em: respondeu ? ultimaInteracao : null,
        mensagens_enviadas: respondeu ? inteiro(3, 18) : 1,
        mensagens_recebidas: respondeu ? inteiro(2, 15) : 0,
        servico_interesse_id: servico.id,
        valor_potencial: servico.preco_promocional ?? servico.preco,
        externo_id: null,
        criado_em: instante(entradaOffset),
        atualizado_em: ultimaInteracao,
      });
    }

    if (!convertido) continue;

    /* ---- Lead virou cliente ---- */
    const cadastroOffset = entradaOffset + inteiro(3, 15);
    clientes.push({
      id: clienteId as string,
      nome,
      empresa,
      telefone: tel,
      whatsapp: tel,
      email: emailDe(nome, empresa),
      documento: null,
      cidade: escolher(['Goiânia', 'Anápolis', 'Brasília', 'Uberlândia', 'São Paulo', 'Aparecida de Goiânia']),
      estado: escolher(['GO', 'DF', 'MG', 'SP']),
      observacoes: chance(0.3) ? 'Prefere contato por WhatsApp no período da tarde.' : null,
      lead_origem_id: leadId,
      criado_em: instante(cadastroOffset),
      atualizado_em: instante(cadastroOffset + inteiro(0, 30)),
    });

    // Alguns clientes compraram duas vezes.
    const quantasVendas = chance(0.25) ? 2 : 1;

    for (let v = 0; v < quantasVendas; v++) {
      const svc = v === 0 ? servico : escolher(servicosVendaveis);
      const vendaOffset = cadastroOffset + v * inteiro(60, 150);
      if (vendaOffset > 0) continue; // venda no futuro nao existe

      const base = svc.preco_promocional ?? svc.preco;
      const desconto = chance(0.3) ? Math.round(base * escolher([0.05, 0.1])) : 0;
      const liquido = base - desconto;
      const forma: PaymentMethod = chance(0.55) ? 'pix' : 'cartao';
      const totalParcelas = forma === 'pix' ? (chance(0.6) ? 1 : 2) : inteiro(1, Math.min(6, svc.max_parcelas));

      const vendaId = `sale-${String(sequencialVenda).padStart(3, '0')}`;
      const codigo = codigoVenda(sequencialVenda);
      sequencialVenda++;

      // Distribuicao do valor: a ultima parcela absorve o arredondamento para
      // que a soma feche exatamente com o liquido. Centavo perdido em software
      // financeiro e bug, nao detalhe.
      const valorParcela = Math.floor(liquido / totalParcelas);
      const sobra = liquido - valorParcela * totalParcelas;

      let pagas = 0;
      const registrosParcela: { valor: number; vencimento: string; venceu: boolean }[] = [];

      for (let n = 1; n <= totalParcelas; n++) {
        const valor = valorParcela + (n === totalParcelas ? sobra : 0);
        const vencOffset = vendaOffset + (n - 1) * 30;
        registrosParcela.push({ valor, vencimento: dia(vencOffset), venceu: vencOffset < 0 });
      }

      // Quanto do que ja venceu foi pago. 12% dos vencidos ficam em atraso.
      const vencidas = registrosParcela.filter((p) => p.venceu).length;
      const inadimplente = chance(0.12);
      const quitadasAteVencidas = inadimplente ? Math.max(0, vencidas - inteiro(1, Math.max(1, vencidas))) : vencidas;

      registrosParcela.forEach((p, idx) => {
        const numero = idx + 1;
        const jaPaga = numero <= quitadasAteVencidas;
        const atrasada = p.venceu && !jaPaga;

        const statusParcela = jaPaga ? 'pago' : atrasada ? 'atrasado' : 'pendente';
        if (jaPaga) pagas++;

        const pagoEm = jaPaga ? instante(-Math.max(0, -(vendaOffset + idx * 30) - inteiro(0, 3))) : null;
        const pagamentoId = `pay-${vendaId}-${numero}`;

        pagamentos.push({
          id: pagamentoId,
          venda_id: vendaId,
          cliente_id: clienteId as string,
          valor: p.valor,
          forma_pagamento: forma,
          status: statusParcela,
          vencimento: p.vencimento,
          pago_em: pagoEm,
          gateway: null,
          gateway_transacao_id: null,
          criado_em: instante(vendaOffset),
          atualizado_em: pagoEm ?? instante(vendaOffset),
        });

        parcelas.push({
          id: `inst-${vendaId}-${numero}`,
          venda_id: vendaId,
          pagamento_id: pagamentoId,
          numero,
          total_parcelas: totalParcelas,
          valor: p.valor,
          vencimento: p.vencimento,
          status: statusParcela,
          pago_em: pagoEm,
          gateway: null,
          gateway_transacao_id: null,
          criado_em: instante(vendaOffset),
          atualizado_em: pagoEm ?? instante(vendaOffset),
        });
      });

      const statusVenda: Sale['status'] =
        pagas === 0 ? 'aguardando_pagamento' : pagas < totalParcelas ? 'parcialmente_pago' : 'pago';

      vendas.push({
        id: vendaId,
        codigo,
        cliente_id: clienteId as string,
        servico_id: svc.id,
        valor_total: base,
        desconto,
        forma_pagamento: forma,
        parcelas: totalParcelas,
        status: statusVenda,
        data: dia(vendaOffset),
        gateway: null,
        gateway_transacao_id: null,
        responsavel_id: escolher(['usr-admin', 'usr-vendas']),
        observacoes: null,
        criado_em: instante(vendaOffset),
        atualizado_em: instante(vendaOffset + inteiro(0, 20)),
      });

      /* ---- Projeto nasce da venda ---- */
      const inicioOffset = vendaOffset + inteiro(1, 6);
      const duracao = svc.categoria === 'landing_page' ? 3 : svc.categoria === 'ecommerce' ? 30 : 12;
      const prazoOffset = inicioOffset + duracao;
      const terminou = prazoOffset < -5;

      const statusProjeto: ProjectStatus = terminou
        ? chance(0.7) ? 'concluido' : 'entregue'
        : escolher(['briefing', 'planejamento', 'design', 'desenvolvimento', 'revisao', 'ajustes', 'finalizacao']);

      const progresso =
        statusProjeto === 'concluido' || statusProjeto === 'entregue'
          ? 100
          : ({
              aguardando_inicio: 0, briefing: 10, planejamento: 25, design: 45,
              desenvolvimento: 65, revisao: 80, ajustes: 90, finalizacao: 95,
              entregue: 100, concluido: 100,
            } as Record<ProjectStatus, number>)[statusProjeto];

      projetos.push({
        id: `prj-${vendaId}`,
        nome: `${svc.nome} — ${empresa ?? nome}`,
        cliente_id: clienteId as string,
        servico_id: svc.id,
        venda_id: vendaId,
        valor: liquido,
        data_inicio: dia(inicioOffset),
        prazo: dia(prazoOffset),
        responsavel_id: escolher(['usr-admin', 'usr-colaborador']),
        status: statusProjeto,
        progresso,
        observacoes: chance(0.5) ? escolher(OBSERVACOES_PROJETO) : null,
        criado_em: instante(inicioOffset),
        atualizado_em: instante(Math.min(-1, inicioOffset + inteiro(1, 20))),
      });
    }
  }

  /* ---- Notificações derivadas de fatos do dataset ---- */

  const ultimasVendas = [...vendas].sort((a, b) => b.data.localeCompare(a.data)).slice(0, 3);
  for (const v of ultimasVendas) {
    const cliente = clientes.find((c) => c.id === v.cliente_id);
    notificacoes.push({
      id: `ntf-venda-${v.id}`,
      tipo: 'nova_venda',
      severidade: 'sucesso',
      titulo: 'Nova venda registrada',
      descricao: `${v.codigo} — ${cliente?.empresa ?? cliente?.nome ?? 'Cliente'}`,
      lida: false,
      link: `/vendas?busca=${v.codigo}`,
      criado_em: instante(-inteiro(0, 6)),
    });
  }

  const atrasados = pagamentos.filter((p) => p.status === 'atrasado').slice(0, 3);
  for (const p of atrasados) {
    const cliente = clientes.find((c) => c.id === p.cliente_id);
    notificacoes.push({
      id: `ntf-atraso-${p.id}`,
      tipo: 'pagamento_pendente',
      severidade: 'erro',
      titulo: 'Pagamento em atraso',
      descricao: `${cliente?.empresa ?? cliente?.nome ?? 'Cliente'} — venceu em ${p.vencimento.split('-').reverse().join('/')}`,
      lida: false,
      link: '/pagamentos?status=atrasado',
      criado_em: instante(-inteiro(0, 4)),
    });
  }

  const vencendo = pagamentos
    .filter((p) => p.status === 'pendente' && p.vencimento <= dia(7) && p.vencimento >= dia(0))
    .slice(0, 2);
  for (const p of vencendo) {
    const cliente = clientes.find((c) => c.id === p.cliente_id);
    notificacoes.push({
      id: `ntf-vencendo-${p.id}`,
      tipo: 'parcela_vencendo',
      severidade: 'alerta',
      titulo: 'Parcela vencendo',
      descricao: `${cliente?.empresa ?? cliente?.nome ?? 'Cliente'} — vence em ${p.vencimento.split('-').reverse().join('/')}`,
      lida: false,
      link: '/pagamentos?status=pendente',
      criado_em: instante(-inteiro(0, 2)),
    });
  }

  const responderam = conversas.filter((c) => c.status === 'em_atendimento').slice(0, 2);
  for (const c of responderam) {
    const lead = leads.find((l) => l.id === c.lead_id);
    notificacoes.push({
      id: `ntf-conversa-${c.id}`,
      tipo: 'lead_respondeu',
      severidade: 'info',
      titulo: 'Lead respondeu o disparo',
      descricao: `${lead?.nome ?? 'Lead'} — ${c.campanha ?? 'sem campanha'}`,
      lida: chance(0.5),
      link: '/conversas',
      criado_em: instante(-inteiro(0, 3)),
    });
  }

  const perto = projetos
    .filter((p) => p.progresso < 100 && p.prazo && p.prazo >= dia(0) && p.prazo <= dia(10))
    .slice(0, 2);
  for (const p of perto) {
    notificacoes.push({
      id: `ntf-prazo-${p.id}`,
      tipo: 'projeto_prazo',
      severidade: 'alerta',
      titulo: 'Projeto próximo do prazo',
      descricao: `${p.nome} — entrega em ${p.prazo?.split('-').reverse().join('/')}`,
      lida: false,
      link: '/projetos',
      criado_em: instante(-inteiro(0, 2)),
    });
  }

  const novosClientes = [...clientes].sort((a, b) => b.criado_em.localeCompare(a.criado_em)).slice(0, 2);
  for (const c of novosClientes) {
    notificacoes.push({
      id: `ntf-cliente-${c.id}`,
      tipo: 'novo_cliente',
      severidade: 'sucesso',
      titulo: 'Novo cliente cadastrado',
      descricao: c.empresa ?? c.nome,
      lida: true,
      link: `/clientes/${c.id}`,
      criado_em: c.criado_em,
    });
  }

  notificacoes.sort((a, b) => b.criado_em.localeCompare(a.criado_em));

  return { leads, clientes, vendas, pagamentos, parcelas, projetos, conversas, notificacoes };
}

const dados = gerar();

export const leadsMock = dados.leads;
export const clientesMock = dados.clientes;
export const vendasMock = dados.vendas;
export const pagamentosMock = dados.pagamentos;
export const parcelasMock = dados.parcelas;
export const projetosMock = dados.projetos;
export const conversasMock = dados.conversas;
export const notificacoesMock = dados.notificacoes;

/**
 * Nenhum evento de webhook no dataset inicial — e a verdade: nenhum gateway
 * foi conectado ainda. A tela de Integrações traz um simulador (so no modo
 * demonstração) que gera eventos reais atraves do handler de verdade, para
 * que o fluxo possa ser visto funcionando de ponta a ponta.
 */
export const eventosWebhookMock: WebhookEvent[] = [];

/**
 * Uma campanha em rascunho, para a tela abrir com algo real de operar.
 * Sem alvos gerados: quem gera é você, depois de conferir a prévia do público.
 */
export const campanhasMock: Campaign[] = [
  {
    id: 'camp-comercio-local',
    nome: 'Prospecção — Comércio local',
    tag: 'tag-comercio',
    mensagem:
      'Olá, {{primeiro_nome}}! Aqui é da NEXO WEB. Trabalhamos com criação de sites profissionais e queria te mostrar dois exemplos de negócios parecidos com o seu. Posso mandar?',
    status: 'rascunho',
    tamanho_lote: 10,
    criado_em: instante(-6),
    atualizado_em: instante(-6),
    iniciada_em: null,
    concluida_em: null,
  },
];

/** Vazio de propósito: nenhum slot montado ainda. */
export const slotsCampanhaMock: CampaignSlot[] = [];

/** Vazio de propósito: nenhum disparo foi feito ainda. */
export const alvosCampanhaMock: CampaignTarget[] = [];

export const configuracoesMock: Settings = {
  empresa: {
    nome: 'NEXO WEB',
    descricao: 'Sites profissionais para negócios que querem crescer no digital.',
    telefone: '5562984747979',
    email: '',
    logo_url: null,
    site: 'https://nexoweb.com.br',
    instagram: '',
    linkedin: '',
  },
  notificacoes: {
    nova_venda: true,
    pagamento_aprovado: true,
    pagamento_recusado: true,
    pagamento_pendente: true,
    parcela_vencendo: true,
    lead_respondeu: true,
    novo_cliente: true,
    projeto_prazo: true,
  },
};
