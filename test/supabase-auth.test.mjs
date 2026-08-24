import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  AuthError,
  readBearer,
  resolveAuthContext,
  safeReturnPath,
} from '../worker/src/auth-context.js';
import {
  captureInvitationToken,
  parseProtectedRoute,
  restoreProtectedRoute,
  safeReturnPath as safeBrowserReturnPath,
} from '../src/js/supabase-auth.js';
import { buildInvitationUrl, mapOwner, parseStaffRoute } from '../src/js/supabase-staff.js';

test('readBearer accepts only a non-empty Bearer token', () => {
  assert.equal(readBearer(new Request('https://test.local')), null);
  assert.equal(readBearer(new Request('https://test.local', { headers: { Authorization: 'Basic abc' } })), null);
  assert.equal(readBearer(new Request('https://test.local', { headers: { Authorization: 'Bearer   ' } })), null);
  assert.equal(readBearer(new Request('https://test.local', { headers: { Authorization: 'Bearer user-jwt' } })), 'user-jwt');
});

test('safeReturnPath permits only protected internal routes', () => {
  assert.equal(safeReturnPath('/my'), '/my');
  assert.equal(safeReturnPath('/my/pets/40000000-0000-0000-0000-0000000000a1?tab=history'), '/my/pets/40000000-0000-0000-0000-0000000000a1?tab=history');
  assert.equal(safeReturnPath('//evil.example/x'), '/my');
  assert.equal(safeReturnPath('/admin'), '/my');
  assert.equal(safeReturnPath('https://evil.example/my'), '/my');
});

/* スタッフの画面（/edit）も戻り先として保持する。ここを /my だけに戻すと、
   スタッフかつ飼い主のアカウント（D-20260823-06 = マスター自身）が未ログインで
   /edit を開いたとき、ログイン後に飼い主画面へ着いてトリマー画面に戻れなくなる。
   ブラウザ側（supabase-auth.js）と Worker 側（auth-context.js）は同じ契約。 */
test('safeReturnPath keeps the staff route so trimmers land back on /edit', () => {
  for (const fn of [safeReturnPath, safeBrowserReturnPath]) {
    assert.equal(fn('/edit'), '/edit');
    assert.equal(fn('/edit/p/40000000-0000-0000-0000-0000000000a1'), '/edit/p/40000000-0000-0000-0000-0000000000a1');
    assert.equal(fn('/editorial'), '/my', '前方一致で通してはいけない');
    assert.equal(fn('//evil.example/edit'), '/my');
  }
});

test('resolveAuthContext validates the bearer with Supabase Auth', async () => {
  const calls = [];
  const context = await resolveAuthContext(
    new Request('https://test.local/api/session', { headers: { Authorization: 'Bearer user-jwt' } }),
    { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'publishable-key' },
    async (url, init) => {
      calls.push({ url, init });
      return Response.json({ id: '20000000-0000-0000-0000-0000000000a1', email: 'owner-a@local.test' });
    },
  );
  assert.equal(context.userId, '20000000-0000-0000-0000-0000000000a1');
  assert.equal(context.accessToken, 'user-jwt');
  assert.equal(calls[0].url, 'https://project.supabase.co/auth/v1/user');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer user-jwt');
  assert.equal(calls[0].init.headers.apikey, 'publishable-key');
});

test('resolveAuthContext rejects missing and invalid sessions generically', async () => {
  await assert.rejects(
    () => resolveAuthContext(new Request('https://test.local/api/session'), { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'pk' }),
    (error) => error instanceof AuthError && error.status === 401 && error.message === 'authentication required',
  );
  await assert.rejects(
    () => resolveAuthContext(
      new Request('https://test.local/api/session', { headers: { Authorization: 'Bearer invalid' } }),
      { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'pk' },
      async () => new Response('internal details', { status: 401 }),
    ),
    (error) => error instanceof AuthError && error.status === 401 && !error.message.includes('internal details'),
  );
});

