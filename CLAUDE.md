# NEXO WEB

Site comercial da **NEXO WEB**, empresa de criação e desenvolvimento de sites.
Este arquivo é a porta de entrada do projeto e deve ser lido sempre que esta pasta for aberta.

## Fontes de verdade

Antes de qualquer alteração, leia:

- @specs/site.md — o que precisa ser construído (escopo, seções, funcionalidades, stack, requisitos).
- @specs/design.md — identidade visual, paleta, tipografia, componentes e regras de UI.
- @memoria.md — decisões já aprovadas e o histórico do que foi definido.

## Regra de conflito (obrigatória)

> Se algum pedido meu contradisser uma decisão registrada em @specs/site.md, @specs/design.md ou
> @memoria.md, pare e me avise antes de realizar qualquer alteração. Explique qual decisão seria
> afetada e pergunte se desejo substituí-la.

## Regras de trabalho

- Não altere a stack técnica sem minha autorização.
- Não remova uma decisão aprovada silenciosamente.
- Não invente informações comerciais, médicas ou técnicas sobre o produto.
- Sempre preserve a consistência visual e estrutural entre as seções.
- Antes de uma mudança grande, apresente um plano resumido.
- Depois de uma decisão importante aprovada, atualize @memoria.md.

## Regras específicas deste projeto

- **Nunca invente** clientes, projetos, números, prêmios, depoimentos ou métricas.
  O portfólio usa **somente** os trabalhos reais da pasta `/portfolio`.
- **Nunca** coloque chaves, tokens, senhas ou credenciais no código do frontend.
- Os **valores dos planos** (R$ 1.500 / R$ 3.500 / R$ 6.000) são fixos. Não altere.
- O nome da marca é **NEXO WEB** e não muda.
- Dado de contato único e centralizado: constante `WHATSAPP` em `assets/js/config.js`.
  Alterou lá, alterou no site inteiro. Não espalhe o número pelo HTML.

## Stack (travada)

HTML5 semântico + CSS3 + JavaScript ES6 puro. **Zero dependências de runtime, zero build.**
Abrir `index.html` já roda. Detalhes e justificativa em @specs/site.md.

## Estrutura

```
index.html            Página única com todas as seções
404.html              Página de erro
assets/css/styles.css Design system + todas as seções
assets/js/config.js   WhatsApp e mensagens por contexto (ponto único de edição)
assets/js/boot.js     Script mínimo no <head> (marca .js para as animações)
assets/js/main.js     Menu, scroll spy, reveal, lightbox, formulário
assets/img/           Ícones, OG e portfólio otimizado (WebP)
assets/fonts/         Inter variável, auto-hospedada (OFL)
portfolio/            Prints originais em PNG — arquivo-fonte, não vai para produção
scripts/dev-server.js Pré-visualização local com os headers de produção
specs/                Fontes de verdade do projeto
```

## Comandos

Rodar localmente. Use este, e não `npx serve`: ele aplica a mesma
Content-Security-Policy da produção, então problemas de CSP aparecem aqui e não depois do deploy.

```bash
node scripts/dev-server.js
```

## Antes de considerar qualquer tarefa concluída

1. Console do navegador sem erros e sem `console.log` esquecido.
2. Testar em 375px, 768px, 1280px e 1920px.
3. Todos os links e CTAs funcionando; nenhum `href="#"` vazio.
4. Nenhum placeholder, lorem ipsum ou texto de demonstração.
5. Verificar se nenhuma informação sensível foi exposta no frontend.
