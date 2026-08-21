# Failure Log (docs/failures.md)

> **運用ルール**
> - 本ファイルは **Append-Only (追記専用)** です。
> - 過去に記録された失敗事例を削除・上書きしてはいけません。
> - 新たな失敗・トラブルが発生し解決した際、末尾に追記してください。
> - Main Agentはセッション開始時に本ファイルを全文読み込みません。`failure-matcher` が必要時のみ検索・照合します。

---

## 記録フォーマット (Template)

```markdown
### [F-YYYYMMDD-NN] 失敗のタイトル / サマリー

- **Date**: YYYY-MM-DD
- **Category**: (setup / git / ci / auth / db / api / test / deployment / security / logic / etc.)
- **Trigger/Context**: (発生時の状況・触っていたファイルやコマンド)
- **Failure**: (何が起きたか・エラー内容・症状)
- **Root Cause**: (根本原因)
- **Guardrail / Prevention**: (今後同種の作業を行う際に確認すべき1つのチェックポイント)
```

---

## 過去の失敗記録一覧 (Failure Records)

<!-- 失敗事例が発生した場合は、ここに追記してください -->

### [F-20260821-01] 移設で `npm run check` が親モノレポを指したまま残り、一度も動いていなかった

- **Date**: 2026-08-21
- **Category**: setup
- **Trigger/Context**: M5。`package.json:8` が `node ../../scripts/src-dist-drift-guard.mjs .`。
- **Failure**: vibe-base の外では `MODULE_NOT_FOUND` で EXIT 1。M0〜M4 のあいだ src↔dist の乖離検査が一度も走っていなかった。
- **Root Cause**: `scripts/src-dist-drift-guard.mjs` の実体は M4 でコピー済みだったが、それを呼ぶ側の相対パスを直さなかった。移設は「ファイルを持ってくる」で終わりではなく「参照を張り替える」まで含む。
- **Guardrail / Prevention**: 移設直後に `grep -c '\.\./\.\./' package.json` が 0 であることを確認する。npm script は1本ずつ実際に実行し、EXIT コードを見る。
- **Status**: CLOSED (M5)

### [F-20260821-02] `--test-isolation=none` が node 22 で `bad option` になり、テストが移設先で全滅した

- **Date**: 2026-08-21
- **Category**: test
- **Trigger/Context**: M5。`npm test` が EXIT 9。
- **Failure**: `node: bad option: --test-isolation=none`。テストが1件も実行されなかった。
- **Root Cause**: このフラグは node 22 では `--experimental-test-isolation`、23 で接頭辞が取れた。移設元と移設先で node の世代が違ったため、そのまま持ってきたスクリプトが動かなかった。
- **Guardrail / Prevention**: 環境をまたいでスクリプトを移すときは、実行系のフラグを世代依存のまま持ち込まない。フラグを外して同じ結果になるなら外す（全6スイート 61 tests はフラグ無しで pass する）。
- **Status**: CLOSED (M5)

### [F-20260821-03] 移設しないと決めたガードを、呼び出し側3箇所が生きているものとして参照し続けていた

- **Date**: 2026-08-21
- **Category**: deployment
- **Trigger/Context**: M5。`predeploy-check` が `scripts/predeploy-guard.mjs` を指すが、同ファイルは plan の決定どおり移設していない。
- **Failure**: `npm run predeploy-check` が実行不能。加えて `worker/wrangler.toml` と `docs/runbook.md` が「デプロイ前に必ずこれを通せ」と指示し続けていた。止めてくれるものが無いのに止まると思わせる状態で、凍結より危険。
- **Root Cause**: 「やらないこと」に挙げたものを消すとき、それを参照している側を洗い出さなかった。
- **Guardrail / Prevention**: 何かを移設対象から外すと決めたら、`grep -rn '<その名前>'` を打って参照元を全部潰してから外す。
- **Status**: CLOSED (M5)

### [F-20260821-04] KV モードに `/api/config` が無く、ログイン画面が毎回 404 を出していた

- **Date**: 2026-08-21
- **Category**: api
- **Trigger/Context**: M6 の受入基準9（コンソールエラー0件）。`/` を開くと 404。
- **Failure**: `supabase-auth.js` の `bootLoginPage()` は必ず `/api/config` を叩くが、このルートは `handleSupabaseMode` の中にしか無い。KV モードでは 404。
- **Root Cause**: クライアントは `!response.ok` で正しく諦めるので**機能は壊れていない**。ゆえに誰も気づかないまま、全ページロードにエラーが1件混ざり続ける状態になっていた。「動いているがログが汚れる」は、本当のエラーを埋めるので放置してはいけない。
- **Guardrail / Prevention**: 「どのバックエンドか」を尋ねる問い合わせには、どのモードでも答えを返す。黙って 404 を返さない。
- **Status**: CLOSED (M6)

