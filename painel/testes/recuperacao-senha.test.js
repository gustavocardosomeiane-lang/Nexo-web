/**
 * Testes da leitura do link de recuperação.
 *
 * O Supabase entrega o token em quatro formatos diferentes. Tratar só o mais
 * comum funciona até o projeto mudar de flow — e aí o link de recuperação
 * quebra em silêncio, no pior momento possível. Cada formato tem teste.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  forcaDaSenha,
  interpretarLinkRecuperacao,
  validarNovaSenha,
} from '../shared/recuperacao-senha.ts';

const BASE = 'https://nexo-painel-bay.vercel.app/redefinir-senha';

/* ==========================================================================
   Formato 1 — implícito (fragmento)
   ========================================================================== */

test('lê access_token e refresh_token do fragmento', () => {
  const r = interpretarLinkRecuperacao(
    `${BASE}#access_token=abc123&refresh_token=ref456&expires_in=3600&type=recovery`,
  );
  assert.equal(r.tipo, 'sessao_no_fragmento');
  assert.equal(r.accessToken, 'abc123');
  assert.equal(r.refreshToken, 'ref456');
});

test('fragmento com access_token mas sem refresh_token não é sessão válida', () => {
  // Meia sessão não serve: setSession exige os dois.
  const r = interpretarLinkRecuperacao(`${BASE}#access_token=abc123&type=recovery`);
  assert.notEqual(r.tipo, 'sessao_no_fragmento');
});

/* ==========================================================================
   Formato 2 — PKCE
   ========================================================================== */

test('lê o code do fluxo PKCE', () => {
  const r = interpretarLinkRecuperacao(`${BASE}?code=pkce-abc-123`);
  assert.equal(r.tipo, 'codigo');
  assert.equal(r.codigo, 'pkce-abc-123');
});

/* ==========================================================================
   Formato 3 — token_hash
   ========================================================================== */

test('lê token_hash da query', () => {
  const r = interpretarLinkRecuperacao(`${BASE}?token_hash=hash-xyz&type=recovery`);
  assert.equal(r.tipo, 'token_hash');
  assert.equal(r.tokenHash, 'hash-xyz');
});

test('lê token_hash também quando vem no fragmento', () => {
  const r = interpretarLinkRecuperacao(`${BASE}#token_hash=hash-xyz&type=recovery`);
  assert.equal(r.tipo, 'token_hash');
});

/* ==========================================================================
   Formato 4 — erro
   ========================================================================== */

test('link expirado vira mensagem em português', () => {
  const r = interpretarLinkRecuperacao(
    `${BASE}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`,
  );
  assert.equal(r.tipo, 'erro');
  assert.equal(r.codigo, 'otp_expired');
  assert.match(r.mensagem, /expirou/i);
});

test('erro sem código conhecido usa a descrição, com o + virando espaço', () => {
  const r = interpretarLinkRecuperacao(
    `${BASE}#error=server_error&error_description=Algo+deu+errado+aqui`,
  );
  assert.equal(r.tipo, 'erro');
  assert.equal(r.mensagem, 'Algo deu errado aqui');
});

test('erro sem descrição nenhuma ainda dá uma orientação útil', () => {
  const r = interpretarLinkRecuperacao(`${BASE}#error=access_denied`);
  assert.equal(r.tipo, 'erro');
  assert.ok(r.mensagem.length > 20);
});

test('ERRO TEM PRIORIDADE sobre tokens presentes no mesmo link', () => {
  // O caso perigoso: se os tokens vencessem, a tela pediria a nova senha e só
  // falharia no fim, depois da pessoa digitar tudo.
  const r = interpretarLinkRecuperacao(
    `${BASE}#access_token=abc&refresh_token=ref&error=access_denied&error_code=otp_expired`,
  );
  assert.equal(r.tipo, 'erro');
});

/* ==========================================================================
   Ausência
   ========================================================================== */

test('URL limpa não traz recuperação nenhuma', () => {
  assert.equal(interpretarLinkRecuperacao(BASE).tipo, 'ausente');
});

test('query irrelevante não é confundida com token', () => {
  assert.equal(interpretarLinkRecuperacao(`${BASE}?utm_source=email`).tipo, 'ausente');
});

test('URL malformada não derruba a tela', () => {
  assert.equal(interpretarLinkRecuperacao('nao-e-url').tipo, 'ausente');
  assert.equal(interpretarLinkRecuperacao('').tipo, 'ausente');
});

/* ==========================================================================
   Validação da nova senha
   ========================================================================== */

test('senha válida e confirmada passa', () => {
  assert.equal(validarNovaSenha('senhaSegura123', 'senhaSegura123'), null);
});

test('senha curta é recusada', () => {
  assert.match(validarNovaSenha('curta', 'curta'), /8 caracteres/);
});

test('senha vazia pede a senha', () => {
  assert.match(validarNovaSenha('', ''), /Informe a nova senha/);
});

test('confirmação vazia é cobrada', () => {
  assert.match(validarNovaSenha('senhaSegura123', ''), /Confirme/);
});

test('senhas diferentes são recusadas', () => {
  assert.match(validarNovaSenha('senhaSegura123', 'senhaSegura124'), /não são iguais/);
});

test('senha acima do limite do bcrypt é recusada', () => {
  // Passando de 72 bytes o bcrypt corta em silêncio, e a pessoa ficaria com
  // uma senha diferente da que digitou.
  const gigante = 'a'.repeat(73);
  assert.match(validarNovaSenha(gigante, gigante), /72 caracteres/);
});

test('exatamente 72 caracteres é aceito', () => {
  const limite = 'a'.repeat(72);
  assert.equal(validarNovaSenha(limite, limite), null);
});

/* ==========================================================================
   Força da senha
   ========================================================================== */

test('classifica a força da senha', () => {
  assert.equal(forcaDaSenha('curta'), 'fraca');
  assert.equal(forcaDaSenha('somenteletras'), 'fraca');
  assert.equal(forcaDaSenha('letras123'), 'media');
  assert.equal(forcaDaSenha('SenhaLonga123!'), 'forte');
});
