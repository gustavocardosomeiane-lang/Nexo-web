/**
 * Catalogo de servicos.
 *
 * Preco NAO e constante de codigo: e dado, cadastrado aqui, editavel sem
 * publicar nada. Os tres planos ja vem cadastrados com os valores reais da
 * NEXO WEB (R$ 1.400 / R$ 2.500 / R$ 4.000).
 */

import { useCallback, useMemo, useState } from 'react';
import { db } from '@/data';
import { useColecao } from '@/hooks/useColecao';
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/components/ui/Toast';
import type { Service, ServiceCategoria } from '@/types';
import { brl, centavosParaCampo, paraCentavos } from '@/lib/format';
import { Confirmacao, Modal } from '@/components/ui/Modal';
import {
  Aviso,
  Badge,
  Botao,
  BotaoIcone,
  CampoSelect,
  CampoTexto,
  CampoTextarea,
  Eyebrow,
  Switch,
  Vazio,
} from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { CATEGORIA_SERVICO, opcoesSimples } from '@/components/dominio/StatusBadge';
import { coletarErros, inteiroEntre, limparTexto, obrigatorio, temErro, valorValido } from '@/lib/validation';

export function Servicos() {
  const { pode } = useAuth();
  const toast = useToast();

  const colecao = useColecao<Service>(db.servicos, {
    porPagina: 50,
    ordenarPor: 'nome',
    ordem: 'asc',
    filtrosIniciais: { categoria: 'todos' },
  });

  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<Service | null>(null);
  const [excluindo, setExcluindo] = useState<Service | null>(null);
  const [processando, setProcessando] = useState(false);

  const alternarAtivo = useCallback(
    async (servico: Service) => {
      try {
        await db.servicos.atualizar(servico.id, { ativo: !servico.ativo });
        toast.sucesso(servico.ativo ? 'Serviço desativado.' : 'Serviço ativado.');
        colecao.recarregar();
      } catch (e) {
        toast.erro(e instanceof Error ? e.message : 'Não foi possível atualizar.');
      }
    },
    [toast, colecao],
  );

  const excluir = useCallback(async () => {
    if (!excluindo) return;
    setProcessando(true);
    try {
      await db.servicos.remover(excluindo.id);
      toast.sucesso('Serviço excluído.');
      setExcluindo(null);
      colecao.recarregar();
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Não foi possível excluir.');
    } finally {
      setProcessando(false);
    }
  }, [excluindo, toast, colecao]);

  const ativos = useMemo(() => colecao.itens.filter((s) => s.ativo), [colecao.itens]);
  const inativos = useMemo(() => colecao.itens.filter((s) => !s.ativo), [colecao.itens]);

  return (
    <>
      <header className="pagina-cabeca">
        <div>
          <Eyebrow>Catálogo</Eyebrow>
          <h1 className="pagina-titulo">Serviços</h1>
          <p className="pagina-descricao">
            O que a NEXO WEB vende e por quanto. Estes preços alimentam o formulário de venda e o
            valor potencial dos leads — nenhum valor fica preso no código.
          </p>
        </div>
        {pode('servicos', 'criar') && (
          <div className="pagina-acoes">
            <Botao variante="primario" icone="mais" onClick={() => setCriando(true)}>
              Novo serviço
            </Botao>
          </div>
        )}
      </header>

      <div className="filtros">
        <CampoTexto
          className="busca"
          placeholder="Buscar serviço"
          iconeEsquerda="busca"
          value={colecao.busca}
          onChange={(e) => colecao.setBusca(e.target.value)}
          aria-label="Buscar serviços"
        />
        <select
          className="select"
          value={String(colecao.filtros.categoria ?? 'todos')}
          onChange={(e) => colecao.definirFiltro('categoria', e.target.value)}
          aria-label="Filtrar por categoria"
        >
          {opcoesSimples(CATEGORIA_SERVICO, 'Todas as categorias').map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.rotulo}
            </option>
          ))}
        </select>
      </div>

      {colecao.erro && <Aviso tom="erro">{colecao.erro}</Aviso>}

      {colecao.carregando ? (
        <div className="grade-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card card-p">
              <div className="skeleton" style={{ height: 120 }} />
            </div>
          ))}
        </div>
      ) : colecao.itens.length === 0 ? (
        <div className="card">
          <Vazio icone="servicos" titulo="Nenhum serviço cadastrado" />
        </div>
      ) : (
        <>
          <div className="grade-3">
            {ativos.map((s) => (
              <CardServico
                key={s.id}
                servico={s}
                podeEditar={pode('servicos', 'editar')}
                podeExcluir={pode('servicos', 'excluir')}
                aoEditar={setEditando}
                aoExcluir={setExcluindo}
                aoAlternar={alternarAtivo}
              />
            ))}
          </div>

          {inativos.length > 0 && (
            <div className="secao">
              <div className="secao-cabeca">
                <h2 style={{ fontSize: '1rem' }}>Inativos</h2>
                <span style={{ fontSize: '.8125rem', color: 'var(--fg-dim)' }}>
                  Não aparecem no formulário de venda
                </span>
              </div>
              <div className="grade-3">
                {inativos.map((s) => (
                  <CardServico
                    key={s.id}
                    servico={s}
                    podeEditar={pode('servicos', 'editar')}
                    podeExcluir={pode('servicos', 'excluir')}
                    aoEditar={setEditando}
                    aoExcluir={setExcluindo}
                    aoAlternar={alternarAtivo}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {(criando || editando) && (
        <FormularioServico
          servico={editando}
          aoFechar={() => {
            setCriando(false);
            setEditando(null);
          }}
          aoSalvar={() => {
            setCriando(false);
            setEditando(null);
            colecao.recarregar();
          }}
        />
      )}

      <Confirmacao
        aberto={excluindo !== null}
        aoFechar={() => setExcluindo(null)}
        aoConfirmar={() => void excluir()}
        titulo="Excluir serviço"
        mensagem={`“${excluindo?.nome}” sai do catálogo. Vendas antigas que apontam para ele continuam existindo. Se a ideia é só tirar de circulação, prefira desativar.`}
        textoConfirmar="Excluir"
        perigo
        processando={processando}
      />
    </>
  );
}

function CardServico({
  servico,
  podeEditar,
  podeExcluir,
  aoEditar,
  aoExcluir,
  aoAlternar,
}: {
  servico: Service;
  podeEditar: boolean;
  podeExcluir: boolean;
  aoEditar: (s: Service) => void;
  aoExcluir: (s: Service) => void;
  aoAlternar: (s: Service) => void;
}) {
  const promo = servico.preco_promocional !== null && servico.preco_promocional < servico.preco;

  return (
    <article className={`card card-p servico-card ${servico.ativo ? '' : 'inativo'}`}>
      <div className="linha-entre" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <Badge tom="neutro" ponto={false}>
            {CATEGORIA_SERVICO[servico.categoria]}
          </Badge>
          <h3 style={{ marginTop: 10 }}>{servico.nome}</h3>
        </div>
        <div className="linha" style={{ gap: 2 }}>
          {podeEditar && <BotaoIcone icone="editar" rotulo={`Editar ${servico.nome}`} onClick={() => aoEditar(servico)} />}
          {podeExcluir && <BotaoIcone icone="lixeira" rotulo={`Excluir ${servico.nome}`} onClick={() => aoExcluir(servico)} />}
        </div>
      </div>

      {servico.descricao && <p className="servico-descricao">{servico.descricao}</p>}

      <div className="servico-preco">
        {promo && <span className="servico-preco-antigo">{brl(servico.preco)}</span>}
        <span className="servico-preco-atual">{brl(servico.preco_promocional ?? servico.preco)}</span>
        <span className="servico-parcelas">
          <Icon nome="pagamentos" tamanho={13} />
          até {servico.max_parcelas}×
        </span>
      </div>

      {podeEditar && (
        <div className="servico-rodape">
          <Switch
            rotulo={servico.ativo ? 'Ativo' : 'Inativo'}
            checked={servico.ativo}
            onChange={() => aoAlternar(servico)}
          />
        </div>
      )}
    </article>
  );
}

function FormularioServico({
  servico,
  aoFechar,
  aoSalvar,
}: {
  servico: Service | null;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    nome: servico?.nome ?? '',
    descricao: servico?.descricao ?? '',
    preco: servico ? centavosParaCampo(servico.preco) : '',
    preco_promocional: servico?.preco_promocional ? centavosParaCampo(servico.preco_promocional) : '',
    categoria: (servico?.categoria ?? 'site_institucional') as ServiceCategoria,
    max_parcelas: String(servico?.max_parcelas ?? 6),
    ativo: servico?.ativo ?? true,
  });
  const [erros, setErros] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    const preco = paraCentavos(form.preco || '0');
    const promo = form.preco_promocional ? paraCentavos(form.preco_promocional) : null;
    const parcelas = Number.parseInt(form.max_parcelas, 10) || 1;

    const encontrados = coletarErros<Record<string, unknown>>({
      nome: obrigatorio(form.nome, 'O nome'),
      preco: preco <= 0 ? 'Informe o preço.' : valorValido(preco),
      preco_promocional:
        promo !== null && promo >= preco ? 'O preço promocional precisa ser menor que o normal.' : null,
      max_parcelas: inteiroEntre(parcelas, 1, 24, 'O número máximo de parcelas'),
    });

    if (temErro(encontrados)) {
      setErros(encontrados as Record<string, string>);
      return;
    }

    setErros({});
    setSalvando(true);

    const dados = {
      nome: limparTexto(form.nome, 120),
      descricao: limparTexto(form.descricao, 1000) || null,
      preco,
      preco_promocional: promo,
      categoria: form.categoria,
      max_parcelas: parcelas,
      ativo: form.ativo,
    };

    try {
      if (servico) {
        await db.servicos.atualizar(servico.id, dados);
        toast.sucesso('Serviço atualizado.');
      } else {
        await db.servicos.criar(dados);
        toast.sucesso('Serviço cadastrado.');
      }
      aoSalvar();
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      largo
      titulo={servico ? 'Editar serviço' : 'Novo serviço'}
      rodape={
        <>
          <Botao variante="fantasma" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={() => void salvar()} carregando={salvando}>
            {servico ? 'Salvar alterações' : 'Cadastrar'}
          </Botao>
        </>
      }
    >
      <div className="form-grade">
        <CampoTexto
          className="col-inteira"
          rotulo="Nome"
          value={form.nome}
          onChange={(e) => setForm({ ...form, nome: e.target.value })}
          erro={erros.nome}
          maxLength={120}
          obrigatorio
          autoFocus
        />
        <CampoTextarea
          className="col-inteira"
          rotulo="Descrição"
          value={form.descricao}
          onChange={(e) => setForm({ ...form, descricao: e.target.value })}
          maxLength={1000}
        />
        <CampoTexto
          rotulo="Preço (R$)"
          value={form.preco}
          onChange={(e) => setForm({ ...form, preco: e.target.value })}
          erro={erros.preco}
          inputMode="decimal"
          placeholder="2500,00"
          obrigatorio
        />
        <CampoTexto
          rotulo="Preço promocional (R$)"
          value={form.preco_promocional}
          onChange={(e) => setForm({ ...form, preco_promocional: e.target.value })}
          erro={erros.preco_promocional}
          inputMode="decimal"
          ajuda="Deixe vazio se não houver."
        />
        <CampoSelect
          rotulo="Categoria"
          value={form.categoria}
          opcoes={opcoesSimples(CATEGORIA_SERVICO)}
          onChange={(e) => setForm({ ...form, categoria: e.target.value as ServiceCategoria })}
        />
        <CampoTexto
          rotulo="Máximo de parcelas"
          type="number"
          min={1}
          max={24}
          value={form.max_parcelas}
          onChange={(e) => setForm({ ...form, max_parcelas: e.target.value })}
          erro={erros.max_parcelas}
        />
        <div className="col-inteira">
          <Switch
            rotulo="Serviço ativo"
            descricao="Serviços inativos não aparecem no formulário de venda."
            checked={form.ativo}
            onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
          />
        </div>
      </div>
    </Modal>
  );
}
