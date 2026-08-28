# 1件ずつ壊した結果

**一部だけ（finalize-returns-error）。全体の記録ではない。**

実行: `node scripts/mutate-run.mjs`（**本物の土台が要る**——CI で走らせる）

- 赤になった（その壊しを検出できた）: **8件**

## 赤になった（`- <検査の名前>` ← どの壊しで）

- ear.comment（耳のコメント）   ← finalize-returns-error / verify-xss.mjs
- nail.comment（爪のコメント）   ← finalize-returns-error / verify-xss.mjs
- skin[].loc（皮膚の部位）   ← finalize-returns-error / verify-xss.mjs
- staffNote（担当からの一言）   ← finalize-returns-error / verify-xss.mjs
- teeth.comment（歯のコメント）   ← finalize-returns-error / verify-xss.mjs
- teeth.status（歯の状態）   ← finalize-returns-error / verify-xss.mjs
- weights[].ym（体重グラフのラベル）   ← finalize-returns-error / verify-xss.mjs
- 犬の名前（見出しへ入る）   ← finalize-returns-error / verify-xss.mjs
