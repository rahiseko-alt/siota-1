# 1件ずつ壊した結果 — 犬種（`N-48`）と管理者／スタッフ（`N-49`）・2026-11-19

> マスターの Windows PC の本物のローカル Supabase（Docker）で実測。`npx supabase db reset` のあと、
> 10個の壊し方を1つずつ当てて `verify-admin.mjs` を走らせ、**戻したあとは 62/62 に復した**（同じ版で2回・2026-11-19）。
> スクリプトの既定の記録先（`mutate-run-partial.md`）は 2026-09-24 の証拠を指しているので、上書きせずこちらに分けた。

**一部だけ（pet-breed-not-sent pet-breed-not-in-row pet-breed-edit-ignored pet-breed-no-candidates session-role-dropped shops-admin-update-rls-open owner-pet-admin-delete-rls-open report-delete-admin-open pet-deactivate-admin-open staff-invitation-admin-open）。全体の記録ではない。**

実行: `node scripts/mutate-run.mjs`（**本物の土台が要る**——CI で走らせる）

- 赤になった（その壊しを検出できた）: **21件**

## 赤になった（`- <検査の名前>` ← どの壊しで）

- 22b. スタッフの管理画面には リピーター / 新規 の2つだけが出る（削除・店舗設定・スタッフ招待が無い）   ← session-role-dropped / verify-admin.mjs
- 22d. スタッフも新規で犬を作れて、打った犬種がそのまま保存される   ← pet-breed-not-sent / verify-admin.mjs
- 22e. スタッフも「犬の情報を直す」で犬種を変えられる（サーバーの値が変わった）   ← pet-breed-edit-ignored / verify-admin.mjs
- 22f-1. スタッフが /admin/delete を開くと「管理者だけ」の案内ともどるだけが出て、操作の部品が無い   ← session-role-dropped / verify-admin.mjs
- 22f-2. スタッフが /admin/delete/owner を開くと「管理者だけ」の案内ともどるだけが出て、操作の部品が無い   ← session-role-dropped / verify-admin.mjs
- 22f-3. スタッフが /admin/delete/pet を開くと「管理者だけ」の案内ともどるだけが出て、操作の部品が無い   ← session-role-dropped / verify-admin.mjs
- 22f-4. スタッフが /admin/delete/report を開くと「管理者だけ」の案内ともどるだけが出て、操作の部品が無い   ← session-role-dropped / verify-admin.mjs
- 22f-5. スタッフが /admin/settings を開くと「管理者だけ」の案内ともどるだけが出て、操作の部品が無い   ← session-role-dropped / verify-admin.mjs
- 22f-6. スタッフが /admin/invite-staff を開くと「管理者だけ」の案内ともどるだけが出て、操作の部品が無い   ← session-role-dropped / verify-admin.mjs
- 22g. スタッフのカルテ削除は断られ、カルテは消えず・削除中にもなっていない   ← report-delete-admin-open / verify-admin.mjs
- 22h. スタッフが犬を「使わない」にするのは断られ、犬は有効のまま（消す代わりの抜け道を塞ぐ）   ← pet-deactivate-admin-open / verify-admin.mjs
- 22i. スタッフの DELETE /api/pets は断られ、犬は消えていない   ← owner-pet-admin-delete-rls-open / verify-admin.mjs
- 22j. スタッフの DELETE /api/owners は断られ、顧客は消えていない   ← owner-pet-admin-delete-rls-open / verify-admin.mjs
- 22k. スタッフの PATCH /api/shop は断られ、既定の来店間隔は変わっていない   ← shops-admin-update-rls-open / verify-admin.mjs
- 22l. スタッフのスタッフ招待は断られ、招待は増えず・前の招待も取り消されていない   ← staff-invitation-admin-open / verify-admin.mjs
- 6a. 犬種の欄に、打つと出る候補が付いている   ← pet-breed-no-candidates / verify-admin.mjs
- 6b. 登録で手入力した犬種が、そのままの値で保存された   ← pet-breed-not-sent / verify-admin.mjs
- 6c. 犬種で打つと、その犬種の子だけが出て、行に飼い主名・犬名・犬種が並ぶ   ← pet-breed-not-sent / verify-admin.mjs
- 6e. 直す画面には、いまの犬種が入っている   ← pet-breed-not-sent / verify-admin.mjs
- 6f. 直した犬種がサーバーに入った   ← pet-breed-edit-ignored / verify-admin.mjs
- 6g. 空欄で保存すると犬種が消える（空文字ではなく「無し」）   ← pet-breed-edit-ignored / verify-admin.mjs
