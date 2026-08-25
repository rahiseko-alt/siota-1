# F1 再発防止チェック（開始時）

対象: docs/failures.md 全28件（`grep -c '^### \[F-2026' docs/failures.md` = 28）
参照: docs/decisions.md 全37件＋未決2件
実施: 2026-08-25

**この時点の実測（3回とも実行した）**

| 命令 | EXIT |
|---|---|
| `npm run build` | **0** |
| `npm run check` | **1**（関所が停止。③の本書と②の承認印が無いため） |
| `npm test` | **0**（58件 / 5+47+6） |
| `npm run walk` | **1**（④→⑤で 30秒 TimeoutError） |
| `npm run verify:all` / `npm run preview` | **1**（`Missing script`） |

F1 の完了条件のうち「UI から `backend/` への参照が 0」は**値としては満たしている**
（`grep -rn 'backend/\|supabase\|/api/' src/index.html src/js/ui.js src/js/dummy.js src/manifest.json` = 0。
ヒットするのは `src/js/dummy.js:4` のコメント1行のみ）。ただし**機械で確認する仕組みは無い**——
`npm run check` の3本（`guard/run.mjs` / `src-dist-drift-guard.mjs` / `design-isolation-guard.mjs`）に
`backend` という語が1度も出てこない。

---

## 起こり得るもの（表の先頭・16行 = 失敗15件 ＋ 決定2件）

