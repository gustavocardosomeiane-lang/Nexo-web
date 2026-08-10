# specs/site.md — Fonte de verdade funcional

Documento que define **o que precisa ser construído**. Em caso de conflito entre um pedido novo e
o que está aqui, vale a regra de conflito do @CLAUDE.md: parar e avisar antes de alterar.

---

## 1. Objetivo do site

Ser a **vitrine comercial** da NEXO WEB e converter visitantes em orçamentos.

O site precisa fazer o visitante pensar, em poucos segundos:
*"Essa empresa consegue criar um site profissional para o meu negócio."*

Objetivo primário mensurável: **contato iniciado** (WhatsApp aberto ou formulário enviado).
Objetivo secundário: percepção de autoridade e qualidade técnica.

O visitante deve percorrer, sem esforço, este caminho:

```
O QUE É A NEXO WEB → O QUE ELA FAZ → QUANTO CUSTA → EXEMPLOS → COMO CONTRATAR
```

## 2. Público-alvo

- **Pequenas e médias empresas** que ainda não têm site ou têm um site amador/desatualizado.
- **Prestadores de serviço e profissionais liberais** que precisam de autoridade digital.
- **Negócios locais** que dependem de credibilidade para fechar venda.
- **Infoprodutores e gestores de tráfego** que precisam de landing pages para campanhas.
- **Lojistas** que querem vender online.

Perfil: decisor não técnico, na maior parte das vezes acessando pelo **celular**. Avalia por
aparência, prova visual e facilidade de contato — não por especificação técnica.

Objeções que o site precisa derrubar:
1. "Será que fica bonito mesmo?" → Portfólio com trabalhos reais.
2. "Quanto vai custar?" → Preços abertos, sem 'consulte-nos'.
3. "Quanto tempo demora?" → Seção de prazos por tipo de projeto.
4. "E depois que entregar, fico sozinho?" → Suporte vitalício nos planos.
5. "Como funciona?" → Processo em 4 etapas.

## 3. Produto e proposta de valor

**Proposta de valor:**
*Transformamos negócios em experiências digitais que geram confiança, autoridade e oportunidades.*

A comunicação vende **resultado e percepção de valor**, nunca "código" ou "linhas de programação".
Proibido o tom "nós fazemos sites".

**Serviços:**

| Serviço | Descrição |
|---|---|
| Landing Pages | Páginas focadas em conversão, geração de leads e campanhas. |
| Sites Institucionais | Presença digital completa para empresas que querem transmitir profissionalismo e autoridade. |
| E-commerce | Lojas virtuais completas para vender produtos online. |
| Projetos Personalizados | Sistemas, dashboards, integrações e experiências digitais específicas. |

## 4. Idiomas

**Português do Brasil (pt-BR)** — idioma único.
`<html lang="pt-BR">`. Não há versão em outro idioma no escopo atual.

## 5. Quantidade de páginas

**1 página principal** (one-page com navegação por âncoras) + **1 página de erro 404**.

Justificativa: o público decide rápido e majoritariamente no mobile. Uma jornada contínua
converte mais do que espalhar a informação em páginas separadas.

Âncoras: `#inicio`, `#servicos`, `#processo`, `#portfolio`, `#prazos`, `#planos`,
`#diferenciais`, `#garantia`, `#duvidas`, `#contato`.

## 6. Seções necessárias

Ordem definitiva (topo → base):

| # | Seção | Papel na conversão |
|---|---|---|
| 1 | Header / Navbar | Navegação fixa + CTA sempre visível |
| 2 | Hero | Promessa, prova visual imediata e CTA principal |
| 3 | Serviços | Mostra que existe solução para o caso do visitante |
| 4 | Como funciona | Organização e previsibilidade do processo |
| 5 | Portfólio | Prova real do trabalho |
| 6 | Prazos / Tipos de projeto | Responde "quanto tempo demora" |
| 7 | Planos | Responde "quanto custa" |
| 8 | Diferenciais | Justifica o valor |
| 9 | Garantia de qualidade | Reduz o risco percebido |
| 10 | Dúvidas frequentes | Derruba a última objeção antes do fechamento |
| 11 | CTA final + formulário | Fechamento |
| 12 | Footer | Navegação e contato |
| — | Botão flutuante de WhatsApp | Contato disponível o tempo todo |

