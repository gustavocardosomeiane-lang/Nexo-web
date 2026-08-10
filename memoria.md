# memoria.md — Decisões aprovadas

Histórico das decisões já tomadas e aprovadas neste projeto.
Nada aqui é alterado ou removido sem aviso — ver a regra de conflito em @CLAUDE.md.

---

## 2026-08-10 — Início do projeto

### D-01 · Marca
**NEXO WEB.** Marca independente, identidade própria: preto dominante, vermelho como acento,
branco e escala de cinzas. Nome fixo.

### D-02 · Stack técnica
**HTML5 + CSS3 + JavaScript ES6 puro. Zero dependências, zero build.**

Alternativas avaliadas: Astro e Next.js + Tailwind.
Motivo da escolha: site institucional de uma página. Framework aqui adicionaria peso, superfície
de ataque por dependências e manutenção, sem ganho real. Sem build, o site abre direto e roda em
qualquer hospedagem.

**Travada.** Não muda sem autorização explícita.

### D-03 · Formulário sem backend
O formulário de orçamento **não envia e-mail**. Valida no cliente e abre o WhatsApp com a
mensagem já montada.

Motivo: nenhuma credencial exposta, nenhuma superfície de spam, nenhum custo, nenhuma dependência
de terceiro — e o lead chega direto no celular.

Alternativas descartadas por ora: Web3Forms/Formspree (envio por e-mail) e a combinação dos dois.
Migrar para envio por e-mail exige aprovação prévia.

### D-04 · Portfólio — só trabalho real
Somente os três projetos existentes em `/portfolio`:

| Projeto | Segmento | URL (verificada, 200 OK) |
|---|---|---|
| Center Seg | Segurança Eletrônica | https://centerseg-site.vercel.app |
| TRAÇO Arquitetura | Arquitetura e Interiores | https://traco-arquitetura-silk.vercel.app |
| C2 Minds | Marketing de Conteúdo | https://c2minds-site.vercel.app |

Proibido inventar projeto, cliente, resultado, número ou depoimento.

### D-05 · "C2 Minds" no portfólio — override aprovado
**Contexto:** a regra original dizia "não utilize o nome C2 MINDS em absolutamente nenhum lugar".
O terceiro print do portfólio é justamente o site da C2 Minds, com a marca visível na imagem.

**O conflito foi apresentado e você decidiu:** usar o **nome real** na legenda do projeto,
tratando como crédito de cliente, igual aos outros dois.

**Alcance do override — importante:**
- ✅ Permitido: "C2 Minds" como **nome de cliente** na legenda do card e do lightbox.
- ❌ Proibido: qualquer uso de C2 MINDS como identidade, marca, referência visual, inspiração de
  layout, paleta ou copy da NEXO WEB.

A identidade da NEXO WEB permanece 100% independente. Ver @specs/design.md § 1.

### D-06 · Contato
WhatsApp **+55 62 98474-7979** (`5562984747979`), informado por você.

Centralizado na constante `WHATSAPP` em `assets/js/config.js` — ponto único de edição. O número
não é repetido pelo HTML.

**E-mail não foi publicado.** Não usar e-mail pessoal como contato comercial sem autorização.

### D-07 · Sem depoimentos, selos ou estatísticas
Nenhum número de projetos entregues, anos de mercado, nota de satisfação, depoimento ou selo.
Não existem dados reais para sustentar isso, e inventar quebraria a confiança que o site inteiro
tenta construir.

A prova social vem do **portfólio real**, dos preços abertos e do processo transparente.

### D-08 · Planos — valores imutáveis
R$ 1.500 (Básico) · R$ 3.500 (Profissional, "MAIS POPULAR") · R$ 6.000 (Premium).
Valores, descrições e itens inclusos **não mudam**.

### D-09 · Sem analytics e sem cookies
Nenhum Google Analytics, Meta Pixel ou rastreador. Motivo: exigiria banner de consentimento e
política de privacidade, que ainda não existem.

Os planos mencionam integração de pixels **como serviço vendido ao cliente** — isso é diferente
de instalar rastreador no site da NEXO WEB.

### D-10 · Fonte auto-hospedada
Inter Variable (licença OFL) baixada para `assets/fonts/`, servida do próprio domínio.
Nada de Google Fonts via CDN: elimina requisição externa, melhora o LCP e evita entregar IP de
visitante para terceiro.

### D-11 · Idioma
Português do Brasil, idioma único. Multi-idioma está fora do escopo.

