# 1件ずつ壊した結果

**一部だけ（screen-stale-panels-stay-active settext-off）。全体の記録ではない。**

実行: `node scripts/mutate-run.mjs`（**本物の土台が要る**——CI で走らせる）

- 赤になった（その壊しを検出できた）: **19件**

## 赤になった（`- <検査の名前>` ← どの壊しで）

- ★. 間違えても1タッチで一覧へ戻れる   ← screen-stale-panels-stay-active / verify-m6.mjs
- 10. 飼い主: 担当からの一言   ← settext-off / verify-report-roundtrip.mjs
- 11. 件数が実データと合っている   ← screen-stale-panels-stay-active / verify-edit.mjs
- 11. 飼い主: 爪   ← settext-off / verify-report-roundtrip.mjs
- 12. 一覧の画面（screen-2）が開いている   ← screen-stale-panels-stay-active / verify-edit.mjs
- 12. 飼い主: 耳   ← settext-off / verify-report-roundtrip.mjs
- 13. ⑤確認の画面（screen-4）が開いている   ← screen-stale-panels-stay-active / verify-edit.mjs
- 13. 飼い主: 歯   ← settext-off / verify-report-roundtrip.mjs
- 14. 飼い主: 体重   ← settext-off / verify-report-roundtrip.mjs
- 3. 確認: 担当からの一言   ← settext-off / verify-report-roundtrip.mjs
- 4. 確認: 爪   ← settext-off / verify-report-roundtrip.mjs
- 5. 確認: 耳   ← settext-off / verify-report-roundtrip.mjs
- ⑤b. 確定した中身に、書いた一言が入っている   ← settext-off / verify-m6.mjs
- 6. 確認: 歯   ← settext-off / verify-report-roundtrip.mjs
- ⑥b. 飼い主はカルテを開ける   ← settext-off / verify-m6.mjs
- 7. 確認: 体重   ← settext-off / verify-report-roundtrip.mjs
- 8. ②一覧が実データの犬になっている   ← screen-stale-panels-stay-active / verify-edit.mjs
- 8. トリマーは1件目を作る画面に入れる   ← screen-stale-panels-stay-active / verify-empty-pet.mjs
- 9. 飼い主: 犬の名前   ← settext-off / verify-report-roundtrip.mjs
