# specs/design.md — Fonte de verdade visual

Identidade visual da **NEXO WEB**. Marca independente, com identidade própria.
Toda decisão visual do projeto sai daqui.

---

## 1. Identidade

**Nome:** NEXO WEB

*Nexo* = ligação, conexão, ponto que une. A marca representa a ponte entre um negócio e a
presença digital que ele merece.

A identidade transmite: **tecnologia · profissionalismo · confiança · velocidade · qualidade ·
modernidade · conversão · crescimento**.

### Personalidade

| É | Não é |
|---|---|
| Sóbria, escura, densa | Colorida, festiva, "startup neon" |
| Precisa e geométrica | Orgânica, arredondada demais |
| Confiante | Agressiva ou gritada |
| Silenciosa, com poucos acentos | Cheia de efeitos disputando atenção |
| Estúdio de tecnologia | Template de marketplace |

### Símbolo

"N" geométrico construído com duas hastes brancas e uma **diagonal vermelha desenhada por trás
das hastes** — o vermelho aparece só na faixa central, nunca borrando os cantos.

Arquivos: `assets/img/favicon.svg`, `favicon-32.png`, `favicon-16.png`, `apple-touch-icon.png`,
`icon-192.png`, `icon-512.png`.

### Assinatura

Símbolo + "NEXO WEB" em branco, peso 800, `letter-spacing: -0.02em`, tudo em caixa alta.
O vermelho da assinatura vem **apenas do símbolo**. Nunca colorir a palavra "WEB" de vermelho —
o vermelho é reservado para ação, e a logo não é um botão.

### Proibido

- Usar a marca **C2 MINDS** como identidade, referência visual ou inspiração. A NEXO WEB é
  independente. *(Exceção aprovada e registrada em @memoria.md: "C2 Minds" aparece **apenas**
  como nome de cliente real numa legenda do portfólio.)*
- Copiar logo, cores, textos ou elementos proprietários de qualquer referência.
- Aparência de template pronto.

## 2. Paleta

Estética **predominantemente preta, sofisticada e premium**. O vermelho é o acento — nunca o
protagonista.

### Neutros (a base)

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#08080A` | Fundo principal |
| `--bg-alt` | `#0B0C0F` | Faixas alternadas |
| `--surface` | `#111318` | Cards |
| `--surface-2` | `#16181E` | Card em hover, elementos elevados |
| `--line` | `#23262E` | Bordas |
| `--line-soft` | `rgba(255,255,255,.07)` | Divisores sutis |
| `--fg` | `#FFFFFF` | Títulos |
| `--fg-muted` | `#A8ABB4` | Texto corrido |
| `--fg-dim` | `#767A85` | Legendas, apoio |

### Vermelho (o acento)

| Token | Valor | Uso |
|---|---|---|
| `--red` | `#E10E21` | Cor de ação principal |
| `--red-hover` | `#FF2033` | Hover de botões |
| `--red-deep` | `#B00A19` | Sombra/profundidade |
| `--red-glow` | `rgba(225,14,33,.35)` | Brilho controlado |
| `--red-tint` | `rgba(225,14,33,.10)` | Fundo de badge, ícone |

### Regra dos 90/10

**Mínimo 90% da tela em preto/cinza/branco. No máximo ~10% em vermelho.**

Vermelho **pode**: botão primário · badge "MAIS POPULAR" · números de etapa · ícone em hover ·
borda do card selecionado/destacado · eyebrow das seções · sublinhado de destaque na headline ·
anel de foco · botão do WhatsApp · barra do rodapé.

Vermelho **não pode**: fundo de seção inteira · texto corrido · mais de um botão vermelho no
mesmo campo de visão · todos os ícones ao mesmo tempo · bordas de todos os cards em repouso.

> Teste rápido: dê um passo atrás da tela. Se o olho não souber para onde ir primeiro, tem
> vermelho demais.

## 3. Tipografia

