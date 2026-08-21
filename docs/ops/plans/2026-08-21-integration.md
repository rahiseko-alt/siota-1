# trimmer-system 統合 plan — モック意匠 × V1機能 × Supabase保存

## 大義との整合

- 照合先: 1
- 整合: 施術記録と健康所見を、トリマーが入力した形のまま飼い主へ届ける単一のアプリを成立させる。現在3つに割れている資産（モック／V1／Supabase版）を1本に統合することがその前提になる。

### ロードマップ（2026-08-21 マスター承認済み・実装の最初の一手として作成する）

| id | マイルストーン | 依存 |
|---|---|---|
| **1** | **統合版の成立**（P0〜P9）← 本 plan | — |
| 2 | 実DB検証（Docker復旧・RLS runtime・private Storage・Google OAuth 1往復） | 1 |
| 3 | 塩田様 UI 承認 | 1 |
| 4 | KV → Supabase データ移行（`scripts/migrate-kv-to-supabase.mjs`） | 2, 3 |
| 5 | 本番切替・運用開始 | 4 |

H2大義: **塩田様のトリミングサロンで、施術記録と愛犬の健康所見が、書いた形のまま飼い主へ届く状態をつくる。**

`roadmap.md` と `roadmap-state.json`（現在地 = M1 / status のみ AI が編集可）を P0 着手前に作成する。

---

## Context

マスターの決定により、統合の方向が確定した。

| 項目 | 決定 |
|---|---|
| UI の正 | **モック**（4ステップ・エディトリアル意匠） |
| 機能 | モックに無いものは **V1 から持ってくる** |
| バックエンド構造 | **V1** |
| 保存先 | **Supabase**（配信は Cloudflare Worker のまま） |
| 肉球ナビ | **廃止**（モックのタイムライン日付切替に置換） |
| 公開URL `/p/` `/o/` | **廃止**（既定方針どおり） |

調査の結果、これは「3つのうちどれかを選ぶ」作業ではなく、**既に噛み合う設計になっている部品を組み直す**作業だと判明した。`supabase-staff.js:37-57` の `mapPet`/`mapOwner` が Supabase のデータを V1 画面が期待する形へ変換し、`PonchiApp.show()` を呼ぶ構造が既にある。つまり **V1 のJSエンジンを残したまま HTML/CSS をモック意匠に貼り替えれば、Supabase 結線は済んでいる。**

---

## 方式: 再スキン（書き直しではない）

V1 の資産 **約3,063行**（`ponchi-app.js` 1484 + `publish-client-ponchi.js` 613 + V1 HTML内インラインエンジン 966）を温存し、DOM をモック意匠に置き換えて V1 のデータ契約属性（`data-field` 等）を後付けする。

**書き直しを選ばない決定的な理由:** `finalize_report`（`supabase/migrations/202607160004_private_storage_lifecycle.sql:98-160`）は4条件の整合検査に失敗すると **例外ではなく `null` を返す**。保存パスを自作すると「保存したのに draft のまま」という無症状バグになり、しかも Docker 停止中の今それを検出する手段が無い。`ponchi-app.js:1270-1305` の4段保存は、この4条件を満たす唯一の実装として既に動く形で存在する。

### 調査で判明した前提の修正

**V1エンジンの約半分（`createDrawer` を含む966行）は、消滅した V1 HTML のインラインに埋まっている**（`6505921^:src/design-samples/ponchi-v2.html` L1156-2122）。`src/js/*.js` だけでは動かない。よって **P0「エンジン抽出」が全ての前提**になる。

---

## 画面マップ

| V1 | モック | 統合後 | URL |
|---|---|---|---|
| `#screen-owner` | `#screen-2` 検索一覧 | **`#screen-list`** | `/edit`, `/edit/o/{ownerId}` |
| `#screen-paw` | — | **廃止** | — |
| `#screen-archive` | `#screen-4` のタイムラインチップ列 | **`#screen-view` に吸収** | — |
| `#screen-report`（編集/閲覧兼用） | `#screen-3` / `#screen-4` | **`#screen-edit` / `#screen-view` に分割** | `/edit/p/{petId}/new`, `/edit/p/{petId}/{reportId}` |
| — | `#screen-1` 認証 | `src/index.html` を認証専用ページへ縮小 | `/` |

`PonchiApp.show()` の screen 名: `'owner'|'paw'|'archive'|'report'` → **`'list'|'edit'|'view'`**

`/edit/p/{petId}/new` を足すため `worker/src/index.js:40` の `SUPABASE_EDIT_PATH_PATTERN` に1箇所追加が要る。

### 編集画面と閲覧画面を分ける理由

