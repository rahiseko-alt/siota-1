# 1件ずつ壊した結果 — 管理者だけがスタッフを止める（#76）・2026-11-20

> マスターの Windows PC の本物のローカル Supabase で実測。壊し方4つを1つずつ当てて verify-admin.mjs を走らせ、戻したあとは 70/70。

## 赤になった（`- <検査の名前>` ← どの壊しで）

- 23c. 「利用を止める」は確認の画面でもう1回押すと効き、一覧で「停止中」・「再開する」に変わる   ← member-stop-ignored / verify-admin.mjs
- 23d. 止めた人の鍵では /api/pets が断られるか店の犬が1件も返らず、お店の人として扱われない   ← member-stop-ignored / verify-admin.mjs
- 23e. 「再開する」を押すと「利用中」に戻り、その人の鍵で店の犬が再び取れる   ← member-stop-ignored / verify-admin.mjs
- 23f. 管理者が API で自分を止めようとしても断られ、管理者のまま使える   ← member-self-stop-allowed / verify-admin.mjs
- 23g. スタッフには ⑥ スタッフ管理 が出ず、/admin/staff を開くと「管理者だけ」の案内ともどるだけが出る   ← staff-manage-visible-to-staff / verify-admin.mjs
- 23h. スタッフの GET /api/staff と、管理者を止める POST は断られ、管理者は止まっていない   ← member-self-stop-allowed / verify-admin.mjs

## ⚠️ 見ておくこと

- [member-active-anyone] 壊したあと db reset が通らない:                                                                                       ^                     Try rerunning the command with --debug to troubleshoot the error. 

### 追加（member-active-anyone・本文の囲みを $fn$ に直して再実行）
## 赤になった（`- <検査の名前>` ← どの壊しで）

- 23f. 管理者が API で自分を止めようとしても断られ、管理者のまま使える   ← member-active-anyone / verify-admin.mjs
- 23h. スタッフの GET /api/staff と、管理者を止める POST は断られ、管理者は止まっていない   ← member-active-anyone / verify-admin.mjs
