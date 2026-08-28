# 1件ずつ壊した結果

**一部だけ（portal-content-shown-logged-out portal-sample-image）。全体の記録ではない。**

実行: `node scripts/mutate-run.mjs`（**本物の土台が要る**——CI で走らせる）

- 赤になった（その壊しを検出できた）: **2件**

## 赤になった（`- <検査の名前>` ← どの壊しで）

- 7. 未ログインで中身とログアウトは隠れている   ← portal-content-shown-logged-out / verify-portal.mjs
- 8. 見本画像を出していない   ← portal-sample-image / verify-portal.mjs
