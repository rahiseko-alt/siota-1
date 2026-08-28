# 1件ずつ壊した結果

**一部だけ（pet-purge-broken）。全体の記録ではない。**

実行: `node scripts/mutate-run.mjs`（**本物の土台が要る**——CI で走らせる）

- 赤になった（その壊しを検出できた）: **1件**

## 赤になった（`- <検査の名前>` ← どの壊しで）

- 18. 消した犬の写真が Storage に残っていない   ← pet-purge-broken / verify-admin.mjs
