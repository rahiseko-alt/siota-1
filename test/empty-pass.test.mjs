/**
 * empty-pass.test.mjs — 「無いこと」を空で受けて合格にする形を、機械が本当に捕まえるか
 *
 * **検査そのものが落ちる形になっているか**を見る（`D-18` / `docs/watch.md` W-1）。
 * `empty-pass` は W-1 の型を止めるために作った機械なので、これが恒真だと
 * **W-1 の型を、W-1 を止める機械の中で踏む**ことになる。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { passConditions, findEmptyPasses } from '../scripts/guard/empty-pass.mjs';

/** 検査1本だけを置いた、まっさらな作業場を作る。 */
function sandbox(body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-pass-'));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.writeFileSync(path.join(root, 'scripts', 'verify-sample.mjs'), body);
  return root;
}

test('第2引数（合格条件）だけを取り出す——説明文の中の || [] は数えない', () => {
  const got = passConditions("check('1. 例', Array.isArray(x) && x.length === 0, `${(x || []).length}件`);");
  assert.equal(got.length, 1);
  assert.equal(got[0].name, '1. 例');
  assert.match(got[0].cond, /Array\.isArray/);
  assert.doesNotMatch(got[0].cond, /\|\|\s*\[\]/);
});

test('錨の無い否定 ＋ 空フォールバックを捕まえる', () => {
  const root = sandbox("check('16. 消えた', !(left.pets || []).some((p) => p.id === id));\n");
  const { bad } = findEmptyPasses(root);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].name, '16. 消えた');
});

test('Array.isArray の錨が在れば通す', () => {
  const root = sandbox("check('16. 消えた', Array.isArray(left.pets) && !left.pets.some((p) => p.id === id));\n");
  assert.equal(findEmptyPasses(root).bad.length, 0);
});

test('=== true の錨が在れば通す（19番が実際に使っている形）', () => {
  const root = sandbox("check('19. 出していない', s.denied === true && (s.menus || []).length === 0);\n");
  assert.equal(findEmptyPasses(root).bad.length, 0);
});

test('肯定の合格条件は、空フォールバックが在っても通す（空なら落ちるので嘘にならない）', () => {
  const root = sandbox("check('5. 作られた', (after.owners || []).some((o) => o.name === n));\n");
  assert.equal(findEmptyPasses(root).bad.length, 0);
});

test('空フォールバックが無ければ、否定でも通す', () => {
  const root = sandbox("check('16. 消えた', !left.pets.some((p) => p.id === id));\n");
  assert.equal(findEmptyPasses(root).bad.length, 0);
});

test('いまのリポジトリは緑（回帰したら赤になる）', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const { files, scanned, bad } = findEmptyPasses(root);
  assert.ok(files.length >= 15, `検査が ${files.length}本しか見つからない`);
  assert.ok(scanned >= 150, `合格条件が ${scanned}件しか取れていない——取り出しが壊れた疑い`);
  assert.deepEqual(bad, []);
});

/* ── proof-of-red（壊して赤にならない検査は壊れているとみなす）── */

test('check の宣言そのものを、検査として数えない', () => {
  const got = passConditions('function check(name, pass, detail) {}\ncheck("1. 例", x === 1);\n');
  assert.equal(got.length, 1);
  assert.equal(got[0].name, '1. 例');
});

test('名前が式のときは、書いてある式をそのまま持つ（途中で千切らない）', () => {
  const got = passConditions('check(`${label}: 実行されない`, x === 1);\n');
  assert.equal(got.length, 1);
  assert.equal(got[0].name, '`${label}: 実行されない`');
});

test('台帳の節を読み分ける', async () => {
  const { sectionEntries } = await import('../scripts/guard/proof-of-red.mjs');
  const led = '## 証明済み\n\n- verify-a.mjs :: 1. あ\n\n## 未証明\n\n- verify-b.mjs :: 2. い\n';
  assert.deepEqual(sectionEntries(led, '## 証明済み'), [{ file: 'verify-a.mjs', name: '1. あ' }]);
  assert.deepEqual(sectionEntries(led, '## 未証明'), [{ file: 'verify-b.mjs', name: '2. い' }]);
});

test('いまのリポジトリは、全件が台帳に載っている', async () => {
  const { audit } = await import('../scripts/guard/proof-of-red.mjs');
  const r = audit(path.resolve(import.meta.dirname, '..'));
  assert.equal(r.fatal, undefined);
  assert.deepEqual(r.unlisted, [], '台帳に無い検査がある');
  assert.deepEqual(r.stale, [], '台帳が実体に無い検査を指している');
  assert.ok(r.total >= 150, `検査が ${r.total}件しか数えられていない`);
});

test('コメントの中の check(…) を、検査として数えない', async () => {
  const { stripComments } = await import('../scripts/guard/empty-pass.mjs');
  const src = '/* 昔は check(x, true) と直書きしていた */\n// check("嘘", true)\ncheck("1. 本物", y === 1);\n';
  const got = passConditions(src);
  assert.equal(got.length, 1);
  assert.equal(got[0].name, '1. 本物');
  /* 行番号がずれない（コメントは空白に潰すが改行は残す）。 */
  assert.equal(got[0].line, 3);
  assert.doesNotMatch(stripComments(src), /昔は|嘘/);
});

test('文字列の中の // や /* は、コメントとして潰さない', async () => {
  const { stripComments } = await import('../scripts/guard/empty-pass.mjs');
  const src = 'check("http://例/*a*/", u === v);\n';
  const got = passConditions(src);
  assert.equal(got.length, 1);
  assert.equal(got[0].name, 'http://例/*a*/');
  assert.match(stripComments(src), /http:\/\/例/);
});
