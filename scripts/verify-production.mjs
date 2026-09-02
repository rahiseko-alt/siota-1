/**
 * verify-production.mjs — デプロイ済みの実物が、いま手元でビルドしたものと同じかを見る
 *
 * `docs/handoff.md`「次に効いてくること」の1件目。**緑なのは手元と CI だけで、
 * デプロイ済みの実物は一度も確認されていなかった。** 手元で `build`・`check`・`test`・
 * `verify:*` が全部通っていても、それは**手元のバイト列の話**であって、
 * お客さんが開く URL が何を返すかは別のことである（D-18 偽-5「別の緑で覆う」の型）。
 *
 * 一度だけ手で curl して確かめても、次のセッションでは同じ穴が開く。だから機械にする（D-7）。
 *
 * 見るのは4つ。**判定の右辺は全部 `dist/` と git から取る**——
 * 「本番はこうであるはず」を人が書き写すと、書き写した側がズレる（`F-20260825-40` の型）:
 *
 *   1. 配信物のバイト一致  `dist/` の非 HTML を1本ずつ取り、sha256 が一致するか
 *   2. 飼い主の画面        `/my` が `dist/my.html` とバイト一致するか
 *   3. 旧UI の残骸         git で削除済みの `src/js/*.js` `ponchi-v2.html` が 404 か
 *   4. 正UI が配られているか `/edit` の script 一覧が `dist/index.html` のそれと一致するか
 *
 * **この検査が保証しないこと**（D-18 偽-5 の潰し）:
 *   - **人が使えるかは見ない。** ログインした先で何が見えるか、動線が最後まで行くかは
 *     見ていない。それは `npm run walk` の絵と D-14 の2問の領分である。
 *   - **本番のデータは一切見ない。** ログインもせず、お客さんの情報を取らない（A-2）。
 *   - **正しさは見ない。** 手元と同じ版が配られているかだけを見る。
 *     手元が間違っていれば、本番も同じように間違ったまま緑になる。
 *
 *   npm run verify:prod
 *   PROD_URL=https://例.example npm run verify:prod   ← 接続先を差し替える
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const BASE = (process.env.PROD_URL || 'https://trimmer-system.kouheikosehira.com').replace(/\/+$/, '');
const DIST = 'dist';
const TIMEOUT_MS = 30_000;

const results = [];
function check(name, pass, detail = '') {
  results.push(pass);
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}\n`);
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** 取れなかったことを例外にしない——ネットワークの失敗も「本番がそう見えた」の一種として扱う。 */
async function get(urlPath) {
  const url = `${BASE}${urlPath}`;
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = Buffer.from(await res.arrayBuffer());
    return { status: res.status, body, error: null };
  } catch (e) {
    return { status: 0, body: Buffer.alloc(0), error: String(e).split('\n')[0] };
  }
}

/** dist の中身を、配信される URL のパスに直す。`dist/js/ui.js` → `/js/ui.js`。 */
function distFiles() {
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  })(DIST);
  return out.sort();
}

const toUrlPath = (file) => `/${path.relative(DIST, file).split(path.sep).join('/')}`;

