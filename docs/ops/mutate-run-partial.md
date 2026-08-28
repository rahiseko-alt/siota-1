# 1件ずつ壊した結果

**一部だけ（pet-create-wrong-status）。全体の記録ではない。**

実行: `node scripts/mutate-run.mjs`（**本物の土台が要る**——CI で走らせる）

- 赤になった（その壊しを検出できた）: **3件**

## 赤になった（`- <検査の名前>` ← どの壊しで）

- 0. 検査用の犬を登録できた   ← pet-create-wrong-status / verify-delete.mjs
- 1. その飼い主の犬を登録できた   ← pet-create-wrong-status / verify-invitation.mjs
- 検査を最後まで実行できた   ← pet-create-wrong-status / verify-delete.mjs
