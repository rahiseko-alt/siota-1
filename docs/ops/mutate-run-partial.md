# 1件ずつ壊した結果

**一部だけ（edit-dummy-dogs-leak edit-breed-mock-refill empty-photo-attr-page-url letter-section-always-shown）。全体の記録ではない。**

実行: `node scripts/mutate-run.mjs`（**本物の土台が要る**——CI で走らせる）

- 赤になった（その壊しを検出できた）: **8件**

## 赤になった（`- <検査の名前>` ← どの壊しで）

- 10. 持っていない項目（犬種・担当）が空で出ている   ← edit-dummy-dogs-leak / verify-edit.mjs
- 10. 飼い主: 壊れた画像（ページURL を指す img）が無い   ← empty-photo-attr-page-url / verify-photo-roundtrip.mjs
- 11. 件数が実データと合っている   ← edit-dummy-dogs-leak / verify-edit.mjs
- 15. 空の写真スロットがページURLを指していない   ← empty-photo-attr-page-url / verify-edit.mjs
- 16. 担当メッセージが無いカルテで、文例が出ていない   ← letter-section-always-shown / verify-edit.mjs
- 16. 飼い主: 壊れた画像（ページURL）が出ていない   ← empty-photo-attr-page-url / verify-report-roundtrip.mjs
- 8. ②一覧が実データの犬になっている   ← edit-dummy-dogs-leak / verify-edit.mjs
- 9. 仮データ（window.DUMMY）の犬が出ていない   ← edit-dummy-dogs-leak / verify-edit.mjs