| 失敗ID | 何が起きたか（1行） | いま起こり得るか | 既に起こっていないか | 根拠 |
|---|---|---|---|---|
| **F-20260821-03** | 移設しないと決めたガードを、呼び出し側3箇所が生きているものとして参照し続けた | **○** | **既に起きている** | `git show --stat 6685df5` が `verify-*.mjs` **9本**と `test/supabase-auth.test.mjs`（466行）の削除を示す。一方 `AGENTS.md:176-181` の Runtime Evidence 表と `AGENTS.md:247-250`（D-9〜D-12 の「機械強制」欄）は今も `npm run verify:xss` / `verify:empty` / `verify:roundtrip` を指す。実行 → `npm error Missing script` ・**EXIT 1**。`npm run preview` も EXIT 1。さらに `backend/js/supabase-auth.js:2` が `import { renderMagazine } from './magazine-view.js'` のままで、`find . -name magazine-view.js` = **0件**。`worker/src/index.js:381,733,745` は dist に存在しない `my.html` / `ponchi-v2.html` / `js/supabase-auth.js` を配信しようとする |
| **F-20260821-19** | 移設で持ってきた文書を読み直さず、実在しないファイルへ「必ず通せ」と指示し続けた | **○** | **既に起きている** | 上と同じ証拠。加えて `docs/handoff.md` は 6685df5（UI はがし）を1行も反映しておらず、`:62-73` が `verify:m6 11/11` `verify:roundtrip 15/15` … を現在の状態として掲げる。自分で書いた `AGENTS.md` D-13「『削除禁止』『必ず通せ』は対象の実在を確かめる」に違反している |
| **F-20260821-11** | 受入基準を通すことを目的にして、機能そのものを確かめていなかった（「緑」を完了の根拠にした） | **○** | **既に起きている** | `npm run build`=0・`npm test`=0（58件）が緑。同じ木で `npm run walk`=**EXIT 1**。ログ実物: `locator.tap: Timeout 30000ms exceeded` / `<div>左耳 (L)</div> from <div class="editor-wrapper"> subtree intercepts pointer events`（「確定してお客様カルテ」が奪われる）。F1 の完了条件は build/check/test の EXIT 0 しか見ないので、**人間が④で止まったまま F1 を閉じられる** |
| **F-20260821-01** | `npm run check` が実体の無い場所を指したまま残り、検査が一度も動いていなかった | **○** | **既に起きている** | `src-dist-guard.config.json` の2番目の check が `"srcDir": "src/design-samples"`。`ls src/design-samples` → `No such file or directory`。`scripts/src-dist-drift-guard.mjs:55` が `if (!fs.existsSync(srcDirFull)) continue;` で**黙って飛ばす**ので `node scripts/src-dist-drift-guard.mjs .` は `✅ src→dist parity OK`・EXIT 0。**対象が消えても緑になる検査**。F1 はこの `check` に隔離検査を足す作業そのもの |
| **F-20260821-08** | PWA が機能していない（`<link rel="manifest">` が 0 件） | **○** | **既に起きている** | F-08 と同じ命令で確認: `grep -rc 'rel="manifest"' src/*.html` → **0**。`src/manifest.json` は在り、`npm run build` のログも `[build] manifest.json 1件` と出す（dist に入る）が、**どの HTML からも参照されていない**。前回 M8 で4ファイルに入れた結線が、UI 差し替えで再び切れた |
| **F-20260821-06** | 画面の見出しがデモ既定値のまま出る（代入経路が実在しない／届いていない） | **○** | **既に起きている** | `src/js/ui.js:102` が `mag-dog-sub` へ `` `${breed} / 4歳 / 2.79kg` `` を代入。**どの犬でも 4歳・2.79kg**。`src/js/dummy.js` は各犬に `age` と `weight` を持っているのに使っていない。既定値は `src/index.html:2051` の「トイプードル / 4歳 / 2.79kg」で、F-06 と同じ「表示要素と代入の食い違いで既定値が残る」形 |
| **F-20260821-14** | 「担当からの一言」が保存されず、飼い主に**誰も書いていない定型文**が届いた | **○** | **既に在る（種として）** | `src/index.html:1953` の `<textarea id="editor-trimmer-letter">` に「今月もとってもお利口にトリミングさせてくれました。…」が**既定値として書かれている**。`:2076`（顧客カルテ側）にも同じ文が固定で埋まる。F-14 の Root Cause「既定文がプレースホルダではなく実文だったため抜けが空欄として現れない」と同一。強制手段だった `verify:roundtrip` は削除済み |
| **F-20260821-15** | カルテ0件の犬に、存在しない施術履歴が飼い主へ表示された | **○** | **既に在る（種として）＋決定違反** | `src/index.html:2306-2312` に `magazine-revisit-title`「次回のおすすめご来店時期」「ポンチくんの毛質と爪の伸び具合から、理想の周期は約3〜4週間後（2026年9月10日前後）」が固定で入っている。これは **D-20260823-13 で「載せない・`magazine-revisit-box` は丸ごと省いた」と決めたもの**が意匠モック経由で復活した形。`AGENTS.md` D-10 の強制手段 `npm run verify:empty` は EXIT 1（存在しない） |
| **F-20260821-22** | 意匠モックを「本番の実体の場所」（`src/my.html`）にそのまま置いた | **○** | **既に起きている（今回は意図的）** | 6685df5 が `design/mock-4step.html`（90KB）を `src/index.html`（74KB）へ貼った。`onclick` の集合を比べると 46/55 が一致し、src 側だけの追加は `App.openLightbox('')` 1件のみ＝ほぼモックそのもの。plan が「意匠モックが正」と指示しているので**方針としては正しい**が、F-22 の教訓「繋いだ後の見た目で埋めると、繋がっていないこと自体が見えなくなる」は生きている。今それを担保するのは `scripts/serve-ui.mjs`（API 無しの静的配信）1本だけで、`npm run check` からは呼ばれない。機械強制だった `test/supabase-auth.test.mjs` も削除済み |
| **F-20260821-21** | レビューが「実行されなかった」ことを「指摘が無かった」と報告した | **○** | **既に起きている（型として）** | `docs/handoff.md:62-73` は `verify:*` の PASS 値を**現在の状態**として掲げるが、実行すると `Missing script`・EXIT 1。「実行していない」が「通っている」と読める状態。F-21 の Root Cause「bot の通知を結果として読み、状態として読まなかった」と同型 |
| **F-20260821-17** | 保存データが飼い主のブラウザで実行された（stored XSS・Critical） | **○** | **×（現時点では成立しない）** | 現 UI の HTML 注入は `src/js/ui.js:31` の `card.innerHTML = <静的テンプレート>` 1箇所のみで、値は `:51-55` で `textContent` として入る（`grep -n "innerHTML" src/js/ui.js` = 2件）。ただし `AGENTS.md` D-9・D-11 が名指しする強制手段 `npm run verify:xss` は EXIT 1。F1 の共通ゲート（`npm run check`）に代わりを入れないまま F1 を閉じると、撃ち込む検査が無い状態が恒久化する |
| **F-20260821-20** | 受入基準を「語の不在」で読み替え、目的を損なった | **○** | **×** | F1 の完了条件は「UI から `backend/` への参照が 0（**機械で確認**）」。いま 0 は `grep` を手で打って確かめただけで、`npm run check` の3本に `backend` の語が1度も出てこない（`grep -rc backend scripts/guard/*.mjs scripts/src-dist-drift-guard.mjs scripts/design-isolation-guard.mjs`）。「grep が 0 だった」を「機械で確認した」と読み替える余地が、いま正面に在る |
| **F-20260821-23** | 新設した検査が、2回目の実行で必ず落ちた（自前で立てたサーバを止め切れていない） | **○** | **×（構造としては直っている）** | `scripts/walk-human.mjs:33` が `startUiServer(PORT)`、`:119-123` の `finally` で `await stop()`。子プロセスではなく in-process の `http.createServer` なので F-23 の workerd 残留は起きない。ただし **F-23 の Guardrail が要求する「起動前のポート空き確認」は無い**（`grep -n "EADDRINUSE\|listen(" scripts/walk-human.mjs` = 0）。かつ `walk` は現に EXIT 1 なので「3回連続 EXIT 0」を一度も取れていない。F1 で `check` に足す検査をサーバ起動型にすると同じ穴 |
| **F-20260821-24**／**F-20260823-01** | マイグレーションが一度も実行されず、予約語で構文エラーのまま置かれていた | **○（弱）** | **×** | 実 PostgreSQL に流す唯一の検査 `verify:migrations` は `package.json:11` に在るが、`"test"` は `test:unit + test:schema + test:migration` の3本だけで**呼ばれない**（`test:migration` は `test/kv-migration.test.mjs`＝JS の変換テスト）。F-24 の Guardrail「`supabase/migrations/` に手を入れたら必ずこれを回す」は人間の記憶だけが担保。F1 で SQL は触らないので実害は今は無い |
| **D-20260824-37**（決定側） | 機能は生きているのに、どこからも押せない（3回目はマスター指摘で発覚） | **○** | **既に起きている（4回目）** | `design/mock-4step.html:1814` に `<button … onclick="App.createNewKarte()">＋ 新規カルテを作成する</button>` が在る。`src/index.html` には **「新規」も「＋」も 0件**（`grep -n "＋\|新規" src/index.html` → 出力なし）。一方 `src/js/ui.js:127` に `createNewKarte()` の実体は残っている＝**押す場所だけが消えた**。マスター指定の動線④「カルテ作成」の入口。D-20260824-29（招待QR）・D-20260824-37（カルテを書く）と完全に同型 |
| **D-20260824-34**（決定側） | Storage より先に DB 行を消すと、写真が誰からも取れなくなる | **○** | **×（まだ削除導線が無い）** | 順序を守る実装 `purgePetAssets` / `purgeOwnerAssets` は削除された `src/js/ponchi-app.js` にしか無かった（`git show 6685df5^:src/js/ponchi-app.js \| grep -c purgePetAssets` = **2**、現ツリー = **0**）。検査 `verify:delete`（14項目）も削除済み。RLS 側の条件 `private.storage_path_staff`（`supabase/migrations/202607160001_supabase_base.sql:316`）は残っているので、**F3 で削除ボタンを作り直すときに順序を知らないと、その瞬間に再発する** |

