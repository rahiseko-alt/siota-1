# trimmer-system → siota-1 移設 plan（納品リポジトリ版）

## 大義との整合

- 照合先: 1
- 整合: クライアントへ納品する動作するアプリを、独立リポジトリ `siota-1` の上に成立させる。

> ⚠️ `roadmap-state.json` 未作成のため `plan-daigi-gate` が ExitPlanMode を塞ぐ。承認は手動で Plan Mode を抜ける形になる。移設完了後はこの hook 自体が無くなる。

---

## Context

`rahiseko-alt/siota-1`（private・default branch `master`）を**クライアント納品用の正リポジトリ**にする。ローカルの既存データ（本番 KV の顧客データ）は引き継がない。**移設した時点で動くものが揃っている状態**を作る。

### 前版の誤り（2026-08-21 マスター指摘により修正）

前版は V1 を `legacy/` に参照専用で凍結し、静的モックを `src/` の正本に据えていた。**動くコードを資料扱いにして動かないものを本体にする構成**で、納品にならない。

**修正: V1 を `src/` に戻す。** V1 は本番 `trimmer-system.kouheikosehira.com` で現に稼働している実体なので、移せばそのまま動く。モックは統合で貼り替えるための意匠見本として `design/` に置く。

この修正で**デプロイ凍結の前提も消える**。凍結は「`src` が本番と別世代（モック）だから、デプロイすると本番が潰れる」ことが理由だった。`src` が V1 に戻れば本番と一致し、デプロイは安全になる。

### 確定事項

| 項目 | 決定 |
|---|---|
| 目的 | **クライアント納品用リポジトリ**。移設完了 = 動くものが揃っている |
| ルール体系 | siota-1 の `template-0811 v3`。vibe-base の規律は持ち込まない |
| スタック | 現状維持（Vanilla JS + Konva + Cloudflare Workers）。AGENTS.md の Golden Stack を書き換える |
| `src/` の中身 | **V1（動くアプリ）** |
| モック | `design/` に意匠見本として配置。統合で `src/` へ貼り替える |
| 既存データ | **引き継がない**。KV→Supabase のデータ移行は行わない |
| git 履歴 | 持っていかない。移設元はアーカイブとして残す |

---

## この計画が完了した時点の状態

**動く。** `npm run preview` でログイン → 検索 → 肉球 → カルテを辿り、写真を貼り、犬体図に描き込み、保存できる。

| 動くもの | 根拠 |
|---|---|
| 4画面のナビゲーション | `ponchi-app.js` の `PonchiApp.show()` + Worker の状態注入 |
| Konva 描画（ペン/矢印/文字/消しゴム/undo/色5種/ピンチズーム） | V1 HTML インラインの `createDrawer` 966行 |
| 写真アップロード（7スロット）と写真への描き込み | `SaltyDogPonchiPhoto` + `createPhotoDrawer` |
| カルテの保存と読み戻し | `publish-client-ponchi.js` の `extractReport`/`applyReport` → `POST /api/reports` |
| 飼い主向け公開カルテ | Worker の `/p/{slug}` `/o/{ownerSlug}` |
| 音声入力（4箇所） | Web Speech API |
| ビルド・テスト・検査が自立 | `npm run build && npm run check && npm test` EXIT 0 |

**この時点では見た目は V1 のまま**（モック意匠ではない）。意匠の貼り替えは統合（P0〜P9）で行う。

保存先は **KV モードで動く**（本番と同じ構成）。Supabase モードは実装済みだが、Supabase プロジェクト作成と Google OAuth 設定（マスター作業）が済むまで有効化しない。

---

## ディレクトリ構成

