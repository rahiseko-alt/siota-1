/**
 * mutate-run.mjs — **1件ずつ狙って壊し、検査が赤になるところを見る**（マスター判断 A）
 *
 * `docs/ops/proof-of-red.md` の定義:
 *   **「壊して赤になったところを見ていない検査は、壊れているものとして数える」**
 *
 * ── なぜ毒見では足りなかったか ──
 * 毒見（`scripts/poison-run.mjs`）は土台ごと壊すので、**検査は最初の1件で死ぬ**。
 * 検査 N を判定するには検査 1〜N-1 が通っていなければならず、3種類の毒を作っても
 * **182件中21件で天井**に当たった（`docs/ops/proof-of-red.md`「⛔ 毒見の天井」）。
 *
 * ── こちらの造り ──
 * **土台は本物のまま**、製品のコードを**1行だけ**壊す。検査は最後まで走り、
 * **その壊しに気づいた項だけが赤になる**。赤になった項は「この壊しを検出できる」
 * ことが実測で示されたので、証明済みへ移せる。
 *
 * 1つの壊しで複数の検査が赤になるのは**正しい**——どれもその壊しを検出したのだから、
 * どれも証明されている。161件に161個の壊しは要らない。
 *
 * ── 実行できる場所 ──
 * **本物の土台が要るので、この環境では走らない**（Docker が無い）。CI で走らせる。
 * ここで確かめられるのは「壊して、戻せること」まで（`--dry-run`）。
 *
 *   node scripts/mutate-run.mjs --dry-run     壊して戻せるかだけ見る（土台不要）
 *   node scripts/mutate-run.mjs               全部（CI・本物の土台が要る）
 *   node scripts/mutate-run.mjs delete-assets  1つだけ
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 壊し方の台帳。**客に当たる経路から並べる**（マスター指示・2026-08-28）。
 *
 * `find` は**そのファイルにちょうど1回だけ**現れる文字列でなければならない
 * （0回なら「壊せていない」、2回以上なら「どこを壊したか分からない」）。
 * 機械がそれを確かめてから壊す。
 *
 * `why` は**その壊しで何が客に起きるか**を1行で。ここが書けない壊しは、
 * 証明の役に立たない（何を検出したのか言えないため）。
 */
