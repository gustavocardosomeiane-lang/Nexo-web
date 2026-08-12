/**
 * Clientes — listagem e cadastro.
 * O historico completo de cada um fica em `ClienteDetalhe`.
 */

import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/data';
import { useColecao } from '@/hooks/useColecao';
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/components/ui/Toast';
import type { Client } from '@/types';
import { formatarData, formatarTelefone, whatsappLink } from '@/lib/format';
import { DataTable, type Coluna } from '@/components/ui/DataTable';
import { Paginacao } from '@/components/ui/Pagination';
import { Confirmacao, Modal } from '@/components/ui/Modal';
import { Aviso, Avatar, Botao, BotaoIcone, CampoTexto, CampoTextarea, Eyebrow } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { coletarErros, emailValido, limparTexto, obrigatorio, telefoneValido, temErro } from '@/lib/validation';

const VAZIO = {
  nome: '',
  empresa: '',
  telefone: '',
  email: '',
  documento: '',
  cidade: '',
  estado: '',
  observacoes: '',
};

type FormCliente = typeof VAZIO;

export function Clientes() {
  const { pode } = useAuth();
  const toast = useToast();
  const navegar = useNavigate();

  const colecao = useColecao<Client>(db.clientes, { porPagina: 20, ordenarPor: 'criado_em' });

  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<Client | null>(null);
  const [excluindo, setExcluindo] = useState<Client | null>(null);
  const [processando, setProcessando] = useState(false);

  const excluir = useCallback(async () => {
    if (!excluindo) return;
    setProcessando(true);
    try {
      await db.clientes.remover(excluindo.id);
      toast.sucesso('Cliente excluído.');
      setExcluindo(null);
      colecao.recarregar();
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Não foi possível excluir.');
    } finally {
      setProcessando(false);
    }
  }, [excluindo, toast, colecao]);

  const colunas: Coluna<Client>[] = useMemo(
    () => [
      {
        chave: 'nome',
        titulo: 'Cliente',
        ordenarPor: 'nome',
        render: (c) => (
          <div className="linha" style={{ gap: 10 }}>
            <Avatar nome={c.empresa ?? c.nome} tamanho="sm" />
            <div className="pilha" style={{ minWidth: 0 }}>
              <span className="forte truncar">{c.empresa ?? c.nome}</span>
              <span className="truncar" style={{ fontSize: '.75rem', color: 'var(--fg-dim)' }}>
                {c.empresa ? c.nome : 'Pessoa física'}
              </span>
            </div>
          </div>
        ),
      },
      {
        chave: 'telefone',
        titulo: 'Telefone',
        render: (c) => formatarTelefone(c.telefone),
      },
      {
        chave: 'email',
        titulo: 'E-mail',
        ocultarNoMobile: true,
        render: (c) => <span className="truncar">{c.email ?? '—'}</span>,
      },
      {
        chave: 'local',
        titulo: 'Cidade',
        ocultarNoMobile: true,
        render: (c) => (c.cidade ? `${c.cidade}${c.estado ? `/${c.estado}` : ''}` : '—'),
      },
      {
        chave: 'cadastro',
        titulo: 'Cadastro',
        ordenarPor: 'criado_em',
        ocultarNoMobile: true,
        render: (c) => formatarData(c.criado_em),
      },
      {
        chave: 'acoes',
        titulo: '',
        render: (c) => (
          <div className="linha" style={{ gap: 2, justifyContent: 'flex-end' }}>
            {c.whatsapp && (
              <a
                className="btn-icone"
                href={whatsappLink(c.whatsapp) ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`WhatsApp de ${c.nome}`}
                title="WhatsApp"
                onClick={(e) => e.stopPropagation()}
              >
                <Icon nome="whatsapp" />
              </a>
            )}
            {pode('clientes', 'editar') && (
              <BotaoIcone
                icone="editar"
                rotulo={`Editar ${c.nome}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditando(c);
                }}
              />
            )}
            {pode('clientes', 'excluir') && (
              <BotaoIcone
                icone="lixeira"
                rotulo={`Excluir ${c.nome}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setExcluindo(c);
                }}
              />
            )}
          </div>
        ),
      },
    ],
    [pode],
  );

  return (
    <>
      <header className="pagina-cabeca">
        <div>
          <Eyebrow>Carteira</Eyebrow>
          <h1 className="pagina-titulo">Clientes</h1>
          <p className="pagina-descricao">
            Clique em qualquer cliente para abrir o histórico completo: vendas, pagamentos,
            parcelas, projetos e conversas.
          </p>
        </div>
        {pode('clientes', 'criar') && (
          <div className="pagina-acoes">
            <Botao variante="primario" icone="mais" onClick={() => setCriando(true)}>
              Novo cliente
            </Botao>
          </div>
        )}
      </header>

      <div className="filtros">
        <CampoTexto
          className="busca"
          placeholder="Buscar por nome, empresa, e-mail ou cidade"
          iconeEsquerda="busca"
          value={colecao.busca}
          onChange={(e) => colecao.setBusca(e.target.value)}
          aria-label="Buscar clientes"
        />
      </div>

      {colecao.erro && <Aviso tom="erro">{colecao.erro}</Aviso>}

      <DataTable
        colunas={colunas}
        itens={colecao.itens}
        chaveDe={(c) => c.id}
        carregando={colecao.carregando}
        aoClicar={(c) => navegar(`/clientes/${c.id}`)}
        ordenarPor={colecao.ordenarPor}
        ordem={colecao.ordem}
        aoOrdenar={colecao.alternarOrdem}
        vazioTitulo="Nenhum cliente encontrado"
        vazioDescricao="Clientes normalmente nascem de um lead convertido, mas você também pode cadastrar direto."
      />

      <Paginacao
        pagina={colecao.pagina}
        porPagina={colecao.porPagina}
        total={colecao.total}
        aoMudar={colecao.setPagina}
        rotuloItem="clientes"
      />

      {(criando || editando) && (
        <FormularioCliente
          cliente={editando}
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
        titulo="Excluir cliente"
        mensagem={`“${excluindo?.empresa ?? excluindo?.nome}” será removido. Vendas, pagamentos e projetos ligados a ele continuam no banco, mas ficam sem cliente associado.`}
        textoConfirmar="Excluir"
        perigo
        processando={processando}
      />
    </>
  );
}

export function FormularioCliente({
  cliente,
  aoFechar,
  aoSalvar,
}: {
  cliente: Client | null;
  aoFechar: () => void;
  aoSalvar: (c: Client) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<FormCliente>(() =>
    cliente
      ? {
          nome: cliente.nome,
          empresa: cliente.empresa ?? '',
          telefone: cliente.telefone ?? '',
          email: cliente.email ?? '',
          documento: cliente.documento ?? '',
          cidade: cliente.cidade ?? '',
          estado: cliente.estado ?? '',
          observacoes: cliente.observacoes ?? '',
        }
      : VAZIO,
  );
  const [erros, setErros] = useState<Partial<Record<keyof FormCliente, string>>>({});
  const [salvando, setSalvando] = useState(false);

  const definir = (campo: keyof FormCliente, valor: string) =>
    setForm((atual) => ({ ...atual, [campo]: valor }));

  async function salvar() {
    const encontrados = coletarErros<FormCliente>({
      nome: obrigatorio(form.nome, 'O nome'),
      telefone: telefoneValido(form.telefone, true),
      email: form.email.trim() ? emailValido(form.email) : null,
    });

    if (temErro(encontrados)) {
      setErros(encontrados);
      return;
    }

    setErros({});
    setSalvando(true);

    const telefone = form.telefone.replace(/\D/g, '') || null;
    const dados = {
      nome: limparTexto(form.nome, 120),
      empresa: limparTexto(form.empresa, 120) || null,
      telefone,
      whatsapp: telefone,
      email: limparTexto(form.email, 120) || null,
      documento: limparTexto(form.documento, 24) || null,
      cidade: limparTexto(form.cidade, 80) || null,
      estado: limparTexto(form.estado, 2).toUpperCase() || null,
      observacoes: limparTexto(form.observacoes, 2000) || null,
    };

    try {
      const salvo = cliente
        ? await db.clientes.atualizar(cliente.id, dados)
        : await db.clientes.criar({ ...dados, lead_origem_id: null });
      toast.sucesso(cliente ? 'Cliente atualizado.' : 'Cliente cadastrado.');
      aoSalvar(salvo);
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
      titulo={cliente ? 'Editar cliente' : 'Novo cliente'}
      rodape={
        <>
          <Botao variante="fantasma" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </Botao>
          <Botao variante="primario" onClick={() => void salvar()} carregando={salvando}>
            {cliente ? 'Salvar alterações' : 'Cadastrar'}
          </Botao>
        </>
      }
    >
      <div className="form-grade">
        <CampoTexto
          rotulo="Nome do contato"
          value={form.nome}
          onChange={(e) => definir('nome', e.target.value)}
          erro={erros.nome}
          maxLength={120}
          obrigatorio
          autoFocus
        />
        <CampoTexto
          rotulo="Empresa"
          value={form.empresa}
          onChange={(e) => definir('empresa', e.target.value)}
          maxLength={120}
        />
        <CampoTexto
          rotulo="Telefone / WhatsApp"
          value={form.telefone}
          onChange={(e) => definir('telefone', e.target.value)}
          erro={erros.telefone}
          inputMode="tel"
          maxLength={20}
        />
        <CampoTexto
          rotulo="E-mail"
          type="email"
          value={form.email}
          onChange={(e) => definir('email', e.target.value)}
          erro={erros.email}
          maxLength={120}
        />
        <CampoTexto
          rotulo="CPF / CNPJ"
          value={form.documento}
          onChange={(e) => definir('documento', e.target.value)}
          maxLength={24}
        />
        <div className="form-grade" style={{ gridTemplateColumns: '1fr 88px', gap: 12 }}>
          <CampoTexto
            rotulo="Cidade"
            value={form.cidade}
            onChange={(e) => definir('cidade', e.target.value)}
            maxLength={80}
          />
          <CampoTexto
            rotulo="UF"
            value={form.estado}
            onChange={(e) => definir('estado', e.target.value.toUpperCase())}
            maxLength={2}
          />
        </div>
        <CampoTextarea
          className="col-inteira"
          rotulo="Observações"
          value={form.observacoes}
          onChange={(e) => definir('observacoes', e.target.value)}
          maxLength={2000}
        />
      </div>
    </Modal>
  );
}
