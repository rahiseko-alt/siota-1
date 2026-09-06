/**
 * plan.test.mjs — `npm run plan` の進捗表示が嘘をつかないことを見る
 *
 * 実際に起きた事故（`docs/ops/plan.md` 第9章の統合時に発見）:
 *   `STAGES` に `F4` が無く、`docs/ops/phase` が `F4` になった時点で
 *   `STAGES.findIndex()` が `-1` を返し、**完了済みの F1〜F3 まで
 *   全段「未着手（⬜）」と表示していた**。大計画の唯一の進捗表示が
 *   「何も進んでいない」と嘘をついていた。
 *
 * この検査は2つを見る:
 *   ①いまの `phase`（`docs/ops/phase`）が `STAGES` のどこかに実在すること
 *     （`-1` にならないこと＝今回の事故そのもの）
 *   ②`stageIndex` より前の段は必ず `render()` の出力で `✅` になること
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGES, stageIndex, render, readNextLine, countDeferred } from '../scripts/plan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const planText = fs.readFileSync(path.join(ROOT, 'docs/ops/plan.md'), 'utf8');
const phase = fs.readFileSync(path.join(ROOT, 'docs/ops/phase'), 'utf8').trim();

test('いまの docs/ops/phase の値が STAGES に実在する（-1 にならない）', () => {
  assert.notEqual(stageIndex(phase), -1,
    `docs/ops/phase の値 "${phase}" が STAGES のどのキーとも一致しない。`
    + '新しいフェーズ札を作ったら、まず STAGES に足すこと。');
});

test('phase=F4 のとき、F1〜F3 はすべて完了（✅）と表示される（今回の事故の再発防止）', () => {
  const out = render('F4', planText);
  const lines = out.split('\n');
  for (const key of ['F1', 'F2', 'F3']) {
    const line = lines.find((l) => l.includes(`${key}　`));
    assert.ok(line, `${key} の行が出力に無い`);
    assert.ok(line.startsWith('  ✅'),
      `${key} が完了として表示されていない: "${line}"`);
  }
});

test('phase=F4 のとき、F4 自身は「作業中（▶）」と表示される', () => {
  const out = render('F4', planText);
  const line = out.split('\n').find((l) => l.includes('F4　'));
  assert.ok(line.startsWith('  ▶'), `F4 が作業中として表示されていない: "${line}"`);
});

test('知らないフェーズ札を渡すと、全段 ⬜ になる（-1 の挙動を明示的に確認）', () => {
  const out = render('存在しない札', planText);
  const lines = out.split('\n').filter((l) => /^  [✅▶⬜]/.test(l));
  assert.ok(lines.length > 0);
  for (const l of lines) assert.ok(l.startsWith('  ⬜'), `-1 のとき全段 ⬜ のはず: "${l}"`);
});

test('「いまやる番」を docs/ops/plan.md から読める', () => {
  const line = readNextLine(planText);
  assert.notEqual(line, '(未設定)', '「いまやる番」の行が docs/ops/plan.md に無い');
  assert.ok(line.length > 0);
});

test('放置リストの件数が数えられる（放置リストが空でも壊れない）', () => {
  const { total, open, done } = countDeferred(planText);
  assert.ok(total >= 0);
  assert.equal(open + done, total);
});

test('放置リストの数え方は、他の章の番号付き表（C-1・1-1 等）を混ぜない', () => {
  const fakeplan = '**いまやる番: x**\n'
    + '| C-1 | 指示 | 状態 | やること | migration |\n'
    + '| 1-1 | やること | 証明 | 実測 |\n'
    + '| 3 | 見つけた日 | 場所 | 何が起きているか | 進めるか | 直した |\n';
  const { total } = countDeferred(fakeplan);
  assert.equal(total, 1, '放置リスト以外の表の行を数えてしまっている');
});

/* ────────────────────────────────────────────────────────────────
   大計画をセッション開始時に必ず見る（三重の見逃し防止・`D-20260906-71`）

   マスター指示（2026-09-06）: 「大計画をセッション開始時に絶対に見る様に、
   チェックインスキルに組み込め。claude.md にも念のため @参照とファイル名でもかけ。
   三重で見逃し防止体制にしろ」。

   **実際に素通りできていた。** 印（`.plan-read`）は時刻1行で、関所は
   ファイルの有無しか見ていなかったため、**前日のセッションが残した印で
   その日のセッションが通っていた**。しかも `checkin.mjs` は大計画
   （`docs/ops/roadmap.md`）を一度も画面に出しておらず、出していたのは
   「詳しい地図: docs/ops/roadmap.md」という**案内1行**だけだった。

   3層それぞれに1本ずつ置く。**1層だけ外しても赤になる**ようにするため。
   ──────────────────────────────────────────────────────────────── */

