# 1件ずつ壊した結果

**一部だけ（edit-dog-list-empty edit-dummy-dogs-leak）。全体の記録ではない。**

実行: `node scripts/mutate-run.mjs`（**本物の土台が要る**——CI で走らせる）

- 赤になった（その壊しを検出できた）: **7件**

## 赤になった（`- <検査の名前>` ← どの壊しで）

- 10. 持っていない項目（犬種・担当）が空で出ている   ← edit-dummy-dogs-leak / verify-edit.mjs
- 11. 件数が実データと合っている   ← edit-dummy-dogs-leak / verify-edit.mjs
- ②b. ログインすると作業画面に入れる   ← edit-dog-list-empty / verify-m6.mjs
- ③. 名前で犬を選べる   ← edit-dog-list-empty / verify-m6.mjs
- 8. ②一覧が実データの犬になっている   ← edit-dummy-dogs-leak / verify-edit.mjs
- 9. 仮データ（window.DUMMY）の犬が出ていない   ← edit-dummy-dogs-leak / verify-edit.mjs
- 検査を最後まで実行できた   ← edit-dog-list-empty / verify-m6.mjs