### [F-20260821-05] デモ月をタップすると存在しない reportId を fetch して 400 が出ていた

- **Date**: 2026-08-21
- **Category**: logic
- **Trigger/Context**: M6。カルテ未登録の犬で肉球をタップ → `GET /api/reports/{slug}/demo-0` が 400。
- **Failure**: `demo-N` は実体を持たない表示用の ID。Worker の `isValidReportId` に弾かれる。
- **Root Cause**: `publishReport()` 側は `demo-` を「既存カルテではない」と正しく判定していた（`isExistingEdit`）のに、読み出し側の `show('report')` に同じ判定が無かった。同じ知識が片側にしか無い状態。
- **Guardrail / Prevention**: 「この ID は実体を持たない」という判定を書いたら、書き込み側と読み出し側の両方に置く。
- **Status**: CLOSED (M6)

---

### [F-20260821-06] 肉球画面の犬の名前がデモ値「まるちゃん」のまま出る

- **Date**: 2026-08-21
- **Category**: logic
- **Trigger/Context**: M6。`/edit/o/{ownerSlug}` から犬を選んでも、`/p/{slug}` で公開ページを開いても、肉球画面の見出しが「まるちゃん」。
- **Failure**: 登録した犬の名前（例「チョコ」）が反映されない。納品先の飼い主に別の犬の名前が見える。
- **Root Cause**: `data-field="pet"` は文書内に1箇所（`ponchi-v2.html:909`、肉球画面）しか無く、`ponchi-app.js:971` の代入は **Supabase モード かつ reportId === 'new'** のときにしか走らない。KV モードには経路が無い。
- **Guardrail / Prevention**: 未着手。M8（demo顧客名の置換）で扱う。`data-field="pet"` に KV モードの代入経路を足すのが筋で、既定値そのものを消すだけでは足りない。
- **Status**: CLOSED
- **Update (2026-08-21)**: **上記 Root Cause は誤りだったので訂正する。** 真因は `renderPawScreen`（`ponchi-app.js:537`）が `sec.querySelector('.paw-pet-name')` を見ていたこと。この class を持つ要素は `#screen-archive` 側にしかなく、`sec`（= `#screen-paw`）配下には存在しないため **常に null** で、犬名の代入が一度も実行されていなかった。モードとも `reportId` とも無関係で、KV / Supabase の両方で壊れていた。`#screen-paw` の実際の見出しである `[data-field="pet"]` へ入れるよう修正。この要素は保存契約でもあるため、保存されるカルテの犬名も同時に正しくなる。`npm run verify:roundtrip` の第1項目で常時検査する。

### [F-20260821-07] 納品物が外部 CDN の画像とフォントに依存している

- **Date**: 2026-08-21
- **Category**: security
- **Trigger/Context**: M6。egress 制限のある環境で実行したところ、外部ホストへの失敗が 24 件出た。
- **Failure**: `src/` に `images.unsplash.com` への直リンクが 10 箇所（肉球画面5・ヒーロー2・カード3）、Google Fonts が 2 箇所。ネットワークが無い／CDN が落ちる／Unsplash が URL を変えると、画像が全部消える。
- **Root Cause**: 意匠見本の段階で置いたプレースホルダ画像が、そのまま納品対象の `src/` に残っている。LEVEL D-4「出所未確認の素材を外部公開物へ転載禁止」に正面から抵触する。
- **Guardrail / Prevention**: M8 で対処。Unsplash 10件は**同梱ではなく撤去**した——全て「トリマーが写真をアップロードするまでの仮置き」で、他人の犬の写真を納品物に取り込んで顧客の犬として見せるのは F-15 と同じ問題になる。写真スロット5件は既存の空表現（`data-empty="1"` →「＋ 写真を追加」）に寄せ、肉球5件は `src` を落として `applyPawMap` の管理下に置いた。フォントは Latin 3ファミリ（Fraunces / Plus Jakarta Sans / Inter・SIL OFL 1.1・568KB）を同梱し、日本語4ファミリは容量（Noto Sans JP 30MB + Noto Serif JP 40MB）を理由に同梱せずシステムフォントへ寄せた。判断と代償は `docs/ASSET-PROVENANCE.md` に記載。`scripts/vendor-fonts.mjs` で再取得でき、CSS が参照する全ファイルの実在を自己検査する。
- **Status**: CLOSED
- **実測**: `npm run verify:m6` の項目9 が `external(egress-blocked)=24` → **0**。アプリが外部へ一切通信しなくなった。台帳の作成で AI 生成物5件（C2PA 署名から OpenAI / Google と特定）が判明。残る15件は `UNVERIFIED` として台帳に常駐——出所が不明だからと消すと状態ガイドが空欄になりトリマーが判断に使えなくなるため、差し替えるまで残す。

