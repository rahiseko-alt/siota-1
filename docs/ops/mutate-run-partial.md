# 1件ずつ壊した結果

**一部だけ（skin-image-blank weight-prefilled-sample）。全体の記録ではない。**

実行: `node scripts/mutate-run.mjs`（**本物の土台が要る**——CI で走らせる）

- 赤になった（その壊しを検出できた）: **3件**

## 赤になった（`- <検査の名前>` ← どの壊しで）

- 15. 飼い主: 犬体図の印が画像として届く   ← skin-image-blank / verify-report-roundtrip.mjs
- 19. 体重の欄が空で始まる（見本値が入っていない）   ← weight-prefilled-sample / verify-report-roundtrip.mjs
- 8. 確認: 犬体図の印が画像として出ている   ← skin-image-blank / verify-report-roundtrip.mjs