```
siota-1/
├─ AGENTS.md / README.md / CLAUDE.md / .cursorrules   ← 既存。AGENTS.md を改訂
├─ package.json          ← 未宣言依存3件を固定
├─ .claude/settings.json ← 新規（deny ルールのみ。hook は持ち込まない）
│
├─ docs/
│  ├─ design.md / failures.md / handoff.md            ← 既存。中身を埋める
│  ├─ prototype-scope-constraints.md                  ← 移設
│  ├─ runbook.md                                      ← PII 除去して1本化
│  ├─ ASSET-PROVENANCE.md                             ← 新規。素材の出所台帳
│  └─ ops/plans/2026-08-21-integration.md             ← 移設（次工程 P0〜P9）
│
├─ prompts/ (3) / .agents/skills/ (3)                 ← 既存
│
├─ design/                ★ 意匠見本。ビルド対象外・import 禁止
│  ├─ README.md           ← 「これは statisch なモック。統合の貼り替え目標」
│  └─ mock-4step.html     2782行（現 src/design-samples/ponchi-v2.html）
│
├─ src/                   ★ 動くアプリ = V1
│  ├─ index.html          248行（ログイン）
│  ├─ search.html         515行（検索）
│  ├─ my.html             727行（顧客ポータル・Supabase 用）
│  ├─ manifest.json
│  ├─ design-samples/ponchi-v2.html   2128行（カルテ本体 + インラインエンジン966行）
│  ├─ js/ (6本)
│  └─ assets/ (21件・konva.min.js 含む)
│
├─ worker/    src/(5) + wrangler.toml ×2
├─ supabase/  migrations(5) + config.toml + seed.sql + tests/rls.sql
├─ scripts/   build-dist / src-dist-drift-guard★ / design-isolation-guard★ / migrate-kv-to-supabase + lib(2)
└─ test/      生きている4 + 眠っている3 + e2e/(2)
```

`design/` は `src/` の外に置く。`scripts/build-dist.mjs:177-190` の completeness guard が `src/` 配下の HTML を全列挙して未処理があれば EXIT 1 するため、外に置く限り自動的にビルドから隔離される。`design-isolation-guard.mjs` で `src/` からの参照が 0 件であることを `npm run check` に組み込む。

**`scripts/predeploy-guard.mjs` と `worker/deploy-freeze.md` は移設しない。** 凍結は「src が本番と別世代」への対処であり、V1 を戻せば前提が消える。

---

## 実装ステップ

`M0 → M1 → … → M9` の直列。各 Phase は単独コミット。

| Phase | 内容 | 主な機械検証 |
|---|---|---|
| **M0** 事前確認 | private・branch・既存13ファイル | `gh api … --jq .private` → `true` / `.default_branch` → `master` |
| **M1** 移設元の証跡固定 | ローカルタグ `archive/pre-siota-1-20260821` → `8f079ad` | `git status --porcelain \| wc -l` → 0 |
| **M2** clone | **vibe-base の外**へ | `realpath siota-1 \| grep -c vibe-base` → **0** |
| **M3** **V1 を `src/` へ復元** | `git show 6505921^:` の3ファイルを `src/` へ書き出す | `wc -l src/design-samples/ponchi-v2.html` → **2128** / `src/index.html` → 248 / `src/search.html` → 515 / `grep -c 'function createDrawer'` → 1 / `grep -c 'PonchiApp.boot()'` → 2 |
| **M4** 残りのコード移設 | `src/js`(6) `src/assets`(21) `src/my.html` `src/manifest.json` `worker/` `supabase/` `scripts/` `test/` `docs/`(4) | `find src/assets -type f \| wc -l` → 21 / `du -sm .` → **< 20** / `grep -rl 'raw-materials' .` → 0 |
| **M5** 依存固定 | `playwright@1.59.1` `wrangler@4.92.0` を devDep に。`check` を自リポ参照に。`src-dist-drift-guard.mjs` をコピー | `grep -c '\.\./\.\./' package.json` → **0** / `npm run build && npm run check` → **EXIT 0** |
| **M6** **動作証明** | `npm run preview` で実際に動かし、①〜④を1画面ずつ辿る。カルテを1件保存して読み戻す | 下記「動作の受入基準」全項目 |
| **M7** モック配置とテスト配線 | モックを `design/mock-4step.html` へ。`design-isolation-guard.mjs` 追加。眠っている39testを npm script へ | `npm test` の pass 合計 → **61** / `grep -rc 'design/' src/ worker/` → 0 |
| **M8** PII/権利/PWA 是正 | Gmail 置換 / 素材台帳 / `<link rel="manifest">` 再結線 / demo顧客名置換 | `grep -rc '@gmail.com'` → 0 / `grep -rc '塩田' src/` → 0 / `grep -c 'saltydog-report-worker' worker/wrangler.toml` → **1（変えない）** |
| **M9** ルール改訂と移設元の凍結 | AGENTS.md / design.md / failures.md(8件) / handoff.md、移設元を EXIT 1 化、push | `grep -c 'Next.js\|Prisma\|Tailwind\|Vitest' AGENTS.md docs/design.md` → 0 / `grep -c '^### \[F-2026' docs/failures.md` → 8 / 移設元 `npm run build` → EXIT 1 |

