---
name: failure-match
description: >-
  Use this skill to compare proposed changes against past failure logs in docs/failures.md.
  Triggers on Level 2/3 changes, known-risk area modifications, or repeated failures.
---

# Failure Match Skill

過去の失敗記録 (`docs/failures.md`) と予定している変更を照合し、事故の再発を防ぐスキル。

## 起動条件 (Triggers)
1. Level 2 (重要変更) / Level 3 (クリティカル変更)
2. 既知リスク領域 (`AGENTS.md`, `.claude/`, `.github/`, CI, Git, deploy, secret, setup)
3. 同種の失敗が2回発生した場合

## 手順
1. 作業の `GOAL`, `GAP`, `TOUCH`, `PLAN` を整理する。
2. `docs/failures.md` を検索・照合する（セッション全体は読み込まずキーワード/セクション単位で探索）。
3. 過去に直接関連する事例がある場合、最大3件の `Failure`, `Why relevant`, `Guardrail` を出力する。
4. 該当なしの場合は `NO RELEVANT FAILURE` とする。
