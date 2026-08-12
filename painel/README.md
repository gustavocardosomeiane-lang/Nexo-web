# NEXO WEB — Painel administrativo

Centro de comando da NEXO WEB: leads, clientes, vendas, pagamentos, parcelas,
faturamento, serviços, projetos, conversas, automações e integrações.

Aplicação **separada do site**. O site em `../` continua exatamente como estava —
HTML/CSS/JS puro, zero build, zero dependência. Nada aqui é publicado junto dele.

---

## Como rodar

```bash
npm install --prefix painel
```

```bash
npm run dev --prefix painel
```

Abre em `http://localhost:5174` no **modo demonstração**: dados fictícios, nenhum
banco, nenhuma rede. Entre com qualquer um dos e-mails listados na tela de login e
qualquer senha de 8+ caracteres.

Outros comandos:

```bash
npm run typecheck --prefix painel
```

```bash
npm run build --prefix painel
```

---

## Os dois modos

O painel opera em um de dois modos, nunca nos dois. Quem decide é `VITE_DATA_MODE`.

| | **MOCK MODE** | **PRODUCTION MODE** |
|---|---|---|
| Origem dos dados | `src/data/mock/seed.ts` + localStorage | Supabase / PostgreSQL |
| Selo na barra superior | `Demonstração` (âmbar) | `Produção` (verde) |
| Autenticação | senha **não** verificada | Supabase Auth |
| Rede | nenhuma | apenas Supabase |

**Os dois nunca se misturam.** Se `VITE_DATA_MODE=production` e o Supabase não
estiver configurado, a aplicação **para e mostra erro** em vez de cair para dados
fictícios. Exibir faturamento inventado com o selo "Produção" seria pior do que
não abrir.

Tudo que é fictício está declarado no topo de `src/data/mock/seed.ts`. A única
informação real ali são os preços dos três planos (R$ 1.400 / R$ 2.500 /
R$ 4.000). Nenhum cliente real da NEXO WEB aparece no dataset: seria atribuir
receita inventada a cliente de verdade.

---

## Variáveis de ambiente

Copie `.env.example` para `.env.local` (que nunca vai para o Git).

> **A regra que não pode ser esquecida:** tudo com prefixo `VITE_` é compilado
> dentro do JavaScript e fica **visível para qualquer visitante**. Chave pública
> pode; secret key, nunca — nem no `.env.local`, nem em lugar nenhum do painel.

| Variável | Onde vive | Para quê |
|---|---|---|
| `VITE_DATA_MODE` | frontend | `mock` ou `production` |
| `VITE_SUPABASE_URL` | frontend | URL do projeto |
| `VITE_SUPABASE_ANON_KEY` | frontend | chave pública; quem protege é o RLS |
| `VITE_PAYMENT_PROVIDER` | frontend | identificador do adaptador |
| `VITE_PAYMENT_API_URL` | frontend | endpoint público do gateway |
| `VITE_PAYMENT_PUBLIC_KEY` | frontend | tokenização no navegador |
| `PAYMENT_SECRET_KEY` | **servidor** | criar/consultar cobrança |
| `PAYMENT_WEBHOOK_SECRET` | **servidor** | validar assinatura do webhook |
| `NINJABOT_API_KEY` | **servidor** | token do NinjaBot |

A tela **Configurações › Integrações** mostra, em tempo real, o que está
configurado e o que falta.

---

## Conectar o Supabase

