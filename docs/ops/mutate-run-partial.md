# 1件ずつ壊した結果

**一部だけ（admin-link-wrong-destination）。全体の記録ではない。**

実行: `node scripts/mutate-run.mjs`（**本物の土台が要る**——CI で走らせる）

- 赤になった（その壊しを検出できた）: **3件**

## 赤になった（`- <検査の名前>` ← どの壊しで）

- 1. 管理者も、みんなと同じカルテ画面に着く   ← admin-link-wrong-destination / verify-admin.mjs
- 1b. 管理者には「管理」の入口が見えていて、指が届く   ← admin-link-wrong-destination / verify-admin.mjs
- 検査を最後まで実行できた   ← admin-link-wrong-destination / verify-admin.mjs
