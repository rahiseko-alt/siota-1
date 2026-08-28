# 毒見の結果（毒「empty」の世界で `verify:*` を走らせた）


実行: `node scripts/poison-run.mjs --flavor=empty`（Docker 不要）

- 赤になった（壊すと落ちることを確かめた）: **25件**
- **緑のまま残った（何も無くても通る）: 18件**

## 赤になった（`- <ファイル> :: <検査の名前>`）

- verify-admin.mjs :: 検査を最後まで実行できた
- verify-delete.mjs :: 検査を最後まで実行できた
- verify-draft.mjs :: 0. 検査用の犬を登録できた
- verify-draft.mjs :: 検査を最後まで実行できた
- verify-edit.mjs :: 検査を最後まで実行できた
- verify-empty-pet.mjs :: 0. カルテ0件の犬を用意できた
- verify-empty-pet.mjs :: 検査を最後まで実行できた
- verify-invitation.mjs :: 0. 新しい飼い主を登録できた
- verify-invitation.mjs :: 検査を最後まで実行できた
- verify-m6.mjs :: 検査を最後まで実行できた
- verify-photo-roundtrip.mjs :: 検査を最後まで実行できた
- verify-portal.mjs :: 検査を最後まで実行できた
- verify-report-roundtrip.mjs :: 0. 検査用の犬を登録できた
- verify-report-roundtrip.mjs :: 検査を最後まで実行できた
- verify-screens.mjs :: 検査を最後まで実行できた
- verify-stack.mjs :: マイグレーションと seed が当たっている（seed の犬 X を id で引ける）
- verify-stack.mjs :: 鍵なしでは読めない（RLS/ゲートウェイが効いている）
- verify-xss.mjs :: 犬の名前（見出しへ入る）
- verify-xss.mjs :: staffNote（担当からの一言）
- verify-xss.mjs :: skin[].loc（皮膚の部位）
- verify-xss.mjs :: ear.comment（耳のコメント）
- verify-xss.mjs :: nail.comment（爪のコメント）
- verify-xss.mjs :: teeth.status（歯の状態）
- verify-xss.mjs :: teeth.comment（歯のコメント）
- verify-xss.mjs :: weights[].ym（体重グラフのラベル）

## 緑のまま残った（**壊れている**）

- verify-m6.mjs :: ①. URL を開ける
- verify-m6.mjs :: ②a. 未ログインならログインの画面に導かれる
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
- verify-stack.mjs :: seed のアカウントで実ログインできる
