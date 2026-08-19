/**
 * Registra `_resolver-ts-em-js.mjs` (ver aquele arquivo para o porquê).
 * Carregado via `--import` no script `testar` do package.json.
 */
import { register } from 'node:module';

register('./_resolver-ts-em-js.mjs', import.meta.url);