1. Crie o projeto em [supabase.com](https://supabase.com).
2. **SQL Editor** → cole `supabase/schema.sql` inteiro → **Run**.
   Cria as 12 tabelas, os relacionamentos, os índices, os triggers e as políticas
   de Row Level Security. É idempotente: pode rodar de novo.
3. **Authentication → Users** → convide o seu e-mail.
4. O gatilho cria o perfil como `colaborador` — o papel mais restrito, de
   propósito. Promova você mesmo:
   ```sql
   update public.users set role = 'administrador' where email = 'SEU@EMAIL';
   ```
5. **Project Settings → API**: copie a URL e a `anon` key para o `.env.local`.
6. `VITE_DATA_MODE=production`.

### Sobre a segurança do banco

A `anon` key é pública por natureza — ela vai no bundle e qualquer pessoa
consegue lê-la. **Quem impede acesso indevido é o Row Level Security**, e o
schema liga RLS em todas as tabelas. A matriz em `src/auth/permissions.ts` é
conveniência de interface: esconde botão que iria falhar. As duas camadas
precisam contar a mesma história — mexeu numa, revise a outra.

A `service_role` key ignora RLS e **não pode existir neste projeto**. Ela só vive
no servidor que trata webhooks.

---

## Webhooks de pagamento

**O endpoint `POST /api/webhooks/payment` não existe nesta aplicação.** Isto é uma
SPA: não há servidor para receber requisição. Está declarado aqui, na tela de
Integrações e no código — em vez de fingir que existe.

O que **existe e está pronto**:

`src/integrations/payments/webhookHandler.ts` contém a função
`processarEventoPagamento(evento, gateway, porta)`. Ela não conhece HTTP: recebe
o evento já normalizado e uma **porta de dados**. Isso permite rodar o mesmo
código no navegador (simulador) e num servidor real, sem alterar a regra.

O que ela faz, nesta ordem:

1. registra o evento — a constraint `UNIQUE` em `webhook_events.evento_externo_id`
   é a garantia de idempotência;
2. localiza a venda pela referência ou pelo id da transação;
3. atualiza o pagamento;
4. atualiza a parcela correspondente;
5. **recalcula** o status da venda a partir das parcelas (nunca aceita o status
   que o gateway mandar — a venda é a soma das suas partes);
6. marca o evento como processado;
7. cria a notificação.

### Ver funcionando

No modo demonstração, **Configurações › Integrações › Simular um evento** executa
o handler de verdade. Dispare duas vezes com o mesmo ID de evento: a segunda
volta como *"já havia sido processado. Nada foi alterado."*

### Colocar no ar

Escreva uma Edge Function do Supabase que:

1. leia o corpo **bruto** da requisição;
2. valide a assinatura com `PAYMENT_WEBHOOK_SECRET` — sem isso o endpoint é
   público e qualquer um marca venda como paga;
3. traduza o payload com `interpretarEvento` do adaptador do gateway;
4. chame `processarEventoPagamento` com uma porta escrita contra o cliente
   `service_role`;
5. responda `200` mesmo para evento duplicado — gateway que recebe erro reenvia
   em laço.

Só o passo 4 precisa de código novo; o resto do handler é reaproveitado.

---

## Conectar um gateway

Nenhum gateway foi escolhido — nem por você, nem por mim. Quando escolher, ele
precisa oferecer PIX, cartão, parcelamento, checkout, API e webhooks.

1. Crie `src/integrations/payments/<nome>Provider.ts` implementando
   `PaymentProvider` (a interface está toda comentada em `PaymentProvider.ts`).
2. Registre no mapa `ADAPTADORES` em `src/integrations/payments/index.ts`.
3. Defina `VITE_PAYMENT_PROVIDER=<nome>` e `VITE_PAYMENT_API_URL`.
4. Suba a função de webhook com as chaves de servidor.

Trocar de gateway depois é escrever outro adaptador. Nenhuma tela muda.

---

## Conectar o NinjaBot

A API não foi fornecida, então **nada foi inventado**.
`src/integrations/ninjabot/NinjaBotProvider.ts` declara apenas o que o painel
precisa receber para montar a tela de Conversas — lead, telefone, campanha, data
do disparo, status, última mensagem, etapa do funil, interesse e valor potencial.

Quando a API real aparecer (e o formato dela vai ser diferente), a tradução
acontece dentro do adaptador. As telas não mudam.

---

## Estrutura

```
painel/
├── index.html
├── vercel.json               Headers, CSP própria e rewrite de SPA
├── supabase/schema.sql       Tabelas, relacionamentos, índices, triggers e RLS
├── public/                   Logo, favicons e a Inter (copiados do site)
└── src/
    ├── main.tsx  App.tsx     Entrada e rotas (páginas em lazy loading)
    ├── types/                Modelo de domínio — espelha o schema.sql
    ├── lib/                  env · format · validation · rotulos · exportar · id
    ├── data/
    │   ├── provider.ts       INTERFACE DatabaseProvider
    │   ├── analytics.ts      Cálculo das métricas (puro, usado pelos 2 modos)
    │   ├── operacoes.ts      Regras multi-tabela (venda → parcelas → projeto)
    │   ├── query.ts          Busca, filtro, ordenação e paginação em memória
    │   ├── mock/             seed determinístico + provider de demonstração
    │   └── supabase/         cliente + provider PostgREST
    ├── integrations/
    │   ├── payments/         PaymentProvider · webhookHandler · adaptador nulo
    │   └── ninjabot/         NinjaBotProvider · adaptador nulo
    ├── auth/                 AuthContext · permissions · guardas de rota
    ├── hooks/                useColecao · useAsync · usePeriodo
    ├── components/
    │   ├── ui/               Primitivas, Modal, DataTable, Toast, Paginação
    │   ├── charts/           Gráficos em SVG, sem biblioteca
    │   ├── layout/           Shell · Sidebar
    │   └── dominio/          StatusBadge · StatCard · FiltroPeriodo
    ├── pages/                Uma por módulo
    └── styles/               tokens · base · components · charts · app · responsive
```

### Três interfaces, três fornecedores trocáveis

`DatabaseProvider` · `PaymentProvider` · `NinjaBotProvider`

A aplicação fala com as interfaces, nunca com a implementação. Trocar de banco,
de gateway ou de robô é escrever um arquivo.

---

## Identidade visual

Mesma marca do site, sem desvio: preto `#08080A`, vermelho `#E10E21` como
**acento** (regra dos 90/10 de `specs/design.md`), Inter variável auto-hospedada,
logo oficial, eyebrow vermelho, raios e curvas idênticos. Dark mode é o único
modo — a marca é escura por definição.

A paleta de gráficos foi validada para daltonismo e contraste sobre a superfície
`#111318`. **Não troque uma cor de série no olho**: a ordem é fixa e passou nos
testes de separação. Limite de 5 séries em barra/linha e 4 em rosca; o que passar
disso vira "Outros".

---

## O que ainda não está implementado

Dito aqui para não haver surpresa:

| Item | Situação |
|---|---|
| Endpoint HTTP de webhook | Handler pronto; falta a Edge Function (SPA não tem servidor) |
| Gateway de pagamento | Nenhum contratado. Cobrança e baixa são manuais |
| NinjaBot | API não fornecida |
| Exportar Excel (.xlsx) | Exige biblioteca de planilha. O CSV abre no Excel corretamente |
| Exportar PDF | Use Imprimir → Salvar como PDF; há folha de estilo de impressão |
| Criar/remover usuários | Pelo painel do Supabase (Authentication → Users) |
| Transação em `criarVendaCompleta` | Várias chamadas em sequência. Vira função PL/pgSQL quando o volume exigir |

---

## Deploy

Projeto Vercel **separado** do site:

- **Root Directory:** `painel`
- **Framework:** Vite · **Build:** `npm run build` · **Output:** `dist`
- Variáveis de ambiente: as `VITE_*` da tabela acima
- Domínio sugerido: `painel.nexoweb.com.br`

`vercel.json` já entrega CSP restritiva (`connect-src` liberado só para o
Supabase), HSTS, `X-Frame-Options: DENY`, `X-Robots-Tag: noindex` e o rewrite de
SPA. O `robots.txt` bloqueia tudo.

O site principal ignora esta pasta (`/painel/` está no `.vercelignore` da raiz),
então nada daqui vaza para `nexoweb.com.br`.

> Ao sair do modo demonstração, troque `https://*.supabase.co` na CSP pela URL
> exata do seu projeto. O curinga aceita qualquer projeto Supabase do mundo.
