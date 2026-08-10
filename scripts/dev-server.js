/**
 * Servidor local de pré-visualização — NEXO WEB.
 *
 *   node scripts/dev-server.js      →  http://localhost:4321
 *
 * Não é dependência do site: o site é estático e não precisa de servidor para
 * funcionar. Este script existe por um motivo específico — ele aplica os MESMOS
 * cabeçalhos de segurança do vercel.json, então a Content-Security-Policy é
 * testada de verdade aqui, antes do deploy. Abrir o index.html direto no
 * navegador (file://) não exercita nada disso.
 *
 * Zero dependências: só os módulos nativos do Node.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const PORTA = process.env.PORT || 4321;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

// Espelho do vercel.json / _headers. Mudou lá, mude aqui também.
const SEGURANCA = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'sha256-OuZY6WzJOIh2C89ThsUSxQtxIJomDP4jHuL8NXL3o5c='; " +
    "style-src 'self'; img-src 'self' data:; font-src 'self'; " +
    "connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-src 'none'; " +
    "frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

http.createServer((req, res) => {
  let caminho = decodeURIComponent(req.url.split('?')[0]);
  if (caminho === '/') caminho = '/index.html';

  const arquivo = path.resolve(RAIZ, '.' + caminho);

  // Impede sair da pasta do projeto (path traversal).
  if (arquivo !== RAIZ && !arquivo.startsWith(RAIZ + path.sep)) {
    res.writeHead(403, SEGURANCA).end('Acesso negado');
    return;
  }

  fs.readFile(arquivo, (erro, dados) => {
    const cabecalhos = Object.assign({}, SEGURANCA);

    if (erro) {
      fs.readFile(path.join(RAIZ, '404.html'), (e2, corpo) => {
        cabecalhos['Content-Type'] = 'text/html; charset=utf-8';
        res.writeHead(404, cabecalhos).end(e2 ? 'Não encontrado' : corpo);
      });
      return;
    }

    cabecalhos['Content-Type'] = TIPOS[path.extname(arquivo).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, cabecalhos).end(dados);
  });
}).listen(PORTA, () => {
  process.stdout.write('NEXO WEB rodando em http://localhost:' + PORTA + '\n');
});
