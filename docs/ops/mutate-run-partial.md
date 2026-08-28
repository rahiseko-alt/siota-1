# 1件ずつ壊した結果

**一部だけ（admin-pet-delete-not-persisted）。全体の記録ではない。**

実行: `node scripts/mutate-run.mjs`（**本物の土台が要る**——CI で走らせる）

- 赤になった（その壊しを検出できた）: **1件**

## 赤になった（`- <検査の名前>` ← どの壊しで）

- 16. ペットが実際に消えた   ← admin-pet-delete-not-persisted / verify-admin.mjs
