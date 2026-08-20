/**
 * Testes de `sanitizarTextoParaTts` (shared/regras-nexo-ai.ts) — o Google TTS
 * narra o SIGNIFICADO de emoji ("🚀" vira "foguete") em vez de ignorá-lo; esta
 * função limpa só o texto que vai pro TTS, sem tocar no texto visual/persistido.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizarTextoParaTts } from '../shared/regras-nexo-ai.ts';

/* ==========================================================================
   Caso do PROBLEMA real relatado
   ========================================================================== */

test('exemplo real: emoji vira pausa (ponto), nunca é narrado', () => {
  assert.equal(
    sanitizarTextoParaTts('Fechamos mais 10 leads 🚀 Agora vamos pra cima 💪'),
    'Fechamos mais 10 leads. Agora vamos pra cima.',
  );
});

/* ==========================================================================
   Emoji simples
   ========================================================================== */

test('emoji simples no meio da frase vira pausa', () => {
  assert.equal(sanitizarTextoParaTts('Oi 😀 tudo bem?'), 'Oi. tudo bem?');
});

test('emoji simples no início: some sem deixar ponto solto', () => {
  assert.equal(sanitizarTextoParaTts('🚀 Vamos!'), 'Vamos!');
});

test('emoji simples no fim: vira ponto final, sem duplicar pontuação existente', () => {
  assert.equal(sanitizarTextoParaTts('Combinado 👍'), 'Combinado.');
});

test('emoji já ao lado de pontuação: não duplica o ponto', () => {
  assert.equal(sanitizarTextoParaTts('Ótimo! 🎉 Vamos lá.'), 'Ótimo! Vamos lá.');
});

/* ==========================================================================
   Emoji com variation selector (U+FE0F)
   ========================================================================== */

test('emoji com variation selector (❤️ = U+2764 + U+FE0F) é removido por inteiro', () => {
  const comSelector = '\u{2764}\u{FE0F}';
  assert.equal(sanitizarTextoParaTts(`Amamos o trabalho de vocês ${comSelector}`), 'Amamos o trabalho de vocês.');
});

test('variation selector solto (sem base pictográfica reconhecida logo antes) some sem deixar lixo', () => {
  const soltoNoMeio = `abc\u{FE0F}def`;
  assert.doesNotMatch(sanitizarTextoParaTts(soltoNoMeio), /[\u{FE00}-\u{FE0F}]/u);
});

/* ==========================================================================
   Emoji composto / ZWJ (família, profissões com gênero)
   ========================================================================== */

test('emoji composto por ZWJ (família) é removido como UMA unidade — não sobra ZWJ nem pedaço', () => {
  const familia = '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}'; // 👨‍👩‍👧
  const resultado = sanitizarTextoParaTts(`Nossa equipe ${familia} cresceu`);
  assert.equal(resultado, 'Nossa equipe. cresceu');
  assert.doesNotMatch(resultado, /\u{200D}/u);
});

test('ZWJ solto (sem sequência de emoji reconhecida) é removido sem deixar caractere invisível', () => {
  const comZwjSolto = `teste\u{200D}normal`;
  assert.doesNotMatch(sanitizarTextoParaTts(comZwjSolto), /\u{200D}/u);
});

/* ==========================================================================
   Bandeira (par de indicadores regionais)
   ========================================================================== */

test('bandeira (🇧🇷 = par de Regional Indicator) é removida por inteiro, não letra a letra', () => {
  const bandeiraBrasil = '\u{1F1E7}\u{1F1F7}'; // 🇧🇷
  assert.equal(sanitizarTextoParaTts(`Atendemos todo o Brasil ${bandeiraBrasil}`), 'Atendemos todo o Brasil.');
});

/* ==========================================================================
   Múltiplos emojis
   ========================================================================== */

test('múltiplos emojis seguidos (com ou sem espaço) viram UMA única pausa, não várias', () => {
  const resultado = sanitizarTextoParaTts('Demais 😀😂😍 mesmo');
  assert.equal(resultado, 'Demais. mesmo');
});

test('emojis espalhados em frases diferentes: cada um vira sua própria pausa', () => {
  assert.equal(
    sanitizarTextoParaTts('Parte um 🚀 parte dois 🎯 parte três 💪'),
    'Parte um. parte dois. parte três.',
  );
});

/* ==========================================================================
   Preservação — o que NÃO pode ser removido
   ========================================================================== */

test('texto sem emoji permanece semanticamente idêntico', () => {
  const original = 'Fechamos 10 contratos este mês, com ticket médio de R$ 2.500,00 (alta de 12,5%).';
  assert.equal(sanitizarTextoParaTts(original), original);
});

test('acentos e caracteres pt-BR são preservados', () => {
  const original = 'Ótima notícia: São Paulo, Ceará e Goiânia já têm atendimento — sem exceção.';
  assert.equal(sanitizarTextoParaTts(original), original);
});

test('moeda, porcentagem e números são preservados', () => {
  const original = 'O plano Profissional custa R$ 2.500 e teve alta de 15% em relação a 30 dias atrás.';
  assert.equal(sanitizarTextoParaTts(original), original);
});

test('nomes próprios e siglas são preservados', () => {
  const original = 'A NEXO WEB e a API do CRM foram integradas por Gustavo Cardoso.';
  assert.equal(sanitizarTextoParaTts(original), original);
});

test('pontuação comum (vírgula, dois-pontos, travessão) não fica quebrada', () => {
  const original = 'Prioridades: leads, campanhas e follow-up — nessa ordem.';
  assert.equal(sanitizarTextoParaTts(original), original);
});

test('emoji imediatamente seguido de vírgula: a vírgula não fica flutuando sozinha', () => {
  assert.equal(sanitizarTextoParaTts('Ótimo 🎉, vamos continuar'), 'Ótimo, vamos continuar');
});

/* ==========================================================================
   Normalização de espaços
   ========================================================================== */

test('espaços duplicados criados pela remoção do emoji são normalizados', () => {
  const resultado = sanitizarTextoParaTts('Antes    do emoji 🚀    depois');
  assert.doesNotMatch(resultado, /  /);
});

test('nunca quebra uma palavra ao redor de um emoji colado (sem espaço)', () => {
  const resultado = sanitizarTextoParaTts('sucesso🚀total');
  assert.doesNotMatch(resultado, /succes|tota(?!l)/); // nenhuma letra de "sucesso"/"total" foi comida
  assert.match(resultado, /sucesso/);
  assert.match(resultado, /total/);
});

/* ==========================================================================
   Casos vazios / defensivos
   ========================================================================== */

test('texto vazio ou só emoji: devolve string vazia, nunca lança', () => {
  assert.equal(sanitizarTextoParaTts(''), '');
  assert.equal(sanitizarTextoParaTts('🚀'), '');
  assert.equal(sanitizarTextoParaTts('   '), '');
});

test('idempotente: sanitizar o resultado de novo não muda nada', () => {
  const primeira = sanitizarTextoParaTts('Fechamos mais 10 leads 🚀 Agora vamos pra cima 💪');
  assert.equal(sanitizarTextoParaTts(primeira), primeira);
});