export const MUTATIONS = [
  {
    id: 'delete-assets',
    why: '犬を消しても、写真の実体が Storage に残り続ける（誰も回収できない）',
    file: 'backend/js/supabase-storage.js',
    find: 'export async function deleteReportAssets({ client, api, petId',
    replace: 'export async function deleteReportAssets_MUTATED({ client, api, petId',
    extra: 'export async function deleteReportAssets() { return { removed: 0 }; }\n',
    scripts: ['verify-delete.mjs', 'verify-admin.mjs'],
  },
  {
    id: 'hydrate-assets',
    why: '飼い主の画面で、写真が実体に戻らない（asset:// のまま出る＝写真が届かない）',
    file: 'backend/js/supabase-storage.js',
    find: 'export async function hydrateAssetReferences(data, assets, c',
    replace: 'export async function hydrateAssetReferences_MUTATED(data, assets, c',
    extra: 'export async function hydrateAssetReferences(data) { return data; }\n',
    scripts: ['verify-photo-roundtrip.mjs'],
  },
  {
    id: 'upload-assets',
    why: '撮った写真が1枚も上がらない（飼い主には何も届かない）',
    file: 'backend/js/supabase-storage.js',
    find: 'export async function uploadReportAssets({',
    replace: 'export async function uploadReportAssets_MUTATED({',
    extra: 'export async function uploadReportAssets() { return { assets: [] }; }\n',
    scripts: ['verify-photo-roundtrip.mjs', 'verify-delete.mjs'],
  },
  {
    id: 'text-as-html',
    why: '**細工したカルテが飼い主のブラウザで実行される**（`F-20260821-17` の stored XSS そのもの）',
    file: 'backend/js/magazine-view.js',
    find: 'function setText(root, view, text) {',
    replace: 'function setText_MUTATED(root, view, text) {',
    extra: 'function setText(root, view, text) {\n'
      + '  const el = root.querySelector(\'[data-view="\' + view + \'"]\');\n'
      + '  if (el) el.innerHTML = text;\n'
      + '  return el;\n}\n',
    scripts: ['verify-xss.mjs'],
  },
  {
    id: 'settext-off',
    why: '飼い主の画面に、書いた文字が1つも出ない（枠だけが並ぶ）',
    file: 'backend/js/magazine-view.js',
    find: 'function setText(root, view, text) {',
    replace: 'function setText_MUTATED(root, view, text) {',
    extra: 'function setText(root, view) {\n'
      + '  return root.querySelector(\'[data-view="\' + view + \'"]\');\n}\n',
    scripts: ['verify-report-roundtrip.mjs'],
  },
  {
    id: 'weight-graph-off',
    why: '体重の推移が飼い主に出ない（グラフが描かれない）',
    file: 'backend/js/magazine-view.js',
    find: 'function renderWeightGraph(root, weights, bestWeight) {',
    replace: 'function renderWeightGraph_MUTATED(root, weights, bestWeight) {',
    extra: 'function renderWeightGraph() {}\n',
    scripts: ['verify-report-roundtrip.mjs'],
  },
  {
    id: 'resume-draft-off',
    why: '書きかけのカルテが戻ってこない（離れて戻ると、書いた分が消えている）',
    file: 'src/js/ui.js',
    find: '  resumeDraft(petId) {\n',
    replace: '  resumeDraft_MUTATED(petId) {\n',
    extra: null,
    injectAfter: '  resumeDraft_MUTATED(petId) {\n',
    inject: '    if (petId) return;\n',
    scripts: ['verify-draft.mjs'],
  },
  {
    id: 'empty-back-off',
    why: '**空の一覧に置き去りにされる**——間違えて戻っても犬が1頭も並ばず、先へ進めない（`F-20260825-39`）',
    file: 'src/js/ui.js',
    find: "    if (stepNum === 2 && this.dogs === null && globalThis.TrimmerSupabaseStaff) {\n      location.href = '/edit';\n      return;",
    replace: "    if (false && stepNum === 2 && this.dogs === null && globalThis.TrimmerSupabaseStaff) {\n      location.href = '/edit';\n      return;",
    extra: null,
    scripts: ['verify-m6.mjs'],
  },
  {
    id: 'rls-any-owner-sees-any-dog',
    sql: true,
    why: '**飼い主が、他人の犬を見られる**——ログインさえすれば全店の全頭が一覧に出る',
    file: 'supabase/migrations/202607160001_supabase_base.sql',
    find: '  for select to authenticated using (active and private.is_owner_user(owner_id));',
    replace: '  for select to authenticated using (active);',
    extra: null,
    /* `verify-report-roundtrip.mjs` は**外してある**。犬の RLS を開いても
       あの検査は緑のままだった（run 122）——あそこの 17番が見ているのは
       カルテの RLS だけで、犬の一覧の RLS ではない。**気づかない検査を
       「気づくはず」の欄に置いたままにすると、次に本当に気づかなくなったとき
       区別がつかない。** カルテ側は下の `rls-reports-open-to-strangers` で見る。 */
    scripts: ['verify-portal.mjs'],
  },
  {
    id: 'rls-both-layers-open',
    sql: true,
    why: '**確定したカルテが、他人にも読める**——URL さえ知れば誰のカルテでも開ける',
    file: 'supabase/migrations/202607160001_supabase_base.sql',
    /* **1枚ずつでは漏れない。** 実測（どちらも `verify-report-roundtrip` は緑）:
         run 122  犬の RLS だけ開ける  → カルテは `can_read_pet` が止める
         run 124  カルテの RLS だけ開ける → 画面が犬を引けず、そこで止まる
       他人にカルテが届くのは**両方が開いたときだけ**なので、
       `17.` を判定するには2枚同時に剥がすしかない（`F-20260828-52`）。 */
    edits: [
      { find: '  for select to authenticated using (active and private.is_owner_user(owner_id));',
        replace: '  for select to authenticated using (active);' },
      { find: "  for select to authenticated using (status = 'final' and private.can_read_pet(pet_id));",
        replace: "  for select to authenticated using (status = 'final');" },
    ],
    extra: null,
    scripts: ['verify-report-roundtrip.mjs'],
  },
  {
    id: 'rls-drafts-leak',
    sql: true,
    why: '**書きかけのカルテが飼い主に見える**——確定前の下書きがそのまま届く',
    file: 'supabase/migrations/202607160001_supabase_base.sql',
    find: "  for select to authenticated using (status = 'final' and private.can_read_pet(pet_id));",
    replace: '  for select to authenticated using (private.can_read_pet(pet_id));',
    extra: null,
    scripts: ['verify-draft.mjs', 'verify-empty-pet.mjs'],
  },
];