---

## 起こり得ないもの（12行 = 失敗13件）

| 失敗ID | 何が起きたか（1行） | いま起こり得るか | 既に起こっていないか | 根拠 |
|---|---|---|---|---|
| F-20260821-02 | `--test-isolation=none` が node 22 で `bad option` になりテストが全滅 | × | × | `grep -c 'test-isolation' package.json` = 0。`npm test` EXIT 0・58件（5+47+6）が実際に走る |
| F-20260821-04 | KV モードに `/api/config` が無くログイン画面が毎回 404 | × | × | `grep -rn '/api/' src/index.html src/js/ui.js src/js/dummy.js` = 0件。UI は `dummy.js` 以外からデータを取らない。API 側は `backend/` `worker/` に在り F1 では触らない |
| F-20260821-05 | 実体を持たない `demo-N` を fetch して 400 | × | × | `grep -rn 'demo-' src/` = **0件**。表示用IDという概念が現 UI に無い |
| F-20260821-07 | 納品物が外部 CDN の画像とフォントに依存 | × | × | `grep -rho 'https\?://' src/index.html src/js/*.js src/assets/fonts/fonts.css`（w3.org 除く）= **0件**。同梱フォントのみ。※ 検査 `verify:m6` 項目9 は削除済みなので、値は 0 だが番人はいない |
| F-20260821-09 | plan が指す XSS の座標が移設後のファイルで特定できない | × | × | `vibe-base` の参照は `AGENTS.md:275`（「参照しない」という否定文）と `docs/handoff.md:43`（打ち切りの記録）のみ。行番号で他リポジトリを指す記述は無い |
| F-20260821-10 | 移設元の失敗記録8件が転記できていない | × | × | 同上。基準は D-20260821-10 の Update で読み替え済み。本ファイルの照合対象は本リポジトリの28件で完結している |
| F-20260821-12 | 値をセレクタに連結し、復元だけが静かに失敗 | × | × | `grep -rn 'data-val\|cssAttrSafe' src/` = **0件**。保存・復元の処理そのものが UI に無い（第3段） |
| F-20260821-13 | 耳・爪・歯のコメントが保存対象になっていなかった | × | × | 同上。`extractReport` / `data-field` 契約ごと 6685df5 で削除。F1 の作業（隔離検査の追加）に保存契約は含まれない。※ F3 で繋ぐとき「UI の id と保存側のキーが食い違う」形で同型が起こり得る |
| F-20260821-16 | 直せる不具合を「判断が要る」と称してマスターに投げ返した | × | × | `docs/deferred.md` の2件はどちらも「先へ進めるか= **進める**」と判定済みで、plan のルール④⑤（あと回し→F3完了後に決める）に沿っている。実害を選択肢として提示したものではない |
| F-20260821-18 | エスケープ関数を文脈の違う場所（HTML属性内のJS文字列）に使って無効化 | × | × | モックに在った `onclick="App.selectKarte('ポンチ', '塩田 様', …)"` `App.cloneAndCreate('ポンチ')` の**値埋め込み6件は、src では消えて** `src/js/ui.js:30,60` の `card.onclick = () => …` に移っている（`onclick` 集合の差分で確認）。src 側だけの追加は `App.openLightbox('')`（空文字）1件 |
| F-20260821-25 | Workers の `fetch` をレシーバ付きで呼び、本番の Supabase 通信が全滅 | × | × | `backend/` `worker/` は F1 の対象外。`test/supabase-store.test.mjs` の当該テストは残り `npm test` EXIT 0（47件のうち）。※ 同ファイル `:142` は `assert.deepEqual(assetRequests, ['/my.html'])` で、その `my.html` はもう存在しない（緑のまま死んだ参照＝ F-03 の証拠に計上済み） |
| F-20260823-26／F-20260823-27 | 新規カルテが日付結合の欠落で公開できない／日付ピッカーが静的既定値のまま | × | × | `grep -n 'type="date"\|value="2026' src/index.html` = **0件**。日付入力そのものが現 UI に無い |

