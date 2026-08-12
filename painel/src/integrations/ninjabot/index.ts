/**
 * Selecao do adaptador do NinjaBot.
 *
 * Para plugar a integracao real:
 *   1. crie `src/integrations/ninjabot/<nome>Provider.ts` implementando NinjaBotProvider;
 *   2. registre no mapa abaixo;
 *   3. defina VITE_NINJABOT_PROVIDER=<nome> e VITE_NINJABOT_API_URL.
 *
 * Se a API do NinjaBot exigir token, a chamada precisa passar por um proxy no
 * servidor: token em variavel VITE_ vira token publico.
 */

import { ninjabotEnv } from '@/lib/env';
import { nullNinjaBotProvider, type NinjaBotProvider } from './NinjaBotProvider';

const ADAPTADORES: Record<string, NinjaBotProvider> = {
  none: nullNinjaBotProvider,
};

export const ninjaBotProvider: NinjaBotProvider =
  ADAPTADORES[ninjabotEnv.provider] ?? nullNinjaBotProvider;

export const ninjaBotConfigurado = ninjaBotProvider.configurado && ninjabotEnv.configurado;

export * from './NinjaBotProvider';
