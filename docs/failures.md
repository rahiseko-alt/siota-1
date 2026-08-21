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
- **Status**: OPEN

### [F-20260821-07] 納品物が外部 CDN の画像とフォントに依存している

- **Date**: 2026-08-21
- **Category**: security
- **Trigger/Context**: M6。egress 制限のある環境で実行したところ、外部ホストへの失敗が 24 件出た。
- **Failure**: `src/` に `images.unsplash.com` への直リンクが 10 箇所（肉球画面5・ヒーロー2・カード3）、Google Fonts が 2 箇所。ネットワークが無い／CDN が落ちる／Unsplash が URL を変えると、画像が全部消える。
- **Root Cause**: 意匠見本の段階で置いたプレースホルダ画像が、そのまま納品対象の `src/` に残っている。LEVEL D-4「出所未確認の素材を外部公開物へ転載禁止」に正面から抵触する。
- **Guardrail / Prevention**: 未着手。M8 で `docs/ASSET-PROVENANCE.md` を作り、出所を台帳化したうえで自リポジトリ同梱に切り替える。Konva を同梱している（CDN 禁止）のと同じ理由が画像にも当てはまる。
- **Status**: OPEN

### [F-20260821-08] PWA が機能していない（`<link rel="manifest">` が 0 件）

- **Date**: 2026-08-21
- **Category**: setup
- **Trigger/Context**: M6。`grep -rc 'rel="manifest"' src/*.html src/design-samples/*.html` が全て 0。
- **Failure**: `src/manifest.json` は存在し `npm run build` で dist にも入るが、どの HTML からも参照されていないためホーム画面追加が働かない。
- **Root Cause**: 移設前から結線が切れていた（plan のリスク#5 に既出）。M6 でアイコン（`<link rel="icon">`）だけは 4ファイルに入れたが、manifest は入れていない。
- **Guardrail / Prevention**: 未着手。M8 で 4ファイルに `<link rel="manifest">` を足す。`build-dist.mjs` のパス置換（`../assets/` → `/assets/`）が manifest の相対パスにも効くかを同時に確認すること。
- **Status**: OPEN

### [F-20260821-09] plan が指す XSS Critical の箇所が、移設後のファイルで特定できていない

- **Date**: 2026-08-21
- **Category**: security
- **Trigger/Context**: 移設 plan のリスク#1 が `ponchi-v2.html:1590` の `innerHTML` 連結を XSS Critical として挙げ、`Status: OPEN` での登録を指示している。
- **Failure**: 移設後の同ファイル 1590 行付近に該当する連結が無い。`innerHTML` の使用箇所を全て見たところ、`ponchi-v2.html` 側は定数（`SKIN_TYPES` / `SKIN_CHANGES`）と ASCII 化済みキーのみ、`ponchi-app.js` 側はユーザ入力に `escHtml()` を通していた。
- **Root Cause**: 不明。行番号が移設元の別世代を指している可能性と、見落としの可能性の両方がある。**「見つからなかった」を「無い」と読み替えない**ため OPEN で残す。
- **Guardrail / Prevention**: 未着手。移設元（vibe-base）の当該コミットで 1590 行を実見して、同じ構造が移設後のどこに対応するかを突き合わせる。それまで「対処済み」にしない。
- **Status**: OPEN

### [F-20260821-10] 移設元の失敗記録8件が転記できていない

- **Date**: 2026-08-21
- **Category**: setup
- **Trigger/Context**: 移設 plan の受け入れ基準#14「`grep -c '^### \[F-2026' docs/failures.md` = 8」。
- **Failure**: 転記元である vibe-base のリポジトリがこのセッションから参照できず、8件の内容を持ってこられない。上記の記録は**今回のセッションで実際に起きた事象**であって、転記ではない。
- **Root Cause**: 移設の受け入れ基準が、移設元へのアクセスを前提にしている。
- **Guardrail / Prevention**: 未着手。M9 を vibe-base に触れる環境で実施する。件数だけ合わせて中身の違うものを置かない。
- **Status**: OPEN
