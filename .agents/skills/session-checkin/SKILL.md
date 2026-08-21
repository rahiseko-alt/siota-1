---
name: session-checkin
description: >-
  Use this skill at the beginning of a working session or when starting a new task.
  Performs the In-check protocol: reads docs/handoff.md, checks git status, determines
  the goal, and prevents reading unnecessary context (like failures.md).
---

# Session Check-in Skill (セッション開始プロトコル)

セッション開始時 (`In`) に実行する標準チェックイン手順。

## 手順 (Workflow)

1. **セッション引き継ぎの確認 (Read Handoff)**:
   - [`docs/handoff.md`](../../docs/handoff.md) を読み込み、前回セッションの「現在の状態」と「次回やること」を把握する。

2. **恒久設計の確認 (Optional Design Check)**:
   - 必要に応じて [`docs/design.md`](../../docs/design.md) を確認し、製品定義・アーキテクチャ・確定事実を把握する。

3. **コンテキスト節約ルール (Context Protection)**:
   - ⚠️ `docs/failures.md` 全文を**読み込んではいけない**（コンテキスト汚染防止）。
   - 過去失敗の照合は、EXPLORE完了後に `failure-matcher` スキル/サブエージェントが必要時のみ行う。

4. **リポジトリ状態の確認 (Git Status Check)**:
   - `git status` および `git branch` を確認し、クリーンな状態または現在の作業ブランチを特定する。

5. **Goal・Gapの確認 (Explore)**:
   - ユーザー要求の Goal、Existing、Gap を特定し、作業を開始する。
