/**
 * Visibilidade por papel — versão de SERVIDOR.
 *
 * ===========================================================================
 * POR QUE ISTO EXISTE SEPARADO
 *
 * A matriz completa vive em `src/auth/permissions.ts`, mas aquele arquivo é
 * frontend (usa o alias `@/` e tipos de `src/`). Uma função serverless não
 * pode importá-lo. Em vez de importar, espelhamos aqui APENAS a dimensão que
 * o servidor precisa: "este papel PODE VER este módulo?".
 *
 * Duas cópias de uma regra divergem com o tempo — já nos mordeu neste projeto.
 * Por isso existe `testes/nexo-ai-permissao.test.js`, que compara esta tabela
 * com a de `src/auth/permissions.ts` e falha se alguém mexer numa e esquecer
 * a outra. A duplicação é controlada por teste, não por confiança.
 * ===========================================================================
 */

/** Módulos que cada papel ENXERGA (dimensão "ver" da matriz do frontend). */
export const VISIBILIDADE: Record<string, readonly string[]> = {
  administrador: [
    'dashboard', 'leads', 'clientes', 'vendas', 'pagamentos', 'servicos',
    'projetos', 'financeiro', 'conversas', 'automacoes', 'notificacoes',
    'relatorios', 'configuracoes',
  ],
  vendedor: [
    'dashboard', 'leads', 'clientes', 'vendas', 'pagamentos', 'servicos',
    'projetos', 'conversas', 'notificacoes', 'relatorios',
  ],
  financeiro: [
    'dashboard', 'leads', 'clientes', 'vendas', 'pagamentos', 'servicos',
    'projetos', 'financeiro', 'notificacoes', 'relatorios',
  ],
  colaborador: ['dashboard', 'clientes', 'projetos', 'conversas', 'notificacoes'],
};

/** `true` se o papel pode ver o módulo. Falha fechado para papel desconhecido. */
export function podePorPapel(papel: string, modulo: string): boolean {
  return VISIBILIDADE[papel]?.includes(modulo) ?? false;
}
