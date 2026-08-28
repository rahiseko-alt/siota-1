# 1件ずつ壊した結果

**一部だけ（ear-right-input-missing）。全体の記録ではない。**

実行: `node scripts/mutate-run.mjs`（**本物の土台が要る**——CI で走らせる）

- 赤になった（その壊しを検出できた）: **2件**

## 赤になった（`- <検査の名前>` ← どの壊しで）

- 1. 記入先の要素がすべて実在する   ← ear-right-input-missing / verify-report-roundtrip.mjs
- 検査を最後まで実行できた   ← ear-right-input-missing / verify-report-roundtrip.mjs
