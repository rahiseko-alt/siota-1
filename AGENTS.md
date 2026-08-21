# AGENTS.md

> **中心思想**
> **既にあるものを探し、必要な差分だけ作り、過去の失敗に該当するときだけ照合し、重要な変更だけ独立した目で疑い、最後は実際に動いた事実で証明する。**
> *(最小の工程で、十分な品質を得る)*

---

## 4層ルール構造 (Rule Hierarchy)

本リポジトリのルールは以下の4階層で構成される。上位レベルのルールは下位レベルに常に優先する。

```text
LEVEL A: NON-NEGOTIABLE RULES     (絶対遵守・省略不可)
LEVEL B: DEVELOPMENT PRINCIPLES    (開発思想・基本Harness)
LEVEL C: RISK-BASED WORKFLOW      (リスク別動的プロセス・Sub-Agent)
LEVEL D: REPOSITORY-SPECIFIC RULES (プロジェクト固有ルール)
```

---

# LEVEL A — NON-NEGOTIABLE RULES (絶対ルール)

リスクレベルや作業規模にかかわらず、いかなる場合も省略・妥協してはならない。

1. **秘密情報の保護**
   - APIキー、トークン、パスワード、秘密鍵、本番接続文字列、認証情報などのシークレットをコード内に生成・表示・コミット・受領しない。
2. **個人情報の保護**
   - 実在する個人情報、顧客データをサンプルやテストデータ、ログに使用しない。不必要に外部へ送信しない。
3. **権利・素材の保護**
   - 著作権不明なコード、画像、音源、ライブラリ、外部データを無断混入しない。
4. **品質検査の完全性**
   - テストを勝手に削除・弱体化させてCIを無理に通さない。
   - Lint、型チェック、静的解析を`// eslint-disable`や`# type: ignore`などで不当に握りつぶさない。
5. **不要コードの排除**
   - デバッグ用の一時コード、到達不能な死んだコード、不要なログ出力を残したまま完了としない。

---

# LEVEL B — DEVELOPMENT PRINCIPLES (開発原則)

すべての開発タスクにおける基本原則。

```text
1. Goalを確認する
2. repository内を先に探す (Search First)
3. Library / Framework / SDK / API / OSS / SaaS / 特化AIを探す (Reuse First)
4. ExistingとGoalの差分をGapとして定義する (Define the Gap)
5. Gapだけを実装する (Build Only the Gap)
6. 不要な抽象化をしない (No Unnecessary Abstraction)
7. 将来用途だけの実装をしない (No Speculative Implementation)
8. 変更範囲を必要最小限にする (Minimum Change)
9. 機械判定できるものは機械に任せる (Mechanical Check First)
10. 最後は実際に動いた事実で証明する (Runtime Evidence)
```

### デフォルト鉄板構成 (Default Golden Stack)
新規構築や技術選定に特段の指定がない場合は、以下の**鉄板構成**をデフォルトとする。

| レイヤー | デフォルト技術スタック (Golden Stack) |
|---|---|
| **言語・ランタイム** | TypeScript (Strict Mode) / Node.js LTS (v20+) |
| **フレームワーク** | Next.js (App Router) / React |
| **スタイリング・UI** | Tailwind CSS + shadcn/ui + Lucide Icons |
| **API / バックエンド** | Next.js Route Handlers / Fastify (Python時は FastAPI) |
| **DB & ORM** | PostgreSQL (本番) / SQLite (PoC/ローカル), Drizzle ORM / Prisma |
| **バリデーション** | Zod (Schema-First Type Inference) |
| **テスト & 検証** | Vitest (Unit/Integration) + Playwright (E2E / Runtime Evidence) |
| **Linter / Formatter**| Biome (または ESLint + Prettier) |
| **CI / CD** | GitHub Actions |

### 標準開発Harness (Default Harness)

通常開発の基本フローは以下のみとする。ReviewやFailure Matchは条件付きでのみ追加する。

```text
EXPLORE  -->  BUILD  -->  VERIFY
```

---

# LEVEL C — RISK-BASED WORKFLOW (リスク別ワークフロー)