test('層1: チェックインのスキルが、大計画を最初に読ませる', () => {
  const skill = fs.readFileSync(
    path.join(ROOT, '.agents/skills/session-checkin/SKILL.md'), 'utf8',
  );
  assert.match(skill, /docs\/ops\/roadmap\.md/,
    'session-checkin の手順に大計画（docs/ops/roadmap.md）が無い');
  assert.match(skill, /scripts\/guard\/checkin\.mjs/,
    '印を書く手順（checkin.mjs の実行）が無い');
  /* **手順の1番目であること。** 下の方に足しただけでは、指示を1つずつ
     処理するうちに読み飛ばされる。 */
  const steps = skill.slice(skill.indexOf('## 手順'));
  assert.ok(steps.indexOf('roadmap.md') < steps.indexOf('handoff.md'),
    '大計画が handoff より後ろに置かれている（最初に読ませること）');
});

test('層2: CLAUDE.md に大計画への @参照 が在る', () => {
  const claudeMd = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
  assert.match(claudeMd, /@docs\/ops\/roadmap\.md/,
    'CLAUDE.md に @docs/ops/roadmap.md が無い');
  assert.match(claudeMd, /@docs\/ops\/phase/, 'CLAUDE.md に @docs/ops/phase が無い');
});

test('層2b: ルールの正（AGENTS.md）にも大計画が入っている', () => {
  const agents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  const inSection = agents.slice(agents.indexOf('### セッション開始 (In)'));
  assert.match(inSection, /docs\/ops\/roadmap\.md/,
    'AGENTS.md のセッション開始規約に大計画が無い（CLAUDE.md は案内、正はこちら）');
});

test('層3: 関所が「このセッションが大計画を読んだか」を見る', async () => {
  const { judgePlanReadMark, readPlanReadMark, ROADMAP, MAX_AGE_MS } =
    await import('../scripts/guard/plan-read-mark.mjs');
  const now = Date.parse('2026-09-06T12:00:00.000Z');
  const fresh = (over) => ({
    at: new Date(now - 1000).toISOString(), session: 'S1', shown: [ROADMAP], ...over,
  });

  assert.equal(judgePlanReadMark(fresh(), { env: { CLAUDE_CODE_SESSION_ID: 'S1' }, now }).ok,
    true, 'このセッションの印を弾いてはいけない');
  assert.equal(judgePlanReadMark(fresh(), { env: { CLAUDE_CODE_SESSION_ID: 'S2' }, now }).ok,
    false, '別セッションの印を通してはいけない（これが実際に起きた穴）');
  assert.equal(judgePlanReadMark(fresh({ shown: ['docs/ops/plan.md'] }), { env: {}, now }).ok,
    false, '大計画を出していないチェックインの印を通してはいけない');
  assert.equal(judgePlanReadMark(null, { env: {}, now }).ok,
    false, '印が無いのに通してはいけない');
  /* 鍵の取れない AI 向けの受け皿。**前日の印では通さない。** */
  assert.equal(judgePlanReadMark(fresh(), { env: {}, now }).ok,
    true, '鍵が無い環境でも、新しい印は通す');
  assert.equal(
    judgePlanReadMark(
      fresh({ at: new Date(now - MAX_AGE_MS - 1000).toISOString() }), { env: {}, now },
    ).ok,
    false, '鍵が無い環境で、古い印を通してはいけない',
  );
  /* 旧い形（時刻1行）は通さない——通すと入れ替えた意味が無い。 */
  assert.equal(readPlanReadMark('2026-09-05T08:09:23.576Z\n'), null,
    '旧い形式の印を有効として読んではいけない');
});

