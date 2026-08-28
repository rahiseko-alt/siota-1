# 1件ずつ壊した結果

**一部だけ（screen-stale-panels-stay-active）。全体の記録ではない。**

実行: `node scripts/mutate-run.mjs`（**本物の土台が要る**——CI で走らせる）

- 赤になった（その壊しを検出できた）: **4件**

## 赤になった（`- <検査の名前>` ← どの壊しで）

- 11. 件数が実データと合っている   ← screen-stale-panels-stay-active / verify-edit.mjs
- 12. 一覧の画面（screen-2）が開いている   ← screen-stale-panels-stay-active / verify-edit.mjs
- 13. ⑤確認の画面（screen-4）が開いている   ← screen-stale-panels-stay-active / verify-edit.mjs
- 8. ②一覧が実データの犬になっている   ← screen-stale-panels-stay-active / verify-edit.mjs
