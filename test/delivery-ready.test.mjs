/**
 * delivery-ready.test.mjs — 「F4 を閉じてよいか」を判定する機械が、本当に3条件を見るか
 *
 * `D-18`: 基準の機械自身が、落ちるべき形で落ちるかを確かめる。
 * ここが恒真だと、**台帳が空でも F4 が閉じられる**ことになる。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scopeSections, latestResultHasWarning, check } from '../scripts/guard/delivery-ready.mjs';

const LEDGER_BASE = `# 検査の「赤になったところを見た」台帳

## 証明済み（\`- <ファイル> :: <検査の名前>\`）

- verify-a.mjs :: 1. 例

## F4 を閉じる範囲

### 客に当たる経路

\`\`\`
verify-a.mjs
\`\`\`

### 判定できない

- \`verify-c.mjs\` 1件 … 壊せない

### F4 の後に回す

- \`verify-d.mjs\` 1件 … あと回し

## ⛔ 毒見の天井

## 未証明（**壊して赤になるところを、まだ見ていない**）

- verify-b.mjs :: 1. 例
`;

/** 検査ファイル1本と台帳を置いた作業場を作る。 */
function sandbox({ ledger = LEDGER_BASE, result, checks = { 'verify-a.mjs': "check('1. 例', x === 1);\n" } } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-ready-'));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'docs/ops'), { recursive: true });
  for (const [f, body] of Object.entries(checks)) fs.writeFileSync(path.join(root, 'scripts', f), body);
  fs.writeFileSync(path.join(root, 'docs/ops/proof-of-red.md'), ledger);
  if (result !== undefined) fs.writeFileSync(path.join(root, 'docs/ops/mutate-run-result.md'), result);
  return root;
}

test('3節を読み分ける', () => {
  const s = scopeSections(LEDGER_BASE);
  assert.deepEqual(s.scope, ['verify-a.mjs']);
  assert.deepEqual(s.excluded, ['verify-c.mjs']);
  assert.deepEqual(s.later, ['verify-d.mjs']);
});

test('節が無い台帳は fatal（存在しないフェーズで誤って引っかからない）', () => {
  const r = check(sandbox({ ledger: '# 台帳\n\n## 証明済み\n\n## 未証明\n' }));
  assert.match(r.fatal, /F4 を閉じる範囲/);
});

test('条件1: 範囲内が全部証明済みなら通る（他の2条件も揃っていれば）', () => {
  const ledger = LEDGER_BASE; /* verify-a.mjs は証明済み */
  const r = check(sandbox({ ledger, result: '# 結果\n\n- 赤になった: **1件**\n' }));
  assert.equal(r.unprovenInScope.length, 0);
});

test('条件1: 範囲内の検査を1本増やすと、証明済みでない限り赤になる', () => {
  const r = check(sandbox({
    checks: {
      'verify-a.mjs': "check('1. 例', x === 1);\ncheck('2. 増えた', y === 1);\n",
    },
  }));
  assert.equal(r.unprovenInScope.length, 1);
  assert.equal(r.unprovenInScope[0].name, '2. 増えた');
});

test('条件2: 範囲にも理由にも無いファイルが在れば赤', () => {
  const r = check(sandbox({
    checks: {
      'verify-a.mjs': "check('1. 例', x === 1);\n",
      'verify-z.mjs': "check('1. 名指しされていない', x === 1);\n",
    },
  }));
  assert.equal(r.unaccounted.length, 1);
  assert.equal(r.unaccounted[0].file, 'verify-z.mjs');
});

test('条件2: 「判定できない」に載っていれば理由つきの除外として通る', () => {
  const r = check(sandbox({
    checks: {
      'verify-a.mjs': "check('1. 例', x === 1);\n",
      'verify-c.mjs': "check('1. 壊せない', x === 1);\n",
    },
  }));
  assert.equal(r.unaccounted.length, 0);
});

test('条件3: mutate-run-result.md が無ければ missing', () => {
  const root = sandbox({});
  assert.equal(latestResultHasWarning(root).missing, true);
});

test('条件3: ⚠️ の節が在れば warning', () => {
  const root = sandbox({ result: '# 結果\n\n## ⚠️ 見ておくこと\n\n- 何か\n' });
  assert.equal(latestResultHasWarning(root).warning, true);
});