/** HTML の `<script src="...">` を出てくる順に並べる。属性の書き方の違いに引きずられないよう src だけ取る。 */
function scriptSources(html) {
  return [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
}

if (!fs.existsSync(DIST)) {
  process.stdout.write(`[verify-production] ${DIST}/ が無い。先に npm run build を走らせること。\n`);
  process.exit(1);
}

process.stdout.write(`[verify-production] 接続先: ${BASE}\n`);

/* ------------------------------------------------------------------
   1. 配信物のバイト一致
   HTML は worker が状態を注入して配るので、ここでは見ない（2 と 4 で別に見る）。
------------------------------------------------------------------ */
const staticFiles = distFiles().filter((f) => !f.endsWith('.html'));
let sameCount = 0;
const mismatched = [];

for (const file of staticFiles) {
  const urlPath = toUrlPath(file);
  const want = sha256(fs.readFileSync(file));
  const res = await get(urlPath);
  if (res.status === 200 && sha256(res.body) === want) {
    sameCount += 1;
  } else {
    mismatched.push(
      `${urlPath} → ${res.error ? res.error : res.status === 200 ? '中身が違う' : `HTTP ${res.status}`}`,
    );
  }
}

check(
  `配信物が手元の dist と同じ（${sameCount}/${staticFiles.length} 本）`,
  mismatched.length === 0,
  mismatched.length ? `\n        ${mismatched.slice(0, 8).join('\n        ')}${mismatched.length > 8 ? `\n        ほか ${mismatched.length - 8} 件` : ''}` : '',
);

/* ------------------------------------------------------------------
   2. 飼い主の画面（/my）が dist/my.html と同じか
------------------------------------------------------------------ */
const myLocal = path.join(DIST, 'my.html');
if (fs.existsSync(myLocal)) {
  const res = await get('/my');
  const want = sha256(fs.readFileSync(myLocal));
  const got = res.status === 200 ? sha256(res.body) : null;
  check(
    '/my が dist/my.html と同じ',
    got === want,
    res.error ? res.error : got === want ? '' : `HTTP ${res.status} / sha ${String(got).slice(0, 12)} ≠ ${want.slice(0, 12)}`,
  );
}

/* ------------------------------------------------------------------
   3. 旧UI の残骸が本番に残っていないか
   名前を直書きしない。**git で消えた事実**を右辺にする。
   移設（src/js → backend/js）で消えたものも含まれるが、それでよい——
   移設後の版が配られているなら、古いパスは 404 になっているはずである。
------------------------------------------------------------------ */
const deletedUiPaths = [
  ...new Set(
    execSync(
      "git log --diff-filter=D --name-only --format= -- 'src/js/*.js' 'src/design-samples/*.html' 'src/*.html'",
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
      .toString()
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((repoPath) => {
        const base = path.basename(repoPath);
        return repoPath.startsWith('src/js/') ? `/js/${base}` : `/${base}`;
      }),
  ),
]
  // いま dist に同じ URL で在るものは「残骸」ではない（消したあと同じ場所へ戻した）。
  .filter((urlPath) => !fs.existsSync(path.join(DIST, urlPath.replace(/^\//, ''))))
  .sort();

const stillAlive = [];
for (const urlPath of deletedUiPaths) {
  const res = await get(urlPath);
  if (res.status === 200) stillAlive.push(`${urlPath} → HTTP 200 (${res.body.length}B)`);
}

/* **0本を「合格」にしない。** 走査の右辺は `git log` の履歴なので、**履歴が浅い
   作業場（`git clone --depth` の容器・実際にこのリポジトリの開発容器がそう）では
   1本も出ず、何も確かめないまま緑になっていた**（2026-09-02 に実測。CI は
   `fetch-depth: 0` なので9本見えており、手元とCIで別のことを言っていた）。
   件数が0のときは、それが「残骸が無い」なのか「履歴が見えていない」なのかを
   区別してから答える。判定を緩めたのではなく、**空で緑になる穴を塞いだ**。 */
const shallow = (() => {
  try { return execSync('git rev-parse --is-shallow-repository', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() === 'true'; } catch { return false; }
})();
check(
  `削除済みの旧UI が本番に残っていない（${deletedUiPaths.length} 本を確認）`,
  stillAlive.length === 0 && deletedUiPaths.length > 0,
  stillAlive.length
    ? `\n        ${stillAlive.join('\n        ')}`
    : deletedUiPaths.length === 0
      ? `**1本も走査していない。**${shallow ? ' git の履歴が浅い（--depth つきの clone）ため、消えたファイルが見えない。' : ''}`
        + '\n        全履歴のある場所で実行すること（CI は fetch-depth: 0）。'
      : '',
);

/* ------------------------------------------------------------------
   4. /edit が正UI を配っているか
   テンプレートは worker が状態を注入するのでバイト一致しない。
   代わりに「読み込む script の並び」を見る——**右辺は dist/index.html から取る**。
------------------------------------------------------------------ */
const indexLocal = path.join(DIST, 'index.html');
if (fs.existsSync(indexLocal)) {
  const want = scriptSources(fs.readFileSync(indexLocal, 'utf8'));
  const res = await get('/edit');
  const got = res.status === 200 ? scriptSources(res.body.toString('utf8')) : [];

  /* **本番の並びは、手元の HTML と同じにはならない。**
     Supabase モードの worker は `</head>` の前に backend の3本を**注入して**配る
     （`worker/src/index.js` の `supabaseScripts`）。これは F3 の結線そのもので、
     正しい動作である。**一致**を求めると、正しく配れているときに必ず落ちる
     ——実際 2026-08-27 の初回デプロイで落ちた（`F-20260827-43`）。

     だから見るのは「同じ並びか」ではなく **「在るべきものが、順序を保って在るか」**:
       (a) 手元の `dist/index.html` の script が、本番の並びの中に同じ順で全部在る
       (b) 注入される3本も、同じ順で在る
     (b) の右辺は **worker のソースから抜く**。ここに書き写すと、
     写した側がズレたときに気づけない（`F-20260825-40` の型）。 */
  const workerSource = fs.readFileSync(path.join('worker', 'src', 'index.js'), 'utf8');

  /** worker のソースから、**その関数が注入する分だけ**を抜く。

      ここは長らくソース全体を走査していた。**注入する場所が1つしか無い間は
      それで正しかった**が、2026-09-02 に `/` 用の `renderLoginPage` を足した
      瞬間に壊れた——`/edit` 用の3本に `/` 用の2本が混ざって5本になり、
      `/edit` が正しく3本を配っているのに落ちた（deploy が赤で止まった）。
      **判定を緩めたのではなく、右辺を「どの画面の注入か」まで絞った。**
      関数の中だけを見るので、注入場所がさらに増えても混ざらない。 */
  const injectedBy = (fnName) => {
    const start = workerSource.indexOf(`async function ${fnName}(`);
    if (start === -1) return [];
    /* 次の `\nasync function ` までを、その関数の本体とみなす（このファイルは
       トップレベル関数が `async function` で並ぶ書き方に揃っている）。 */
    const nextAt = workerSource.indexOf('\nasync function ', start + 1);
    const body = workerSource.slice(start, nextAt === -1 ? undefined : nextAt);
    return [...body.matchAll(/<script[^>]*src="(\/backend\/js\/[^"]+)"/g)].map((m) => m[1]);
  };
  const injected = injectedBy('renderAppPage');

  /** 順序を保った部分列か（間に別のものが挟まってよい）。 */
  const inOrder = (needles, haystack) => {
    let at = 0;
    for (const needle of needles) {
      const found = haystack.indexOf(needle, at);
      if (found === -1) return false;
      at = found + 1;
    }
    return true;
  };

  /* **0本を「合格」にしない。** 抜き出しに失敗したときに空配列が返ると、
     (b) は何も見ないまま緑になる——実際この検査を書いた直後に一度そうなった。
     worker が注入する以上、ここは必ず3本取れる。取れなければ検査のほうが壊れている。 */
  const ok = want.length > 0 && injected.length > 0 && inOrder(want, got) && inOrder(injected, got);
  check(
    `/edit が正UI を配っている（手元 ${want.length} 本 ＋ 注入 ${injected.length} 本）`,
    ok,
    res.error
      ? res.error
      : ok
        ? ''
        : `HTTP ${res.status}\n        手元: ${want.join(' ') || '(無し)'}`
          + `\n        注入（worker から）: ${injected.join(' ') || '(無し)'}`
          + `\n        本番: ${got.join(' ') || '(無し)'}`,
  );

  /* 5. **`/`（お客さんが最初に開く場所）が、本物の入口として配られているか**

     ここを見ていなかったせいで、本番の `/` は**バックエンドの script が0本**の
     まま配られ続けた。載っている「Google でログイン」は押してもログインせず、
     ホーム画面のアイコンから開いた人は練習用の犬（ポンチ等）の画面に入り、
     本物のデータには一生たどり着けなかった（`F-20260902-66`）。
     上の `4.` は `/edit` しか見ておらず、`/` は誰も見ていなかった。 */
  const topRes = await get('/');
  const topGot = topRes.status === 200 ? scriptSources(topRes.body.toString('utf8')) : [];
  const topWant = injectedBy('renderLoginPage');
  const topBody = topRes.status === 200 ? topRes.body.toString('utf8') : '';
  const topOk = topWant.length > 0 && inOrder(topWant, topGot) && /__ENTRY__\s*=\s*true/.test(topBody);
  check(
    `/ が本物の入口として配られている（注入 ${topWant.length} 本）`,
    topOk,
    topRes.error
      ? topRes.error
      : topOk
        ? ''
        : `HTTP ${topRes.status}\n        注入されるはず（worker から）: ${topWant.join(' ') || '(無し)'}`
          + `\n        本番: ${topGot.join(' ') || '(無し)'}`
          + `\n        __ENTRY__ の印: ${/__ENTRY__\s*=\s*true/.test(topBody) ? '在る' : '**無い**'}`,
  );
}

/* ------------------------------------------------------------------ */
const failed = results.filter((r) => !r).length;
process.stdout.write(`\n${results.length - failed}/${results.length} PASS\n`);
if (failed > 0) {
  process.stdout.write(
    'デプロイ済みの実物が、手元でビルドしたものと違う。' +
      'デプロイし直すか、違いを説明できるようにすること。\n',
  );
}
process.exit(failed > 0 ? 1 : 0);
