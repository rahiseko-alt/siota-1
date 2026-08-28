# 毒見の結果（何も動いていない世界で `verify:*` を走らせた）

実行: `node scripts/poison-run.mjs`（Docker 不要）

- 赤になった（壊すと落ちることを確かめた）: **2件**
- **緑のまま残った（何も無くても通る）: 2件**

## 赤になった（`- <ファイル> :: <検査の名前>`）

- verify-stack.mjs :: マイグレーションと seed が当たっている（seed の犬 X を id で引ける）
- verify-stack.mjs :: 鍵なしでは読めない（RLS/ゲートウェイが効いている）

## 緑のまま残った（**壊れている**）

- verify-stack.mjs :: Supabase が起きている
- verify-stack.mjs :: seed のアカウントで実ログインできる
