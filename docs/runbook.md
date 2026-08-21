# runbook — ポチ版B（ponchi-v2）本番デプロイ手順

対象: `trimmer-system` ポチ版B（ponchi-v2.html + ponchi-app.js + publish-client-ponchi.js）

---

## 0. 前提・構成

| 要素 | 実体 |
|------|------|
| ポチ HTML（編集/閲覧 兼用正本） | `src/design-samples/ponchi-v2.html`（**ローカルデモ用・相対パスのまま維持**） |
| ポチ JS | `src/js/ponchi-app.js` / `src/js/publish-client-ponchi.js` |
| アイコン群 | `src/assets/icon-{spa,weight,skin,ear,nail}.png` |
| dist 配信物（絶対パス版） | `dist/ponchi-v2.html`（相対パス→絶対パスに変換済）/ `dist/js/ponchi-app.js` 等 |
| Worker（/p/* /o/* /edit/* /api/*） | `worker/src/index.js`（KV binding `REPORTS`） |
| データストア | Cloudflare Workers KV（id `50241192b25149eb8f846653ecae8f64`） |
| 本番ドメイン | `trimmer-system.kouheikosehira.com`（Cloudflare 管理） |
| Cloudflare 認証 | 運用担当者のアカウントで OAuth 済（`npx wrangler whoami` で確認） |
| A版後方互換 | **このリポジトリには無い**。`beauty-report-mobile.html` は移設対象外（本番 KV に残る A版 slug は本リポジトリからは配信できない） |

**パス方針（重要）**:
`src/design-samples/ponchi-v2.html` は `../assets/` `../js/` の相対パスのまま維持し `file://` で開ける状態を保つ。
dist にコピーする時だけ絶対パス（`/assets/` `/js/`）に書き換える。
理由: 本番 `/p/{slug}/{reportId}` 閲覧時、相対パスだとブラウザが `/p/{slug}/js/...` と誤解決し
Worker の `/p/*` route に吸われて 404 になる。

route 優先順位: **Worker route（/p/* /o/* /edit/* /api/*）> Pages フォールスルー（他パス）**。

---

## 1. dist 構成手順（デプロイ前に必ず実行）

> dist/ は gitignore 済。生成は `npm run build` 1 本に統一（手動コピー禁止）。

### 1-A. ビルド実行

```powershell
cd <リポジトリのルート>
npm run build
```

`scripts/build-dist.mjs` が src → dist を生成する:
- `src/design-samples/ponchi-v2.html` → `dist/ponchi-v2.html`（相対パス `../assets/`・`../js/` を絶対パス `/assets/`・`/js/` へ自動置換）
- `src/js/*.js`（ponchi-app.js / publish-client-ponchi.js）→ `dist/js/`（無変換）
- `src/assets/` の使用 10 ファイル → `dist/assets/`（選別コピー）
- `src/manifest.json` → `dist/manifest.json`

スクリプト末尾の self-check が「相対パス残存ゼロ・絶対パス存在」を自動検証する。残存があれば EXIT 1 で停止するため、置換漏れによる本番 404 が構造的に起きない。

### 1-B. 手動コピーは禁止

旧来の手動 `Copy-Item` ＋ `-replace` 手順は廃止した。dist は必ず `npm run build` で生成すること。破損・差分時の復旧は `docs/build-recovery.md` を参照。

---

## 2. ローカル通電確認（wrangler dev）

デプロイ前に必ずローカルで動作を確認する。

```powershell
cd worker
npx wrangler dev --local
```

ブラウザで以下を確認（KV local のため既存データがない場合は 404 が正常）:

| URL | 期待結果 |
|-----|---------|
| `http://localhost:8787/api/ping` | `{"ok":true}` |
| `http://localhost:8787/edit` | ponchi-v2.html（__OWNER_LIST__ 注入・__VIEW__ なし） |
| `http://localhost:8787/p/{slug}` | ponchi-v2.html（__VIEW__=true・__SCREEN__='paw'） |

---

## 3. デプロイ手順（順序固定）

> ⛔ **移設・統合フェーズのあいだ、本節の手順を実行するな。**
> 移設元にあったデプロイ凍結（`predeploy-guard.mjs` / `deploy-freeze.md`）は、
> 「`src/` が静的モックで本番と別世代」という前提が siota-1 では成立しないため
> 移設していない。`npm run predeploy-check` は**存在しない**。
> つまり機械的に止めるものが何も無いので、実行前に必ずマスターの承認を取ること。
> 経緯 → `docs/ops/plans/2026-08-21-migration.md`

### A. Worker をデプロイ

```powershell
cd worker
npx wrangler deploy
```

- `wrangler.toml`（`main = src/index.js`）が参照される。
- deploy 完了後、`https://trimmer-system.kouheikosehira.com/api/ping` が `{"ok":true}` を返すことを確認。

### B. Pages をデプロイ（dist の絶対パス指定）

```powershell
npx wrangler pages deploy dist `
  --project-name=trimmer-system `
  --branch=main `
  --commit-dirty=true `
  --commit-message="deploy ponchi-v2 dist"
```

注意: `--commit-message` は ASCII 文字のみ使用（日本語不可）。

---

## 4. デプロイ後 E2E チェックリスト

### 閲覧 E2E（A版後方互換 — 回帰確認）

- [ ] A版 slug の確認は本リポジトリでは行えない（`beauty-report-mobile.html` を移設していないため）
- [ ] `https://trimmer-system.kouheikosehira.com/p/{A版slug}/{reportId}` → カルテ内容が正常表示
- [ ] 上記で `window.__VIEW__=true` が注入されていること（DevTools > Console: `__VIEW__`）

### 閲覧 E2E（ポチ版B）

- [ ] `https://trimmer-system.kouheikosehira.com/o/{ownerSlug}` → `ponchi-v2.html` 飼い主画面（`__VIEW__=true`・`__SCREEN__='owner'`）
- [ ] `https://trimmer-system.kouheikosehira.com/p/{ponchiSlug}` → 肉球画面（`__SCREEN__='paw'`）
- [ ] `https://trimmer-system.kouheikosehira.com/p/{ponchiSlug}/all` → アーカイブ画面（`__SCREEN__='archive'`）
- [ ] `https://trimmer-system.kouheikosehira.com/p/{ponchiSlug}/{reportId}` → カルテ画面（`__SCREEN__='report'`・`__VIEW__=true`）

### 編集 E2E（ポチ版B）

- [ ] `https://trimmer-system.kouheikosehira.com/edit` → 飼い主一覧画面（`__VIEW__` なし・`__OWNER_LIST__` 注入）
- [ ] `https://trimmer-system.kouheikosehira.com/edit/o/{ownerSlug}` → 飼い主の犬一覧（`__VIEW__` なし・`__OWNER__` 注入）
- [ ] `https://trimmer-system.kouheikosehira.com/edit/p/{slug}` → 月一覧/新規作成画面（`__VIEW__` なし・`__SCREEN__='archive'`）
- [ ] `https://trimmer-system.kouheikosehira.com/edit/p/{slug}/{reportId}` → 既存レポート編集（`__VIEW__` なし・`__SCREEN__='report'`）
- [ ] 上記編集 URL でフォームが入力可能（読取専用でない）ことを確認

### スタティックアセット E2E

- [ ] `https://trimmer-system.kouheikosehira.com/assets/icon-spa.png` → 200 OK（画像表示）
- [ ] `https://trimmer-system.kouheikosehira.com/js/ponchi-app.js` → 200 OK
- [ ] `https://trimmer-system.kouheikosehira.com/js/publish-client-ponchi.js` → 200 OK
- [ ] ponchi-v2.html のアイコン・JS が 404 にならないこと（DevTools > Network で確認）

---

## 5. ロールバック手順

### Worker のロールバック

```powershell
cd worker
# Cloudflare ダッシュボードで前バージョンの deployment ID を確認してから:
npx wrangler rollback <deployment-id>
```

または Cloudflare ダッシュボード（Workers & Pages > trimmer-system > Deployments）から前バージョンへ「Rollback」ボタンで戻す。

### Pages のロールバック

Cloudflare ダッシュボード（Workers & Pages > trimmer-system > Deployments）で前バージョンの「Rollback to this deployment」を使用。

### git によるコードロールバック

```powershell
# worker/src/index.js を特定コミットに戻す場合:
git checkout <commit-hash> -- worker/src/index.js
# その後 wrangler deploy で再デプロイ
```

---

## 6. 補足: 編集モード vs 閲覧モードの違い

| 項目 | 閲覧（/p/* /o/*） | 編集（/edit/*） |
|------|-----------------|---------------|
| `window.__VIEW__` | `true` | 注入しない（undefined） |
| `window.__SCREEN__` | 画面に応じて注入 | 画面に応じて注入 |
| `window.__OWNER__` | 注入（/o/* のみ） | 注入（/edit/o/* のみ） |
| `window.__OWNER_LIST__` | 注入しない | `/edit` のみ注入（飼い主一覧配列） |
| `window.__PET__` | 注入（/p/* のみ） | 注入（/edit/p/* のみ） |
| `window.__REPORT__` | 注入（/p/*/{reportId} のみ） | 注入（/edit/p/*/{reportId} のみ） |
| ponchi-app.js の動作 | `__VIEW__=true` → 閲覧専用 | `__VIEW__` なし → 編集可能 |

---

v1.0 | 2026-06-03 | ポチ版B 本番デプロイ準備完了