### Conteúdo travado por seção

**Hero**
- Headline: "Seu negócio merece uma presença digital à altura."
- Subheadline: "Criamos sites profissionais, rápidos e estratégicos para empresas que querem
  transmitir autoridade, conquistar clientes e crescer no digital."
- CTA principal: "Quero meu site" → WhatsApp
- CTA secundário: "Ver portfólio" → `#portfolio`

**Como funciona** — 4 etapas:
`01 Briefing` · `02 Estratégia` · `03 Desenvolvimento` · `04 Entrega`

**Prazos / Tipos de projeto** — 3 formatos:

| Formato | Prazo | Aplicação |
|---|---|---|
| Express | 72 horas | Landing Pages e Presell |
| Padrão | Até 7 dias | Sites com mais de 5 páginas |
| Premium | Até 1 mês | E-commerces e Projetos Complexos |

**Planos** — valores e itens **imutáveis**:

| Plano | Valor | Descrição | Inclui |
|---|---|---|---|
| Básico | R$ 1.500 | Ideal para pequenas empresas | Site de até 5 páginas · Design responsivo · Otimização SEO básica · Pixels Meta e Google Ads integrados · Formulário de contato · Suporte vitalício |
| **Profissional** (MAIS POPULAR) | R$ 3.500 | Para empresas em crescimento | Site de até 10 páginas · Design personalizado · SEO avançado · Integração com CMS · Analytics integrado · Suporte vitalício |
| Premium | R$ 6.000 | Solução completa | Site ilimitado · Design exclusivo · E-commerce integrado · Sistema de gestão · Relatórios avançados · Suporte vitalício |

CTA de todos os planos: **"Escolher Plano"**. O Profissional é o de maior destaque visual.

**Diferenciais** — 6 itens: Design personalizado · Performance · Responsividade · Estratégia ·
Segurança · Suporte.

**Garantia de qualidade** — texto travado:
> "Todos os nossos projetos passam por rigorosos testes de qualidade antes da entrega. Revisamos
> responsividade, navegação, performance, formulários, links, compatibilidade e funcionamento das
> principais funcionalidades para garantir uma experiência final profissional."

Proibido transformar isso em garantia jurídica, promessa de reembolso ou prazo contratual.

**Dúvidas frequentes** — 5 perguntas, em `<details>`/`<summary>` nativo (acessível, sem JS):
prazo de entrega · suporte vitalício · funcionamento no celular · loja virtual · como começar.

Toda resposta é derivada de fato já aprovado (prazos, planos, serviços, processo). **Nenhuma
resposta pode introduzir informação comercial nova** — política de reembolso, prazo de resposta,
condição de pagamento ou escopo de suporte precisam ser definidos por você antes de entrar aqui.

**CTA final**
- Headline: "Seu próximo site começa aqui."
- Texto: "Conte um pouco sobre seu projeto e descubra como a NEXO WEB pode transformar sua
  presença digital."
- Botão: "Solicitar orçamento" + CTA de WhatsApp.

**Footer** — NEXO WEB · "Sites profissionais para negócios que querem crescer no digital." ·
links de navegação · WhatsApp · "© 2026 NEXO WEB. Todos os direitos reservados."

## 7. Portfólio — regra rígida

Somente os trabalhos reais existentes em `/portfolio`. **Três projetos:**

| Projeto | Segmento | URL — **uso interno, nunca exibir** |
|---|---|---|
| Center Seg | Segurança Eletrônica | https://centerseg-site.vercel.app |
| TRAÇO Arquitetura | Arquitetura e Interiores | https://traco-arquitetura-silk.vercel.app |
| C2 Minds | Marketing de Conteúdo | https://c2minds-site.vercel.app |

### Sem acesso externo (regra rígida)

O visitante **só visualiza** o projeto, dentro do site. É proibido no portfólio:

- link ou `href` para o site do projeto;
- botão "Visitar site", "Ver site" ou equivalente;
- exibir qualquer URL — em especial qualquer coisa com `.vercel.app`;
- qualquer elemento que permita abrir o site do projeto.

