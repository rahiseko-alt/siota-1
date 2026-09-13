# 1件ずつ壊した結果

**一部だけ（revise-photos-from-hydrated revise-photo-add-not-locked）。全体の記録ではない。**

実行: `node scripts/mutate-run.mjs`（**本物の土台が要る**——CI で走らせる）

- 赤になった（その壊しを検出できた）: **3件**

## 赤になった（`- <検査の名前>` ← どの壊しで）

- 12b. 直したあとの写真が、保存された実体を指している（一時的な住所になっていない）   ← revise-photos-from-hydrated / verify-photo-roundtrip.mjs
- 12c. 直したあとも、飼い主の画面で写真が実際に出る   ← revise-photos-from-hydrated / verify-photo-roundtrip.mjs
- 12d. 直しの画面では、写真を足す入口が閉じている   ← revise-photo-add-not-locked / verify-photo-roundtrip.mjs
