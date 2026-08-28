# 1件ずつ壊した結果

**一部だけ（empty-pet-name-wrong commit-button-out-of-dock）。全体の記録ではない。**

実行: `node scripts/mutate-run.mjs`（**本物の土台が要る**——CI で走らせる）

- 赤になった（その壊しを検出できた）: **2件**

## 赤になった（`- <検査の名前>` ← どの壊しで）

- 1. 犬の名前は出ている（ページ自体は開けている）   ← empty-pet-name-wrong / verify-empty-pet.mjs
- 9. 確定のボタンが在る（行き止まりでない）   ← commit-button-out-of-dock / verify-empty-pet.mjs