A barra de endereço das molduras de navegador mostra o **nome do projeto**, não a URL. Vale
também para as duas molduras do Hero. Ver D-14 em @memoria.md.

As URLs acima existem só como registro interno. `/specs` e `/portfolio` não vão para produção
(`.vercelignore`) e estão bloqueados no `robots.txt`.

Proibido: inventar projetos, clientes, resultados, números, depoimentos ou atribuir trabalhos a
empresas não informadas.

O grid é **flexível por quantidade** (`flex-wrap` centralizado, `flex: 1 1 300px`): adicionar ou
remover um projeto não abre buraco no layout — com 3 itens em 2 colunas, o terceiro centraliza.

Os cards ficam direto no HTML (e não em JavaScript) para que os buscadores enxerguem os projetos
e para que a seção funcione mesmo sem JS. Cada `<article class="pf-card">` carrega o que o
lightbox precisa em atributos `data-`:

| Atributo | Conteúdo |
|---|---|
| `data-title` | Nome do projeto |
| `data-tag` | Segmento |
| `data-url` | Endereço do site no ar |
| `data-full` | Caminho do WebP em alta, baixado só ao abrir o projeto |

Para adicionar um projeto novo: colocar o print em `/portfolio`, gerar os WebP (`-card` e `-full`),
duplicar um `<article class="pf-card">` no `index.html` e trocar os quatro `data-`, o `src`, o
`alt` e a URL da barra do navegador.

## 8. Funcionalidades

- Navegação por âncora com rolagem suave e compensação da navbar fixa.
- Header fixo com mudança de estado ao rolar.
- Scroll spy: destaca no menu a seção em que o visitante está.
- Menu hamburger no mobile, com foco preso (focus trap) e fechamento por `Esc`.
- **Loader de tela cheia** com barra de progresso; sai deslizando para cima.
- **Hero palavra a palavra**: cada palavra em clip-mask, `translateY(115%)` → `0`, easeOutExpo,
  stagger de 55ms.
- **Títulos de seção em StackedLines**: linha a linha, stagger de 110ms. O JS mede onde o
  navegador realmente quebrou a linha e refaz a medição ao redimensionar.
- Animações de entrada por `IntersectionObserver`, com stagger; variante em escala para cards de
  portfólio e planos.
- Parallax discreto no Hero (só desktop).
- **Rolagem suave com inércia própria**, sem biblioteca — só em telas com mouse.
- Portfólio: efeito de rolagem do print no hover + elevação e zoom sutil + lightbox com a página
  inteira. **Sem link externo.**
- Lightbox acessível: `Esc` fecha, foco preso, scroll do fundo bloqueado, imagem carregada
  sob demanda.
- Formulário de orçamento com validação em tempo real.
- Botão flutuante de WhatsApp, presente em toda a navegação.
- CTAs de WhatsApp com mensagem pré-preenchida por contexto (plano escolhido, serviço, etc).

### Como o formulário entrega a mensagem

**Decisão aprovada:** sem backend. O formulário valida os dados no cliente e abre o WhatsApp com
a mensagem já montada (`https://wa.me/<numero>?text=<mensagem>`).

Motivos: zero credencial exposta, zero superfície de spam, zero custo, zero dependência de
terceiro — e o lead chega direto no celular. Todo texto é passado por `encodeURIComponent`.

Se um dia for preciso enviar por e-mail, isso exige backend ou serviço externo e **deve ser
aprovado antes**.

## 9. Chamadas para ação

| Local | Texto | Destino |
|---|---|---|
| Header | Solicitar orçamento | `#contato` |
| Hero (principal) | Quero meu site | WhatsApp |
| Hero (secundário) | Ver portfólio | `#portfolio` |
| Cards de serviço | Solicitar este serviço | WhatsApp (mensagem por serviço) |
| Portfólio | Ver projeto | Lightbox (sem link externo) |
| Prazos | Falar sobre este formato | WhatsApp (mensagem por formato) |
| Planos | Escolher Plano | WhatsApp (mensagem por plano) |
| CTA final | Solicitar orçamento | Envio do formulário |
| CTA final | Chamar no WhatsApp | WhatsApp |
| Footer | WhatsApp | WhatsApp |
| Flutuante | Ícone de WhatsApp | WhatsApp |