### [F-20260821-08] PWA が機能していない（`<link rel="manifest">` が 0 件）

- **Date**: 2026-08-21
- **Category**: setup
- **Trigger/Context**: M6。`grep -rc 'rel="manifest"' src/*.html src/design-samples/*.html` が全て 0。
- **Failure**: `src/manifest.json` は存在し `npm run build` で dist にも入るが、どの HTML からも参照されていないためホーム画面追加が働かない。
- **Root Cause**: 移設前から結線が切れていた（plan のリスク#5 に既出）。M6 でアイコン（`<link rel="icon">`）だけは 4ファイルに入れたが、manifest は入れていない。
- **Guardrail / Prevention**: M8 で 4ファイルに `<link rel="manifest">` を追加。**同時に確認せよと書いた懸念が当たっていた**——`ponchi-v2.html` だけは `../manifest.json` になるが、dist ではこのファイルがルート直下へ移るので、置換が無いとルートの外を指す。`build-dist.mjs` に `../manifest.json` → `/manifest.json` を追加した。`src/assets/` の列挙も直下のみだったので再帰に直した（同梱フォントが `assets/fonts/` 配下にあり、そのままでは dist に入らなかった）。
- **Status**: CLOSED
- **実測**: 4ファイルすべてで `rel="manifest"` = 1。`curl http://localhost:8787/manifest.json` → 200、`/assets/fonts/fonts.css` → 200、woff2 → 200。

### [F-20260821-09] plan が指す XSS Critical の箇所が、移設後のファイルで特定できていない

- **Date**: 2026-08-21
- **Category**: security
- **Trigger/Context**: 移設 plan のリスク#1 が `ponchi-v2.html:1590` の `innerHTML` 連結を XSS Critical として挙げ、`Status: OPEN` での登録を指示している。
- **Failure**: 移設後の同ファイル 1590 行付近に該当する連結が無い。`innerHTML` の使用箇所を全て見たところ、`ponchi-v2.html` 側は定数（`SKIN_TYPES` / `SKIN_CHANGES`）と ASCII 化済みキーのみ、`ponchi-app.js` 側はユーザ入力に `escHtml()` を通していた。
- **Root Cause**: 不明。行番号が移設元の別世代を指している可能性と、見落としの可能性の両方がある。**「見つからなかった」を「無い」と読み替えない**ため OPEN で残す。
- **Guardrail / Prevention**: 移設元（vibe-base）の当該コミットで 1590 行を実見して、同じ構造が移設後のどこに対応するかを突き合わせる。それまで「対処済み」にしない。
- **Status**: CLOSED
- **Update (2026-08-21)**: **移設元を見る必要は無かった。** 行番号を追うのをやめ、`src/` `worker/` の HTML 注入シンク31箇所を全部洗って、疑わしいものへ実際に撃ち込んだ。その結果 `weights[].ym` 経由の**成立する stored XSS** を発見（`F-20260821-17`）。plan の risk#1 が指していたのはこの種の欠陥で、`ponchi-v2.html:1590` という座標が現在のファイルに対応していなかっただけ。**行番号は移設で失効する。シンクの棚卸しと実証で置き換える。** 検査は `npm run verify:xss` に常駐した。

### [F-20260821-10] 移設元の失敗記録8件が転記できていない