test('browser return path and protected route parser reject external or malformed routes', () => {
  const reportPath = '/my/pets/40000000-0000-0000-0000-0000000000a1/reports/50000000-0000-0000-0000-0000000000a1';
  assert.equal(safeBrowserReturnPath(reportPath), reportPath);
  assert.equal(safeBrowserReturnPath('//evil.example/my'), '/my');
  assert.deepEqual(parseProtectedRoute('/my'), { name: 'pets', petId: null, reportId: null });
  assert.deepEqual(parseProtectedRoute(reportPath), {
    name: 'report',
    petId: '40000000-0000-0000-0000-0000000000a1',
    reportId: '50000000-0000-0000-0000-0000000000a1',
  });
  assert.equal(parseProtectedRoute('/my/pets/not-a-uuid'), null);
});

test('session restoration returns directly to a protected bookmark', async () => {
  const storage = new Map([['post_auth_return', '/my/pets/40000000-0000-0000-0000-0000000000a1']]);
  const result = await restoreProtectedRoute(
    { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } }, error: null }) } },
    {
      pathname: '/my',
      search: '',
      storage: {
        getItem: (key) => storage.get(key) || null,
        removeItem: (key) => storage.delete(key),
      },
    },
  );
  assert.deepEqual(result, {
    state: 'signed-in',
    target: '/my/pets/40000000-0000-0000-0000-0000000000a1',
    accessToken: 'jwt',
  });
  assert.equal(storage.has('post_auth_return'), false);
});

test('signed-out bookmark is preserved for Google login', async () => {
  const result = await restoreProtectedRoute(
    { auth: { getSession: async () => ({ data: { session: null }, error: null }) } },
    { pathname: '/my/pets/40000000-0000-0000-0000-0000000000a1', search: '?tab=history', storage: null },
  );
  assert.deepEqual(result, {
    state: 'signed-out',
    returnPath: '/my/pets/40000000-0000-0000-0000-0000000000a1?tab=history',
  });
});

test('staff routes and owner mapping preserve A to X Y Z without adding a selector', () => {
  const owner = mapOwner({
    id: '30000000-0000-0000-0000-0000000000a1',
    name: 'A',
    pets: [
      { id: '40000000-0000-0000-0000-0000000000a1', owner_id: '30000000-0000-0000-0000-0000000000a1', name: 'X', reports: [] },
      { id: '40000000-0000-0000-0000-0000000000a2', owner_id: '30000000-0000-0000-0000-0000000000a1', name: 'Y', reports: [] },
      { id: '40000000-0000-0000-0000-0000000000a3', owner_id: '30000000-0000-0000-0000-0000000000a1', name: 'Z', reports: [] },
    ],
  });
  assert.deepEqual(owner.pets.map((pet) => pet.petName), ['X', 'Y', 'Z']);
  assert.deepEqual(parseStaffRoute('/edit/p/40000000-0000-0000-0000-0000000000a1'), {
    name: 'pet', ownerId: null, petId: '40000000-0000-0000-0000-0000000000a1', reportId: null,
  });
  assert.equal(parseStaffRoute('/edit/p/not-a-pet'), null);
});

test('invitation token moves out of browser history into temporary session storage', () => {
  const stored = new Map();
  let replaced = null;
  const token = 'a'.repeat(64);
  assert.equal(captureInvitationToken(`?invite=${token}&tab=history`, {
    pathname: '/my',
    storage: { setItem: (key, value) => stored.set(key, value) },
    history: { replaceState: (_state, _title, url) => { replaced = url; } },
  }), token);
  assert.equal(stored.get('pending_invitation'), token);
  assert.equal(replaced, '/my?tab=history');

  replaced = null;
  assert.equal(captureInvitationToken('?invite=not-valid', {
    pathname: '/my',
    storage: { setItem: (key, value) => stored.set(key, value) },
    history: { replaceState: (_state, _title, url) => { replaced = url; } },
  }), null);
  assert.equal(replaced, '/my');
});

test('invitation URL is first-registration-only and contains only the raw token', () => {
  const token = 'b'.repeat(64);
  assert.equal(
    buildInvitationUrl('https://dev.example.test/edit', token),
    `https://dev.example.test/my?invite=${token}`,
  );
  assert.throws(() => buildInvitationUrl('https://dev.example.test', 'short'));
});

