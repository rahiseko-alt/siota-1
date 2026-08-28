# 毒見の結果（何も動いていない世界で `verify:*` を走らせた）


実行: `node scripts/poison-run.mjs --flavor=noauth`（Docker 不要）

- 赤になった（壊すと落ちることを確かめた）: **16件**
- **緑のまま残った（何も無くても通る）: 15件**

## 赤になった（`- <ファイル> :: <検査の名前>`）

- verify-admin.mjs :: 検査を最後まで実行できた
- verify-delete.mjs :: 検査を最後まで実行できた
- verify-draft.mjs :: 検査を最後まで実行できた
- verify-edit.mjs :: 検査を最後まで実行できた
- verify-empty-pet.mjs :: 検査を最後まで実行できた
- verify-invitation.mjs :: 検査を最後まで実行できた
- verify-m6.mjs :: 検査を最後まで実行できた
- verify-photo-roundtrip.mjs :: 検査を最後まで実行できた
- verify-portal.mjs :: 検査を最後まで実行できた
- verify-report-roundtrip.mjs :: 検査を最後まで実行できた
- verify-screens.mjs :: 検査を最後まで実行できた
- verify-stack.mjs :: seed のアカウントで実ログインできる
- verify-stack.mjs :: seed のアカウントで実ログインできる
- verify-stack.mjs :: マイグレーションと seed が当たっている（seed の犬 X を id で引ける）
- verify-stack.mjs :: 鍵なしでは読めない（RLS/ゲートウェイが効いている）
- verify-xss.mjs :: 検査を最後まで実行できた

## 緑のまま残った（**壊れている**）

- verify-portal.mjs :: 1. /my が配信される
- verify-portal.mjs :: 2. 起動分岐が立っている
- verify-portal.mjs :: 3. Supabase vendor が読めている
- verify-portal.mjs :: 4. ポータルが起動している
- verify-portal.mjs :: 5. 未ログインでログイン導線が出る
- verify-portal.mjs :: 6. ログインボタンが押せる
- verify-portal.mjs :: 7. 未ログインで中身とログアウトは隠れている
- verify-portal.mjs :: 8. 見本画像を出していない
- verify-portal.mjs :: 9. 犬を直接指す URL でもログイン導線が出る
- verify-portal.mjs :: 10. アプリ由来のコンソールエラーが無い（ログイン前）
- verify-screens.mjs :: 1. `/` が配信される
- verify-screens.mjs :: 2. `/` に4画面が乗っている
- verify-screens.mjs :: 3. `/` に段のタブが4つ在る
- verify-screens.mjs :: 4. `/` はログイン画面から始まる
- verify-stack.mjs :: Supabase が起きている
