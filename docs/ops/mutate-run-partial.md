# 1件ずつ壊した結果

**一部だけ（revise-photo-upload-still-draft-only）。全体の記録ではない。**

実行: `node scripts/mutate-run.mjs revise-photo-upload-still-draft-only`
（この作業コンテナは Docker あり・本物の土台で実測できた）

- 赤になった（その壊しを検出できた）: **1件**（`検査を最後まで実行できた`）

## 赤になった（`- <検査の名前>` ← どの壊しで）

- 検査を最後まで実行できた   ← revise-photo-upload-still-draft-only / verify-photo-roundtrip.mjs
  （`page.waitForURL: Timeout 60000ms exceeded` — 12d. まで緑のあと、耳の写真の
  貼り替え保存が `カルテを保存できませんでした／画像を保存できませんでした` で失敗し、
  確定後の画面へ遷移しないまま60秒でタイムアウトした。12e./12f. 相当の赤。）

## ⚠️ 見ておくこと

- **`node scripts/mutate-run.mjs <id>` を機械的に流した最初の1回は「0件」の誤りを出した。**
  原因は検査そのものではなく、この壊し方が `sql: true` のため内部で `npx supabase db reset`
  を呼ぶ手順にある——`db reset` 直後は Kong が古い upstream を掴んだままで
  `/auth/v1/health` が 502 を返すことがあり（`scripts/lib/local-stack.mjs` の既知の注意）、
  `verify-photo-roundtrip.mjs` の `startLocalWorker()` が **try の外側**で
  `ensureLocalSupabaseRunning()` を呼んでいるため、そこで投げた例外は `check()` を
  一度も通らず、`FAIL` 行そのものが出ない（`mutate-run.mjs` の `failedNames()` は
  `FAIL` 行を正規表現で拾うだけなので、この形の異常終了を「赤 0件」と誤読する）。
  **`mutate-run.mjs` 自体の欠陥ではなく、db reset 後の待ち時間が足りないことが原因。**
  手で `docker restart supabase_kong_trimmer-system` を挟んで `/auth/v1/health` が
  200 になるのを待ってから同じコマンドを再実行したところ、上の1件で正しく赤になった。
  次にこの壊し方を CI や別セッションで走らせる人は、同じ待ちを入れること
  （`mutate-run.mjs` 側に恒久対応を入れるかは範囲外・別途検討）。
