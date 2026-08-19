/**
 * Testes da análise técnica real de site (Etapa 3).
 *
 * `fetch` é sempre mockado. Cobre HTTPS, viewport, CTA (tel/WhatsApp/
 * formulário), status HTTP inválido, timeout, redirecionamento, erro de
 * rede e o contrato central: `analisarSite` NUNCA rejeita.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { analisarSite } from '../api/_lib/nexo-ai/analise-site.ts';

const fetchOriginal = global.fetch;

test.afterEach(() => {
  global.fetch = fetchOriginal;
});

/* --------------------------------------------------------------------------
   Fábricas
   -------------------------------------------------------------------------- */

function htmlSaudavel() {
  return `<!doctype html>
<html><head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head><body>
  <a href="tel:+5562984747979">Ligar</a>
</body></html>`;
}

function respostaOk({ url = 'https://exemplo.com.br/', html = htmlSaudavel(), headers = {} } = {}) {
  return {
    ok: true,
    status: 200,
    url,
    headers: { get: (nome) => headers[nome.toLowerCase()] ?? null },
    text: async () => html,
  };
}

function respostaErro(status, url = 'https://exemplo.com.br/') {
  return {
    ok: false,
    status,
    url,
    headers: { get: () => null },
    text: async () => '',
  };
}

/* ==========================================================================
   Casos básicos
   ========================================================================== */

test('site acessível e saudável: HTTPS, viewport e CTA todos detectados', async () => {
  global.fetch = async () => respostaOk();

  const resultado = await analisarSite('https://exemplo.com.br');

  assert.equal(resultado.tem_site, true);
  assert.equal(resultado.acessivel, true);
  assert.equal(resultado.status_http, 200);
  assert.equal(resultado.https, true);
  assert.equal(resultado.viewport_mobile, true);
  assert.equal(resultado.tem_cta, true);
  assert.equal(resultado.erro, null);
  assert.ok(typeof resultado.tempo_resposta_ms === 'number');
});

test('site quebrado (500): acessível=false, mantém o status_http', async () => {
  global.fetch = async () => respostaErro(500);

  const resultado = await analisarSite('https://exemplo.com.br');

  assert.equal(resultado.tem_site, true);
  assert.equal(resultado.acessivel, false);
  assert.equal(resultado.status_http, 500);
  assert.equal(resultado.erro, 'status_500');
});

test('site não encontrado (404): acessível=false', async () => {
  global.fetch = async () => respostaErro(404);

  const resultado = await analisarSite('https://exemplo.com.br');

  assert.equal(resultado.acessivel, false);
  assert.equal(resultado.status_http, 404);
});

test('erro de rede (fetch rejeita): acessível=false, erro="rede"', async () => {
  global.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  const resultado = await analisarSite('https://exemplo.com.br');

  assert.equal(resultado.tem_site, true);
  assert.equal(resultado.acessivel, false);
  assert.equal(resultado.erro, 'rede');
});

test('timeout: acessível=false, erro="timeout" — sem esperar o timeout real de produção', async () => {
  global.fetch = (url, opcoes) =>
    new Promise((_resolve, reject) => {
      opcoes.signal.addEventListener('abort', () => {
        const erro = new Error('The operation was aborted');
        erro.name = 'AbortError';
        reject(erro);
      });
    });

  const resultado = await analisarSite('https://exemplo.com.br', { timeoutMs: 15 });

  assert.equal(resultado.acessivel, false);
  assert.equal(resultado.erro, 'timeout');
});

/* ==========================================================================
   Contrato: nunca rejeita
   ========================================================================== */

test('nunca rejeita: erro inesperado no fetch vira AnaliseSite, não exceção', async () => {
  global.fetch = () => {
    throw new Error('algo quebrou de um jeito inesperado');
  };

  await assert.doesNotReject(() => analisarSite('https://exemplo.com.br'));
  const resultado = await analisarSite('https://exemplo.com.br');
  assert.equal(resultado.acessivel, false);
  assert.ok(resultado.erro);
});

test('nunca rejeita: falha ao ler o corpo (text() rejeita) vira AnaliseSite', async () => {
  global.fetch = async () => ({
    ok: true,
    status: 200,
    url: 'https://exemplo.com.br/',
    headers: { get: () => null },
    text: async () => {
      throw new Error('corpo corrompido');
    },
  });

  const resultado = await analisarSite('https://exemplo.com.br');
  assert.equal(resultado.acessivel, false);
  assert.equal(resultado.erro, 'leitura_falhou');
});

