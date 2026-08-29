# 1件ずつ壊した結果

**一部だけ（admin-menu-title-lost）。全体の記録ではない。**

実行: `node scripts/mutate-run.mjs`（**本物の土台が要る**——CI で走らせる）

- 赤になった（その壊しを検出できた）: **4件**

## 赤になった（`- <検査の名前>` ← どの壊しで）

- 13. 削除に 顧客 / ペット / カルテ の3つが在る   ← admin-menu-title-lost / verify-admin.mjs
- 2. 管理者ページに リピーター / 新規 / 削除 / 店舗設定 が在る   ← admin-menu-title-lost / verify-admin.mjs
- 3. リピーターに カルテ作成 / カルテ修正 が在る   ← admin-menu-title-lost / verify-admin.mjs
- 4. 新規に 顧客アカウント作成 / ペットアカウント作成 が在る   ← admin-menu-title-lost / verify-admin.mjs