## 10. Informações que ainda precisam ser definidas

| Item | Situação | Onde entra |
|---|---|---|
| Domínio de produção | **Pendente.** Assumido `https://nexoweb.com.br` | `SITE_URL` no `<head>`, `canonical`, `og:url`, `sitemap.xml`, `robots.txt`, JSON-LD |
| E-mail comercial | **Pendente.** Não publicado — não usar e-mail pessoal sem autorização | Footer, seção de contato, JSON-LD |
| Redes sociais (Instagram/LinkedIn) | **Pendente.** Omitidas para não gerar link quebrado | Footer, JSON-LD `sameAs` |
| CNPJ / razão social | **Pendente** | Footer |
| Cidade / região de atendimento | **Pendente** | JSON-LD `areaServed`, SEO local |
| Página de Política de Privacidade | **Pendente.** Necessária se algum dia entrar formulário com backend ou analytics | Footer |
| Analytics (GA4 / Meta Pixel) | **Não instalado.** Exige aviso de cookies/privacidade | `<head>` |

WhatsApp **definido**: `+55 62 98474-7979` (`5562984747979`).

Enquanto pendentes, esses itens **não devem ser preenchidos com dados inventados**.

## 11. Stack técnica (travada)

- **HTML5 semântico** — sem framework.
- **CSS3 puro** — custom properties, Grid, Flexbox, `clamp()`. Sem pré-processador, sem Tailwind.
- **JavaScript ES6 puro** — módulos nativos, sem bundler, sem transpilação.
- **Fonte Inter variável auto-hospedada** (`assets/fonts/`, licença OFL). Zero requisição externa.
- **Imagens em WebP**, geradas offline a partir dos PNG originais.

**Zero dependências de runtime. Zero etapa de build.** Abrir `index.html` funciona.

Motivo: site institucional de uma página. Framework aqui só adicionaria peso, superfície de
ataque (supply chain) e manutenção — sem nenhum ganho.

Hospedagem prevista: qualquer host estático (Vercel, Netlify, Cloudflare Pages ou hospedagem
tradicional). `vercel.json` e `_headers` já entregam os cabeçalhos de segurança.

**Não trocar a stack sem autorização explícita.**

## 12. Regras de responsividade

Abordagem **mobile-first**: o CSS base é o do celular; `min-width` adiciona o resto.

| Breakpoint | Alvo | Comportamento |
|---|---|---|
| 360–479px | Celulares pequenos | 1 coluna, tipografia reduzida via `clamp()` |
| 480–767px | Celulares grandes | 1 coluna, respiro maior |
| 768–1023px | Tablets | 2 colunas em serviços/diferenciais/prazos |
| 1024–1279px | Notebooks | Layout completo, menu horizontal |
| ≥1280px | Desktop | Container de 1200px, hero em 2 colunas |
| ≥1600px | Monitores grandes | Container mantido; sem esticar texto |

Regras:
- Não é redução do desktop: o mobile tem ordem, espaçamento e hierarquia próprios.
- Alvo de toque: **44px** de altura em botões, CTAs e controles de ícone. Links de lista no
  rodapé ficam em 41px — bem acima do mínimo de 24px exigido pelo WCAG 2.2 AA.
- Nada de rolagem horizontal em nenhuma largura.
- Tipografia fluida com `clamp()` — sem saltos bruscos.
- Imagens sempre com `width`/`height` declarados, para não causar deslocamento de layout.
- **Planos:** no mobile o Profissional vem **primeiro**, sem o efeito de escala.
- **Portfólio:** flex centralizado, adapta-se à quantidade de itens sem buraco.
- **Botão do WhatsApp:** posição segura, respeitando `safe-area-inset` do iPhone; nunca sobre
  um botão importante.
- **Navbar:** hamburger abaixo de 1024px, com menu em painel lateral.

## 13. Requisitos de acessibilidade

Meta: **WCAG 2.1 nível AA**.

