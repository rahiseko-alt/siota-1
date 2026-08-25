/**
 * local-stack-endpoint.test.mjs — 検査の接続先が差し替えられること
 *
 * `docs/ops/plan.md` 4-0-a / `D-20260825-44`。
 * ここが直書きだったため `verify:*` は「`supabase start` が同じ機械で動いている」
 * 前提でしか動かず、**特定の一台の机の上でしか走らない検査**になっていた。
 * マスターの Windows でもエージェントのコンテナでも動かず、結果として
 * 「飼い主に何が届くか」を見る検査が9本とも失われたまま放置されていた。
 *
 * 差し替えは import 時に決まるので、`process.env` を変えてから読み直して確かめる。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const MODULE = '../scripts/lib/local-stack.mjs';

/** 環境変数を差し替えて、モジュールを読み直す（キャッシュを避けるため毎回別クエリ）。 */
async function loadWith(env, tag) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try {
    return await import(`${MODULE}?${tag}`);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

test('何も設定しなければ、従来どおりローカルの supabase start を指す', async () => {
  const m = await loadWith(
    { SUPABASE_LOCAL_URL: undefined, SUPABASE_LOCAL_ANON_KEY: undefined }, 'default',
  );
  assert.equal(m.LOCAL_SUPABASE_URL, 'http://127.0.0.1:54321');
  assert.match(m.LOCAL_ANON_KEY, /^sb_publishable_/);
});

test('SUPABASE_LOCAL_URL で接続先を差し替えられる（CI から同じ検査を走らせるため）', async () => {
  const m = await loadWith({ SUPABASE_LOCAL_URL: 'http://kong.test.invalid:8000' }, 'swapped');
  assert.equal(m.LOCAL_SUPABASE_URL, 'http://kong.test.invalid:8000');
});

test('鍵も一緒に差し替わる（接続先だけ変えても意味がない）', async () => {
  const m = await loadWith({ SUPABASE_LOCAL_ANON_KEY: 'sb_publishable_swapped_for_test' }, 'key');
  assert.equal(m.LOCAL_ANON_KEY, 'sb_publishable_swapped_for_test');
});

test('接続先を直書きに戻していない（同じ穴を掘り直さない）', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL(MODULE, import.meta.url), 'utf8');
  const assignment = source.match(/export const LOCAL_SUPABASE_URL = ([^;]+);/)[1];
  assert.match(assignment, /process\.env\.SUPABASE_LOCAL_URL/,
    'LOCAL_SUPABASE_URL が環境変数を見ていない。直書きに戻っている');
});
