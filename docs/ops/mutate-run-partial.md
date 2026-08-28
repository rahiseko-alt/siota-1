# 1件ずつ壊した結果

**一部だけ（rls-any-owner-sees-any-dog app-throws-runtime-error portal-throws-runtime-error）。全体の記録ではない。**

実行: `node scripts/mutate-run.mjs`（**本物の土台が要る**——CI で走らせる）

- 赤になった（その壊しを検出できた）: **5件**

## 赤になった（`- <検査の名前>` ← どの壊しで）

- 10. アプリ由来のコンソールエラーが無い（ログイン前）   ← portal-throws-runtime-error / verify-portal.mjs
- 13. アプリ由来のエラーが無い   ← app-throws-runtime-error / verify-photo-roundtrip.mjs
- 18. アプリ由来のエラーが無い   ← app-throws-runtime-error / verify-report-roundtrip.mjs
- 21. アプリ由来のエラーが無い   ← app-throws-runtime-error / verify-admin.mjs
- 7. アプリ由来のエラーが無い   ← app-throws-runtime-error / verify-edit.mjs

## ⚠️ 見ておくこと

- [rls-any-owner-sees-any-dog] verify-portal.mjs が**1件も赤にならなかった**。
    壊したのに気づいていない＝この検査は「**飼い主が、他人の犬を見られる**——ログインさえすれば全店の全頭が一覧に出る」を検出できない。
- [rls-any-owner-sees-any-dog] verify-invitation.mjs が**1件も赤にならなかった**。
    壊したのに気づいていない＝この検査は「**飼い主が、他人の犬を見られる**——ログインさえすれば全店の全頭が一覧に出る」を検出できない。