- HTML semântico: um único `<h1>`, hierarquia de headings sem pular nível, `<nav>`, `<main>`,
  `<section>`, `<footer>`.
- Contraste mínimo de 4,5:1 em texto normal e 3:1 em texto grande.
- Foco visível em todos os elementos interativos (`:focus-visible` com anel vermelho).
- Link "Pular para o conteúdo" como primeiro elemento focável.
- Navegação completa por teclado, incluindo menu mobile e lightbox (focus trap + `Esc`).
- `aria-label`, `aria-expanded`, `aria-controls`, `aria-current` e `role` onde necessário.
- `alt` descritivo em todas as imagens; decorativas com `alt=""` e `aria-hidden`.
- Erros de formulário associados por `aria-describedby` e anunciados via `role="alert"`.
- `prefers-reduced-motion: reduce` desliga animações e transições.
- Nenhuma informação transmitida somente por cor.
- Zoom até 200% sem quebra de layout.

## 14. Requisitos de desempenho

Metas (Lighthouse mobile, 4G simulado):

| Métrica | Meta |
|---|---|
| Performance | ≥ 95 |
| Acessibilidade | ≥ 95 |
| Boas práticas | 100 |
| SEO | 100 |
| LCP | < 2,0s |
| CLS | < 0,05 |
| INP | < 200ms |
| Peso total inicial | < 500 KB |

Como se sustenta:
- Zero JavaScript de terceiros; JS próprio abaixo de 15 KB.
- CSS único, sem framework.
- Imagens WebP com recorte dedicado para o hero (28 KB) e `loading="lazy"` no resto.
- Imagens do lightbox carregadas **somente ao abrir**.
- Fonte variável auto-hospedada com `preload` + `font-display: swap`.
- Animações restritas a `transform` e `opacity` (sem reflow).
- `IntersectionObserver` no lugar de listener de scroll; scroll real com `passive: true`.
- Nenhum `@import` no CSS; nenhuma requisição externa bloqueante.

## 15. Segurança

- Nenhuma chave, token, senha ou credencial no frontend — o projeto **não possui** nenhum segredo.
- Content-Security-Policy restritiva (`default-src 'self'`), sem `unsafe-inline` em scripts.
- Cabeçalhos: HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`, `Cross-Origin-Opener-Policy`.
- Todo link externo com `rel="noopener noreferrer"`.
- Sem `innerHTML` com dado vindo do usuário — apenas `textContent`.
- Entrada do formulário validada, limitada em tamanho e escapada com `encodeURIComponent`.
- Sem `eval`, sem `new Function`, sem handler inline no HTML.
- Nenhum `console.log` em produção.
- `/portfolio` (PNGs originais) e `/specs` não vão para produção — ver `.vercelignore`.

## 16. SEO

- `<title>` e `meta description` únicos e otimizados.
- Open Graph + Twitter Card com imagem 1200×630 própria.
- URL canônica.
- JSON-LD: `ProfessionalService` + `FAQPage` + `BreadcrumbList`.
- `robots.txt` e `sitemap.xml`.
- Favicon SVG + PNG + apple-touch-icon + webmanifest.
- `alt` descritivo em todas as imagens.
- Um `<h1>` só, headings em ordem.
- `lang="pt-BR"`, charset UTF-8, viewport correto.

## 17. Escopo

### Dentro do escopo

- Página única responsiva com as 11 seções definidas.
- Página 404.
- Portfólio com os 3 trabalhos reais, com lightbox.
- Formulário de orçamento que entrega via WhatsApp.
- Botão flutuante de WhatsApp.
- Design system próprio (preto + vermelho).
- SEO técnico, acessibilidade AA e cabeçalhos de segurança.
- Otimização das imagens do portfólio.

### Fora do escopo

- Backend, banco de dados, área de login ou painel administrativo.
- CMS ou blog.
- Pagamento online / checkout dos planos.
- Multi-idioma.
- Analytics, pixels de rastreamento e banner de cookies (exigem decisão de privacidade).
- E-mail transacional.
- Chat ao vivo (o WhatsApp cumpre esse papel).
- Depoimentos, selos, prêmios e estatísticas — **não existem dados reais para isso**.
- Modo claro (a marca é escura por definição).
