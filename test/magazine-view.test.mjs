/**
 * magazine-view.test.mjs — 飼い主に「誰も書いていないもの」を見せないこと
 *
 * `docs/ops/bad-scenarios-F3.md` #1 の再発防止。
 * カルテが取れなかったとき `renderMagazine` が**静かに帰る**と、器に前から入っていた
 * 意匠モック由来の文例（「今月もとってもお利口に…」）が、担当トリマーが書いたものとして
 * そのまま飼い主に見え続ける。`AGENTS.md` D-2「null は必ず失敗として扱う」の表示側。
 *
 * ここでは DOM を使わない。落ちる経路は `document` に触る前に通るので、
 * 器の最小限の形（`innerHTML` と `querySelector`）だけを持つ替え玉で足りる。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMagazine } from '../backend/js/magazine-view.js';

/** ⑥の器に、意匠モック由来の文例が入っている状態を作る。 */
const FAKE_LETTER = '今月もとってもお利口にトリミングさせてくれました。';
const makeContainer = () => ({ innerHTML: FAKE_LETTER, querySelector: () => null });

test('カルテが無いとき、静かに帰らずに失敗として投げる', () => {
  assert.throws(() => renderMagazine(makeContainer(), null), /カルテがありません/);
  assert.throws(() => renderMagazine(makeContainer(), undefined), /カルテがありません/);
});

test('カルテが無いとき、器に前の内容を残さない（偽の手紙を見せない）', () => {
  for (const missing of [null, undefined]) {
    const container = makeContainer();
    assert.throws(() => renderMagazine(container, missing));
    assert.ok(
      !container.innerHTML.includes(FAKE_LETTER),
      `report=${missing} のとき、器に文例が残っている: ${container.innerHTML.slice(0, 40)}`,
    );
  }
});

test('空の状態に、文例を混ぜない', () => {
  const container = makeContainer();
  assert.throws(() => renderMagazine(container, null));
  /* 「担当トリマーからのメッセージ」の見出しごと消えていること。
     見出しだけ残ると、本文が空でも「書いたが空だった」ように読める。 */
  assert.ok(!container.innerHTML.includes('担当トリマー'));
  assert.ok(!container.innerHTML.includes('お利口'));
});

test('描画先の器が無いときも、静かに帰らない', () => {
  assert.throws(() => renderMagazine(null, { data: {} }), /描画先の器がありません/);
});