/** ファイルの中身の指紋。戻せたことを**実際に確かめる**ために使う。 */
const fingerprint = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

/** 1つ壊す。`restore()` を返す。`find` がちょうど1回でなければ壊さずに投げる。 */
export function applyMutation(root, m) {
  const target = path.join(root, m.file);
  const before = fs.readFileSync(target, 'utf8');
  /* **守りが二重のときは、1枚ずつ剥がしても何も漏れない。**
     `verify-report-roundtrip :: 17.` は、犬の RLS だけ開けても（run 122）
     カルテの RLS だけ開けても（run 124）緑のままだった——**どちらも正しい**。
     片方が残っているかぎり他人には届かないからである。
     つまりこの項を判定するには**両方を同時に開ける**しかない。
     `edits` はそのための形で、単発の `find`/`replace` はその1件版として扱う。 */
  const edits = m.edits || [{ find: m.find, replace: m.replace }];
  for (const e of edits) {
    const hits = before.split(e.find).length - 1;
    if (hits !== 1) {
      throw new Error(
        `[${m.id}] 壊せない: ${m.file} に目印が ${hits}回（ちょうど1回でなければならない）\n`
        + `  目印: ${e.find}\n`
        + `  0回なら**壊したつもりで何も壊れていない**——そのまま走らせると`
        + `「赤にならなかった＝検査が壊れている」と逆の結論を出す。`,
      );
    }
  }
  /* **置換だけで壊れる壊し方もある。** `extra` は「元の名前で空の実装を足す」形の
     ためのもので、条件を `false &&` にするような壊しには要らない。
     無いのに `undefined` を足すと、**壊した跡が文字列として残って build が通らなくなり**、
     「検査が気づかなかった」ではなく「壊し方が下手だった」で赤になる。 */
  let after = before;
  for (const e of edits) after = after.replace(e.find, e.replace);
  if (m.inject) after = after.replace(m.injectAfter, m.injectAfter + m.inject);
  if (m.extra) after += `\n${m.extra}`;
  fs.writeFileSync(target, after);
  return () => {
    fs.writeFileSync(target, before);
    if (fingerprint(target) !== crypto.createHash('sha256').update(before).digest('hex')) {
      throw new Error(`[${m.id}] 戻せていない: ${m.file}`);
    }
  };
}

const run = (cmd, args) => spawnSync(cmd, args, {
  cwd: ROOT, encoding: 'utf8', timeout: 600_000, env: process.env,
});

/** 検査の出力から、赤になった項の名前を拾う。 */
const failedNames = (out) => [...(out || '').matchAll(/^FAIL {2}(.+?)(?: {2}|$)/gm)]
  .map((m) => m[1].trim());

