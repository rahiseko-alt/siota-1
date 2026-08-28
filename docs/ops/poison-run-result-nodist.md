# 毒見の結果（毒「nodist」の世界で `verify:*` を走らせた）


実行: `node scripts/poison-run.mjs --flavor=nodist`（Docker 不要）

- 赤になった（壊すと落ちることを確かめた）: **26件**
- **緑のまま残った（何も無くても通る）: 2件**

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
- verify-m6.mjs :: ①. URL を開ける
- verify-m6.mjs :: ②a. 未ログインならログインの画面に導かれる
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

- verify-stack.mjs :: Supabase が起きている
- verify-stack.mjs :: seed のアカウントで実ログインできる
