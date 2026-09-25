# 1件ずつ壊した結果

**一部だけ（admin-invite-staff-menu-missing admin-invite-staff-broken-endpoint admin-invite-staff-no-warning）。全体の記録ではない。**

実行: `node scripts/mutate-run.mjs`（**本物の土台が要る**——CI で走らせる）

- 赤になった（その壊しを検出できた）: **8件**

## 赤になった（`- <検査の名前>` ← どの壊しで）

- 18b. スタッフ招待の画面で、招待される側の権限を発行前に伝えている   ← admin-invite-staff-no-warning / verify-admin.mjs
- 18c. 発行すると スタッフ招待URL が出る   ← admin-invite-staff-broken-endpoint / verify-admin.mjs
- 18d. QR が画像として出ている   ← admin-invite-staff-broken-endpoint / verify-admin.mjs
- 18e. 招待を消化すると、新しいアカウントがトリマーの作業画面に着く   ← admin-invite-staff-broken-endpoint / verify-admin.mjs
- 18f. その場で shop_memberships に有効な行が実際に作られている   ← admin-invite-staff-broken-endpoint / verify-admin.mjs
- 2. 管理画面に リピーター / 新規 / 削除 / 店舗設定 / スタッフ招待 が在る   ← admin-invite-staff-menu-missing / verify-admin.mjs
- 3f. 無い住所を開いても白い画面にならず、管理のトップが出る   ← admin-invite-staff-menu-missing / verify-admin.mjs
- 検査を最後まで実行できた   ← admin-invite-staff-menu-missing / verify-admin.mjs
