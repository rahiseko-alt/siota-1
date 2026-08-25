# SALTY DOG カルテ — 完成までの実装計画（正・1本のみ）

> **F3 完了まで有効。** セッションを跨いでも、AI が替わっても破棄しない。
> ルールの正は `AGENTS.md`（D-15）。この文書は**計画の正**。計画ファイルはこれ1本だけ。

---

## 0. ゴールの定義

- **人間**: マスターが実店舗で1頭分のカルテを最後まで作り、飼い主がスマホでそれを見られる。それが完成。
- **AI**: F1〜F3 の完了 ≠ 納品物の完成（ルール②）。F3 の後にマスター判断の棚卸し（第6章）が残る。

**なぜこの計画か**: 本番は動いていたが、マスターが指定した動線どおりに進めなかった。
検査が9本すべて緑でも、人間は前に進めなかった。原因は UI とバックエンドが混ざっていて、
**画面の良し悪しをバックエンドの緑で隠せた**こと。そこで UI を切り離し、UI だけで動線を
完成させてから繋ぎ直す。**新しく作るのではなく、いま在るものを並べ替える。**

## 1. 現在地（2026-08-25）

| 済んでいる | 状態 |
|---|---|
| Supabase 移行 F0〜F6 | 本番ドメイン `trimmer-system.kouheikosehira.com` は Supabase 版を配信中 |
| 旧 KV Worker | 閉鎖のうえ残置（D-20260823-09・切り戻し用） |
| UI / backend の分離 | `src/`=UI（仮データ）、`backend/`=Supabase モジュール、`scripts/serve-ui.mjs`=静的配信のみ |
| 監視の仕組み | `npm run guard`（scope / gate / solved）、3帳面の設計、真解決の定義（D-18） |
| F1 バッドシナリオ | 10個承認済み・実測済み（**該当8件** / 該当せず2件） |

| 残っている | どこで |
|---|---|
| F1 の該当8件を真解決で潰す | 第2章 |
| ④カルテ作成 → ⑤確認へ進めない（463px 問題） | 第3章 |
| モックに在る「＋ 新規カルテを作成する」が画面に無い | 第3章 |
| 仮データ → 実データの結線 | 第4章 |
| マスター判断待ち一式 | 第6章 |

---

## 重要ルール（マスター指定・全フェーズに適用）

**①現状あるものだけで完成させる**
- **人間**: 新しい道具や部品を買い足さない。いま在るもので片づける。
- **AI**: 新規実装・新規依存の追加を禁止。`npm install` は `npm run guard` が止める。

**②納品物の完成 ≠ フェーズの完成** ／ **③目的は現状の整理整頓** ／
**④見つけた問題は原則あと回し**（例外は「直さないと次の画面へ行けない」ものだけ。進める状態まで） ／
**⑤あと回しは `docs/deferred.md` に残し、F3 完了後にマスターが決める**

**真解決の定義（D-18）**: 問題発見 → 調査（**先に**そのエラーを出す検査を作り赤を見る）→
解決行動 → 仮解決 → **①戻すと同じエラーが出る／②直すと消える** の両方で真解決。
機械: `node scripts/guard/solved.mjs`。フェーズは `node scripts/guard/gate.mjs --end` が通るまで閉じない。

---

## 2. F1 — UI とバックエンドの隔離（残り: 該当8件を潰す）

**完了条件**: A `src/` に UI 以外が無い ／ B UI→backend 参照 0（機械で確認）／ C build・check・test が EXIT 0。

| 該当# | 直し方（検査を先に作る） |
|---|---|
| 1・2・4 | **新規 `scripts/guard/isolation.mjs`**: `src/` 全ファイル（`index.html` 含む）から `backend/`・`@supabase`・`/api/`・実URL・`fetch(` を探し、1件でも EXIT 1。`check` に組込み。**わざと違反を置いて赤を見てから**組み込む |
| 6 | 同 isolation.mjs 条件A: `index.html` から到達できないファイルを列挙。逃がすのは **`docs/deferred.md` の番号付き**のみ（無条件の免罪符にしない） |
| 7 | `git show '6685df5^:src/js/magazine-view.js' > backend/js/magazine-view.js` で復元（消したのは私。呼び出し元が生きている） |
| 8 | **新規 `test/backend-import.test.mjs`**: `backend/js/` 全モジュールを import。**先に走らせて赤（#7）を見る** |
| 9 | `src-dist-guard.config.json` の死んだ項を削除し、drift-guard を「設定が実在しない場所を指したら EXIT 1」に変える |
| 10 | まっさら相当 `rm -rf dist && npm run check` を赤として確認してから、`check` の扱いを決める（勝手に緩めない） |