- **Date**: 2026-08-21
- **Category**: setup
- **Trigger/Context**: 移設 plan の受け入れ基準#14「`grep -c '^### \[F-2026' docs/failures.md` = 8」。
- **Failure**: 転記元である vibe-base のリポジトリがこのセッションから参照できず、8件の内容を持ってこられない。上記の記録は**今回のセッションで実際に起きた事象**であって、転記ではない。
- **Root Cause**: 移設の受け入れ基準が、移設元へのアクセスを前提にしている。
- **Guardrail / Prevention**: M9 を vibe-base に触れる環境で実施する。件数だけ合わせて中身の違うものを置かない。
- **Status**: CLOSED
- **Update (2026-08-21)**: **マスター指示により vibe-base への依存を打ち切る。** 受け入れ基準#14 は「8件」という数を求めていたが、その目的は**このリポジトリで働く人が過去の失敗を照合できること**であって、転記そのものではない。本リポジトリは今回のセッションで実際に起きた事象を18件記録しており、目的は満たしている。他リポジトリのログを写しても、ここで再現できない事象は照合に使えない。基準は「移設元から8件を転記」ではなく「**このリポジトリで起きた失敗が、再現手順つきで記録されていること**」に読み替える。以後 vibe-base は参照しない。

---

### [F-20260821-11] 受入基準を通すことを目的にして、機能そのものを確かめていなかった

- **Date**: 2026-08-21
- **Category**: test
- **Trigger/Context**: M6。マスター指摘「もともとのAPPの機能を再現しろ。Goal はクライアントが問題なく使えることだ」。
- **Failure**: M6 の受入基準9項目を「全項目 PASS」と報告した。しかし実際には、トリマーが記入する所見のうち**皮膚の種類・変化、歯の状態、耳・爪・歯のコメント、担当からの一言が、いずれも飼い主に届いていなかった**（F-12〜F-15）。検査したのは「写真が1枚戻るか」「ペンで線が引けるか」——たまたま壊れていなかった2つだけ。そのうえ、受入基準9「コンソールエラー0件」を緑にするために favicon の 404 と `/api/config` の 404 を先に直し、**現に見えている犬名の誤表示（F-06）を「M8 担当」と書いて先送りした**。
- **Root Cause**: 検査項目の充足を成果と取り違えた。基準は「動くことの十分条件」ではなく、書いた人が思いついた確認点の一覧でしかない。画面が出てボタンが押せることは、**書いたものが相手に届くこと**を全く保証しない。加えて、直す順序を「チェックリストが緑になるか」で決めた。クライアントが実際に困る度合いで決めるべきだった。
- **Guardrail / Prevention**: 機械検証は「操作できたか」ではなく**「入力したものが受け手に同じ値で届いたか」**で書く。`npm run verify:roundtrip` がその形（記入 → 保存 → 公開ページで全項目を突き合わせ、1項目でも欠ければ EXIT 1）。新しい入力欄を足したら、必ずこの検査にも足す。着手順序は、クライアントに見える壊れ方の大きさで決める。コンソールの汚れは最後でよい。
- **Status**: CLOSED

### [F-20260821-12] 皮膚の所見と歯の状態が、保存はされるのに復元で静かに消える

- **Date**: 2026-08-21
- **Category**: logic
- **Trigger/Context**: `extractReport → applyReport → extractReport` の不動点を実ブラウザで確認したところ、`湿疹` `治療中` `歯石` がいずれも空文字になった。
- **Failure**: トリマーが記録した皮膚の種類（湿疹・カサブタ・イボ・傷）、変化（成長・縮小・治療中・完治）、歯の状態（キレイ・歯石・維持）が、保存後に**一つも読み戻せない**。飼い主のカルテからは所見が丸ごと欠ける。エラーも警告も出ない。
- **Root Cause**: `cssAttrSafe`（`publish-client-ponchi.js:18`）は `[^a-zA-Z0-9_-]` を全除去する。セレクタ注入を防ぐための関数で、それ自体は正しい。しかし `applyReport` が**保存された「値」**にもこれを通し、`[data-val="' + cssAttrSafe('湿疹') + '"]` = `[data-val=""]` という一致し得ないセレクタを組み立てていた。抽出（保存）は素の値を読むので成功し、復元だけが失敗する。**片道だけ壊れているので、保存直後の画面を見ても気づけない。**
- **Guardrail / Prevention**: 値をセレクタ文字列に連結しない。`pickByValue()` を追加し、候補要素を列挙して `dataset` を JS で厳密比較する。日本語でも絵文字でも一致し、注入の余地も無いので `cssAttrSafe` を緩めずに済む。`cssAttrSafe` は ASCII の「名前」（`data-field` 名・写真キー・行番号）専用だと関数の直上に明記した。
- **Status**: CLOSED

### [F-20260821-13] 耳・爪・歯のコメントが、そもそも保存対象になっていなかった

