---
name: session-checkout
description: >-
  Use this skill at the end of a working session or when completing a task.
  Performs the Out-check protocol: writes progress back to the master plan
  (docs/ops/roadmap.md and the "いまやる番" line in docs/ops/plan.md), updates
  docs/handoff.md, records failures to docs/failures.md if any occurred, and
  commits/pushes changes.
---

# Session Check-out Skill (セッション終了プロトコル)

作業完了時またはセッション終了時 (`Out`) に実行する標準チェックアウト手順。

## 手順 (Workflow)

1. **機械検査・ランタイム検証の完了確認**:
   - 変更内容に応じたテスト・Lint・実環境確認 (Runtime Evidence) が完了していることを確認する。

2. **大計画の進捗を書く (Update the master plan)** ⚠️ **読むだけで終わらせない**:
   - [`docs/ops/roadmap.md`](../../docs/ops/roadmap.md) の「フェーズごとの宿題」の表と
     「納品準備でやること」を、**いまの実態**に直す。
     現在地より前は `✅`、現在地は `▶`、まだの段は `⬜`。
   - **方向性は変えない。進捗だけ**（マスター指示 2026-09-06）。
   - `docs/ops/plan.md` の「**いまやる番**」も次の項目に書き換える。
   - `node scripts/guard/checkout.mjs` の**項目7と項目8**が、この2つを機械で見る。
     地図が現在地について嘘をついていると**赤で止まる**
     （2026-09-06 に実際に古くなっていた・`D-20260906-72`）。

3. **Handoff の更新 (Update Handoff)**:
   - [`docs/handoff.md`](../../docs/handoff.md) を更新する。
     - **今回やったこと**: 完了したタスク・変更点
     - **現在の状態**: 動作状態、未解決事項
     - **次回やること**: 次セッションでのタスク

4. **失敗事例の記録 (Append Failures if applicable)**:
   - 作業中にエラー、コマンド失敗、バグ、誤ったアプローチなどの失敗が発生し解決した場合は、[`docs/failures.md`](../../docs/failures.md) の末尾に追記する (Append-Only)。

5. **Git コミット & プッシュ (Commit & Push)**:
   - 不要ファイルやシークレットが混入していないか `git status` で確認する。
   - `git add -A`
   - `git commit -m "..."`
   - `git push origin <branch>`
   - *(注意: PR作成やマージはユーザーからの明示的な指示がある場合のみ行う)*
