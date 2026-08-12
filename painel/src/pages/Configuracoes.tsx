/**
 * Configuracoes: empresa, usuarios, integracoes e notificacoes.
 *
 * A aba de Integracoes e a mais importante: e nela que se ve, sem enfeite, o
 * que esta conectado e o que ainda nao esta, e exatamente qual variavel de
 * ambiente falta.
 *
 * O simulador de webhook so aparece no modo demonstracao. Ele executa o
 * handler DE VERDADE (`processarEventoPagamento`), inclusive a idempotencia —
 * disparar o mesmo evento duas vezes resulta em "ignorado" na segunda.
 */

import { useCallback, useState } from 'react';
import { db, emModoDemonstracao } from '@/data';
import { limparDadosMock } from '@/data/mock/mockProvider';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { DATA_MODE, ninjabotEnv, paymentEnv, supabaseEnv } from '@/lib/env';
import { gatewayConfigurado, portaWebhook, processarEventoPagamento } from '@/integrations/payments';
import { ninjaBotConfigurado } from '@/integrations/ninjabot';
import type { Sale, Settings, User, WebhookEvent } from '@/types';
import { formatarDataHora, formatarTelefone } from '@/lib/format';
import {
  Aviso,
  Avatar,
  Badge,
  Botao,
  Card,
  CampoSelect,
  CampoTexto,
  CampoTextarea,
  Eyebrow,
  Skeleton,
  Switch,
  Vazio,
} from '@/components/ui/primitives';
import { Confirmacao } from '@/components/ui/Modal';
import { Icon, MarcaNexo, type NomeIcone } from '@/components/ui/Icon';
import { PAPEL, StatusWebhook } from '@/components/dominio/StatusBadge';
import { emailValido, limparTexto, obrigatorio, telefoneValido } from '@/lib/validation';

type Aba = 'empresa' | 'usuario' | 'integracoes' | 'notificacoes';