/* ここから下は src/my.html（飼い主のマイページ）の結線検査。
   フックが1つでも欠けると bootProtectedPortal() は無反応になるか、
   loginButton.onclick で落ちる。実際に data-portal="customer" が消えていて
   ポータルが一度も起動していなかった期間がある（統合 plan のリスク#3）。
   Supabase 未有効化のため実機では確かめられないので、静的に押さえる。 */

const portalHtml = fs.readFileSync(new URL('../src/my.html', import.meta.url), 'utf8');
const authSource = fs.readFileSync(new URL('../src/js/supabase-auth.js', import.meta.url), 'utf8');
const bootSource = authSource.slice(
  authSource.indexOf('export async function bootProtectedPortal'),
  authSource.indexOf('async function bootLoginPage'),
);

/** 属性名がそのまま出現しているか。`data-portal` が `data-portal-status` に当たらないようにする。 */
function hasAttribute(html, name) {
  return new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(html);
}

test('my.html carries every DOM hook bootProtectedPortal looks up', () => {
  assert.ok(bootSource.length > 0, 'bootProtectedPortal の本文を切り出せていない');
  const hooks = [...bootSource.matchAll(/document\.querySelector\('\[([\w-]+)\]'\)/g)].map((m) => m[1]);
  assert.deepEqual(
    hooks,
    ['data-portal-status', 'data-login-panel', 'data-portal-content', 'data-google-login', 'data-sign-out'],
  );
  for (const hook of hooks) {
    assert.ok(hasAttribute(portalHtml, hook), `src/my.html に ${hook} が無い`);
  }
});

test('my.html declares the portal flavor bootProtectedPortal branches on', () => {
  const [, flavor] = authSource.match(/document\.body\?\.dataset\.portal === '([\w-]+)'/);
  assert.equal(flavor, 'customer');
  assert.match(portalHtml, new RegExp(`<body[^>]*\\sdata-portal="${flavor}"`));
});

test('my.html loads the Supabase vendor before the portal module', () => {
  const vendorAt = portalHtml.indexOf('src="/js/supabase-vendor.js"');
  const moduleAt = portalHtml.indexOf('src="/js/supabase-auth.js"');
  assert.ok(vendorAt >= 0, 'vendor を読んでいない。createAuthClient が vendor?.createClient で必ず落ちる');
  assert.ok(moduleAt >= 0, 'supabase-auth.js を読んでいない。ポータルが起動しない');
  assert.ok(vendorAt < moduleAt, 'vendor は supabase-auth.js より前に置くこと');
  assert.match(portalHtml, /<script type="module" src="\/js\/supabase-auth\.js"><\/script>/);
});

test('my.html hides the login panel, the content and the sign-out until boot decides', () => {
  for (const hook of ['data-login-panel', 'data-portal-content', 'data-sign-out']) {
    assert.match(
      portalHtml,
      new RegExp(`${hook}[^>]*\\shidden`),
      `${hook} が初期表示で出ている。ログイン前の飼い主に中身の枠が見えてしまう`,
    );
  }
});

/* D-10: 飼い主に見せる画面に見本・デモ・既定文を出さない（F-14 / F-15）。
   my.html は 2026-08-21 まで、架空の犬・架空の日付・他所の犬の写真が入った
   静的モックだった。カルテの中身は renderReport() が実データから作る。 */
test('my.html ships no sample report content of its own', () => {
  assert.doesNotMatch(portalHtml, /<img\b/, 'カルテ画像を静的に埋めている');
  assert.doesNotMatch(portalHtml, /\/assets\/(photo|guide)-/, '見本写真を参照している');
  assert.doesNotMatch(portalHtml, /20\d\d[.\-/]\d\d[.\-/]\d\d/, '架空の来店日が埋まっている');
  assert.doesNotMatch(portalHtml, /\d+(\.\d+)?\s*kg/i, '架空の体重が埋まっている');
});

