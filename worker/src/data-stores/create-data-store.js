import { KvDataStore } from './kv-data-store.js';
import { SupabaseDataStore } from './supabase-data-store.js';

export function createDataStore(env, context) {
  const backend = env.DATA_BACKEND || 'kv';
  if (backend === 'kv') return new KvDataStore(env.REPORTS);
  if (backend === 'supabase') {
    return new SupabaseDataStore({
      supabaseUrl: env.SUPABASE_URL,
      publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
      accessToken: context?.accessToken,
      userId: context?.userId,
      fetchImpl: env.FETCH || fetch,
    });
  }
  throw new TypeError('unsupported DATA_BACKEND');
}