test('条件3: ⚠️ が無ければ warning は false', () => {
  const root = sandbox({ result: '# 結果\n\n- 赤になった: **1件**\n' });
  assert.equal(latestResultHasWarning(root).warning, false);
});

test('いまのリポジトリで、機械自身は矛盾なく動く（範囲が空にならない）', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const r = check(root);
  assert.equal(r.fatal, undefined);
  assert.ok(r.scopeFiles.length >= 10, `客に当たる経路が ${r.scopeFiles?.length}本しか無い`);
  assert.deepEqual(r.unaccounted, [], '理由の無い未証明がある');
});

/* ── 1項ごとの理由（マスター判断 A・2026-08-28） ────────────────────────
   除外はそれまでファイル単位でしか書けず、「この項だけは埋められない」を
   機械に伝える場所が無かった。ここを足したので、**黙らせる道具にならない**
   ことを機械で確かめる——理由が短ければ認めない／古ければ赤／矛盾すれば赤。 */

const TWO_CHECKS = { 'verify-a.mjs': "check('1. 例', x === 1);\ncheck('2. 例2', y === 2);\n" };
/** `2. 例2` だけが未証明の台帳を作る。`reason` を渡すと理由の節を足す。 */
function ledgerWithSecond(reasonBlock = '') {
  return LEDGER_BASE.replace(
    '## 未証明（**壊して赤になるところを、まだ見ていない**）',
    `${reasonBlock}## 未証明（**壊して赤になるところを、まだ見ていない**）`,
  );
}

test('理由が無ければ、範囲内の未証明として赤のまま（素通りしない）', () => {
  const r = check(sandbox({ ledger: ledgerWithSecond(), checks: TWO_CHECKS }));
  assert.equal(r.unprovenInScope.length, 1, '理由を書いていないのに外れている');
  assert.equal(r.excused.length, 0);
});

test('理由を書くと外れる（そして何件外したかが残る）', () => {
  const block = '## 1項ごとに埋められない理由（機械が読む）\n\n'
    + '- verify-a.mjs :: 2. 例2\n'
    + '  理由: 直前の待ちが同じことを既に保証しているので、単発の壊しでは赤にできない。\n\n';
  const r = check(sandbox({ ledger: ledgerWithSecond(block), checks: TWO_CHECKS }));
  assert.equal(r.unprovenInScope.length, 0, '理由つきなのに外れていない');
  assert.equal(r.excused.length, 1, '外した件数が残っていない');
});

test('理由が短すぎると認めない（短い言い訳で外せない）', () => {
  const block = '## 1項ごとに埋められない理由（機械が読む）\n\n'
    + '- verify-a.mjs :: 2. 例2\n'
    + '  理由: 無理\n\n';
  const r = check(sandbox({ ledger: ledgerWithSecond(block), checks: TWO_CHECKS }));
  assert.equal(r.thin.length, 1, '短い理由を通している');
  assert.equal(r.unprovenInScope.length, 1, '短い理由で外れてしまっている');
});

test('実体に無い検査を指した理由は「古い」として捕まえる', () => {
  const block = '## 1項ごとに埋められない理由（機械が読む）\n\n'
    + '- verify-a.mjs :: 9. もう無い項\n'
    + '  理由: 直前の待ちが同じことを既に保証しているので、単発の壊しでは赤にできない。\n\n';
  const r = check(sandbox({ ledger: ledgerWithSecond(block), checks: TWO_CHECKS }));
  assert.equal(r.staleReasons.length, 1, '古い行を見逃している');
});

test('証明済みの項に理由が付いていたら矛盾として捕まえる', () => {
  const block = '## 1項ごとに埋められない理由（機械が読む）\n\n'
    + '- verify-a.mjs :: 1. 例\n'
    + '  理由: 直前の待ちが同じことを既に保証しているので、単発の壊しでは赤にできない。\n\n';
  const r = check(sandbox({ ledger: ledgerWithSecond(block), checks: TWO_CHECKS }));
  assert.equal(r.contradicting.length, 1, '証明済みに理由が付いているのを見逃している');
});