`extractReport`/`applyReport`（`publish-client-ponchi.js:20,176`）は `document.querySelector`（単数・文書全体）を使う。**編集画面と閲覧画面に同じ `data-field` を置くと先勝ちで衝突する。** よって閲覧側は `data-view="…"` の別名前空間にし、新規 `src/js/magazine-view.js` の `renderMagazine(report)` が一方向投影する。これにより `publish-client-ponchi.js` の613行を無改修で使え、かつ **スタッフ側プレビューと顧客ポータル `/my` が同一レンダラを共有できる。**

---

## 実装ステップ

`P0 → P1 → P2 → P3 → P4 → P5 → P6 → {P7, P8} → P9`（P7/P8 は並行可）。各 Phase は単独でコミットする。全 Phase 共通ゲート: `npm run build` EXIT 0 かつ `npm run check` EXIT 0。

| Phase | 内容 | 主な機械検証 |
|---|---|---|
| **P0** エンジン抽出 | V1 HTML インライン L1156-2122 を `src/js/ponchi-engine.js` へ逐語移設。`konva.min.js` は現存 | `grep -c 'function createDrawer'` = 1 / `grep -c '__SALTYDOG_'` ≥ 14 |
| **P1** 画面骨格 | `src/design-samples/ponchi-v2.html` を唯一のアプリテンプレに確定。section id 改名。`src/index.html` を認証専用に縮小。`src/search.html` 削除。`scripts/build-dist.mjs` 追随。paw 撤去 | `grep -c "paw" src/js/ponchi-app.js` = **0**（現状31）/ `sha256sum` で src 3ファイルが**一致しないこと** |
| **P2** 判定系の契約 | 耳/爪/歯/カットに属性付与、インライン `onclick` 撤去 | `grep -c 'data-ear='` = 6 / `data-nail=` = 3 / `data-teeth="t[1-6]"` = 6 / `grep -c 'onclick="App\.'` = **0** |
| **P3** Konva 結線 | 生Canvas2D を撤去し `bm/tc/tcn/tt` の4描画ブロックへ置換 | `grep -c 'id="marking-canvas"'` = 0 / konva 参照 = 1 |
| **P4** 写真 I/O | hidden file input 1件 + `img[data-photo]` 9件 + 描画ボタン | `grep -c 'type="file"'` = 1 / `data-photo=` ≥ 9 |
| **P5** 欠落入力UI | 皮膚10枠・オプション9・体重リスト・日付input・コメント6種を編集画面へ追加 | `grep -c 'data-field='` ≥ **16**（V1基準値）/ `class="opt ` = 9 |
| **P6** マガジン投影 | `src/js/magazine-view.js` 新規。閲覧側に `data-view` 付与。`showPreview` 差替 | `grep -c 'data-view='` ≥ 20 / 閲覧側の `data-field=` が 0 |
| **P7** Supabase 結線 | `supabase-staff.js` のルート追加と `show()` 書換。歯の scale/level 変換 | `grep -c "show('owner'\|show('archive'\|show('report'"` = 0 / `npm run test:unit` EXIT 0 |
| **P8** 顧客ポータル | `src/my.html` を再構築（`git show 82deef7:src/my.html` のフック + モック意匠 + `renderMagazine`） | `grep -c 'data-portal="customer"'` = 1 |
| **P9** テスト復旧 | E2E セレクタ更新。**Supabase系テスト39件がどの npm script からも走っていない**ので配線 | `npm test` の実行テスト数が **39増える** |

### 歯の値域衝突（V1 3段階 / モック 6段階）

`reports.data` は自由 jsonb（`202607160001_supabase_base.sql:72` に値域制約なし）なので **DBマイグレーション不要**。6段階を正とし、`{scale:6, level:1..6, key:"t1".."t6", label:表示用, status:3段階の縮退値}` を併記して V1 データと相互に読める形にする。

---

## リスク

| # | 内容 | 対策 |
|---|---|---|
| 1 | **V1 の日本語属性値バグ（新発見）**: `cssAttrSafe`（`publish-client-ponchi.js:18`）が `[^a-zA-Z0-9_-]` を全除去するため、皮膚type/change と歯status は**保存はされるが永久に読み戻せない** | P2 で属性値を ASCII キー（`t1`〜`t6`）化して構造的に解決。`cssAttrSafe` 自体はXSS防御なので緩めない |
| 2 | V1 既存バグ4件（コメント6種・担当一言が保存されない等） | **全件直す**。モック意匠は各項目の解説文を前面に出す設計なので、温存すると意匠が成立しない |
| 3 | `/my` が完全に無反応（`7243f78` で `data-portal="customer"` が消失し `supabase-auth.js:298` の分岐が永久に false） | P8 で再結線 |
| 4 | **Docker/Postgres 停止で RLS・finalize・Storage・OAuth が検証不能** | 各 Phase の合格条件に**実DB項目を入れない**。静的検証（`grep -c` / `node --check` / `npm run build`）だけで判定し、実DB検証は別リストに退避して「検証済み」と誤読させない |
| 5 | 本番 KV との衝突 | KVハンドラ（`worker/src/index.js:777-873`）は**一切触らない**。ローカル確認は `npm run preview:supabase` を使う |