/* 写真スロットの抽出は `img.src`（プロパティ）を読んではいけない。
   `<img src="">` や `img.src = ''` の状態でプロパティを読むと、ブラウザは空文字ではなく
   **現在のページのURL**を返す（HTML仕様のURL解決）。実ブラウザで確認済み:
   `img.src = ''` → `http://host/edit/p/{petId}`。

   ここを間違えると、トリマーが使わなかった写真スロット全部にページURLが保存され、
   replaceDataUrlAssets は data:image/ しか変換しないのでそのままDBへ入り、
   飼い主のマガジン画面に壊れた画像として出る。耳と歯は最初から src="" なので常に、
   ヒーローは hero-1 が空だと hero-2 の実写真より優先されて壊れる。
   ほぼ全カルテで起きるのに、画面もコンソールも何も言わない類の壊れ方だった。 */
const publishClientSource = fs.readFileSync(new URL('../src/js/publish-client-ponchi.js', import.meta.url), 'utf8');

test('photo() reads the src attribute, never the resolved img.src property', () => {
  const body = publishClientSource.slice(
    publishClientSource.indexOf('function photo(key)'),
    publishClientSource.indexOf('function monthKey'),
  );
  assert.ok(body.length > 0, 'photo() の本文を切り出せていない');
  assert.match(body, /getAttribute\(\s*['"]src['"]\s*\)/, 'src を属性として読んでいない');
  assert.doesNotMatch(
    body,
    /\bimg\.src\b/,
    'img.src（プロパティ）を読んでいる。空スロットに現在のページURLが入り、飼い主に壊れた画像が届く',
  );
});

test('photo() treats the data-empty marker as an empty slot', () => {
  const body = publishClientSource.slice(
    publishClientSource.indexOf('function photo(key)'),
    publishClientSource.indexOf('function monthKey'),
  );
  assert.match(body, /data-empty/, '空スロットの印 data-empty を見ていない');
});

/* ══════════════════════════════════════════════════════════════
   トリマーの記入が黙って失われる4経路（D-20260824-30 の 1 / 2 / 6 / 7）

   どれも「画面は何も言わないのに、打ち込んだ内容だけが消える」種類で、
   現場では気づけない。壊れても実行時エラーにならないので、
   ソースの形として押さえておく。
   ══════════════════════════════════════════════════════════════ */
const ponchiAppSource = fs.readFileSync(new URL('../src/js/ponchi-app.js', import.meta.url), 'utf8');
const staffSource = fs.readFileSync(new URL('../src/js/supabase-staff.js', import.meta.url), 'utf8');

function publishReportBody() {
  const start = ponchiAppSource.indexOf('function publishReport(context)');
  const end = ponchiAppSource.indexOf('function publishErrorMessage(err)');
  assert.ok(start > 0 && end > start, 'publishReport() の本文を切り出せていない');
  return ponchiAppSource.slice(start, end);
}

test('公開の再試行は、いま画面に入っている内容を送る（古い試行の内容を使い回さない）', () => {
  const body = publishReportBody();
  const transform = body.indexOf('replaceDataUrlAssets');
  const retryGuard = body.indexOf('retry.petId !== slug');
  assert.ok(transform > 0 && retryGuard > 0, '再試行まわりの目印が見つからない');
  assert.ok(
    transform < retryGuard,
    'replaceDataUrlAssets が再試行判定の内側にある。'
    + '公開に失敗 → 直して再確定、で直した内容が捨てられ「公開しました！」と出る',
  );
  assert.match(body, /retry\.data\s*=\s*transformed\.data/, '再試行時に data を今の内容へ更新していない');
  assert.match(body, /retry\.assets\s*=\s*transformed\.assets/, '再試行時に assets を今の内容へ更新していない');
});

test('公開の失敗理由がトリマーに届く（何度押しても直らない種類を見分ける）', () => {
  const start = ponchiAppSource.indexOf('function publishErrorMessage(err)');
  const body = ponchiAppSource.slice(start, start + 3000);
  assert.ok(start > 0, 'publishErrorMessage() が無い');
  assert.match(body, /HEIC/, 'HEIC（何度やっても失敗する）を見分けていない');
  assert.match(body, /10MB|10 ?MiB/, '写真が大きすぎる場合を見分けていない');
  assert.match(body, /429/, 'レート制限を見分けていない');
  assert.match(body, /401/, 'ログイン切れを見分けていない');
});

test('Worker が返した失敗理由を握りつぶさない', () => {
  const start = staffSource.indexOf('async function readJson');
  const body = staffSource.slice(start, staffSource.indexOf('function ensureDialogStyles'));
  assert.ok(start > 0, 'readJson() が無い');
  assert.match(body, /error\.reason/, 'サーバの {error} を呼び出し側へ渡していない');
});

test('下書きは写真を含めずに保存する（localStorage に入る大きさに保つ）', () => {
  assert.match(publishClientSource, /extractDraft/, 'extractDraft が公開されていない');
  assert.match(publishClientSource, /skipImages/, 'skipImages 経路が無い');
  const start = publishClientSource.indexOf('function extractReport(opts)');
  const end = publishClientSource.indexOf('function applyReport(report)');
  const body = publishClientSource.slice(start, end);
  assert.ok(start > 0 && end > start, 'extractReport() の本文を切り出せていない');
  /* 画像を作る4経路すべてに skipImages の門が要る。1つでも漏れると
     十数MBの data URL が localStorage へ向かい、保存が丸ごと失敗する。 */
  const guarded = body.match(/!skipImages && window\.__SALTYDOG_(BM|TEETH|TC|TCN)\b/g) || [];
  assert.equal(guarded.length, 4, `Konva の書き出し4面のうち ${guarded.length} 面しか止めていない`);
  assert.doesNotMatch(body.slice(body.indexOf('return {')), /\bphoto\('/, '返り値が photo() を直接呼んでいる（skipImages を素通りする）');
});

test('下書きは確定できたときに消える（次回の誤復元を防ぐ）', () => {
  assert.match(ponchiAppSource, /function finishDraftTracking/, 'finishDraftTracking が無い');
  const body = publishReportBody();
  const success = body.indexOf('finishDraftTracking()');
  const notice = body.indexOf("'<p>公開しました！</p>'");
  assert.ok(success > 0, '公開成功時に下書きを消していない');
  assert.ok(notice > 0, '成功通知の組み立てが見つからない');
  assert.ok(success < notice, '成功通知より後で消している（間に失敗すると下書きが残る）');
});

test('未確定のまま離れようとしたら確認が出る', () => {
  assert.match(ponchiAppSource, /addEventListener\('beforeunload'/, '離脱確認が無い。戻るの誤タップ1回で記入が消える');
  assert.match(ponchiAppSource, /_draftUnloadBound/, '離脱確認が二重に登録されうる');
});

test('確定済みカルテは読むだけにする（書けるのに保存できない状態を作らない）', () => {
  const start = ponchiAppSource.indexOf('function lockFinalizedReport()');
  const end = ponchiAppSource.indexOf('function showSupabaseDeleteBar');
  const body = ponchiAppSource.slice(start, end);
  assert.ok(start > 0 && end > start, 'lockFinalizedReport() が無い');
  assert.match(body, /contentEditable\s*=\s*'false'/, 'contenteditable を落としていない');
  assert.match(body, /is-readonly/, '編集UIを隠していない');
  /* 入力の無効化は #screen-report の中だけ。body 全体に掛けると
     犬の一覧の新規登録フォームまで死ぬ。 */
  assert.doesNotMatch(body, /document\.querySelectorAll\('input/, '画面を限定せずに入力を無効化している');
  /* 既存カルテを開く2経路（__REPORT__ 注入 / fetch 後）の両方で掛かること。 */
  const calls = ponchiAppSource.match(/lockFinalizedReport\(\);/g) || [];
  assert.equal(calls.length, 2, `既存カルテを開く2経路のうち ${calls.length} 経路でしか読み取り専用にしていない`);
});

/* ══════════════════════════════════════════════════════════════
   写真が積み上がる／消したのに残る（D-20260824-30 の 4 と 3）
   ══════════════════════════════════════════════════════════════ */
const engineSource = fs.readFileSync(new URL('../src/js/ponchi-engine.js', import.meta.url), 'utf8');
const storageSource = fs.readFileSync(new URL('../src/js/supabase-storage.js', import.meta.url), 'utf8');

test('取り込んだ写真は縮めてから持つ（拡大はしない）', () => {
  const start = engineSource.indexOf('function shrinkPhoto(dataUrl, done)');
  const end = engineSource.indexOf("fileInput.addEventListener('change'");
  const body = engineSource.slice(start, end);
  assert.ok(start > 0 && end > start, 'shrinkPhoto() が無い');
  assert.match(body, /longEdge <= MAX_PHOTO_EDGE/, '元が小さい画像を素通しせず引き伸ばしうる');
  assert.match(body, /toDataURL\('image\/jpeg'/, '再エンコードしていない（縮めても容量が減らない）');
  assert.match(body, /out\.length < dataUrl\.length/, '縮めて大きくなった場合に元へ戻していない');
  /* デコードできない形式（HEIC）はここで握り潰さず、アップロード側の検査へ通す。
     握り潰すと「なぜ失敗したか」を出せなくなる（30 の 6 と噛み合わない）。 */
  assert.match(body, /probe\.onerror[\s\S]{0,60}done\(dataUrl\)/, 'デコード失敗時に元を通していない');
});

test('写真の縮小は data URL のまま返す（保存経路が変わらない）', () => {
  const start = engineSource.indexOf('function shrinkPhoto(dataUrl, done)');
  const body = engineSource.slice(start, start + 1600);
  assert.doesNotMatch(body, /createObjectURL/, 'blob: URL を src に入れている。photo() は data URL を前提にしている');
});

test('犬・飼い主を消す前に Storage を片付ける（順序を逆にすると触れなくなる）', () => {
  assert.match(storageSource, /export async function purgePetAssets/, 'purgePetAssets が無い');
  assert.match(storageSource, /export async function purgeOwnerAssets/, 'purgeOwnerAssets が無い');
  const start = ponchiAppSource.indexOf('function makeDeleteBtn(confirmMsg, apiPath, aria, beforeDelete)');
  const end = ponchiAppSource.indexOf('function makePurge(kind, id)');
  const body = ponchiAppSource.slice(start, end);
  assert.ok(start > 0 && end > start, 'makeDeleteBtn() が beforeDelete を受け取っていない');
  const before = body.indexOf('beforeDelete()');
  const del = body.indexOf("method: 'DELETE'");
  assert.ok(before > 0 && del > before, 'DELETE より後に片付けている。FK カスケードで reports 行が消え、写真が誰からも触れなくなる');
  /* 片付けに失敗したら DELETE を送らないこと。両者の間に .catch が挟まると
     失敗が飲み込まれ、写真を残したまま DB 行だけ消えて回収不能になる。 */
  assert.doesNotMatch(body.slice(before, del), /\.catch\(/,
    '片付けと DELETE の間で失敗を飲み込んでいる。写真を残したまま行だけ消える');
});

test('削除前の片付けは犬・飼い主の両方の導線に付いている', () => {
  const calls = ponchiAppSource.match(/makePurge\('(pet|owner)'/g) || [];
  assert.equal(calls.length, 3, `削除導線3つのうち ${calls.length} つにしか片付けが付いていない`);
  assert.ok(calls.includes("makePurge('owner'"), '飼い主の削除に片付けが付いていない');
});

test('途中で止まった削除が一覧から消えたままにならない', () => {
  const storeSource = fs.readFileSync(
    new URL('../worker/src/data-stores/supabase-data-store.js', import.meta.url), 'utf8',
  );
  const start = storeSource.indexOf('async getPet(petId)');
  const body = storeSource.slice(start, storeSource.indexOf('async createPet'));
  assert.ok(start > 0, 'getPet() が無い');
  assert.doesNotMatch(body, /status=neq\.deleting/,
    'getPet が deleting を隠している。写真ごと残るのに再試行へ到達できなくなる');
  assert.match(ponchiAppSource, /function makeStuckDeletionRow/, '再試行の導線が無い');
  const rowStart = ponchiAppSource.indexOf('function makeStuckDeletionRow');
  const rowBody = ponchiAppSource.slice(rowStart, ponchiAppSource.indexOf('function renderArchiveList'));
  assert.match(rowBody, /deleteReportAssets/, '再試行が削除の3ステップを呼んでいない');
  /* 普通のカルテとして開かせない（中身は見えるが削除も編集もできない状態になる）。 */
  assert.match(ponchiAppSource, /month\.status === 'deleting'/, '一覧で deleting を別扱いにしていない');
});
