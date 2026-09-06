---
name: session-checkin
description: >-
  Use this skill at the beginning of a working session or when starting a new task.
  Performs the In-check protocol: reads the master plan (docs/ops/roadmap.md) first,
  then docs/handoff.md, checks git status, determines the goal, and prevents reading
  unnecessary context (like failures.md).
---

# Session Check-in Skill (セッション開始プロトコル)

セッション開始時 (`In`) に実行する標準チェックイン手順。

## 手順 (Workflow)

1. **大計画の確認 (Read the master plan)** ⚠️ **最初にこれ**:
   - [`docs/ops/roadmap.md`](../../docs/ops/roadmap.md) を読み、**スタートからゴールまでの全体像**を把握する。
   - [`docs/ops/phase`](../../docs/ops/phase) の1行が**いまどこに居るか**。細目は [`docs/ops/plan.md`](../../docs/ops/plan.md)。
   - **`node scripts/guard/checkin.mjs` を実行する。** 大計画を画面に出し、このセッションが読んだ印を残す。
   - この印が無い（または別セッションの印）と **`npm run check` が赤で止まる**。
     指示を1つずつ処理するだけで全体計画を一度も見ない、という抜け方を塞ぐため
     （2026-09-06 に実際に起きた・`D-20260906-71`）。

2. **セッション引き継ぎの確認 (Read Handoff)**:
   - [`docs/handoff.md`](../../docs/handoff.md) を読み込み、前回セッションの「現在の状態」と「次回やること」を把握する。

3. **恒久設計の確認 (Optional Design Check)**:
   - 必要に応じて [`docs/design.md`](../../docs/design.md) を確認し、製品定義・アーキテクチャ・確定事実を把握する。

4. **コンテキスト節約ルール (Context Protection)**:
   - ⚠️ `docs/failures.md` 全文を**読み込んではいけない**（コンテキスト汚染防止）。
   - 過去失敗の照合は、EXPLORE完了後に `failure-matcher` スキル/サブエージェントが必要時のみ行う。

5. **リポジトリ状態の確認 (Git Status Check)**:
   - `git status` および `git branch` を確認し、クリーンな状態または現在の作業ブランチを特定する。

6. **Goal・Gapの確認 (Explore)**:
   - ユーザー要求の Goal、Existing、Gap を特定し、作業を開始する。
