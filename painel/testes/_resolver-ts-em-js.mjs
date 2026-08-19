/**
 * Loader de resolução SÓ PARA TESTES — nunca roda em produção.
 *
 * ===========================================================================
 * POR QUE ISTO EXISTE
 *
 * `tsconfig.api.json` usa `moduleResolution: "NodeNext"` de propósito (ver o
 * comentário lá): a Vercel COMPILA cada `.ts` de `api/`/`shared/` para `.js`
 * de verdade antes de rodar, então todo import relativo entre esses arquivos
 * termina em `.js` — é a extensão do arquivo que vai existir depois do
 * build, e é o que faz o deploy real funcionar.
 *
 * `node --experimental-strip-types` (usado por `npm run testar`) NÃO
 * compila nada — só apaga tipo, na hora, sem gerar arquivo novo. Um import
 * de `./google-places.js` não encontra nada no disco, porque só existe
 * `google-places.ts`. Sem este loader, qualquer teste que importe um
 * arquivo de `api/_lib/` que referencie outro (ex.: `prospeccao.ts` ->
 * `google-places.ts`) quebraria com `ERR_MODULE_NOT_FOUND` — mesmo o código
 * estando certo para produção.
 *
 * O QUE ELE FAZ: deixa o Node tentar resolver normalmente; só quando falha
 * E o pedido termina em `.js` E é um caminho relativo, tenta de novo trocando
 * `.js` por `.ts`. Nunca interfere em pacotes de `node_modules`, nunca
 * interfere quando o `.js` de fato existe (produção nunca passa por aqui,
 * mas se um dia passasse, o comportamento seria idêntico ao padrão do Node).
 * ===========================================================================
 */

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (erro) {
    const relativo = specifier.startsWith('./') || specifier.startsWith('../');
    if (erro?.code === 'ERR_MODULE_NOT_FOUND' && relativo && specifier.endsWith('.js')) {
      const comoTs = `${specifier.slice(0, -3)}.ts`;
      return nextResolve(comoTs, context);
    }
    throw erro;
  }
}
