/**
 * NEXO WEB — configuração de contato.
 *
 * ESTE É O PONTO ÚNICO DE EDIÇÃO DO NÚMERO DE WHATSAPP.
 * Trocou aqui, trocou em todos os botões, links e no formulário.
 *
 * Ao trocar o número, atualize também os dois lugares que precisam existir em
 * HTML estático (para buscadores e para quem navega sem JavaScript):
 *   1. o bloco JSON-LD no <head> do index.html  → "telephone"
 *   2. o <noscript> no rodapé do index.html
 *
 * Nada de secreto mora neste arquivo — é tudo informação pública de contato.
 */
window.NEXO = {
  /** Número no formato internacional, só dígitos: 55 + DDD + número. */
  whatsapp: '5562984747979',

  /** Como o número aparece escrito na tela. */
  whatsappDisplay: '(62) 98474-7979',

  /**
   * Mensagens pré-preenchidas por contexto. A chave é o valor do atributo
   * data-wa no HTML; `padrao` cobre qualquer chave não listada aqui.
   */
  mensagens: {
    padrao: 'Olá! Vim pelo site da NEXO WEB e quero solicitar um orçamento.',
    hero: 'Olá! Vim pelo site da NEXO WEB e quero criar um site para o meu negócio.',
    flutuante: 'Olá! Vim pelo site da NEXO WEB e gostaria de conversar sobre um projeto.',
    rodape: 'Olá! Vim pelo site da NEXO WEB e gostaria de mais informações.',

    'servico-landing': 'Olá! Vim pelo site da NEXO WEB e tenho interesse em uma Landing Page.',
    'servico-institucional': 'Olá! Vim pelo site da NEXO WEB e tenho interesse em um Site Institucional.',
    'servico-ecommerce': 'Olá! Vim pelo site da NEXO WEB e tenho interesse em um E-commerce.',
    'servico-personalizado': 'Olá! Vim pelo site da NEXO WEB e tenho interesse em um Projeto Personalizado.',

    'prazo-express': 'Olá! Vim pelo site da NEXO WEB e quero saber mais sobre a entrega Express (72 horas).',
    'prazo-padrao': 'Olá! Vim pelo site da NEXO WEB e quero saber mais sobre a entrega Padrão (até 7 dias).',
    'prazo-premium': 'Olá! Vim pelo site da NEXO WEB e quero saber mais sobre a entrega Premium (até 1 mês).',

    'plano-basico': 'Olá! Vim pelo site da NEXO WEB e quero contratar o Plano Básico (R$ 1.400).',
    'plano-profissional': 'Olá! Vim pelo site da NEXO WEB e quero contratar o Plano Profissional (R$ 2.500).',
    'plano-premium': 'Olá! Vim pelo site da NEXO WEB e quero contratar o Plano Premium (R$ 4.000).'
  }
};