---

## 起こり得るもの — 何をすれば防げるか（1件1行）

1. **F-20260821-03 / F-20260821-19**: `AGENTS.md:176-181,247-250` と `docs/handoff.md:62-73` の `verify:*` 記述を、**いま実行できるものだけ**に書き換える（消したなら「消した・F3 で作り直す」と書く）。`grep -rn 'verify:' AGENTS.md docs/handoff.md` の全行について実行して EXIT を見る。
2. **F-20260821-03（コード側）**: `backend/js/supabase-auth.js:2` の `./magazine-view.js` import を解消する（復元 `git show 6685df5^:src/js/magazine-view.js` か、import を落とす）。`node -e "import('./backend/js/supabase-auth.js')"` が通ることを F1 の完了条件に足す——**隔離は「移設」であって「片方を壊すこと」ではない**。
3. **F-20260821-11**: F1 を閉じる根拠に `build`/`check`/`test` の EXIT 0 **だけ**を使わない。`npm run walk` が EXIT 1 のあいだは「F1 は閉じたが人間は④で止まっている」と明記して報告する。
4. **F-20260821-01**: `src-dist-guard.config.json` から実在しない `src/design-samples` の check を外す。あわせて `src-dist-drift-guard.mjs:55` の「srcDir が無ければ黙って continue」を**「設定に在るのに無ければ EXIT 1」**に変える。
5. **F-20260821-08**: `src/index.html` に `<link rel="manifest" href="/manifest.json">` を戻し、`grep -rc 'rel="manifest"' src/*.html` = 1 を隔離検査と同じ場所で数える。
6. **F-20260821-06**: `src/js/ui.js:102` の固定文字列 `4歳 / 2.79kg` を `dummy.js` の `age` / `weight` から作る（UI は `dummy.js` 以外からデータを取らない、という自分で書いた不変条件に合わせる）。
7. **F-20260821-14**: `src/index.html:1953` の `<textarea>` 既定文を**空**にし、`:2076` の固定文も空にする——書かれていないものは空で出す（`AGENTS.md` D-10）。
8. **F-20260821-15**: `src/index.html:2306-2312` の「次回のおすすめご来店時期」ブロックを外す。D-20260823-13 で「載せない」と決めたものが、意匠モックの貼り直しで復活している。
9. **F-20260821-22**: 「繋いでいないこと」を `scripts/serve-ui.mjs` に頼らず機械で示す——F1 で足す隔離検査を `npm run check` に入れ、`src/` と `dist/` の両方で `backend` / `supabase` / `/api/` / `fetch(` / `https://` を数える。
10. **F-20260821-21**: `docs/handoff.md` の過去の PASS 値に**「2026-08-23 時点の実測。6685df5 でこの検査は削除済み」**と日付と現況を並べて書く。数字だけを現在の状態として残さない。
11. **F-20260821-17**: F1 では塞げないので、`docs/deferred.md` に「`verify:xss` を消した。F3 で繋ぐ前に必ず復活させる（`git show 6685df5^:scripts/verify-xss.mjs`）」を1行残す。
12. **F-20260821-20**: 「機械で確認」を満たしたと言うのは、`npm run check` が違反を置いたときに**実際に EXIT 1 になることを見てから**にする（②バッドシナリオ #4 と同じ手順）。
13. **F-20260821-23**: F1 で足す検査はサーバを立てない静的検査にする。立てるなら起動前にポートの空きを確かめ、**3回連続 EXIT 0** を見てから完了と書く。
14. **F-20260821-24 / F-20260823-01**: `docs/deferred.md` に「`verify:migrations` が `npm test` から呼ばれていない」を1行残す（F1 で SQL は触らないため、ここでは直さない）。
15. **D-20260824-37**: `src/index.html` に `App.createNewKarte()` を呼ぶボタンを戻す（`design/mock-4step.html:1814` が正）。**マスター指定の動線④の入口で、実体はもう在り、押す場所だけが無い**。ルール④の例外に当たるかは「これが無いと新しい犬のカルテ作成に行けるか」で判断する。
16. **D-20260824-34**: `docs/deferred.md` に「削除は Storage → DB の順（`git show 6685df5^:src/js/ponchi-app.js` の `purgePetAssets`）。F3 で削除導線を作り直すときに必ず参照」を1行残す。**消す順を間違えると、写真が誰からも取れなくなる。**