---

## やらないこと

1. `wrangler deploy` / 本番切替 / KVデータ移行（`worker/deploy-freeze.md` は維持・削除しない）
2. DBマイグレーション追加・RPC/RLS の変更・`finalize_report` の4条件変更
3. `supabase/config.toml:34` の Google 有効化（承認ゲート）
4. モック意匠の変更（CSS変数と BEM+`is-` 規約は不変。属性追加と `onclick` 除去のみ）
5. リポジトリ構成の整理（`site/` `dist.bak/` 重複assets 等 → `docs/ops/plans/2026-08-21-structure-cleanup.md` の管轄）
6. Konva の機能追加・別ライブラリ置換（V1 と完全同等に留める）

---

## テスト方針

| 対象 | 手段 | 合格 |
|---|---|---|
| ビルド | `npm run build` | EXIT 0 |
| src↔dist | `npm run check` | EXIT 0 |
| 構文 | `node --check src/js/*.js` | EXIT 0 |
| Worker 単体 | `npm run test:unit` | EXIT 0 |
| Supabase 静的 | `npm run test:supabase:static` | EXIT 0 |
| 抽出/適用の対称性 | `extractReport → applyReport → extractReport` の不動点テストを新規追加（jsdom不要・DB不要） | EXIT 0 |
| 実物確認 | `npm run preview:supabase` → 1画面ずつブラウザで開く | 目視 |
| 本番無傷 | `https://trimmer-system.kouheikosehira.com/` | 「ポチページ デザイン v2.1」のまま |

**Docker 復旧後に別途回す（本 plan の合格条件に含めない）**: pgTAP/RLS runtime・実DB import・private Storage 実動・Google OAuth 1往復。

---

## 受け入れ基準

| # | 条件 | 機械検証 | 合格値 |
|---|---|---|---|
| 1 | ビルドと drift が通る | `npm run build && npm run check` | EXIT 0 |
| 2 | 肉球が撤去されている | `grep -c "paw" src/js/ponchi-app.js` | 0（現状31） |
| 3 | モックの重複が解消 | `sha256sum src/index.html src/design-samples/ponchi-v2.html` | 2値が**不一致** |
| 4 | インライン onclick 撤去 | `grep -c 'onclick="App\.' src/design-samples/ponchi-v2.html` | 0 |
| 5 | 日本語属性値の残存ゼロ | `grep -c 'data-teeth="[^t]' src/design-samples/ponchi-v2.html` | 0 |
| 6 | V1 のデータ契約を満たす | `grep -c 'data-field=' src/design-samples/ponchi-v2.html` | 16 以上 |
| 7 | 閲覧側との名前空間衝突なし | 閲覧セクション範囲で `grep -c 'data-field='` | 0 |
| 8 | 旧 screen 名の呼出が残っていない | `grep -c "show('owner'\|show('archive'\|show('report'" src/js/supabase-staff.js` | 0 |
| 9 | 顧客ポータルが再結線 | `grep -c 'data-portal="customer"' src/my.html` | 1 |
| 10 | 眠っていたテストが動く | `npm test` の実行テスト数 | 現状 +39 |
| 11 | 新規JSが構文的に正しい | `node --check src/js/ponchi-engine.js src/js/magazine-view.js` | EXIT 0 |
| 12 | 本番が無傷 | `npm run predeploy-check` | EXIT 1（凍結維持が正） |

---

## 実装の順序（P0 より前に1つある）

| # | 作業 | 理由 |
|---|---|---|
| **P-1** | `roadmap.md` と `roadmap-state.json` を作成（上記5マイルストーン・現在地 M1） | マスター承認済み。`plan-daigi-gate` が以後の plan 承認で `照合先:` の id 実在を検証するため、これが無いと次の plan から同じ壁に当たる |
| P0 | エンジン抽出 | 以降は「実装ステップ」表のとおり |

**注意:** `roadmap-state.json` は `roadmap-state-write-gate` の保護対象で、**AI が編集してよいのは status フィールドのみ**。新規作成時のマイルストーン定義は上表のとおりマスター承認済みの内容に限る。
