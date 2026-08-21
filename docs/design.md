# Product Design Document (docs/design.md)

恒久的な製品定義・設計ドキュメント。
揮発的な作業ログや一時メモはここに書かず、`docs/handoff.md` に書くこと。

---

## 1. 概要 (Overview)

- **対象ユーザー (Who)**:
  - **書く人** = トリミングサロンのトリマー。施術後にその場でスマートフォンから記入する
  - **読む人** = 愛犬を預けた飼い主。渡された URL を開くだけ。**アカウント登録もアプリの導入もしない**
- **解決する課題 (What it solves)**:
  施術中に気づいた健康所見（皮膚・耳・爪・歯の状態）は、これまで口頭か紙で断片的にしか伝わらなかった。
  写真と犬体図への描き込みを含めて記録し、**書いた形のまま**飼い主に届ける。
- **差別化要因 / コア価値 (Key differentiator)**:
  **書いた形のまま届くこと**が価値の全て。所見が1項目でも欠けて届けば、この製品は成立しない。
  だから機械検証も「操作できたか」ではなく「同じ値で届いたか」で書く（`npm run verify:roundtrip`）。

---

## 2. コア仕様 (Key Specifications)

### アーキテクチャ概要

Cloudflare Workers が1本で、静的配信・API・公開ページの状態注入をすべて担う。
ビルドは自作の `scripts/build-dist.mjs` で `src/` → `dist/` へ写す（バンドラは Supabase SDK のみ esbuild）。

```
src/           編集元。ここが本番の実体
 ├ index.html            ログイン
 ├ search.html           検索
 ├ my.html               顧客ポータル（Supabase 用）
 ├ design-samples/ponchi-v2.html   カルテ本体 + Konva 描画エンジン（インライン）
 ├ js/                   PonchiApp / 保存・公開 / Supabase 結線
 └ assets/               Konva・画像・同梱フォント（外部 CDN 参照ゼロ）
       ↓ npm run build
dist/          配信物。手で触らない（D-5）
       ↓
worker/src/index.js      Cloudflare Worker。/ /edit/* /p/* /o/* /api/*
       ↓
Workers KV（本番）  /  Supabase（移行先・未有効化）

design/        意匠見本。統合で src/ へ貼り替える目標。import 禁止（D-1）
```

### 確定スタック

`AGENTS.md` の「本リポジトリの確定スタック」を正とする。要点は
**TypeScript を使わない / フレームワークを使わない / Linter は無い / Konva と画像とフォントは同梱 /
テストは `node --test`** の5点。

### データモデル / スキーマ方針

- カルテ1件は `reports.data` の**自由 jsonb**。値域制約を DB に持たせていない
  （歯の3段階/6段階のような表現の揺れを、マイグレーションなしで吸収するため）
- DOM とのやりとりは `data-field` / `data-photo` / `data-*` 属性が契約。
  `extractReport()`（DOM → JSON）と `applyReport()`（JSON → DOM）は**対称写像**でなければならない。
  片道だけ壊れると、保存直後の画面は正常に見えるのに読み戻せない（`F-20260821-12`）
- **`data-*` の値に日本語を使う場合、セレクタ文字列に連結しない**（D-9）。`pickByValue()` を使う

### 主要エンドポイント / インターフェース

| パス | 用途 |
|---|---|
| `/` | ログイン |
| `/edit`, `/edit/o/{ownerId}`, `/edit/p/{petId}/{reportId}` | トリマー側 |
| `/p/{slug}` | **飼い主向け公開カルテ。** 認証なし。`window.__VIEW__` が立つ |
| `/o/{ownerSlug}` | 飼い主の全犬一覧 |
| `/api/owners`, `/api/customers`, `/api/reports`, `/api/config` | データ操作。**認証なし（D-3・意図された前提）** |

`window.__VIEW__` が「飼い主が見ている」の唯一の判定。プレビューはトリマー文脈なので
`isEditMode()` ではなくこちらで分岐する（`ponchi-app.js` に注記あり）。

---

## 3. 調査で確定した事実 (Established Facts & Decisions)

- **Konva 描画エンジンの約966行は `ponchi-v2.html` のインラインに埋まっている。**
  `src/js/*.js` だけでは動かない。統合の P0「エンジン抽出」が全ての前提になる
- **`finalize_report` は整合検査に失敗すると例外ではなく `null` を返す。**
  `202607160001_supabase_base.sql:488` の定義は `raise exception` するが、
  **`202607160004_private_storage_lifecycle.sql:98` が再定義していて**、そちらには
  `return null` が4つある（マイグレーションは順に適用されるので後者が効く）。実物を読んで確認した4条件:

  | # | 条件 | 意味 |
  |---|---|---|
  | 1 | `draft.data::text ~* 'data:image/'` | JSON に生の data URI が残っている |
  | 2 | `asset://{uuid}` に対応する `report_assets` 行が無い | 本文が参照する資産が未登録 |
  | 3 | `report_assets` に対応する `storage.objects` が無い | 登録済みなのに実体が無い |
  | 4 | プレフィックス配下に `report_assets` に無い `storage.objects` がある | 孤児ファイルが残っている |

  4つとも**黙って `null` を返す**。保存パスを自作すると「保存したのに draft のまま」という
  無症状バグになり、しかも例外が出ないので気づけない。`ponchi-app.js` の4段保存が、
  この4条件を満たす唯一の実装として既に存在する。**書き直しではなく再スキンを選ぶ決定的な理由**
- **`cssAttrSafe()` は ASCII の「名前」専用。** 保存された「値」に通すと空文字になり、
  一致しないセレクタが出来上がる（`F-20260821-12`）
- **日本語フォントは同梱していない。** Noto Serif JP 約40MB / Noto Sans JP 約30MB で
  リポジトリ予算 20MB に入らない。和文はシステムフォント。代償は `docs/ASSET-PROVENANCE.md`
- **`src/assets/` の20件中15件は出所不明**（`UNVERIFIED`）。5件は C2PA 署名から AI 生成と判明。
  飼い主に配るページに載るため、公開前に確認が要る
- **既存データ（本番 KV の顧客データ）は引き継がない**（マスター確定）。
  よって納品直後は全ての犬がカルテ0件から始まる
- **`worker/wrangler.toml` の `name` / KV `id` / `routes` は変更しない。**
  `saltydog-report-worker` を変えると別 Worker が作られ本番が2重化する

---

## 4. まだ決まっていないこと (Open Questions)

- **Supabase の有効化** — プロジェクト作成と Google OAuth 設定はマスター作業。
  済むまで KV モードで動かす。実装は済んでいる
- **意匠の貼り替え** — `design/mock-4step.html` への再スキン（`docs/ops/plans/2026-08-21-integration.md` の P0〜P9）。
  V1 の JS を温存したまま HTML/CSS を差し替える方式で確定している
- **素材の出所** — `docs/ASSET-PROVENANCE.md` の `UNVERIFIED` 15件。コードでは解けない