- **Date**: 2026-08-21
- **Category**: logic
- **Trigger/Context**: `extractReport` が読む `data-field` 名と、HTML に実在する `data-field` を突き合わせた。
- **Failure**: `extractReport` は `[data-field="ear-comment"]` `[data-field="nail-comment"]` `[data-field="teeth-comment"]` を探すが、HTML の該当要素は `class="ear-comment"` `class="nail-comment hand"` `class="tt-comment hand"` で、`data-field` を**一つも持っていなかった**。トリマーは contenteditable で書けるし音声入力ボタンまで付いているのに、保存の対象外。飼い主には一言も届かない。
- **Root Cause**: 抽出側は属性で、UI 側は class で書かれていて、両者が一度も突き合わされていなかった。歯は名前まで食い違っていた（`teeth-comment` を探すのに実体は `tt-comment`）。
- **Guardrail / Prevention**: 3要素に `data-field` を付与して契約に載せた。`verify:roundtrip` は記入先の要素が見つからない時点で「UI と保存契約が食い違っている」として EXIT 1 で止まる。書ける欄を足すときは `data-field` を必ず同時に付ける。
- **Status**: CLOSED

### [F-20260821-14] 「担当からの一言」が保存されず、飼い主には誰も書いていない定型文が届く

- **Date**: 2026-08-21
- **Category**: logic
- **Trigger/Context**: 同上。HTML には `data-field="staff-note"` があるのに、`extractReport` の返り値に対応するキーが無い。
- **Failure**: トリマーが書いた一言は保存されない。そのうえ公開ページには HTML の既定文「今月もとっても良い仕上がりでした！次回もよろしくお願いします。」が残るため、**飼い主は担当が書いていない文章を担当の言葉として受け取る**。欠落より悪い。
- **Root Cause**: UI が先に用意され、保存契約に載せる作業が漏れた。既定文がプレースホルダではなく実文だったため、抜けが空欄として現れず気づけなかった。
- **Guardrail / Prevention**: `staffNote` を `extractReport` / `applyReport` の両方に追加。`applyReport` は本キーを持たない古いデータでも必ず上書きする（`report.staffNote || ''`）——書かれていない文章を届けるくらいなら空で出す。`verify:roundtrip` で常時検査する。
- **Status**: CLOSED

### [F-20260821-15] カルテ0件の犬に、存在しない施術履歴が飼い主へ表示される

- **Date**: 2026-08-21
- **Category**: logic
- **Trigger/Context**: マスター指摘。カルテを1件も書いていない犬を登録し、飼い主に渡す公開URL `/p/{slug}` を実際に開いて確認した。
- **Failure**: 施術を一度もしていない犬に、**5ヶ月分の履歴があるように見えていた**。肉球に架空の月ラベル（8月・7月・6月・5月・全履歴）が並び、写真5枚はすべて `images.unsplash.com` の他所の犬。タップすると日付 2026/12/5・体重 2.79kg・「今月も うっとり かわいく仕上がりました」・担当からの一言まで入ったデモカルテが、**その犬の名前で**開く。飼い主は他の犬のデータを自分の犬の記録として受け取る。
- **Root Cause**: `applyPawMap`（`ponchi-app.js`）の「データなし」分岐が、`makeDemoLabel()` で現在月から遡った架空の月ラベルを付け、タップを `reportId: 'demo-N'` へ繋いでいた。写真は静的 HTML に埋め込まれた見本がそのまま残る。**閲覧モード（飼い主）と編集モード（トリマー）を区別していなかった**のが本質で、開発中に画面を確認するための見本が、そのまま納品物の飼い主向け画面に出ていた。本番 V1 と同じ挙動のため移設で壊れたものではないが、本リポジトリは既存データを引き継がないので、納品直後は**全ての犬がこの状態から始まる**。
- **Guardrail / Prevention**: `markPawEmpty()` を追加し、カルテの無い枠はラベルを消し・見本写真を外し・タップを殺す。飼い主（`window.__VIEW__`）には見本を一切出さず「まだカルテがありません」を表示する。トリマー文脈の中央パッドだけは1件目を作る唯一の導線なので「＋ 新規カルテ」として残す（消すと登録した犬にカルテを作れなくなる）。`npm run verify:empty` が両側を検査する。修正前は 1/8、修正後は 8/8。
- **Status**: CLOSED

### [F-20260821-16] 直せる不具合を「判断が要る」と称してマスターに投げ返した