**M6 を M5 の直後に置くのが要。** 依存を固定した直後に「本当に動くか」を実物で確認する。ここで動かなければ以降へ進まない。前版はこの工程が無く、それが「動かないものを納品する計画」になった原因だった。

---

## 動作の受入基準（M6・実物で確認する）

`npm run preview` 起動後、ブラウザで1画面ずつ確認する。

| # | 操作 | 期待 |
|---|---|---|
| 1 | `/` を開く | ログイン画面が出る |
| 2 | 検索画面へ進む | 飼い主・犬の一覧が出る（空でよい） |
| 3 | 飼い主と犬を新規登録 | `POST /api/owners` `POST /api/customers` が 200 |
| 4 | 肉球画面 | 中央パッドと指4本が表示される |
| 5 | カルテ画面で犬体図に描く | Konva のペン・色変更・undo が効く |
| 6 | 写真を1枚アップロード | `img[data-photo]` に反映される |
| 7 | カルテを保存 | `POST /api/reports` が 200 を返す |
| 8 | 公開 URL `/p/{slug}` を開く | 保存した内容が閲覧モードで再現される（描画は静止画） |
| 9 | ブラウザの console | エラー 0 件 |

**この9項目が通らなければ移設は完了していない。**

---

## ルール改訂

### AGENTS.md

Golden Stack を「**本リポジトリの確定スタック**」に差し替える。TypeScript を導入しない / フレームワークなし / Tailwind・shadcn を使わない / Konva 同梱（CDN 禁止）/ Cloudflare Workers / KV と Supabase の二系統 / `node --test`（Vitest でない）/ Linter なし。Zod のみ継承。

MECHANICAL CHECK の実体を明記する: `npm run build` / `check` / `test` の3本が EXIT 0 になるまで VERIFY へ進まない。

### LEVEL D（事故A〜Hを機械強制に落とす）

vibe-base の hook は持ち込まず、`failures.md` / npm script / `.gitignore` / `node --test` だけで再発を防ぐ。

| # | ルール | 由来 | 機械強制 |
|---|---|---|---|
| D-1 | `src/` が本番の実体。`design/` は意匠見本であり import 禁止 | 事故A/C | `design-isolation-guard.mjs` |
| D-2 | データストアは KV/Supabase 二系統。`finalize_report` の `null` 返却を必ず失敗として扱う | — | — |
| D-3 | 意図的に残した脆弱性がある（勝手に発見して騒がない・勝手に塞がない） | — | — |
| D-4 | 出所未確認の素材を外部公開物へ転載禁止 | — | `ASSET-PROVENANCE.md` |
| D-5 | 生成物は `npm run build` 経由でのみ作る（手コピー禁止） | 事故B | `npm run check` |
| D-6 | 既存ファイルを上書きする前に「今も生きているか」を確認する | **事故A** | 消える識別子の `grep -c` |
| D-7 | 自分で書いたルールを自分で守れると仮定しない | 事故D | `.gitignore` / npm EXIT 1 / test に落とす |
| D-8 | 失敗と未完了は `docs/failures.md` にしか書かない。commit hash だけで参照しない | 事故E/G/H | `Status: OPEN` 行 |
| D-9 | `data-*` の値に非 ASCII を使わない | 事故F | 不動点テスト |

### docs/failures.md

8件を転記。日付は事象の発生日。未解決は `Status: OPEN` で常駐。特に **XSS Critical（`ponchi-v2.html:1590` の `innerHTML` 連結）は V1 を戻すことで一緒に戻る**ので、`Status: OPEN` で登録し M6 の後に修正する。

### session-checkout の `git add -A`

そのまま残し、`.gitignore` に `dist.bak/` `docs/raw-materials/` `site/` `*.pdf` を足す。禁止規則は破られるが `.gitignore` は破れない（D-7 の適用）。

---

## リスク

