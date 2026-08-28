# 1件ずつ壊した結果

実行: `node scripts/mutate-run.mjs`（**本物の土台が要る**——CI で走らせる）

- 赤になった（その壊しを検出できた）: **49件**

## 赤になった（`- <検査の名前>` ← どの壊しで）

- ★b. 戻った先に犬が並んでいる（空の一覧に置き去りにしない）   ← empty-back-off / verify-m6.mjs
- ★c. 戻ってから、もう一度同じ犬に入れる   ← empty-back-off / verify-m6.mjs
- 1. 記入が下書きとしてサーバに残った   ← resume-draft-off / verify-draft.mjs
- 10. 飼い主: 担当からの一言   ← settext-off / verify-report-roundtrip.mjs
- 11. ログイン後、自分の犬（X/Y/Z）が一覧に出て、他人の犬（Q）は出ない   ← rls-any-owner-sees-any-dog / verify-portal.mjs
- 11. 直しで開くと、付けた写真が控えに残っている   ← hydrate-assets / verify-photo-roundtrip.mjs
- 11. 飼い主: 爪   ← settext-off / verify-report-roundtrip.mjs
- 12. 直したあとも写真4枚が残っている   ← hydrate-assets / verify-photo-roundtrip.mjs
- 12. 飼い主: 耳   ← settext-off / verify-report-roundtrip.mjs
- 13. 他人の犬（Q）は見えない（RLS）   ← rls-any-owner-sees-any-dog / verify-portal.mjs
- 13. 飼い主: 歯   ← settext-off / verify-report-roundtrip.mjs
- 14. 飼い主: 体重   ← settext-off / verify-report-roundtrip.mjs
- 14b. 飼い主: 体重のグラフが描かれている（数字だけでなく）   ← weight-graph-off / verify-report-roundtrip.mjs
- 15. カルテ1枚が実際に消えた   ← delete-assets / verify-admin.mjs
- 17. 他人にはこのカルテが見えない（RLS）   ← rls-both-layers-open / verify-report-roundtrip.mjs
- 2. 離れて戻ると、続きから書ける   ← resume-draft-off / verify-draft.mjs
- 3. 下書きは飼い主に見えない   ← rls-drafts-leak / verify-draft.mjs
- 3. 確認: 担当からの一言   ← settext-off / verify-report-roundtrip.mjs
- 4. 写真の実体が Storage から消えた（service_role で数える）   ← delete-assets / verify-delete.mjs
- 4. 確認: 爪   ← settext-off / verify-report-roundtrip.mjs
- 5. 確認: 耳   ← settext-off / verify-report-roundtrip.mjs
- 5. 飼い主のページからカルテが消えている   ← delete-assets / verify-delete.mjs
- 6. 確定していないカルテは飼い主に見えない   ← rls-drafts-leak / verify-empty-pet.mjs
- 6. 確認: 歯   ← settext-off / verify-report-roundtrip.mjs
- 6. 飼い主: 表紙が、1枚目に入れた写真   ← hydrate-assets / verify-photo-roundtrip.mjs
- 7. 確認: 体重   ← settext-off / verify-report-roundtrip.mjs
- 7. 飼い主: ギャラリーに2枚並ぶ   ← hydrate-assets / verify-photo-roundtrip.mjs
- 8. 飼い主: 耳の写真が、耳の欄に   ← hydrate-assets / verify-photo-roundtrip.mjs
- 9. 飼い主: 歯の写真が、歯の欄に   ← hydrate-assets / verify-photo-roundtrip.mjs
- 9. 飼い主: 犬の名前   ← settext-off / verify-report-roundtrip.mjs
- ear.comment（耳のコメント）: 実行されない   ← text-as-html / verify-xss.mjs
- ear.comment（耳のコメント）: 細工が文字として飼い主の画面に出ている   ← text-as-html / verify-xss.mjs
- ear.comment（耳のコメント）: 要素として注入されていない   ← text-as-html / verify-xss.mjs
- nail.comment（爪のコメント）: 実行されない   ← text-as-html / verify-xss.mjs
- nail.comment（爪のコメント）: 細工が文字として飼い主の画面に出ている   ← text-as-html / verify-xss.mjs
- nail.comment（爪のコメント）: 要素として注入されていない   ← text-as-html / verify-xss.mjs
- staffNote（担当からの一言）: 実行されない   ← text-as-html / verify-xss.mjs
- staffNote（担当からの一言）: 細工が文字として飼い主の画面に出ている   ← text-as-html / verify-xss.mjs
- staffNote（担当からの一言）: 要素として注入されていない   ← text-as-html / verify-xss.mjs
- teeth.comment（歯のコメント）: 実行されない   ← text-as-html / verify-xss.mjs
- teeth.comment（歯のコメント）: 細工が文字として飼い主の画面に出ている   ← text-as-html / verify-xss.mjs
- teeth.comment（歯のコメント）: 要素として注入されていない   ← text-as-html / verify-xss.mjs
- teeth.status（歯の状態）: 実行されない   ← text-as-html / verify-xss.mjs
- teeth.status（歯の状態）: 細工が文字として飼い主の画面に出ている   ← text-as-html / verify-xss.mjs
- teeth.status（歯の状態）: 要素として注入されていない   ← text-as-html / verify-xss.mjs
- 検査を最後まで実行できた   ← upload-assets / verify-photo-roundtrip.mjs
- 犬の名前（見出しへ入る）: 実行されない   ← text-as-html / verify-xss.mjs
- 犬の名前（見出しへ入る）: 細工が文字として飼い主の画面に出ている   ← text-as-html / verify-xss.mjs
- 犬の名前（見出しへ入る）: 要素として注入されていない   ← text-as-html / verify-xss.mjs