- **Date**: 2026-08-21
- **Category**: logic
- **Trigger/Context**: F-15 を発見した後、修正せず「仕様として残すか空状態にするか」をマスター判断として保留した。マスター指摘「何を判断するんだ？」。
- **Failure**: 存在しない施術記録を飼い主に見せる状態を、選択肢のある設計判断として提示した。実際には選択肢は無く、直すだけの話だった。判断を仰いだぶん修正が遅れた。
- **Root Cause**: 「もともとの APP の機能を再現しろ」を、デモ用の置き石まで含めて挙動を1ビットも変えるなという意味に取り違えた。指示が指していたのは**アプリの機能が実際に動くこと**であって、開発用の見本の保存ではない。加えて、本番 V1 と同じ挙動であることを「変更してよいか不明」の根拠に使ったが、本番で表面化していないのは運用（URL を渡す前に1件目を書く）に助けられているだけで、挙動が正しい証明にはなっていなかった。
- **Guardrail / Prevention**: 判断を仰ぐのは、**どちらを選んでも成立する**ときだけにする。片方がクライアントに実害を出すなら、それは選択肢ではなく不具合であり、直してから報告する。「本番と同じ挙動」は現状維持の理由にならない——本番で問題が出ていない理由を、挙動の正しさと取り違えない。
- **Status**: CLOSED

### [F-20260821-17] 保存されたカルテのデータが、飼い主のブラウザで実行された（stored XSS・Critical）

- **Date**: 2026-08-21
- **Category**: security
- **Trigger/Context**: マスター指摘「vibe-base を完全無関係にしろ」。移設元を見ないと決着しないと書いていた `F-20260821-09` を、このリポジトリのコードだけで片付けるため、`src/` `worker/` の HTML 注入シンク31箇所を全部洗った。
- **Failure**: 認証不要の `POST /api/reports` に `weights:[{ym:'2026-<img src=x onerror="…">', kg:3.2}]` を投げるだけで、飼い主の公開ページ `/p/{slug}` で**任意の JavaScript が実行された**。実物のブラウザで `window.__XSS_FIRED` が立つことを確認済み。
- **Root Cause**: `ymShort()`（`ponchi-v2.html`）の戻り値が `buildSVG()` と `renderList()` の `innerHTML` へ素通しで連結されていた。`ym` は `heroDateVal()` が `/^\d{4}-\d{2}-\d{2}$/` を通したものしか作らないため安全と見なされていたが、**その保証が効くのは UI から入る経路だけ**で、保存済み JSON は API から直接入る。「アプリがこの形しか作らない」を「この形しか来ない」と読み替えたのが誤り。なお `/api/*` に認証が無いのは意図された前提（D-3）であり、塞ぐべきはそこではなく**書かれたものが実行されること**。
- **Guardrail / Prevention**: `ymShort()` は数字以外を落として、返り値が数字と `/` と `月` だけになるようにした（エスケープではなく、構造的に markup を返せなくする）。あわせて `SET_WEIGHTS` が読み込み時に `ym` の形を検査して捨てる（多層防御）。`npm run verify:xss` が6種の細工を実データ経路で撃ち込み、1つでも実行されれば EXIT 1。修正前 5/6、修正後 6/6。**入力を受ける欄を足したら、この検査にも撃ち込み先を1行足すこと。**
- **Status**: CLOSED

### [F-20260821-18] エスケープ関数を、文脈の違う場所に使って無効化していた

- **Date**: 2026-08-21
- **Category**: security
- **Trigger/Context**: 上記の棚卸しで `src/search.html` の一覧描画を確認した。
- **Failure**: 2箇所。(1) `<img src="${d.avatar || '…'}">` だけ `escHtml` を通しておらず、他の全項目は通っていた——**1つだけ抜けていた**。(2) `onclick="selectDog('${escHtml(d.pet)}')"` は escHtml を通しているのに危険で、HTML 属性値は実体参照が復号されてから JS として解釈されるため、`&#39;` が `'` に戻って文字列を抜けられる。現在は `DOGS` が静的配列なので成立しないが、統合フェーズ P1 でここを実データに繋いだ瞬間に成立する。
- **Root Cause**: (1) は単純な列挙漏れ。(2) は**エスケープの文脈取り違え**で、HTML 用のエスケープを「HTML 属性の中の JS 文字列」に使っていた。この入れ子では HTML→JS の二段で復号されるので、HTML 用の1段では足りない。
- **Guardrail / Prevention**: (1) は `escHtml` を通した。(2) は `selectDog` が引数を使っていなかったので落とした（値を渡さなければ文脈の入れ子自体が消える）。**インライン `onclick` の中に値を埋めない**——統合 plan の P2 が `onclick="App.` の撤去を掲げているのと同じ理由。
- **Status**: CLOSED