**Inter Variable**, auto-hospedada em `assets/fonts/` (licença OFL). Fallback:
`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.

Uma família só. A hierarquia vem de **peso, tamanho e espaçamento** — nunca de outra fonte.

| Papel | Tamanho | Peso | Tracking | Altura de linha |
|---|---|---|---|---|
| Display (h1) | `clamp(2.5rem, 6vw, 4.5rem)` | 800 | `-0.035em` | 1.02 |
| Seção (h2) | `clamp(2rem, 4vw, 3.1rem)` | 800 | `-0.03em` | 1.08 |
| Card (h3) | `clamp(1.15rem, 1.6vw, 1.35rem)` | 700 | `-0.01em` | 1.25 |
| Lead | `clamp(1.05rem, 1.5vw, 1.25rem)` | 400 | `0` | 1.65 |
| Corpo | `1rem` | 400 | `0` | 1.7 |
| Pequeno | `0.875rem` | 400 | `0` | 1.6 |
| Eyebrow | `0.75rem` | 600 | `0.18em` | 1 |
| Preço | `clamp(2.5rem, 4vw, 3.25rem)` | 800 | `-0.03em` | 1 |

**Eyebrow** (rótulo acima de cada título de seção): caixa alta, vermelho, precedido de um traço
vermelho de 24px. É o elemento que dá ritmo e identidade ao site inteiro.

Regras:
- Títulos grandes **sempre** com tracking negativo. É o que separa premium de genérico.
- Texto corrido em `--fg-muted`, nunca branco puro — branco puro em parágrafo cansa a vista.
- Largura máxima de leitura: `65ch`.
- Nunca justificado.

## 4. Espaçamento e layout

Escala base de **4px**: `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 · 128`.

- Container: `max-width: 1200px`, padding lateral `clamp(20px, 5vw, 40px)`.
- Respiro vertical entre seções: `clamp(72px, 9vw, 140px)`.
- Espaço em branco é parte do design premium. **Na dúvida, aumente.**
- Grid de 12 colunas conceituais; gap padrão de 24px (32px no desktop).

## 5. Componentes

### Raios

`--r-sm: 8px` · `--r: 14px` · `--r-lg: 20px` · `--r-xl: 28px` · `--r-full: 999px`

### Botões

Altura mínima de 48px (44px no mobile), padding `0 28px`, peso 600, raio `--r-full`.

| Variante | Repouso | Hover |
|---|---|---|
| Primário | Fundo `--red`, texto branco | `--red-hover`, sobe 2px, `box-shadow` com `--red-glow` |
| Secundário | Transparente, borda `--line`, texto branco | Borda branca, fundo `rgba(255,255,255,.04)` |
| WhatsApp | Fundo `#25D366`, texto `#062B14` | Clareia levemente, sobe 2px |
| Fantasma | Só texto + seta | Seta desliza 4px à direita |

Toda transição de botão: `180ms cubic-bezier(.4,0,.2,1)`.

### Cards

Fundo `--surface`, borda `1px solid --line`, raio `--r-lg`, padding `28px`.

Hover: fundo `--surface-2`, borda `rgba(225,14,33,.45)`, `translateY(-4px)` e um brilho vermelho
muito discreto no topo. **Nunca** borda vermelha sólida e cheia — o destaque é sugerido.

### Card de plano

- Básico e Premium: card padrão.
- **Profissional:** borda vermelha, badge "MAIS POPULAR" no topo, `scale(1.04)` no desktop,
  glow vermelho suave, preço em branco com o "R$" em `--fg-dim`.
- No mobile o Profissional vai para **primeiro**, sem `scale`.

### Moldura de navegador (portfólio e hero)

Componente que apresenta os prints como se estivessem num navegador real: barra superior com três
pontinhos e o **nome do projeto** no lugar da URL. É o que transforma "galeria de imagens" em
"apresentação profissional".

**Nunca exibir a URL do projeto ali** — nem no portfólio, nem no Hero. Ver D-14 em @memoria.md.

No hover, o print rola verticalmente revelando a página inteira (`transform: translateY`).

### Texturas de fundo

