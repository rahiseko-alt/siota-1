# 1件ずつ壊した結果

**一部だけ（invitation-both-layers-open）。全体の記録ではない。**

実行: `node scripts/mutate-run.mjs`（**本物の土台が要る**——CI で走らせる）

- 赤になった（その壊しを検出できた）: **2件**

## 赤になった（`- <検査の名前>` ← どの壊しで）

- 5. 招待を消化する前は、その犬を見られない   ← invitation-both-layers-open / verify-invitation.mjs
- 7. 使い終わった招待は、別の人が使えない   ← invitation-both-layers-open / verify-invitation.mjs