変更の影響度（Risk Level）およびトリガー条件に応じて、適切な安全装置を動的に適用する。

## 1. リスクレベル判定 (Risk Levels)

| Level | 種別 | 対象例 | 適用フロー |
|---|---|---|---|
| **Level 0** | **TRIVIAL** | typo, コピー修正, CSS微調整, 単純rename, コメント修正, 1行バグ修正 | `BUILD` → `VERIFY` (EXPLORE省略可) |
| **Level 1** | **NORMAL** | 単一API, 小機能, 局所バグ修正, 既存コンポーネントの軽微拡張 | `EXPLORE` → `BUILD` → `MECHANICAL CHECK` → `VERIFY` |
| **Level 2** | **IMPORTANT** | 新機能追加, 複数ファイル変更, State管理, DB設計/クエリ, 外部API連携, 既存仕様変更, 重要ビジネスロジック | `EXPLORE` → `FAILURE MATCH` → `BUILD` → `MECHANICAL CHECK` → `INDEPENDENT CRITIC` → `WRITER FIX` → `VERIFY` |
| **Level 3** | **CRITICAL** | Auth/認可, 決済/課金, DBマイグレーション, セキュリティ基盤, データ削除, 秘密情報/クレデンシャル | `EXPLORE` → `FAILURE MATCH` → `BUILD` → `MECHANICAL CHECK` → `INDEPENDENT CRITIC` → `WRITER FIX` → `AUTOMATED TEST` → `RUNTIME VERIFY` → `INDEPENDENT VERIFIER` |

---

## 2. 各ステップの詳細仕様

### STEP 1: EXPLORE (探索と差分定義)
- **目的**: 何を作るべきかではなく、**何だけを作ればよいか (GAP)** を特定する。
- **出力形式** (巨大なDiscovery Reportは作らない。原則この3点のみ):
  ```text
  GOAL:     [今回何を実現するか]
  EXISTING: [リポジトリ内・外部OSS等で既に存在・利用可能なもの]
  GAP:      [今回新しく実装・変更する最小差分]
  ```
- **省略条件**: 変更内容を1文で説明でき、既存設計を変更しない場合（Level 0）はEXPLOREを省略可能。

---

### STEP 2: FAILURE MATCH (過去失敗照合)
- **目的**: `docs/failures.md` と照合し、過去の失敗の再発を未然に防ぐ。
- **トリガー条件** (以下のいずれかに該当する場合のみ実行):
  1. **Level 2 / Level 3** の変更
  2. **既知リスク領域 (Known-Risk Area)** の変更:
     `AGENTS.md`, `.claude/`, `.github/`, CI/CD, Git/ブランチ運用, PR/マージ, セットアップ, デプロイ, シークレット管理, テスト基盤
  3. **同一失敗の2回発生 (Repeated Failure)**:
     コマンド失敗、CI失敗、デプロイ失敗、プッシュ/マージ失敗、同一バグ修正の繰り返し、ユーザーからの2回以上の同種指摘
- **担当**: 独立軽量Sub-Agent `failure-matcher`
- **入力**: `GOAL`, `GAP`, `TOUCH` (触るファイル/サブシステム), `PLAN` (予定変更方針) のみ。全文は渡さない。
- **出力**: 最大3件 (`Failure`, `Why relevant`, `Guardrail`) または `NO RELEVANT FAILURE` のみ。

---

### STEP 3: BUILD & MECHANICAL CHECK (最小実装と機械検査)
- **BUILD原則**:
  - Reuse first / Minimum change / Existing pattern first
  - 禁止: 不要なFramework/wrapper、既存helperの再発明、将来用機能、不要な依存追加、全面rewrite、無関係なrefactor
  - 目標: 「最も美しい設計」ではなく「現在のGoalを満たす最小の整合した変更」
- **MECHANICAL CHECK**:
  - Lint, Typecheck, Unit Test, Integration Test, Build, Static Analysis, Smoke, E2E
  - 機械判定できるものは先にすべて自動実行する。LLM Reviewerに機械判定を任せない。

---