/* **直接叩かれたときだけ走る。**
   これが無いと、`import` しただけで**リポジトリを壊しに行く**——
   実際 `test/` から関数を取り出そうとして全体が2回走った。
   壊して戻す機械は、読み込むだけで動いてはならない。 */
const DIRECT = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (DIRECT) {
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const wanted = argv.filter((a) => !a.startsWith('--'));
const targets = wanted.length ? MUTATIONS.filter((m) => wanted.includes(m.id)) : MUTATIONS;

if (targets.length === 0) {
  process.stderr.write(`知らない壊し方: ${wanted.join(' ')}\n`
    + `使えるのは: ${MUTATIONS.map((m) => m.id).join(' / ')}\n`);
  process.exit(1);
}

/* **土台が無いのに走らせない。**
   本物の土台が無ければ検査は全部落ちるか全部素通りし、どちらにしても
   「赤になった／ならなかった」に意味が無い。にもかかわらず記録だけは書けてしまう——
   実際、この機械を `import` した事故で **「赤になった 0件」という嘘の記録**が
   1度できた。**確かめられない場所では、記録を作らせない。** */
if (!DRY) {
  const url = process.env.SUPABASE_LOCAL_URL || 'http://127.0.0.1:54321';
  const alive = await fetch(`${url}/auth/v1/health`).then((r) => r.ok).catch(() => false);
  if (!alive) {
    process.stderr.write(
      `本物の土台が居ない（${url}/auth/v1/health に届かない）。\n`
      + `  この機械は**壊して赤になるかを実測する**ものなので、土台が無いと何も言えない。\n`
      + `  ・CI で走らせる（.github/workflows/ci.yml の mutate ジョブ・手動実行）\n`
      + `  ・手元で壊して戻せることだけ見るなら: node scripts/mutate-run.mjs --dry-run\n`,
    );
    process.exit(1);
  }
}

process.stdout.write(`【1件ずつ壊す】${targets.length}個の壊し方${DRY ? '（壊して戻せるかだけ見る）' : ''}\n`);
process.stdout.write('  土台は本物のまま、製品を1か所だけ壊す。\n');
process.stdout.write('  **その壊しに気づいた項だけ**が赤になる。気づかない項は、その壊しを検出できない。\n\n');

const proven = new Map();   /* 検査の名前 → 気づいた壊し方の id */
const problems = [];

for (const m of targets) {
  const fpBefore = fingerprint(path.join(ROOT, m.file));
  let restore = null;
  try {
    restore = applyMutation(ROOT, m);
    if (DRY) {
      process.stdout.write(`  ✅ ${m.id.padEnd(18)} 壊せた（${m.why}）\n`);
      continue;
    }
    if (m.sql) {
      /* **SQL の壊しは、土台に流し直さないと効かない。**
         RLS はマイグレーションで作られるので、ファイルを書き換えただけでは
         いま動いている DB は古いポリシーのまま——**壊したつもりで何も壊れていない**
         状態になり、「検査が気づかなかった」と逆の結論を出す。 */
      const reset = run('npx', ['supabase', 'db', 'reset']);
      if (reset.status !== 0) {
        problems.push(`[${m.id}] 壊したあと db reset が通らない: ${(reset.stderr || '').split('\n').slice(-3).join(' ')}`);
        continue;
      }
    } else {
      const built = run('node', ['scripts/build-dist.mjs']);
      if (built.status !== 0) {
        problems.push(`[${m.id}] 壊したあと build が通らない: ${(built.stderr || '').split('\n')[0]}`);
        continue;
      }
    }
    for (const s of m.scripts) {
      const res = run('node', [`scripts/${s}`]);
      const names = failedNames(`${res.stdout}\n${res.stderr}`);
      for (const n of names) {
        if (!proven.has(n)) proven.set(n, `${m.id} / ${s}`);
      }
      process.stdout.write(`  ${names.length > 0 ? '✅' : '⚠️ '} ${m.id.padEnd(18)} ${s.padEnd(30)} 赤 ${String(names.length).padStart(3)}件\n`);
      if (names.length === 0) {
        problems.push(
          `[${m.id}] ${s} が**1件も赤にならなかった**。\n`
          + `    壊したのに気づいていない＝この検査は「${m.why}」を検出できない。`,
        );
      }
    }
  } catch (e) {
    problems.push(String(e.message));
  } finally {
    if (restore) restore();
    /* 戻したら**土台にも流し直す**。次の壊し方が、前の壊しの残った DB で走らないように。 */
    if (m.sql && !DRY) run('npx', ['supabase', 'db', 'reset']);
    if (fingerprint(path.join(ROOT, m.file)) !== fpBefore) {
      problems.push(`[${m.id}] **戻し切れていない**: ${m.file}（手で確かめること）`);
    }
  }
}

if (!DRY) run('node', ['scripts/build-dist.mjs']);   /* 壊す前の dist に戻す */

process.stdout.write(`\n  ── まとめ ──\n`);
if (DRY) {
  process.stdout.write(`  ${targets.length}個すべて、壊して戻せた。\n`);
  process.stdout.write(`  **赤になるかは、本物の土台が要る**（CI で走らせる）。\n`);
} else {
  process.stdout.write(`  赤になった（＝その壊しを検出できた）: **${proven.size}件**\n\n`);
  const out = [...proven].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [name, by] of out) process.stdout.write(`    ${name}   ← ${by}\n`);
  /* **一部だけ走らせた回で、全体の記録を上書きしない。**
     `poison-run.mjs` が同じ穴をすでに踏んでいる——1本だけ掛け直したとき全14本の
     結果を消し、**記録が、走らせた範囲より広く見える**形になった（`W-8` の型）。
     こちらはまだ踏んでいないが、それは CI が毎回全部走らせていたからにすぎない。
     壊し方が増えて絞って走らせ始めた時点で、同じように踏む。範囲を指定した回は別名へ。 */
  const outPath = path.join(
    ROOT,
    wanted.length ? 'docs/ops/mutate-run-partial.md' : 'docs/ops/mutate-run-result.md',
  );
  /* **⚠️ を記録にも残す。** これまでは stderr にしか出しておらず、CI が緑か赤かでしか
     読み取れなかった。`docs/ops/delivery-ready.mjs`（F4 を閉じてよいかの機械）は
     「最新の結果に赤0件の組が無い」を見るので、**ファイル自身が自分の結果を語れる**
     形にする——CI の生きた状態を見に行かなくても、この1本の記録だけで判定できる。 */
  fs.writeFileSync(
    outPath,
    ['# 1件ずつ壊した結果',
      wanted.length ? `\n**一部だけ（${wanted.join(' ')}）。全体の記録ではない。**` : '',
      '',
      '実行: `node scripts/mutate-run.mjs`（**本物の土台が要る**——CI で走らせる）',
      '',
      `- 赤になった（その壊しを検出できた）: **${proven.size}件**`,
      '',
      '## 赤になった（`- <検査の名前>` ← どの壊しで）',
      '',
      ...out.map(([n, by]) => `- ${n}   ← ${by}`),
      '',
      ...(problems.length > 0
        ? ['## ⚠️ 見ておくこと', '', ...problems.map((p) => `- ${p}`), '']
        : []),
    ].join('\n'),
  );
  /* **書いた先を、書いた先から出す**（直書きすると `poison-run` の嘘と同じ型になる）。 */
  process.stdout.write(`\n  記録: ${path.relative(ROOT, outPath)}\n`);
}

if (problems.length > 0) {
  process.stderr.write(`\n  ⚠️  ${problems.length}件、見ておくこと:\n`
    + problems.map((p) => `  - ${p}`).join('\n') + '\n');
  process.exit(1);
}
process.exit(0);
}