| # | 内容 | 対策 |
|---|---|---|
| 1 | **V1 を戻すと XSS Critical も戻る**（`ponchi-v2.html:1590`） | `failures.md` に `Status: OPEN` で登録し、M6 の動作確認後に修正 |
| 2 | 移設元で `npm install` すると親の node_modules に解決されて「動いた」ように見える | 必ず vibe-base の外へ clone してから実行。M2 の受入条件で証明 |
| 3 | **顧客名の一括 sed が危険**。`saltydog-report-worker` を変えると別 Worker が作られ本番が2重化 | 置換対象を `src/*.html` の demo 文字列に限定。`worker/` `manifest.json` は対象外 |
| 4 | 顧客提供素材12件の権利が未確認。消すと画面が壊れる | 台帳に `UNVERIFIED` と正直に書いて残す。private は権利問題を解決しない |
| 5 | PWA が機能していない（`<link rel="manifest">` 0件） | M8 で再結線。dist ではパスが変わるので build に置換を1行足す |
| 6 | 移設後にどちらが正本か分からなくなる | M9 で移設元の npm script を EXIT 1 化 + バナー + `ARCHIVED.md`。**削除・リネームはしない** |
| 7 | `wrangler dev --remote` は本番 KV に届く | runbook に明記。`--remote` は使わない |

---

## やらないこと

1. **統合（P0〜P9）** — モック意匠への貼り替えは次工程。移設完了は「V1 が動く状態で揃っている」こと
2. **KV → Supabase のデータ移行** — 既存データは引き継がない（マスター確定）
3. **Supabase の有効化** — プロジェクト作成と Google OAuth 設定はマスター作業。済むまで KV モードで動かす
4. git 履歴の移設 / `docs/raw-materials/`(149MB) / `site/`(実住所・実氏名を含む別事業LP) / `docs/ui-proposal/`(重複)
5. `.claude/`(31) `.codex/`(23) `.serena/`(3) の vibe-base hook 群。`settings.json` の deny だけ新規作成
6. `worker/src/diagrams.js`(参照ゼロ) / `kv-data-store.js`(空スタブ) / `src/assets/` の孤児11件 / debug・measure 系テスト
7. スタック変更（TypeScript化・Next.js移行・Vitest化・Tailwind導入）
8. `worker/wrangler.toml` の `name` / KV `id` / `routes` の変更
9. 移設元ディレクトリの削除・リネーム・移動
10. `/api/*` への認証追加（D-3 の許容リスク）

---

## 受け入れ基準

| # | 条件 | 機械検証 | 合格値 |
|---|---|---|---|
| 1 | vibe-base の外にある | `realpath siota-1 \| grep -c vibe-base` | 0 |
| 2 | **V1 が `src/` に居る** | `wc -l src/design-samples/ponchi-v2.html` | **2128** |
| 3 | **描画エンジンが含まれる** | `grep -c 'function createDrawer' src/design-samples/ponchi-v2.html` | 1 |
| 4 | **アプリが結線されている** | `grep -c 'PonchiApp.boot()' src/design-samples/ponchi-v2.html` | 2 |
| 5 | 親リポ参照が消えた | `grep -c '\.\./\.\./' package.json` | 0 |
| 6 | ビルドと検査が自立 | `npm run build && npm run check` | EXIT 0 |
| 7 | テストが通る | `npm test` の pass 合計 | 61 |
| 8 | **実際に動く** | 上記「動作の受入基準」9項目 | 全項目 OK |
| 9 | モックが隔離されている | `grep -rc 'design/' src/ worker/ scripts/` | 0 |
| 10 | 巨大素材が入っていない | `du -sm .`（.git 除く） | 20 未満 |
| 11 | 個人情報が残っていない | `grep -rc '@gmail.com' docs/ src/ worker/` | 0 |
| 12 | 顧客名が残っていない | `grep -rc '塩田' src/` | 0 |
| 13 | worker 名が変わっていない | `grep -c 'saltydog-report-worker' worker/wrangler.toml` | 1 |
| 14 | 失敗記録が転記された | `grep -c '^### \[F-2026' docs/failures.md` | 8 |
| 15 | 旧スタック記述が消えた | `grep -c 'Next.js\|Prisma\|Tailwind\|Vitest' AGENTS.md docs/design.md` | 0 |
| 16 | 移設元が実行不能化された | 移設元で `npm run build` | EXIT 1 |
| 17 | 本番が無傷 | `curl -s https://trimmer-system.kouheikosehira.com/ \| grep -c 'PonchiApp.boot()'` | 1 以上 |
