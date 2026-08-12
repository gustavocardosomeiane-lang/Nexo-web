/**
 * Escolha do provider de dados. Ponto unico.
 *
 * Toda a aplicacao importa `db` daqui e nunca um provider concreto. Isso e o
 * que faz "trocar de banco" ser um arquivo, e nao um refactor.
 *
 * MOCK MODE e PRODUCTION MODE sao excludentes: em producao o provider mock
 * nunca e chamado, nem para preencher buraco. Se o Supabase estiver fora, a
 * tela mostra erro — inventar numero de faturamento seria muito pior do que
 * mostrar que algo quebrou.
 */

import { DATA_MODE, configuracaoInvalida } from '@/lib/env';
import type { DatabaseProvider } from './provider';
import { mockProvider } from './mock/mockProvider';
import { supabaseProvider } from './supabase/supabaseProvider';

export const db: DatabaseProvider = DATA_MODE === 'production' ? supabaseProvider : mockProvider;

export const emModoDemonstracao = db.modo === 'mock';

/** `true` quando pediram producao sem configurar o Supabase. */
export const bancoIndisponivel = configuracaoInvalida;

export type { DatabaseProvider, Repository, Novo, Analytics } from './provider';