export function Configuracoes() {
  const [aba, setAba] = useState<Aba>('empresa');

  return (
    <>
      <header className="pagina-cabeca">
        <div>
          <Eyebrow>Sistema</Eyebrow>
          <h1 className="pagina-titulo">Configurações</h1>
          <p className="pagina-descricao">
            Dados da empresa, sua conta, integrações e quais eventos geram notificação.
          </p>
        </div>
      </header>

      <div className="abas" role="tablist" aria-label="Seções de configuração">
        {(
          [
            ['empresa', 'Empresa'],
            ['usuario', 'Usuários'],
            ['integracoes', 'Integrações'],
            ['notificacoes', 'Notificações'],
          ] as [Aba, string][]
        ).map(([chave, rotulo]) => (
          <button
            key={chave}
            type="button"
            role="tab"
            className="aba"
            aria-selected={aba === chave}
            onClick={() => setAba(chave)}
          >
            {rotulo}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 20 }} role="tabpanel">
        {aba === 'empresa' && <AbaEmpresa />}
        {aba === 'usuario' && <AbaUsuarios />}
        {aba === 'integracoes' && <AbaIntegracoes />}
        {aba === 'notificacoes' && <AbaNotificacoes />}
      </div>
    </>
  );
}

/* ==========================================================================
   Empresa
   ========================================================================== */

function AbaEmpresa() {
  const toast = useToast();
  const { dado, carregando, recarregar } = useAsync(() => db.obterConfiguracoes(), [], null as Settings | null);
  const [form, setForm] = useState<Settings['empresa'] | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erros, setErros] = useState<Record<string, string>>({});

  const atual = form ?? dado?.empresa ?? null;

  const definir = (campo: keyof Settings['empresa'], valor: string) => {
    if (!atual) return;
    setForm({ ...atual, [campo]: valor });
  };

  async function salvar() {
    if (!atual || !dado) return;

    const encontrados: Record<string, string> = {};
    const erroNome = obrigatorio(atual.nome, 'O nome');
    if (erroNome) encontrados.nome = erroNome;
    const erroTelefone = telefoneValido(atual.telefone, true);
    if (erroTelefone) encontrados.telefone = erroTelefone;
    if (atual.email.trim()) {
      const erroEmail = emailValido(atual.email);
      if (erroEmail) encontrados.email = erroEmail;
    }

    if (Object.keys(encontrados).length > 0) {
      setErros(encontrados);
      return;
    }

    setErros({});
    setSalvando(true);
    try {
      await db.salvarConfiguracoes({
        ...dado,
        empresa: {
          ...atual,
          nome: limparTexto(atual.nome, 80),
          descricao: limparTexto(atual.descricao, 300),
          telefone: atual.telefone.replace(/\D/g, ''),
          email: limparTexto(atual.email, 120),
        },
      });
      toast.sucesso('Dados da empresa salvos.');
      setForm(null);
      recarregar();
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  if (carregando || !atual) return <Skeleton altura={320} />;

  return (
    <div className="grade-larga">
      <Card>
        <div className="card-titulo" style={{ marginBottom: 16 }}>
          Dados da empresa
        </div>
        <div className="form-grade">
          <CampoTexto
            rotulo="Nome"
            value={atual.nome}
            onChange={(e) => definir('nome', e.target.value)}
            erro={erros.nome}
            maxLength={80}
            obrigatorio
          />
          <CampoTexto
            rotulo="Site"
            value={atual.site}
            onChange={(e) => definir('site', e.target.value)}
            maxLength={120}
            placeholder="https://nexoweb.com.br"
          />
          <CampoTextarea
            className="col-inteira"
            rotulo="Descrição"
            value={atual.descricao}
            onChange={(e) => definir('descricao', e.target.value)}
            maxLength={300}
          />
          <CampoTexto
            rotulo="WhatsApp"
            value={formatarTelefone(atual.telefone)}
            onChange={(e) => definir('telefone', e.target.value)}
            erro={erros.telefone}
            inputMode="tel"
            maxLength={20}
          />
          <CampoTexto
            rotulo="E-mail comercial"
            type="email"
            value={atual.email}
            onChange={(e) => definir('email', e.target.value)}
            erro={erros.email}
            maxLength={120}
            ajuda="Ainda não definido no site."
          />
          <CampoTexto
            rotulo="Instagram"
            value={atual.instagram}
            onChange={(e) => definir('instagram', e.target.value)}
            maxLength={120}
            placeholder="@nexoweb"
          />
          <CampoTexto
            rotulo="LinkedIn"
            value={atual.linkedin}
            onChange={(e) => definir('linkedin', e.target.value)}
            maxLength={160}
          />
        </div>

        <div className="linha" style={{ justifyContent: 'flex-end', marginTop: 18 }}>
          <Botao variante="primario" onClick={() => void salvar()} carregando={salvando} disabled={!form}>
            Salvar alterações
          </Botao>
        </div>
      </Card>

      <div className="pilha" style={{ gap: 16 }}>
        <Card>
          <div className="card-titulo" style={{ marginBottom: 14 }}>
            Identidade visual
          </div>
          <div className="linha" style={{ gap: 14, marginBottom: 14 }}>
            <span style={{ color: 'var(--fg)' }}>
              <MarcaNexo size={48} />
            </span>
            <div>
              <div style={{ color: 'var(--fg)', fontWeight: 700, letterSpacing: '-.02em' }}>NEXO WEB</div>
              <div style={{ fontSize: '.75rem', color: 'var(--fg-dim)' }}>
                Símbolo oficial, o mesmo do site
              </div>
            </div>
          </div>
          <p style={{ fontSize: '.8125rem', lineHeight: 1.6 }}>
            O painel usa a logo, a paleta e a tipografia do site — preto dominante, vermelho{' '}
            <span className="mono">#E10E21</span> como acento e Inter auto-hospedada. Não há
            upload de logo aqui de propósito: a marca é definida no projeto, não configurada por
            usuário.
          </p>
        </Card>

        {emModoDemonstracao && <CardDadosDemo />}
      </div>
    </div>
  );
}

function CardDadosDemo() {
  const toast = useToast();
  const [confirmando, setConfirmando] = useState(false);

  return (
    <>
      <Card>
        <div className="card-titulo" style={{ marginBottom: 8 }}>
          Dados de demonstração
        </div>
        <p style={{ fontSize: '.8125rem', lineHeight: 1.6, marginBottom: 14 }}>
          Tudo que você criar ou editar fica salvo no navegador. Restaurar apaga essas alterações e
          volta ao conjunto original de demonstração.
        </p>
        <Botao variante="perigo" icone="atualizar" onClick={() => setConfirmando(true)}>
          Restaurar dados de demonstração
        </Botao>
      </Card>

      <Confirmacao
        aberto={confirmando}
        aoFechar={() => setConfirmando(false)}
        aoConfirmar={() => {
          limparDadosMock();
          toast.sucesso('Dados restaurados. Recarregando…');
          window.setTimeout(() => window.location.reload(), 700);
        }}
        titulo="Restaurar dados de demonstração"
        mensagem="Todos os leads, clientes, vendas e projetos que você criou ou editou serão apagados. Isso não afeta nenhum banco real."
        textoConfirmar="Restaurar"
        perigo
      />
    </>
  );
}

/* ==========================================================================
   Usuários
   ========================================================================== */

function AbaUsuarios() {
  const { usuario, pode } = useAuth();
  const { dado, carregando } = useAsync(() => db.usuarios.todos(), [], [] as User[]);

  return (
    <div className="grade-larga">
      <Card padding={false}>
        <div className="card-cabeca">
          <div>
            <div className="card-titulo">Equipe</div>
            <div className="card-sub">Quem tem acesso ao painel</div>
          </div>
        </div>

        {carregando ? (
          <div style={{ padding: 20 }}>
            <Skeleton altura={180} />
          </div>
        ) : (
          <ul className="lista-simples">
            {dado.map((u) => (
              <li key={u.id}>
                <div className="linha" style={{ gap: 12, minWidth: 0 }}>
                  <Avatar nome={u.nome} url={u.avatar_url} tamanho="sm" />
                  <div className="pilha" style={{ minWidth: 0 }}>
                    <span className="truncar" style={{ color: 'var(--fg)', fontWeight: 600 }}>
                      {u.nome}
                      {u.id === usuario?.id && (
                        <span style={{ color: 'var(--fg-dim)', fontWeight: 400 }}> · você</span>
                      )}
                    </span>
                    <span className="truncar" style={{ fontSize: '.75rem', color: 'var(--fg-dim)' }}>
                      {u.email}
                    </span>
                  </div>
                </div>
                <Badge tom={u.role === 'administrador' ? 'erro' : 'neutro'}>{PAPEL[u.role]}</Badge>
              </li>
            ))}
          </ul>
        )}

        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--line-soft)' }}>
          <p className="campo-ajuda">
            {emModoDemonstracao
              ? 'Criar e remover usuários exige Supabase Auth. No modo demonstração a equipe é fixa.'
              : pode('configuracoes', 'criar')
                ? 'Novos usuários são convidados pelo painel do Supabase (Authentication → Users) e recebem o papel na tabela users.'
                : 'Somente administradores podem gerenciar usuários.'}
          </p>
        </div>
      </Card>

      <Card>
        <div className="card-titulo" style={{ marginBottom: 14 }}>
          Níveis de permissão
        </div>
        <dl className="definicoes">
          <div className="definicao">
            <dt>Administrador</dt>
            <dd>Acesso total, inclusive integrações e exclusões.</dd>
          </div>
          <div className="definicao">
            <dt>Vendedor</dt>
            <dd>Leads, clientes e vendas. Vê pagamentos, não altera.</dd>
          </div>
          <div className="definicao">
            <dt>Financeiro</dt>
            <dd>Pagamentos, parcelas, catálogo de preços e relatórios.</dd>
          </div>
          <div className="definicao">
            <dt>Colaborador</dt>
            <dd>Projetos e clientes. Não vê valores nem o financeiro.</dd>
          </div>
        </dl>
        <Aviso tom="info" className="secao">
          A permissão da interface é conveniência. Quem realmente barra acesso indevido são as
          policies de Row Level Security no Supabase — as duas precisam contar a mesma história.
        </Aviso>
      </Card>
    </div>
  );
}

/* ==========================================================================
   Integrações
   ========================================================================== */

function AbaIntegracoes() {
  return (
    <div className="pilha" style={{ gap: 16 }}>
      <CardIntegracao
        icone="banco"
        nome="Supabase / PostgreSQL"
        conectado={supabaseEnv.configurado && DATA_MODE === 'production'}
        descricao={
          supabaseEnv.configurado && DATA_MODE === 'production'
            ? 'Banco conectado. Todos os dados exibidos vêm do PostgreSQL.'
            : 'Sem banco conectado. O painel está usando dados de demonstração guardados no navegador.'
        }
        variaveis={[
          ['VITE_DATA_MODE', DATA_MODE],
          ['VITE_SUPABASE_URL', supabaseEnv.url || '(vazio)'],
          ['VITE_SUPABASE_ANON_KEY', supabaseEnv.anonKey ? '••••••••' : '(vazio)'],
        ]}
        nota="O schema completo, com relacionamentos e Row Level Security, está em painel/supabase/schema.sql. A service_role key nunca deve ser colocada aqui."
      />

      <CardIntegracao
        icone="pagamentos"
        nome="Gateway de pagamento"
        conectado={gatewayConfigurado}
        descricao={
          gatewayConfigurado
            ? `Gateway "${paymentEnv.provider}" ativo.`
            : 'Nenhum gateway contratado. Cobranças e baixas são feitas manualmente no painel.'
        }
        variaveis={[
          ['VITE_PAYMENT_PROVIDER', paymentEnv.provider],
          ['VITE_PAYMENT_API_URL', paymentEnv.apiUrl || '(vazio)'],
          ['VITE_PAYMENT_PUBLIC_KEY', paymentEnv.publicKey ? '••••••••' : '(vazio)'],
          ['PAYMENT_SECRET_KEY', 'somente no servidor'],
          ['PAYMENT_WEBHOOK_SECRET', 'somente no servidor'],
        ]}
        nota="Nenhum gateway foi escolhido por você, e nenhum foi escolhido por mim. A interface PaymentProvider já define o encaixe: PIX, cartão, parcelamento, checkout, API e webhooks. Secret keys jamais entram no frontend."
      />

      <CardIntegracao
        icone="robo"
        nome="NinjaBot"
        conectado={ninjaBotConfigurado}
        descricao={
          ninjaBotConfigurado
            ? `Adaptador "${ninjabotEnv.provider}" ativo.`
            : 'API não fornecida. Nada é sincronizado automaticamente.'
        }
        variaveis={[
          ['VITE_NINJABOT_PROVIDER', ninjabotEnv.provider],
          ['VITE_NINJABOT_API_URL', ninjabotEnv.apiUrl || '(vazio)'],
          ['NINJABOT_API_KEY', 'somente no servidor'],
        ]}
        nota="A interface NinjaBotProvider descreve apenas o que o painel precisa receber para montar a tela de Conversas. Nenhum endpoint foi inventado."
      />

      <SecaoWebhooks />
    </div>
  );
}

function CardIntegracao({
  icone,
  nome,
  descricao,
  conectado,
  variaveis,
  nota,
}: {
  icone: NomeIcone;
  nome: string;
  descricao: string;
  conectado: boolean;
  variaveis: [string, string][];
  nota: string;
}) {
  return (
    <div className="integracao">
      <span
        className="integracao-icone"
        style={conectado ? { background: 'var(--ok-tint)', color: '#4ADE80' } : undefined}
      >
        <Icon nome={icone} />
      </span>
      <div className="integracao-corpo">
        <div className="linha-entre" style={{ alignItems: 'flex-start' }}>
          <div>
            <div className="integracao-nome">{nome}</div>
            <div className="integracao-desc">{descricao}</div>
          </div>
          <Badge tom={conectado ? 'ok' : 'neutro'}>{conectado ? 'Conectado' : 'Não configurado'}</Badge>
        </div>

        <div className="integracao-env">
          {variaveis.map(([chave, valor]) => (
            <div key={chave}>
              <span className="chave">{chave}</span>
              <span> = {valor}</span>
            </div>
          ))}
        </div>

        <p className="campo-ajuda" style={{ marginTop: 10, lineHeight: 1.6 }}>
          {nota}
        </p>
      </div>
    </div>
  );
}

/* ==========================================================================
   Webhooks
   ========================================================================== */

function SecaoWebhooks() {
  const toast = useToast();
  const eventos = useAsync(
    () => db.eventosWebhook.todos({ ordenarPor: 'recebido_em', ordem: 'desc' }),
    [],
    [] as WebhookEvent[],
  );
  const vendas = useAsync(() => db.vendas.todos(), [], [] as Sale[]);

  const [vendaId, setVendaId] = useState('');
  const [tipo, setTipo] = useState<'pagamento.aprovado' | 'pagamento.recusado' | 'pagamento.pendente' | 'pagamento.reembolsado'>(
    'pagamento.aprovado',
  );
  const [idEvento, setIdEvento] = useState('evt_demo_001');
  const [simulando, setSimulando] = useState(false);

  const simular = useCallback(async () => {
    if (!vendaId) {
      toast.erro('Escolha uma venda.');
      return;
    }

    setSimulando(true);
    try {
      const venda = vendas.dado.find((v) => v.id === vendaId);
      const resultado = await processarEventoPagamento(
        {
          id: idEvento.trim() || `evt_${Date.now()}`,
          tipo,
          transacaoId: `txn_demo_${vendaId.slice(0, 8)}`,
          referencia: vendaId,
          valor: venda ? venda.valor_total - venda.desconto : null,
          metodo: venda?.forma_pagamento ?? null,
          ocorridoEm: new Date().toISOString(),
          bruto: { origem: 'simulador do painel', venda: venda?.codigo },
        },
        'simulado',
        portaWebhook,
      );

      if (resultado.status === 'processado') toast.sucesso(resultado.mensagem);
      else if (resultado.status === 'ignorado') toast.info(resultado.mensagem);
      else toast.erro(resultado.mensagem);

      eventos.recarregar();
      vendas.recarregar();
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Falha ao simular.');
    } finally {
      setSimulando(false);
    }
  }, [vendaId, tipo, idEvento, vendas, eventos, toast]);

  return (
    <Card padding={false}>
      <div className="card-cabeca">
        <div>
          <div className="card-titulo">Webhooks de pagamento</div>
          <div className="card-sub">Eventos recebidos e processados</div>
        </div>
      </div>

      <div style={{ padding: 20 }}>
        <Aviso tom="info">
          O endpoint <code className="mono">POST /api/webhooks/payment</code> <strong>não existe
          nesta aplicação</strong>: um site estático não tem servidor para receber requisição. Toda
          a lógica está pronta e testável em{' '}
          <code className="mono">src/integrations/payments/webhookHandler.ts</code> — ela recebe o
          evento e uma porta de dados, e não conhece HTTP. Para colocar no ar, embrulhe essa função
          numa Edge Function do Supabase. O passo a passo está em{' '}
          <code className="mono">painel/README.md</code>.
        </Aviso>

        {emModoDemonstracao && (
          <div className="simulador">
            <div className="card-titulo" style={{ marginBottom: 4 }}>
              Simular um evento
            </div>
            <p className="campo-ajuda" style={{ marginBottom: 14 }}>
              Executa o handler real, com idempotência de verdade: dispare duas vezes com o mesmo ID
              e a segunda será ignorada, sem cobrar nem notificar de novo.
            </p>

            <div className="form-grade">
              <CampoSelect
                rotulo="Venda"
                value={vendaId}
                opcoes={[
                  { valor: '', rotulo: 'Selecione a venda' },
                  ...vendas.dado
                    .filter((v) => v.status === 'aguardando_pagamento' || v.status === 'parcialmente_pago')
                    .slice(0, 40)
                    .map((v) => ({ valor: v.id, rotulo: `${v.codigo} · ${v.status}` })),
                ]}
                onChange={(e) => setVendaId(e.target.value)}
              />
              <CampoSelect
                rotulo="Evento"
                value={tipo}
                opcoes={[
                  { valor: 'pagamento.aprovado', rotulo: 'pagamento.aprovado' },
                  { valor: 'pagamento.pendente', rotulo: 'pagamento.pendente' },
                  { valor: 'pagamento.recusado', rotulo: 'pagamento.recusado' },
                  { valor: 'pagamento.reembolsado', rotulo: 'pagamento.reembolsado' },
                ]}
                onChange={(e) => setTipo(e.target.value as typeof tipo)}
              />
              <CampoTexto
                className="col-inteira"
                rotulo="ID do evento no gateway"
                value={idEvento}
                onChange={(e) => setIdEvento(e.target.value)}
                ajuda="É a chave da idempotência. Repita o mesmo valor para ver o evento ser ignorado."
                maxLength={64}
              />
            </div>

            <div className="linha" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
              <Botao variante="primario" icone="enviar" onClick={() => void simular()} carregando={simulando}>
                Disparar evento
              </Botao>
            </div>
          </div>
        )}
      </div>

      {eventos.carregando ? (
        <div style={{ padding: 20 }}>
          <Skeleton altura={120} />
        </div>
      ) : eventos.dado.length === 0 ? (
        <Vazio
          icone="plugue"
          titulo="Nenhum evento recebido"
          descricao="Sem gateway conectado, nenhum webhook chega. Os eventos aparecerão aqui assim que a integração existir."
        />
      ) : (
        <div className="tabela-envolucro" style={{ border: 0, borderRadius: 0 }}>
          <table className="tabela">
            <thead>
              <tr>
                <th>Evento</th>
                <th>Tipo</th>
                <th>Transação</th>
                <th>Situação</th>
                <th>Recebido</th>
              </tr>
            </thead>
            <tbody>
              {eventos.dado.slice(0, 30).map((e) => (
                <tr key={e.id}>
                  <td className="mono">{e.evento_externo_id}</td>
                  <td className="mono">{e.tipo}</td>
                  <td className="mono">{e.transacao_id ?? '—'}</td>
                  <td>
                    <StatusWebhook status={e.status} />
                    {e.erro && (
                      <div style={{ fontSize: '.6875rem', color: '#FF8A95', marginTop: 3 }}>{e.erro}</div>
                    )}
                  </td>
                  <td>{formatarDataHora(e.recebido_em)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ==========================================================================
   Notificações
   ========================================================================== */

const EVENTOS: { chave: keyof Settings['notificacoes']; rotulo: string; descricao: string }[] = [
  { chave: 'nova_venda', rotulo: 'Nova venda', descricao: 'Sempre que uma venda for registrada.' },
  { chave: 'pagamento_aprovado', rotulo: 'Pagamento aprovado', descricao: 'Quando o gateway confirmar o recebimento.' },
  { chave: 'pagamento_recusado', rotulo: 'Pagamento recusado', descricao: 'Cartão negado ou cobrança falha.' },
  { chave: 'pagamento_pendente', rotulo: 'Pagamento pendente', descricao: 'Cobrança gerada e ainda não paga.' },
  { chave: 'parcela_vencendo', rotulo: 'Parcela vencendo', descricao: 'Aviso antes do vencimento.' },
  { chave: 'lead_respondeu', rotulo: 'Lead respondeu', descricao: 'Resposta a um disparo do NinjaBot.' },
  { chave: 'novo_cliente', rotulo: 'Novo cliente', descricao: 'Quando um lead vira cliente.' },
  { chave: 'projeto_prazo', rotulo: 'Projeto próximo do prazo', descricao: 'Entrega chegando ou atrasada.' },
];

function AbaNotificacoes() {
  const toast = useToast();
  const { dado, carregando, recarregar } = useAsync(() => db.obterConfiguracoes(), [], null as Settings | null);
  const [form, setForm] = useState<Settings['notificacoes'] | null>(null);
  const [salvando, setSalvando] = useState(false);

  const atual = form ?? dado?.notificacoes ?? null;

  async function salvar() {
    if (!atual || !dado) return;
    setSalvando(true);
    try {
      await db.salvarConfiguracoes({ ...dado, notificacoes: atual });
      toast.sucesso('Preferências salvas.');
      setForm(null);
      recarregar();
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  if (carregando || !atual) return <Skeleton altura={320} />;

  return (
    <Card>
      <div className="card-titulo" style={{ marginBottom: 6 }}>
        Quais eventos geram notificação
      </div>
      <p className="campo-ajuda" style={{ marginBottom: 18 }}>
        Desligar um evento não impede que ele aconteça — apenas deixa de criar alerta na central.
      </p>

      <div className="pilha" style={{ gap: 16 }}>
        {EVENTOS.map((e) => (
          <Switch
            key={e.chave}
            rotulo={e.rotulo}
            descricao={e.descricao}
            checked={atual[e.chave]}
            onChange={(ev) => setForm({ ...atual, [e.chave]: ev.target.checked })}
          />
        ))}
      </div>

      <div className="linha" style={{ justifyContent: 'flex-end', marginTop: 22 }}>
        <Botao variante="primario" onClick={() => void salvar()} carregando={salvando} disabled={!form}>
          Salvar preferências
        </Botao>
      </div>
    </Card>
  );
}