Usar com muita moderação, sempre atrás do conteúdo:
- **Grid**: linhas brancas a 4% de opacidade, células de 48px.
- **Glow radial vermelho**: no máximo **um por seção**, opacidade ≤ 0.18, sempre desfocado e
  fora do centro de leitura.
- **Ruído**: opcional, ≤ 3% de opacidade.

## 6. Ícones

SVG inline, traço de 1.5px, `stroke-linecap="round"`, 24×24, `currentColor`.
Estilo linear e geométrico — nunca preenchidos, nunca coloridos, nunca emoji.

Em repouso: `--fg-muted` dentro de um quadrado `--red-tint`.
Em hover do card: o ícone vira `--red`.

## 7. Movimento

Curvas: `--ease` `cubic-bezier(.4, 0, .2, 1)` para micro; **`--ease-expo`
`cubic-bezier(.16, 1, .3, 1)`** (easeOutExpo) para tudo que entra — arranca rápido e assenta;
`--ease-cortina` `cubic-bezier(.76, 0, .24, 1)` para a saída do loader.

| Interação | Duração | Stagger |
|---|---|---|
| Micro (cor, borda) | 150–200ms | — |
| Hover de card/botão | 200–320ms | — |
| Loader: saída | 900ms | — |
| Hero: palavra a palavra | 1s (transform) / 750ms (opacidade) | 55ms |
| Título de seção: linha a linha | 1s / 750ms | 110ms |
| Entrada ao rolar | 800ms (900ms na variante com escala) | 80ms |
| Lightbox | 300ms | — |
| Menu mobile: links | 450ms | 60ms |
| Rolagem do print no hover | 6,5s (linear) | — |

Entrada padrão: `opacity 0 → 1` + `translateY(26px) → 0`.
Variante com escala (portfólio e planos): + `scale(.965) → 1`.

**Texto em clip-mask** (Hero e títulos de seção): cada palavra — ou cada linha — vive dentro de um
`overflow: hidden` e entra de `translateY(115%)` + `opacity 0` para a posição final. O
`padding-bottom`/`margin-bottom` compensados na máscara evitam cortar descendentes (g, p, ç).

**Feito com `animation`, não com `transition`.** Uma transição deixaria `transform: none` grudado
no elemento e mataria o hover de card, o hover de botão e o destaque do plano — a animação
devolve o controle do `transform` quando termina.

Animar **somente** `transform` e `opacity`.

Proibido: bounce, rotação 3D, parallax forte, texto em máquina de escrever, carrossel automático,
qualquer coisa que se repita infinitamente e chame atenção sem motivo.

O pulso do botão de WhatsApp é a **única** animação em loop permitida — sutil e lenta.

**`prefers-reduced-motion: reduce` desliga tudo.** Elementos aparecem imediatamente, em estado
final. Não é opcional.

## 8. Foto e imagem

- Fonte única de imagens: prints reais do portfólio.
- Sempre dentro da moldura de navegador ou com borda + sombra — nunca soltas na página.
- Sem stock photo, sem ilustração genérica, sem mockup de laptop 3D.
- Sobreposição escura leve quando texto precisar ficar por cima.

## 9. Acessibilidade visual

- Contraste mínimo AA. `--fg-muted` sobre `--bg` = 9.4:1. `--red` sobre branco em texto pequeno
  **não passa** — por isso vermelho nunca é usado em texto corrido, só em botão (branco sobre
  vermelho = 4.9:1) e em elementos grandes.
- Foco: anel de 2px em `--red` com 2px de deslocamento. Sempre visível, nunca removido.
- Estado nunca comunicado só por cor — sempre acompanha ícone, texto ou peso.

## 10. Checklist antes de aprovar qualquer tela

1. O vermelho ocupa menos de 10% da tela?
2. Existe **um** ponto de atenção principal por seção?
3. Os títulos têm tracking negativo?
4. O espaçamento entre seções está generoso?
5. Todo card do mesmo grupo tem a mesma altura e alinhamento?
6. Funciona em 375px sem rolagem horizontal?
7. O foco de teclado está visível em tudo?
8. Alguém diria "isso parece um template"? Se sim, refazer.
