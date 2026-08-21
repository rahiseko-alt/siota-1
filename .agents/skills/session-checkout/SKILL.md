---
name: session-checkout
description: >-
  Use this skill at the end of a working session or when completing a task.
  Performs the Out-check protocol: updates docs/handoff.md, records failures to docs/failures.md
  if any occurred, and commits/pushes changes.
---

# Session Check-out Skill (セッション終了プロトコル)

作業完了時またはセッション終了時 (`Out`) に実行する標準チェックアウト手順。

## 手順 (Workflow)

1. **機械検査・ランタイム検証の完了確認**:
   - 変更内容に応じたテスト・Lint・実環境確認 (Runtime Evidence) が完了していることを確認する。

2. **Handoff の更新 (Update Handoff)**:
   - [`docs/handoff.md`](../../docs/handoff.md) を更新する。
     - **今回やったこと**: 完了したタスク・変更点
     - **現在の状態**: 動作状態、未解決事項
     - **次回やること**: 次セッションでのタスク

3. **失敗事例の記録 (Append Failures if applicable)**:
   - 作業中にエラー、コマンド失敗、バグ、誤ったアプローチなどの失敗が発生し解決した場合は、[`docs/failures.md`](../../docs/failures.md) の末尾に追記する (Append-Only)。

4. **Git コミット & プッシュ (Commit & Push)**:
   - 不要ファイルやシークレットが混入していないか `git status` で確認する。
   - `git add -A`
   - `git commit -m "..."`
   - `git push origin <branch>`
   - *(注意: PR作成やマージはユーザーからの明示的な指示がある場合のみ行う)*