/* ==========================================================================
   HTTPS e redirecionamento
   ========================================================================== */

test('HTTPS refletido pela URL final — inclusive depois de redirecionamento http->https', async () => {
  // `fetch({redirect:'follow'})` já resolveu o redirecionamento antes de
  // devolver a resposta; o que importa é a URL final em `resposta.url`.
  global.fetch = async () => respostaOk({ url: 'https://exemplo.com.br/pagina-final' });

  const resultado = await analisarSite('http://exemplo.com.br');
  assert.equal(resultado.https, true);
});

test('sem HTTPS: URL final ainda em http', async () => {
  global.fetch = async () => respostaOk({ url: 'http://exemplo.com.br/' });

  const resultado = await analisarSite('http://exemplo.com.br');
  assert.equal(resultado.https, false);
});

test('URL sem protocolo recebe https:// automaticamente', async () => {
  let urlChamada = null;
  global.fetch = async (url) => {
    urlChamada = url;
    return respostaOk();
  };

  await analisarSite('exemplo.com.br');
  assert.equal(urlChamada, 'https://exemplo.com.br');
});

/* ==========================================================================
   Viewport mobile
   ========================================================================== */

test('detecta ausência de viewport mobile', async () => {
  global.fetch = async () =>
    respostaOk({ html: '<html><head><title>Sem viewport</title></head><body></body></html>' });

  const resultado = await analisarSite('https://exemplo.com.br');
  assert.equal(resultado.viewport_mobile, false);
});

/* ==========================================================================
   CTA / contato visível
   ========================================================================== */

test('detecta CTA via link tel:', async () => {
  global.fetch = async () =>
    respostaOk({ html: '<html><body><a href="tel:+5562984747979">Ligue já</a></body></html>' });
  const resultado = await analisarSite('https://exemplo.com.br');
  assert.equal(resultado.tem_cta, true);
});

test('detecta CTA via link wa.me', async () => {
  global.fetch = async () =>
    respostaOk({ html: '<html><body><a href="https://wa.me/5562984747979">WhatsApp</a></body></html>' });
  const resultado = await analisarSite('https://exemplo.com.br');
  assert.equal(resultado.tem_cta, true);
});

test('detecta CTA via link api.whatsapp.com', async () => {
  global.fetch = async () =>
    respostaOk({
      html: '<html><body><a href="https://api.whatsapp.com/send?phone=5562984747979">Fale conosco</a></body></html>',
    });
  const resultado = await analisarSite('https://exemplo.com.br');
  assert.equal(resultado.tem_cta, true);
});

test('detecta CTA via formulário de contato', async () => {
  global.fetch = async () =>
    respostaOk({ html: '<html><body><form action="/contato"><input name="email"></form></body></html>' });
  const resultado = await analisarSite('https://exemplo.com.br');
  assert.equal(resultado.tem_cta, true);
});

test('sem nenhum CTA detectável: tem_cta=false', async () => {
  global.fetch = async () =>
    respostaOk({ html: '<html><body><p>Bem-vindo ao nosso site institucional.</p></body></html>' });
  const resultado = await analisarSite('https://exemplo.com.br');
  assert.equal(resultado.tem_cta, false);
});

/* ==========================================================================
   Análise parcial / tamanho
   ========================================================================== */

test('análise parcial: sem Content-Length no header, usa o tamanho do corpo lido', async () => {
  global.fetch = async () => respostaOk({ html: '<html><body>conteúdo curto</body></html>', headers: {} });

  const resultado = await analisarSite('https://exemplo.com.br');
  assert.ok(typeof resultado.tamanho_bytes === 'number');
  assert.ok(resultado.tamanho_bytes > 0);
});

test('usa Content-Length quando o servidor informa', async () => {
  global.fetch = async () => respostaOk({ headers: { 'content-length': '12345' } });

  const resultado = await analisarSite('https://exemplo.com.br');
  assert.equal(resultado.tamanho_bytes, 12345);
});

test('site saudável mas sem HTTPS e sem CTA: análise parcial reflete cada sinal isoladamente', async () => {
  global.fetch = async () =>
    respostaOk({
      url: 'http://exemplo.com.br/',
      html: '<html><head><meta name="viewport" content="width=device-width"></head><body><p>Sobre nós</p></body></html>',
    });

  const resultado = await analisarSite('http://exemplo.com.br');
  assert.equal(resultado.acessivel, true);
  assert.equal(resultado.https, false);
  assert.equal(resultado.viewport_mobile, true);
  assert.equal(resultado.tem_cta, false);
});
