# 1件ずつ壊した結果

**一部だけ（weight-limit-off blank-commit-not-asked edit-broken-url-falls-out pet-page-no-way-back invitation-old-stays-valid admin-substep-no-history）。全体の記録ではない。**

実行: `node scripts/mutate-run.mjs`（**本物の土台が要る**——CI で走らせる）

- 赤になった（その壊しを検出できた）: **5件**

## 赤になった（`- <検査の名前>` ← どの壊しで）

- 13c. 犬のページから、愛犬の一覧へ戻る道が出ている   ← pet-page-no-way-back / verify-portal.mjs
- 21b. 桁違いの体重（9999kg）では確定できない   ← weight-limit-off / verify-report-roundtrip.mjs
- 21d. 体重が空のまま確定を押すと、そのことを言って訊いてくる   ← blank-commit-not-asked / verify-report-roundtrip.mjs
- 3g. カルテ一覧から戻ると、ちょうど1つ手前（犬を選ぶ）に戻る   ← admin-substep-no-history / verify-admin.mjs
- 検査を最後まで実行できた   ← invitation-old-stays-valid / verify-invitation.mjs
