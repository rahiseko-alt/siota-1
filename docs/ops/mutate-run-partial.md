# 1件ずつ壊した結果

**一部だけ（report-create-wrong-status upload-assets）。全体の記録ではない。**

実行: `node scripts/mutate-run.mjs`（**本物の土台が要る**——CI で走らせる）

- 赤になった（その壊しを検出できた）: **10件**

## 赤になった（`- <検査の名前>` ← どの壊しで）

- 0b. 下書きのカルテを用意できた   ← report-create-wrong-status / verify-empty-pet.mjs
- ear.comment（耳のコメント）   ← report-create-wrong-status / verify-xss.mjs
- nail.comment（爪のコメント）   ← report-create-wrong-status / verify-xss.mjs
- skin[].loc（皮膚の部位）   ← report-create-wrong-status / verify-xss.mjs
- staffNote（担当からの一言）   ← report-create-wrong-status / verify-xss.mjs
- teeth.comment（歯のコメント）   ← report-create-wrong-status / verify-xss.mjs
- teeth.status（歯の状態）   ← report-create-wrong-status / verify-xss.mjs
- weights[].ym（体重グラフのラベル）   ← report-create-wrong-status / verify-xss.mjs
- 検査を最後まで実行できた   ← upload-assets / verify-photo-roundtrip.mjs
- 犬の名前（見出しへ入る）   ← report-create-wrong-status / verify-xss.mjs