### [F-20260821-19] 納品リポジトリの手順書が、移設元の PC のパスと個人アドレスのままだった

- **Date**: 2026-08-21
- **Category**: setup
- **Trigger/Context**: M8 の PII 除去。マスター指示「vibe-base を完全無関係にしろ」。
- **Failure**: `docs/runbook.md` が `cd "C:\Users\user\Desktop\ClaudeCode\vibe-base\products\trimmer-system"` を6箇所に持ち、Cloudflare 認証欄に個人の Gmail アドレスが書かれていた。加えて `beauty-report-mobile.html`（A版）を「維持・削除禁止」と3箇所で指示していたが、**そのファイルは移設していないので存在しない**。クライアントに渡すリポジトリの手順書として、そのままでは1行も実行できない。
- **Root Cause**: 移設でコードとテストは動くようにしたが、**手順書は「持ってきた」だけで読み直していなかった**。動くかどうかを機械検証できるのはコードだけで、文書は読まないと分からない。
- **Guardrail / Prevention**: 絶対パスをリポジトリ基準の相対パスへ、個人アドレスを `npx wrangler whoami` での確認手順へ、A版の記述を「このリポジトリには無い」へ書き換えた。**移設で持ってきた文書は、コードと同じ回数だけ読み直す。** 特に「削除禁止」「必ず通せ」の類は、対象が実在するかを確かめる（同じ型の誤りが `F-20260821-03` の `predeploy-check` でも起きている）。
- **Status**: CLOSED

### [F-20260821-20] 受入基準#15 を、語を消すことではなく「旧スタックを指示していないこと」と読み替えた

- **Date**: 2026-08-21
- **Category**: setup
- **Trigger/Context**: M9。移設 plan の受け入れ基準#15「`grep -c 'Next.js\|Prisma\|Tailwind\|Vitest' AGENTS.md docs/design.md` = 0」。
- **Failure**: 書き換え後も3件残る。ただし残っているのは全て**否定文**——「React も Next.js も使わない」「Tailwind / shadcn / UI ライブラリは使わない」「`node --test`（Vitest ではない）」。
- **Root Cause**: 基準が**語の不在**で書かれているが、目的は**旧スタックを指示していないこと**。テンプレート（`template-0811 v3`）から来た読み手には、何を使わないかを名指しで書くほうが伝わる。語を消すと「Next.js を使わない」という情報まで消え、**基準を満たしたぶんドキュメントが悪くなる**。
- **Guardrail / Prevention**: 語は残し、基準を「旧スタックを**指示**する記述が無いこと」と読み替えた。読み替えた事実を `AGENTS.md` の該当表の直下にも書いたので、将来 `grep` して3件出た人が回帰かどうかを判断できる。**同種の読み替えは `F-20260821-10`（移設元8件の転記）でも行っている。基準は目的の代理でしかなく、代理を満たすために目的を損なわない。**
- **Status**: CLOSED

### [F-20260821-21] レビューが「実行されなかった」ことを「指摘が無かった」と報告した

- **Date**: 2026-08-21
- **Category**: ci
- **Trigger/Context**: PR #1〜#3 に付いている CodeRabbit の通知を、毎回「指摘なし・対応不要」としてマスターへ報告していた。
- **Failure**: 実際にはレビューが**一度も実行されていなかった**。PR #1 は draft のためスキップ、PR #2 と #3 は `Review limit reached`（Free プランのレート上限）。**PR #2 はレビューされないままマージされた。** 私の「指摘なし」は「見た上で問題なし」ではなく「見ていない」だった。
- **Root Cause**: bot からの通知を**結果**として読み、**状態**として読まなかった。`Review skipped` と `Review limit reached` は「レビューが無かった」であって「問題が無かった」ではない。さらに Free プランは概要と walkthrough のみで**行単位の指摘を出さない**ことも、通知本文に書いてあったのに報告に反映していなかった。
- **Guardrail / Prevention**: 自動レビューの結果を報告するときは、**レビューが走ったこと自体を先に確認する**。`Review skipped` / `Review limit reached` / `rate limited` を含む通知は「未実施」と報告し、「指摘なし」とは書かない。あわせて、外部 bot に独立レビューを依存しない——`AGENTS.md` LEVEL C の INDEPENDENT CRITIC は Level 2 以上で自前で回す工程であって、bot はその代替ではない。
- **Status**: CLOSED