---

## マスターが名指しした重い再発 — 個別回答

**① マスターが指定した動線を直さず、自分の思いつきのボタンを足して「直した」と報告した**
→ 今回の UI 差し替えに**自分の発案の混入は見つからなかった**。`onclick` 集合の比較で、
`src/index.html` にだけ在るのは `App.openLightbox('')`（空文字・モックの画像パス3件を空スロット化したもの）1件のみ。
`docs/deferred.md` #2 の「01〜04 タブ」も `design/mock-4step.html:1663-1666` に実在し、Claude の追加ではない。
**ただし逆向きの逸脱が在る**——モックに在った「＋ 新規カルテを作成する」（動線④の入口）が消えている（上表 D-20260824-37）。

**② 検査が全部緑なのに、人間は前に進めなかった**
→ **いま同じ状態にある。** `build`=0 / `test`=0（58件）に対し `walk`=EXIT 1。
しかも `npm test` の件数は 80件（D-20260824-34 時点）→ **58件**へ減っており、
UI を1行も見ない検査だけが残っている。F1 の完了条件は3本の EXIT 0 しか見ないので、
**この条件の充足を「F1 完了」の根拠に使ってはいけない。**

**③ 消してはいけないものを消した**
→ **F1 の残作業（`npm run check` への隔離検査追加）に削除は含まれない。**
ただし 6685df5 で既に大規模な削除が済んでいる（`verify:*` 9本・`test/supabase-auth.test.mjs` 466行・UI 6本）。
これらは F-06/07/11/12/13/14/15/17/22 と D-20260824-29/33/34/35/37 の **Guardrail 本体**だった。
すべて `git show 6685df5^:<path>` で復元できることは確認済み（例: `purgePetAssets` が 2件ヒット）。
**F3 で繋ぎ直す前に、どれを復活させるかを決める必要がある。** 本書ではその一覧を上の16件に残した。