各件 `docs/ops/solved-F1.md` に3出力（赤/緑/戻して赤）。完了時に `failure-check-F1-end.md` と `close-F1.md`（ひな形の事後記入）。

## 3. F2 — 正UI のみで動線を完了させる

**動線（意匠モック `design/mock-4step.html` が正。自分の発案を混ぜない）**
`① URLを開く → ② ログイン → ③ 犬の名前を選ぶ → ④ カルテ作成 → ⑤ 確認 → ⑥ 顧客ページ`

**完了条件（D-14）**: スクショのみで 1) 最後まで到達できた 2) 間違えても2タッチで戻れた。

手順:
1. フェーズ開始直後: ②バッドシナリオ10個を出しマスター承認 → ③再発防止チェック → ひな形（4部）を当てて開始時の2択を埋める
2. **「＋ 新規カルテを作成する」の復元** — モックに在り現画面に無い（マスター4回指摘の入口）。モックの該当ブロックを `src/index.html` へ移す
3. **463px 問題** — ④の編集領域が iPhone(390px) からはみ出し、確定ボタンのタップを別要素が奪う。
   直すのは**⑤へ進める状態まで**（ルール④）。**直し方の選択はマスター判断**:
   (a) 編集領域だけ横スクロール容認 (b) モックのレイアウト意図に沿った縮小。私が新デザインを発案しない
4. `npm run walk` / `npm run walk mistakes` の画像で2問に答える。合否は絵で人間が決める

## 4. F3 — 正UI とバックエンドをつなぐ（着手条件: F2 の2問が両方○）

**完了条件**: F2 の2点が**実データでも**同じように通る。

結線表（`src/js/dummy.js` を外し、`ui.js` から backend を呼ぶ。対応は1対1）:

| 画面側（`src/js/ui.js`） | backend 側 |
|---|---|
| ②ログイン | `supabase-auth.js` `signInWithGoogle` / `createAuthClient` |
| ②一覧 `renderDogs()`（いま `window.DUMMY.dogs`） | `supabase-staff.js` 犬一覧取得 + `mapPet` / `mapOwner` |
| ③選択 `selectKarte()` | 該当 pet の最新レポート取得（`authorizedFetch`） |
| ④保存・確定 | `finalize_report` RPC（**null は必ず失敗として扱う** D-2）+ `supabase-storage.js` `uploadReportAssets` |
| ⑥顧客ページ | `supabase-auth.js` `bootProtectedPortal` + `hydrateAssetReferences` + `magazine-view.js` `renderMagazine` |
| 写真の削除・引継ぎ | `deleteReportAssets` / `purgePetAssets`（**Storage → DB の順** D-20260824-34） |

検証: ローカル Supabase（`db reset` 後は Kong 再起動）→ 本番。最後にスクショ2問を実データで。

## 5. 各段の共通ゲート

`npm run build` / `npm run check`（guard 含む）/ `npm test` すべて EXIT 0。
フェーズ境目でひな形（`docs/ops/template.md`・認知的WT4問×6段 + ニールセン10 + 再発分類 + 自己監査5行）を2択・過去形で埋める。
`docs/watch.md`（経過観察）が**空のまま**のフェーズは見落としを疑う。

## 6. F3 完了後の棚卸し（マスターが「直す／放置」を決める）

`docs/deferred.md` 全件 + `docs/watch.md` 全件 + 以下のマスター判断:
担当メッセージの既定文2か所 ／ 「次回のおすすめご来店時期」の値の出どころ（D-20260825-38・残すと決定済み）／
`photo-trim-action.jpg` の出所 ／ 本番のダミー犬3頭と孤児 owner ／ **資格情報3種のローテーション（実顧客データ投入前に必須**・D-20260824-31）／
Konva 4カンバスの出力形式 ／ 爪・歯の解剖図 ／ `01〜04` ステップタブ ／ `manifest.json` の結線。

## 監視の仕組み（実装済み・変更しない）

①逸脱監視 `scripts/guard/scope.mjs`（常時・`npm run guard`）
②バッドシナリオ（フェーズ開始直後・10個・マスター承認後に実行）→ `docs/ops/bad-scenarios-F{n}.md`
③再発防止（開始直後と完了直後・failures.md 全件照合）→ `docs/ops/failure-check-F{n}-{start,end}.md`
関所 `scripts/guard/gate.mjs` は**成果物の実在**だけを見る。解決の裏づけは `scripts/guard/solved.mjs`。