### D-12 · Uma página só
One-page com âncoras + página 404. O público decide rápido e no celular; uma jornada contínua
converte mais do que dividir a informação em páginas.

### D-13 · Seção "Dúvidas frequentes" acrescentada
Não estava na estrutura que você passou. Foi incluída entre "Garantia de qualidade" e o CTA final
porque é o ponto onde a última objeção aparece — logo antes do fechamento — e porque alimenta o
`FAQPage` do JSON-LD, que rende resultado ampliado no Google.

São 5 perguntas, **todas respondidas apenas com fato já aprovado** (prazos, planos, serviços,
processo). Nada de política de reembolso, prazo de resposta ou condição de pagamento — isso
depende de você definir.

Se preferir sem essa seção, é só remover `<section id="duvidas">` do `index.html` e o bloco
`FAQPage` do JSON-LD.

### D-14 · Portfólio sem acesso externo — **substitui parte de D-04**
Os cards do portfólio **não têm mais link para os sites**. Removidos: botão "Visitar site" do
lightbox, ícone de link externo do card, atributos `data-url` e todas as URLs `.vercel.app`.

A barra de endereço das molduras de navegador agora mostra o **nome do projeto** (Center Seg,
TRAÇO Arquitetura, C2 Minds) em vez da URL. Vale também para as duas molduras do Hero.

O visitante só consegue **visualizar** o projeto, pelo lightbox. Nome e segmento continuam à
mostra; imagens e projetos continuam os mesmos.

**Decisão sua, registrada como override:** contraria o que estava em @specs/site.md § 7 e § 9
(que previam "Visitar site" e URL real na moldura) e o componente de moldura descrito em
@specs/design.md § 5. Os dois arquivos foram atualizados.

As URLs continuam registradas **só para uso interno** aqui e em @specs/site.md — nenhum arquivo
desses vai para produção (`.vercelignore` + `robots.txt`).

Uma frase do site foi ajustada por consequência: a seção dizia "Todos estão publicados e podem
ser visitados", que virou mentira depois da mudança. A frase saiu.

### D-15 · Sistema de animações
Loader de tela cheia · Hero palavra a palavra em clip-mask (`translateY(115%)` → `0`, easeOutExpo,
stagger 55ms) · títulos de seção em StackedLines linha a linha (stagger 110ms) · reveal por
`IntersectionObserver` com variante em escala para cards de portfólio e planos · parallax discreto
no Hero · stagger nos links do menu mobile · microinterações em botões e cards.

**Rolagem suave: implementação própria, sem Lenis.** Você escolheu escrever nativo em vez de
adotar a biblioteca. Motivo: Lenis é dependência de terceiro e contraria D-02 (zero dependências)
e a CSP `script-src 'self'`, que bloquearia qualquer CDN. A inércia é feita com
`requestAnimationFrame` em `main.js`, ativa **só** em telas com mouse — no toque o momentum
nativo do sistema é melhor e não é interceptado.

Regra que se manteve: `prefers-reduced-motion: reduce` desliga loader, clip-mask, parallax,
rolagem suave e entradas. O conteúdo aparece direto, em estado final.

### D-16 · Bug corrigido: menu mobile cortado após rolar
O painel do menu ficava com 130px de altura em vez da tela inteira, mas **só depois que a página
era rolada**.

Causa: o `backdrop-filter` do header (o efeito de vidro que aparece ao rolar) cria um *bloco de
contenção* para descendentes `position: fixed`. Como o `<nav>` mora dentro do `<header>`, o
`bottom: 0` do painel passava a se referir ao header (66px), não à janela.

Correção: altura explícita (`height: 100dvh`) em vez de depender de `bottom: 0`. Funciona nos dois
casos, porque o header começa no topo da tela. Registrado aqui porque é uma armadilha fácil de
reintroduzir ao mexer no header.

---

## Pendências abertas

Itens que **não podem ser preenchidos com dado inventado**. Ver @specs/site.md § 10.

- [ ] **Domínio de produção** — assumido `https://nexoweb.com.br`. Confirmar e substituir em
      `index.html` (canonical/OG), `sitemap.xml`, `robots.txt` e JSON-LD.
- [ ] **E-mail comercial** — ausente do site até ser definido.
- [ ] **Redes sociais** — omitidas para não gerar link quebrado.
- [ ] **CNPJ / razão social** — ausente do rodapé.
- [ ] **Cidade / região de atendimento** — melhoraria o SEO local.
- [ ] **Política de Privacidade** — obrigatória antes de instalar qualquer analytics.