test('層3b: チェックインが大計画そのものを画面に出す（案内1行で済ませない）', () => {
  const checkin = fs.readFileSync(path.join(ROOT, 'scripts/guard/checkin.mjs'), 'utf8');
  assert.match(checkin, /readFileSync\(path\.join\(ROOT, ROADMAP\), 'utf8'\)/,
    'checkin.mjs が roadmap.md の中身を読んで出していない');
  assert.match(checkin, /writePlanReadMark\(\)/, '印を書いていない');
});

/* ────────────────────────────────────────────────────────────────
   大計画に**書き戻す**ところ（チェックアウト・`D-20260906-72`）

   マスター指示（2026-09-06）:「大計画の書き込みもチェックアウトスキルに組み込め」。

   **実際に古くなっていた。** `docs/ops/phase` は `F4` なのに、地図は
   「いま居るのは『棚卸し』の入口」「本番はまだ古い版のまま。いま作ったものは
   一度も出していない」と書いたままだった——**その時点で本番へは2回出していた**。
   読む側（`checkin.mjs`）だけ強制しても、書く側が緩いと地図が嘘をつく。
   ──────────────────────────────────────────────────────────────── */

test('大計画の表に、STAGES の全段が在る（段の抜けを作らない）', () => {
  const roadmap = fs.readFileSync(path.join(ROOT, 'docs/ops/roadmap.md'), 'utf8');
  for (const stage of STAGES) {
    assert.match(roadmap, new RegExp(`^\\|\\s*\\*\\*${stage.key}\\*\\*\\s*\\|`, 'm'),
      `docs/ops/roadmap.md の表に ${stage.key} の行が無い`
      + '（`npm run plan` と食い違う。F4 が抜けて全段「未着手」と出した事故と同じ型）');
  }
});

test('大計画の現在地が docs/ops/phase と合っている', () => {
  const roadmap = fs.readFileSync(path.join(ROOT, 'docs/ops/roadmap.md'), 'utf8');
  const here = stageIndex(phase);
  assert.notEqual(here, -1, `docs/ops/phase の値 "${phase}" が STAGES に無い`);
  STAGES.forEach((stage, i) => {
    const row = (roadmap.match(new RegExp(`^\\|\\s*\\*\\*${stage.key}\\*\\*\\s*\\|.*$`, 'm')) || [])[0];
    assert.ok(row, `${stage.key} の行が無い`);
    if (i < here) assert.ok(row.includes('✅'), `${stage.key} は終わっているのに ✅ が無い`);
    if (i === here) assert.ok(row.includes('▶'), `${stage.key} が現在地なのに ▶ が無い`);
    if (i > here) {
      assert.ok(!row.includes('✅') && !row.includes('▶'),
        `${stage.key} はまだなのに ✅／▶ が付いている`);
    }
  });
});

test('チェックアウトが、大計画の現在地を機械で見る', () => {
  const checkout = fs.readFileSync(path.join(ROOT, 'scripts/guard/checkout.mjs'), 'utf8');
  assert.match(checkout, /docs\/ops\/roadmap\.md/,
    'checkout.mjs が大計画を見ていない（読むだけで、書いたことを確かめていない）');
  assert.match(checkout, /大計画（docs\/ops\/roadmap\.md）の現在地が実態と合っている/,
    'チェックアウトの項目に大計画が無い');
});

test('チェックアウトのスキルが、大計画に書き戻させる', () => {
  const skill = fs.readFileSync(
    path.join(ROOT, '.agents/skills/session-checkout/SKILL.md'), 'utf8',
  );
  assert.match(skill, /docs\/ops\/roadmap\.md/,
    'session-checkout の手順に大計画（docs/ops/roadmap.md）が無い');
  const steps = skill.slice(skill.indexOf('## 手順'));
  assert.ok(steps.indexOf('roadmap.md') < steps.indexOf('handoff.md'),
    '大計画が handoff より後ろに置かれている（先に書き戻すこと）');
});

test('ルールの正（AGENTS.md）にも、大計画への書き戻しが入っている', () => {
  const agents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  const outSection = agents.slice(agents.indexOf('### セッション終了 (Out)'));
  assert.match(outSection, /docs\/ops\/roadmap\.md/,
    'AGENTS.md のセッション終了規約に大計画への書き戻しが無い');
});