### STEP 4: INDEPENDENT CRITIC (独立レビュー)
- **目的**: 作成者 (Writer) が気付かなかった重大問題を発見する。
- **トリガー**: Level 2 / Level 3 の変更時
- **担当**: 独立した目線を持つ `independent-critic` (フレッシュコンテキスト)
- **確認項目 (3点のみ)**:
  1. `WRONG GOAL`: 本来の要求・UXを外していないか、必要なフローが抜けていないか、別の問題を解いていないか
  2. `WRONG APPROACH`: 既存解/OSSの車輪の再発明、不適切な技術選択、過剰実装・不要な抽象化がないか
  3. `REAL BUG`: Regression, データ損失, 状態不整合, Race Condition, 権限漏れ, Security, クラッシュ
- **制約**: Critic自身はコードを書かない。リファクタリングを要求しない。代案実装を書かない。
- **Writerの後処理**: 指摘を「採用」「却下」「追加調査」に分類し、採用する場合のみ最小修正する（全面書き直しは禁止）。

---

### STEP 5: REAL VERIFICATION (外部事実による実証)
- **原則**: 自己申告の推論ではなく、外部事実 (Runtime Evidence) で完了を証明する。
- **証拠の強さ**:
  `AI Reasoning < Code Review < Automated Test < Runtime Evidence`
- **対象別検証方法**:
  - **UI / Web**: 実ブラウザ / Playwright等での実操作と表示結果
  - **API**: 実際のHTTPリクエスト/レスポンスとDB状態
  - **Database**: マイグレーション実行、読み書き、ロールバック、互換性
  - **Auth / 権限**: 許可される正常系と**拒否されるべき異常系**の双方案件
  - **File / Batch**: 実ファイルの入出力処理と生成された成果物の内容検証
- **INDEPENDENT VERIFIER**:
  - Level 3 または重要な公開・完了判定時に稼働。完了報告のコマンド・検証手順を再実行し、外部事実を確認する。

---

## 3. セットアップの2段階運用 (Setup Modes)

| モード | 対象 | 最低要件 |
|---|---|---|
| **FAST** (基本) | Prototype, PoC, UI確認, 実験, 内部利用, 短期検証 | 起動可能, Lint, 最低限テスト, Git管理, README |
| **STRICT** | Production, 公開サービス, Auth, 決済, 個人データ, DB migration | FAST要件 ＋ CI, Branch Protection, Smoke/E2E, 独立検証, セキュリティ検査 |

- 判定: `auth`, `payment`, `personal data`, `public release`, `production DB`, `migration` を含む場合は自動で STRICT、それ以外は FAST を基本とする。

---

## 4. セッションの In / Out 規約

### セッション開始 (In)
1. `docs/handoff.md` を読む。
2. 必要に応じて `docs/design.md` を読む。
3. `docs/failures.md` 全文は**読まない**（必要なときだけ Failure Matcher が参照）。

### セッション終了 (Out)
1. `docs/handoff.md` を更新する（今回やったこと、現在の状態、次回やること）。
2. 失敗が発生・解決した場合は `docs/failures.md` に追記する (append-only)。
3. コミット & プッシュ（PR / マージは指示がある場合のみ）。

---

# LEVEL D — REPOSITORY-SPECIFIC RULES (プロジェクト固有ルール)

本プロジェクト固有の制約・要件をここに追記する。

### ルール昇格原則 (Promotion Rule)
- 失敗が1件起きただけで安易にGlobal Rule（AGENTS.md）へ追加してはならない。
- 失敗はまず `docs/failures.md` に記録し、Failure Matcherで再利用する。
- **「複数回発生した」「重大事故に直結する」「機械判定可能」「汎用性が高い」** 条件を満たすもののみ、このセクションまたは上位レベルへ昇格する。

### [プロジェクト固有ルール一覧]
*(プロジェクトの要件に応じてここに必要なルールを最小限追記する)*
- 例: owner_idのないクエリの禁止
- 例: マイグレーションでの既存カラムの不可逆削除禁止
- 例: 外部LLM APIへの生顧客データの直接送信禁止
