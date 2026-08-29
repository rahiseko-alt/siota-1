# 1件ずつ壊した結果

**一部だけ（pet-create-wrong-status）。全体の記録ではない。**

実行: `node scripts/mutate-run.mjs`（**本物の土台が要る**——CI で走らせる）

- 赤になった（その壊しを検出できた）: **11件**

## 赤になった（`- <検査の名前>` ← どの壊しで）

- 0. 検査用の犬を登録できた   ← pet-create-wrong-status / verify-delete.mjs
- 1. その飼い主の犬を登録できた   ← pet-create-wrong-status / verify-invitation.mjs
- 2. 検査用の犬を登録できた   ← pet-create-wrong-status / verify-revisit-interval.mjs
- ear.comment（耳のコメント）   ← pet-create-wrong-status / verify-xss.mjs
- nail.comment（爪のコメント）   ← pet-create-wrong-status / verify-xss.mjs
- skin[].loc（皮膚の部位）   ← pet-create-wrong-status / verify-xss.mjs
- staffNote（担当からの一言）   ← pet-create-wrong-status / verify-xss.mjs
- teeth.comment（歯のコメント）   ← pet-create-wrong-status / verify-xss.mjs
- teeth.status（歯の状態）   ← pet-create-wrong-status / verify-xss.mjs
- weights[].ym（体重グラフのラベル）   ← pet-create-wrong-status / verify-xss.mjs
- 犬の名前（見出しへ入る）   ← pet-create-wrong-status / verify-xss.mjs