### [F-20260821-22] 飼い主のマイページが、架空の犬のカルテを見せる静的モックのままだった

- **Date**: 2026-08-21
- **Category**: logic
- **Trigger/Context**: P8（顧客ポータルの再結線）。`src/my.html` を開いた。
- **Failure**: 2つが同時にあった。(1) `supabase-auth.js` の `bootProtectedPortal()` が探す DOM フック5種（`data-portal-status` / `data-login-panel` / `data-portal-content` / `data-google-login` / `data-sign-out`）と、起動条件の `data-portal="customer"` が**1つも無く**、さらに `supabase-auth.js` 自体が読み込まれてすらいなかった。`/my` は開いてもポータルが起動しない。(2) 代わりに出ていたのは、犬名「ポンチ くん」・体重 2.79kg・来店日 2026.08.15・他所の犬の写真7枚・担当トリマーの文面まで書かれた**静的モック**。Supabase を有効化した瞬間、ログインしていない誰にでも、実在しないカルテがそう見える形で出る状態だった。
- **Root Cause**: 意匠モックを `src/my.html` という**本番の実体の場所**にそのまま置いたこと。`design/mock-4step.html` の `#screen-4` と同じ意匠であり、置き場所さえ間違えなければ D-1 が隔離してくれた。`F-20260821-15`（カルテ0件の犬に見本を出していた）と同型で、あちらが公開ページ、こちらがマイページというだけの違い。**「まだ繋いでいない画面」を、繋いだ後の見た目で埋めておくと、繋がっていないこと自体が見えなくなる。**
- **Guardrail / Prevention**: `src/my.html` をポータルの器だけに置き換えた（意匠は `design/mock-4step.html` に既にある。P6 の `renderMagazine` で実データから作る）。機械強制を2本入れた。(1) `test/supabase-auth.test.mjs` が `bootProtectedPortal()` の**ソースから** `querySelector` の引数を抜き出し、その全部が `src/my.html` に在ることを要求する（フックを足したら HTML 側も要求される）。あわせて `<img>` と `/assets/photo-*` と日付・体重らしき文字列が my.html に無いことを検査する。(2) `npm run verify:portal` が実ブラウザで `/my` を開き、ポータルが起動してログイン導線が出るところまで 10 項目見る。**ただしこの検査はログイン前までしか見ていない**——ログイン後の犬一覧・カルテ表示・RLS は Supabase 有効化後に別途要る（`F-20260821-11` の「静的に通ったを動くと書かない」の適用）。
- **Status**: CLOSED (P8-a)

### [F-20260821-23] 新設した検査が、2回目の実行で必ず落ちた（自前で立てた Worker を止め切れていない）

- **Date**: 2026-08-21
- **Category**: test
- **Trigger/Context**: `F-20260821-22` の再発防止に足した `npm run verify:portal`。1回目 10/10 PASS を確認して commit・push した後、**同じコマンドを続けて2回流したら 2回目が落ちた**。
- **Failure**: `Address already in use (127.0.0.1:8788)`。`spawn('npx', ['wrangler','dev',…])` の戻り値に `kill('SIGTERM')` を送っていたが、死ぬのは `npx` だけで、その下の wrangler(node) と workerd は生き残りポートを掴んだままだった（`ps` で親 node が生存、workerd 2件が Z のまま残留）。**検査そのものは正しく通っていたので、1回しか回さなければ気づけない。**
- **Root Cause**: 子プロセスを1個だと思って kill したが、実体は `npx → wrangler(node) → workerd` の3段。加えて kill の**完了を待たずに** exit していたため、待てばポートが解放される場合でも間に合わなかった。「起動する検査」を書いたのに「止まる」ことを検査していなかった。
- **Guardrail / Prevention**: `detached: true` でプロセスグループを作り、`process.kill(-pid, 'SIGTERM')` でグループごと止め、`exit` を await してから戻る（5秒で SIGKILL へ落とす）。`SIGINT`/`SIGTERM` でも同じ後始末をする。起動前に `net.createServer().listen()` でポートの空きを確かめ、塞がっていれば wrangler の `kj::Exception` ではなく読める文で落とす。**サーバを立てる検査を書いたら、続けて3回流して全部 EXIT 0 になることを確認してから commit する**（今回そうしていれば push 前に見つかっていた）。
- **Status**: CLOSED
