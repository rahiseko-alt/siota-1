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
  /* ── 13回目: 管理者の削除が、画面では成功して DB に残る（2026-08-28・手元で実測）
     削除は「写真 → DB」の2段（`D-20260824-34`）。**DB を消す段だけ**を落とすと、
     画面は成功したように見えるのに実体が残る——`16./17.` はそこを見ている。
     写真の段は残すので、検査は最後まで動く。 */
  {
    id: 'admin-pet-delete-not-persisted',
    why: '**「削除しました」と出るのに、その子のデータが残り続ける**（消えたと思って渡せない）',
    file: 'backend/js/supabase-admin.js',
    find: "await api(`/api/pets/${encodeURIComponent(item.pet.id)}`, { method: 'DELETE' });",
    replace: 'await Promise.resolve();',
    scripts: ['verify-admin.mjs'],
  },
  {
    id: 'admin-owner-delete-not-persisted',
    why: '**「削除しました」と出るのに、その顧客のデータが残り続ける**（消したつもりが消えていない）',
    file: 'backend/js/supabase-admin.js',
    find: "await api(`/api/owners/${encodeURIComponent(item.owner.id)}`, { method: 'DELETE' });",
    replace: 'await Promise.resolve();',
    scripts: ['verify-admin.mjs'],
  },
  /* ── 12回目: 前の画面が開いたまま残る（2026-08-28・手元で実測）
     はじめ「切り替え先を screen-1 に固定する」壊し方にしたが、狙った 12./13. には
     届かず `検査を最後まで実行できた` だけが赤になった——**画面が隠れたままなので
     `waitForSelector` がタイムアウトし、検査がそこで死ぬ**（毒見の天井と同じ型）。
     隠さずに**前の画面も開いたまま**にすれば、流れは最後まで動いたうえで
     「いま開いている画面」の判定だけが狂う。 */
  {
    id: 'screen-stale-panels-stay-active',
    why: '段を進んでも前の画面が開いたまま重なる（どこに居るのか分からなくなる）',
    file: 'src/js/ui.js',
    find: "    document.querySelectorAll('.screen-panel').forEach(panel => {\n"
      + "      panel.classList.remove('is-active');\n"
      + '    });',
    replace: '    /* mutated: 前の画面を閉じない */',
    scripts: ['verify-edit.mjs'],
  },
  /* ── 11回目: 未ログインの /my（2026-08-28・手元で実測） ── */
  {
    id: 'portal-content-shown-logged-out',
    why: '**ログインしていない人に、中身の器が開いたまま出る**（守りの前提が崩れている）',
    file: 'backend/js/supabase-auth.js',
    find: '    show(loginPanel, true);\n    show(content, false);',
    replace: '    show(loginPanel, true);\n    show(content, true);',
    scripts: ['verify-portal.mjs'],
  },
  {
    /* `D-10`／`D-4` の型。見本の写真が飼い主の入口に出ると、客はそれを
       自分の犬の写真だと読む。出どころ不明の素材でもある。 */
    id: 'portal-sample-image',
    why: '飼い主の入口に、誰のものでもない見本の写真が出る（D-10・D-4）',
    file: 'src/my.html',
    find: '<section class="portal-content" data-portal-content hidden></section>',
    replace: '<section class="portal-content" data-portal-content hidden>'
      + '<img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">'
      + '</section>',
    scripts: ['verify-portal.mjs'],
  },
  /* ── 10回目: 犬体図の印と、体重の見本値（2026-08-28・手元で実測） ── */
  {
    id: 'skin-image-blank',
    why: '犬体図に付けた印が、確認画面にも飼い主にも画像として出ない（どこを気にしたかが伝わらない）',
    file: 'backend/js/magazine-view.js',
    find: "setImage(container, 'skin-image-frame', 'skin-image', data.bodyMarkingImage);",
    replace: "setImage(container, 'skin-image-frame', 'skin-image', '');",
    scripts: ['verify-report-roundtrip.mjs'],
  },
  {
    /* 量っていない体重に既定値が入る型。`F-20260821-14`（④の入力欄に見本の文が
       最初から入っていた）と同じ形で、**入力欄の既定値がそのまま確定され、
       飼い主に「量っていない数字」が届く**。
       **狙う場所は入力欄そのもの（テンプレート）。** はじめ `applyReport()` の
       `data.weights` を壊したが、あそこは**既存カルテを開いたときにしか走らない**
       ——検査19は「カルテの無い新しい犬」を開くので、1件も赤にならなかった。
       壊し方が悪かったのであって、検査は正しかった（`F-20260828-54` と同じ型）。 */
    id: 'weight-prefilled-sample',
    why: '体重を量っていないのに、見本の数字が最初から入っていて、そのまま飼い主に届く（D-10）',
    file: 'src/index.html',
    find: 'id="input-weight" placeholder="—"',
    replace: 'id="input-weight" value="4.2" placeholder="—"',
    scripts: ['verify-report-roundtrip.mjs'],
  },
  /* ── 9回目: verify-edit の残りを狙う（2026-08-28・手元で実測） ──
     `docs/ops/proof-of-red.md`「## F4 を閉じる範囲」の残り42件のうち、
     verify-edit に固まっている6件を狙う。 */
  {
    id: 'edit-dummy-dogs-leak',
    why: '一覧が実データではなく仮データを描く（居ない犬が並び、本物の客の犬が消える）',
    file: 'src/js/ui.js',
    find: 'const data = this.dogs || (window.DUMMY && window.DUMMY.dogs) || [];',
    replace: 'const data = (window.DUMMY && window.DUMMY.dogs) || this.dogs || [];',
    scripts: ['verify-edit.mjs'],
  },
  {
    id: 'edit-breed-mock-refill',
    why: '持っていない項目（犬種）に見本の値が出る——客は「うちの子はトイプードルではない」と読む（D-10）',
    file: 'src/js/ui.js',
    find: "card.querySelector('.karte-card__breed').textContent = dog.breed;",
    replace: "card.querySelector('.karte-card__breed').textContent = dog.breed || 'トイプードル';",
    scripts: ['verify-edit.mjs'],
  },
  {
    /* `F-20260828-54` が「この2件を狙うなら getAttribute('src') が実際に壊れた値を
       返す形の壊し方が要る」と書き残したもの。`img.src = ''`（プロパティ代入）では
       素の属性は空文字のままで、`getAttribute` で見ている検査には届かなかった。
       **属性そのものにページURLを書き込む**ので、両方の観測点から見える。 */
    id: 'empty-photo-attr-page-url',
    why: '写真の無いスロットが、現在のページURLを取りに行く（飼い主の画面に読めない画像の取得要求が並ぶ）',
    file: 'backend/js/magazine-view.js',
    find: "    else img.removeAttribute('src');",
    replace: "    else img.setAttribute('src', location.href);",
    scripts: ['verify-edit.mjs', 'verify-report-roundtrip.mjs', 'verify-photo-roundtrip.mjs'],
  },
  {
    id: 'letter-section-always-shown',
    why: '担当が何も書いていないのに、手紙の節が飼い主に出る（誰も書いていない空の手紙が届く）',
    file: 'backend/js/magazine-view.js',
    find: "  if (letterSection) letterSection.hidden = staffNote === '';",
    replace: '  if (letterSection) letterSection.hidden = false;',
    scripts: ['verify-edit.mjs'],
  },
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
       区別がつかない。** カルテ側は下の `rls-reports-open-to-strangers` で見る。
       `verify-invitation.mjs` は足した——招待未消化の飼い主が他人の犬を見られない
       ことも同じ `is_owner_user(owner_id)` が守っているため（4回目のラウンド）。 */
    scripts: ['verify-portal.mjs', 'verify-invitation.mjs'],
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

  /* ── ここから F4 の続き（マスター判断・2026-08-28）: 客に当たる経路まで台帳を埋める ──
     1回目: verify-admin.mjs（`docs/ops/proof-of-red.md` の「## F4 を閉じる範囲」）。 */
  {
    id: 'admin-redirect-off',
    why: '**管理者が /my を開いても管理者画面へ送られない**——毎回自分で URL を打つ羽目になる',
    file: 'backend/js/supabase-auth.js',
    find: "    if ((session.memberships || []).some((m) => m.role === 'admin')) {",
    replace: "    if (false && (session.memberships || []).some((m) => m.role === 'admin')) {",
    extra: null,
    scripts: ['verify-admin.mjs'],
  },
  {
    id: 'admin-menu-title-lost',
    why: '**管理者ページの一覧の見出しが読めなくなる**——リピーター／新規／削除のどれを押したか区別できない',
    file: 'backend/js/supabase-admin.js',
    find: "  button.append(el('strong', null, title));",
    replace: "  button.append(el('span', null, title));",
    extra: null,
    scripts: ['verify-admin.mjs'],
  },
  {
    id: 'admin-owner-create-broken',
    why: '**顧客アカウントの新規作成が効かない**——押しても顧客が作られない',
    file: 'backend/js/supabase-admin.js',
    find: "      const body = await api('/api/owners', { method: 'POST', body: JSON.stringify({ name }) });",
    replace: "      const body = await api('/api/owners-broken', { method: 'POST', body: JSON.stringify({ name }) });",
    extra: null,
    scripts: ['verify-admin.mjs'],
  },
  {
    id: 'admin-pet-create-broken',
    why: '**ペットアカウントの新規作成が効かない**——押しても犬が作られない',
    file: 'backend/js/supabase-admin.js',
    find: '        const body = await api(`/api/owners/${encodeURIComponent(ownerId)}/pets`, {',
    replace: '        const body = await api(`/api/owners/${encodeURIComponent(ownerId)}/pets-broken`, {',
    extra: null,
    scripts: ['verify-admin.mjs'],
  },
  {
    id: 'admin-revise-no-prefill',
    why: '**「カルテ修正」で開いても、前に書いた中身が入っていない**——直すたびに全部書き直しになる',
    file: 'src/js/ui.js',
    find: '  applyReport(data) {\n',
    replace: '  applyReport(data) {\n',
    extra: null,
    injectAfter: '  applyReport(data) {\n',
    inject: '    if (data) return;\n',
    scripts: ['verify-admin.mjs'],
  },
  {
    id: 'admin-revise-becomes-new-report',
    why: '**「カルテ修正」が、直さずに2枚目を作る**——確定済みを直したつもりが飼い主に2通届く',
    file: 'src/js/ui.js',
    find: '      const saved = this.reviseReportId',
    replace: '      const saved = false && this.reviseReportId',
    extra: null,
    scripts: ['verify-admin.mjs'],
  },
  {
    id: 'admin-revise-endpoint-broken',
    why: '**確定済みカルテを直す保存が届かない**——押しても何も直らない',
    file: 'worker/src/index.js',
    find: "          if (parts[5] === 'revise') {",
    replace: "          if (parts[5] === 'revise_MUTATED') {",
    extra: null,
    scripts: ['verify-admin.mjs'],
  },
  {
    id: 'admin-delete-confirm-unlocked',
    why: '**名前を打たなくても削除ボタンが押せる**——確認なしで取り返しのつかない削除に進める',
    file: 'backend/js/supabase-admin.js',
    find: "  input.addEventListener('input', () => { button.disabled = input.value.trim() !== name; });",
    replace: '  button.disabled = false;',
    extra: null,
    scripts: ['verify-admin.mjs'],
  },
  {
    id: 'admin-non-admin-gate-off',
    why: '**管理者でないスタッフにも削除メニューが出る**——権限の無い人が顧客データを消せてしまう',
    file: 'backend/js/supabase-admin.js',
    find: "    const isAdmin = (session.memberships || []).some((m) => m.role === 'admin');",
    replace: '    const isAdmin = true;',
    extra: null,
    scripts: ['verify-admin.mjs'],
  },
  {
    id: 'pet-purge-broken',
    why: '**犬を丸ごと消しても、その犬の写真の実体が Storage に残り続ける**（誰も回収できない）',
    file: 'backend/js/supabase-storage.js',
    find: 'export async function purgePetAssets({ client, api, petId',
    replace: 'export async function purgePetAssets_MUTATED({ client, api, petId',
    extra: 'export async function purgePetAssets() { return { removed: 0 }; }\n',
    scripts: ['verify-admin.mjs'],
  },

  /* 2回目: verify-edit.mjs（19件のうち17件を狙う。7「アプリ由来のエラーが無い」と
     13「⑤確認の画面が開いている」は、確定フローそのものを壊す必要があり
     verify-report-roundtrip の 2. と共通なので、その回に回す）。 */
  {
    id: 'edit-template-broken',
    why: '**/edit がテンプレートを見失って 502 になる**——トリマーが画面を一切開けない',
    file: 'src/index.html',
    find: '</head>',
    replace: '</hea d>',
    extra: null,
    scripts: ['verify-edit.mjs'],
  },
  {
    id: 'edit-backend-scripts-off',
    why: '**/edit が Supabase 用のスクリプトを注入しない**——実データの代わりに仮データ（window.DUMMY）の犬が並ぶ',
    file: 'worker/src/index.js',
    find: "    return renderAppPage(env, { backend: 'supabase' });",
    replace: "    return renderAppPage(env, { backend: 'none' });",
    extra: null,
    scripts: ['verify-edit.mjs'],
  },
  {
    id: 'edit-mock-letter-reappears',
    why: '**⑤確認の器に、意匠モックの既定文が戻る**——`renderMagazine` が器を差し替えていないのと同じ状態',
    file: 'backend/js/magazine-view.js',
    find: '<h3 class="magazine-letter-title">担当トリマーからのメッセージ</h3>',
    replace: '<h3 class="magazine-letter-title">担当トリマーからのメッセージ：今月もとってもお利口に</h3>',
    extra: null,
    scripts: ['verify-edit.mjs'],
  },
  {
    id: 'edit-empty-photo-src-regress',
    why: '**空の写真スロットが、現在のページURLを指す**（`docs/deferred.md` #16 の再発）',
    file: 'backend/js/magazine-view.js',
    find: "    else img.removeAttribute('src');",
    replace: "    else img.src = '';",
    extra: null,
    /* **`verify-edit.mjs` と `verify-report-roundtrip.mjs` は外した**（run #139 で
       実測・⚠️）。`img.src = ''` は**プロパティ**代入で、読み返す `img.src` だけが
       ページURLに解決される——`getAttribute('src')` は素の空文字のまま変わらない。
       `verify-photo-roundtrip.mjs` は `i.src === location.href`（プロパティ）で見るが、
       `verify-edit.mjs`（15.）と `verify-report-roundtrip.mjs`（16.）は
       `el.getAttribute('src')`（素の属性）で見ている——**同じ再発に見えて、
       実は別の観測点**だった。狙いを合わせて他の壊し方を探すまで、この2件は
       未証明のまま残す（F-20260828-54）。 */
    scripts: ['verify-photo-roundtrip.mjs'],
  },
  {
    id: 'edit-trimmer-letter-prefilled',
    why: '**④の入力欄に、見本の文が最初から入っている**（`F-20260821-14` の再発——書いていない手紙が届く）',
    file: 'src/index.html',
    find: '<textarea id="editor-trimmer-letter" data-field="staff-note" class="trimmer-textarea" rows="4" placeholder="今日の様子を、飼い主さんへ一言。"></textarea>',
    replace: '<textarea id="editor-trimmer-letter" data-field="staff-note" class="trimmer-textarea" rows="4" placeholder="今日の様子を、飼い主さんへ一言。">今月もとってもお利口にしていました。</textarea>',
    extra: null,
    scripts: ['verify-edit.mjs'],
  },

  /* 3回目: verify-portal.mjs + verify-m6.mjs（合わせて22件のうち8件を狙う。
     残りは個別の壊しが要る構造的な項目——★（1タッチで戻れる本体の遷移）や
     portal 1〜4・7・8・10・12 など——で、後の回にまとめて回す）。 */
  {
    id: 'portal-login-panel-dead',
    why: '**飼い主のログインパネルが一切出なくなる**——新規も、失効後も、押すものが画面に無い',
    file: 'backend/js/supabase-auth.js',
    find: '  const openLoginPanel = (message, returnPath) => {\n',
    replace: '  const openLoginPanel = (message, returnPath) => {\n',
    extra: null,
    injectAfter: '  const openLoginPanel = (message, returnPath) => {\n',
    inject: '    if (message) return;\n',
    scripts: ['verify-portal.mjs'],
  },
  {
    id: 'portal-pet-name-lost',
    why: '**飼い主の一覧に、犬の名前が出ない**——どれが自分の子か分からない',
    file: 'backend/js/supabase-auth.js',
    find: '    link.textContent = pet.name;',
    replace: "    link.textContent = '';",
    extra: null,
    scripts: ['verify-m6.mjs'],
  },
  {
    id: 'm6-canvas-missing',
    why: '**カルテ作成画面に、犬体図を描く場所が無い**——爪・耳・体の印を記録できない',
    file: 'src/index.html',
    find: '<canvas id="marking-canvas"></canvas>',
    replace: '<canvas id="marking-canvas-x"></canvas>',
    extra: null,
    scripts: ['verify-m6.mjs'],
  },
  {
    id: 'm6-header-wrong-dog',
    why: '**確定後に④へ戻ると、別の犬の名前が見出しに出る**（`docs/deferred.md` #28 の再発）',
    file: 'src/js/ui.js',
    find: "    this.selectKarte(pet.petName || '', pet.ownerName || '', '');\n"
      + '    /* **描いてから移る。**',
    replace: "    /* MUTATED: this.selectKarte(pet.petName || '', pet.ownerName || '', ''); */\n"
      + '    /* **描いてから移る。**',
    extra: null,
    scripts: ['verify-m6.mjs'],
  },

  /* 4回目: verify-empty-pet.mjs + verify-invitation.mjs（合わせて16件のうち
     8件を狙う。5. は上の rls-any-owner-sees-any-dog の scripts に足した）。 */
  {
    id: 'empty-pet-shows-sample',
    why: '**カルテ0件の犬に、見本の写真と文例を出す**——正直な空の知らせの代わりに嘘の中身が届く（`D-10`）',
    file: 'backend/js/supabase-auth.js',
    find: "  if (reports.length === 0) {\n"
      + "    const empty = document.createElement('p');\n"
      + "    empty.textContent = 'まだカルテがありません。';\n"
      + '    container.append(empty);\n'
      + '    return;\n'
      + '  }',
    replace: "  if (reports.length === 0) {\n"
      + "    const sample = document.createElement('img');\n"
      + "    sample.src = 'https://example.com/sample.png';\n"
      + '    container.append(sample);\n'
      + "    const note = document.createElement('p');\n"
      + "    note.textContent = '今月もとってもお利口にしていました。';\n"
      + '    container.append(note);\n'
      + '    return;\n'
      + '  }',
    extra: null,
    scripts: ['verify-empty-pet.mjs'],
  },
  {
    id: 'invite-button-off',
    why: '**一覧から招待を発行する入口が消える**（`D-20260824-29` の再発）',
    file: 'src/js/ui.js',
    find: '        invite.hidden = false;',
    replace: '        invite.hidden = true;',
    extra: null,
    scripts: ['verify-invitation.mjs'],
  },
  {
    id: 'invite-url-broken',
    why: '**発行した QR / URL が初回登録として機能しない**——渡した紙から登録できない',
    file: 'backend/js/supabase-staff.js',
    find: 'return `${new URL(origin).origin}/my?invite=${encodeURIComponent(token.toLowerCase())}`;',
    replace: 'return `${new URL(origin).origin}/my?token=${encodeURIComponent(token.toLowerCase())}`;',
    extra: null,
    scripts: ['verify-invitation.mjs'],
  },
  {
    id: 'invite-qr-not-image',
    why: '**QR が画像として出ない**——紙に印刷して渡せない',
    file: 'backend/js/supabase-staff.js',
    find: 'qr.src = artifact.qrDataUrl;',
    replace: "qr.src = '/assets/app-icon.png';",
    extra: null,
    scripts: ['verify-invitation.mjs'],
  },
  {
    id: 'invite-reusable',
    sql: true,
    why: '**使い終わった招待を、別の人がもう一度使える**——1枚のQRで他人が他人のカルテに入る',
    file: 'supabase/migrations/202607160003_invitation_management.sql',
    find: '    and candidate.claimed_at is null\n    and candidate.revoked_at is null\n',
    replace: '    and candidate.revoked_at is null\n',
    extra: null,
    scripts: ['verify-invitation.mjs'],
  },

  /* 5回目: verify-report-roundtrip / verify-photo-roundtrip / verify-delete /
     verify-draft / verify-xss を狙う。残りは 0/1/2 のような**土台の設営**そのものや
     「アプリ由来のエラーが無い」のような一般項目で、個別に狙うと壊れる範囲が
     広すぎるため見送る。 */
  {
    id: 'delete-throws',
    why: '**製品の削除の道が、呼んでも通らない**——押しても消えたかどうか分からない',
    file: 'backend/js/supabase-storage.js',
    find: 'export async function deleteReportAssets({ client, api, petId',
    replace: 'export async function deleteReportAssets_THROWS({ client, api, petId',
    extra: "export async function deleteReportAssets() { throw new Error('deleteReportAssets is broken'); }\n",
    scripts: ['verify-delete.mjs'],
  },
  {
    id: 'draft-becomes-new-report',
    why: '**「確定」が下書きを確定させず、2枚目を作る**——次に開くと古い記入が蘇る（`#15` の3）',
    file: 'backend/js/supabase-staff.js',
    find: '  const saved = draftId',
    replace: '  const saved = false && draftId',
    extra: null,
    scripts: ['verify-draft.mjs'],
  },
  {
    id: 'report-roundtrip-teeth-value-mismatch',
    why: '**押したボタンの表示と、保存される値が違う**（`docs/deferred.md` #24 の再発——見た目と違う値が飼い主に届く）',
    file: 'src/js/ui.js',
    find: "    this.form.teeth = ((name && name.textContent) || '').trim();",
    replace: "    this.form.teeth = ((name && name.textContent) || '').trim() + '（旧仕様）';",
    extra: null,
    scripts: ['verify-report-roundtrip.mjs'],
  },
  {
    id: 'report-roundtrip-finalize-broken',
    why: '**確定の保存が届かない**——押しても「押せた」だけで何も確定しない',
    file: 'worker/src/index.js',
    find: "          if (parts[5] === 'finalize') {",
    replace: "          if (parts[5] === 'finalize_MUTATED') {",
    extra: null,
    scripts: ['verify-report-roundtrip.mjs'],
  },

  /* 6回目: 「アプリ由来のエラーが無い」系。どのファイルも `page.on('pageerror', …)` で
     捕まえる同じ仕組みを見ているので、**未捕捉の例外を1つ投げるだけ**で複数の
     検査に同時に当たる。他の動作は止めない（`setTimeout` は独立したマクロタスク）。 */
  {
    id: 'app-throws-runtime-error',
    why: '**トリマー画面のどこかで、捕まえていない例外が飛ぶ**——実害は無くても放置サインを見逃す',
    file: 'src/js/ui.js',
    find: '  init() {\n',
    replace: '  init() {\n',
    extra: null,
    injectAfter: '  init() {\n',
    inject: "    setTimeout(() => { throw new Error('mutation: app-throws-runtime-error'); }, 50);\n",
    scripts: ['verify-admin.mjs', 'verify-edit.mjs', 'verify-photo-roundtrip.mjs', 'verify-report-roundtrip.mjs'],
  },
  {
    id: 'portal-throws-runtime-error',
    why: '**飼い主のログイン前の画面で、捕まえていない例外が飛ぶ**',
    file: 'backend/js/supabase-auth.js',
    find: 'export async function bootProtectedPortal() {\n',
    replace: 'export async function bootProtectedPortal() {\n',
    extra: null,
    injectAfter: 'export async function bootProtectedPortal() {\n',
    inject: "  setTimeout(() => { throw new Error('mutation: portal-throws-runtime-error'); }, 50);\n",
    scripts: ['verify-portal.mjs'],
  },

  /* 7回目: verify-portal の残りを狙う。 */
  {
    id: 'portal-flavor-broken',
    why: '**飼い主の画面が、飼い主向けの起動をしない**——`data-portal` の分岐そのものが外れる',
    file: 'src/my.html',
    find: 'data-portal="customer"',
    replace: 'data-portal="customer-broken"',
    extra: null,
    scripts: ['verify-portal.mjs'],
  },
  {
    id: 'portal-signout-hidden-after-login',
    why: '**ログインしても、サインアウトの入口が出ない**——ログアウトできない',
    file: 'backend/js/supabase-auth.js',
    find: '    show(signOutButton, true);',
    replace: '    show(signOutButton, false);',
    extra: null,
    scripts: ['verify-portal.mjs'],
  },

  /* 8回目: verify-empty-pet の残りを狙う。 */
  {
    id: 'empty-pet-fake-history-entry',
    why: '**カルテ0件の犬なのに、履歴の行が1つ出る**——無いはずの記録が見える',
    file: 'backend/js/supabase-auth.js',
    find: '  const reports = pet.reports || [];',
    replace: "  const reports = pet.reports || [];\n"
      + "  if (reports.length === 0) {\n"
      + "    const ghost = document.createElement('div');\n"
      + "    ghost.className = 'report-list';\n"
      + "    const a = document.createElement('a');\n"
      + "    a.href = '#'; a.textContent = 'ghost';\n"
      + "    ghost.append(a);\n"
      + "    container.append(ghost);\n"
      + "  }",
    extra: null,
    scripts: ['verify-empty-pet.mjs'],
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
