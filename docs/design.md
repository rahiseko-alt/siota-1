# Product Design Document (docs/design.md)

恒久的な製品定義・設計ドキュメント。
揮発的な作業ログや一時メモはここに書かず、`docs/handoff.md` に書くこと。

---

## 1. 概要 (Overview)
- **対象ユーザー (Who)**: 
- **解決する課題 (What it solves)**: 
- **差別化要因 / コア価値 (Key differentiator)**: 

---

## 2. コア仕様 (Key Specifications)
- **アーキテクチャ概要**: モダンフルスタック構成 / SPA + Server Components
- **デフォルト鉄板構成 (Golden Stack)**:
  - **言語・ランタイム**: TypeScript (Strict Mode) / Node.js LTS (v20+)
  - **フレームワーク**: Next.js (App Router) / React
  - **スタイリング・UI**: Tailwind CSS + shadcn/ui + Lucide Icons
  - **API / バックエンド**: Next.js Route Handlers / Fastify (Python時は FastAPI)
  - **DB & ORM**: PostgreSQL (本番) / SQLite (PoC/ローカル), Drizzle ORM / Prisma
  - **バリデーション**: Zod
  - **テスト & 検証**: Vitest (Unit/Integration) + Playwright (E2E)
  - **Linter / Formatter**: Biome (または ESLint + Prettier)
  - **CI / CD**: GitHub Actions
- **データモデル / スキーマ方針**: 
- **主要エンドポイント / インターフェース**: 

---

## 3. 調査で確定した事実 (Established Facts & Decisions)
- *(探索フェーズで確定した技術的制約や決定事項を箇条書きで記載)*
