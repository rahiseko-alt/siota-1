# F1 「該当した」8件の解決記録（3出力・D-18）

> `docs/ops/bad-scenarios-F1.md` で **`結果: 該当した`** になった 8 件について、
> 1件につき **① 直す前（赤） ② 直した後（緑） ③ 直しを戻した（また赤）** を貼る。
> ③ が無い主張は「直したのがそこだ」の証明が無い（`AGENTS.md` D-18 偽-10）。
> 機械: `node scripts/guard/solved.mjs F1`

**測り方について（先に断っておく）**

「直った」を言葉で言わずに済むよう、各件に**数えられる尺度**を1つ決めた。
尺度は3回とも同じコマンドで測る。赤と「また赤」に**同じ行**が出ることが、
別のものを直していないことの証拠になる。

計測に使った使い捨てスクリプトは、本文中にそのまま貼ってある（再現できる形にするため）。
リポジトリには置いていない——検査ではなく、このとき測るためだけのものなので。

---

### 1. 「分けた」と言いながら、分けたかを誰も確かめていない
種別: 解決

**原因**: `npm run check` に、UI と backend が分かれているかを見る検査が1本も無かった。
**直したこと**: `scripts/guard/isolation.mjs` を新設し、`npm run check` に組み込んだ。

尺度: `npm run check` が走らせる検査のうち、隔離を見るものの本数。

```js
/* 計測: package.json の check を読んで数える（3件とも同じ measure.mjs で測った） */
const check = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts.check;
console.log(`#1 npm run check が走らせる検査: ${check.split('&&').length} 本`
  + ` / うち UI と backend の隔離を見るもの: ${(check.match(/guard\/isolation/g) || []).length} 本`);
```

#### 直す前（赤）
```
#1 npm run check が走らせる検査: 3 本 / うち UI と backend の隔離を見るもの: 0 本
```

#### 直した後（緑）
```
#1 npm run check が走らせる検査: 4 本 / うち UI と backend の隔離を見るもの: 1 本
```

#### 直しを戻した（また赤）
```
#1 npm run check が走らせる検査: 3 本 / うち UI と backend の隔離を見るもの: 0 本
```

---

### 2. 検査が、いちばん大きい画面ファイルを見ていない
種別: 解決

**原因**: 画面の本体は `src/index.html`（2,340 行）だが、そこを走査する検査が無かった。
**直したこと**: `isolation.mjs` の走査対象を、拡張子の固定リストではなく
**`src/index.html` から実際に辿れたファイル**にした。起点が `index.html` なので、必ず含まれる。

尺度: `src/index.html` に違反を1行置いて、検査が捕まえるか。

```js
/* 計測: index.html に fetch('/api/pets') を1行入れて、検査に掛ける */
fs.writeFileSync(p, original.replace('</head>', "<script>fetch('/api/pets')</script>\n</head>"));
const r = runIsolation();
fs.writeFileSync(p, original);
/* 「捕まえた」= 検査が動いたうえで、その違反を index.html の行として挙げたとき。
   検査が落ちただけのものを「捕まえた」と数えない */
const caught = r.code === 1 && /条件B/.test(r.out) && /index\.html:\d+/.test(r.out);
```

> この尺度は最初に書いたとき**誤って緑を出した**。検査ファイルが存在しないための
> `MODULE_NOT_FOUND` を「捕まえた」と数えていた。測るもの自体が壊れていたので直した。

#### 直す前（赤）
```
#2 src/index.html（2340 行）に置いた違反: 見逃した
```

#### 直した後（緑）
```
#2 src/index.html（2340 行）に置いた違反: 捕まえた
```

#### 直しを戻した（また赤）
```
#2 src/index.html（2340 行）に置いた違反: 見逃した
```

---

### 4. 検査が、赤くなるところを一度も見ていない
種別: 解決

**原因**: 検査を書いても、違反を置いて赤くなることを確かめていなかった。
**直したこと**: バッドシナリオが指定した確かめ方を実行し、**5つの違反の型すべて**で
EXIT 1 になることを確認した。1つだけ効いて他が効かない状態を残さないため。

#### 直す前（赤）
バッドシナリオ #4 が指定した確かめ方（`src/js/ui.js` に backend を import して `npm run check`）を、
検査が在る状態で実行した結果。**違反を置いても、検査は 0 件で合格していた**（＝赤を一度も見ていない状態）。

```
#1 npm run check が走らせる検査: 3 本 / うち UI と backend の隔離を見るもの: 0 本
#2 src/index.html（2340 行）に置いた違反: 見逃した
#6 src/ の在庫を参照の有無で分類: 0 件
```

#### 直した後（緑）
5型すべてを `src/js/ui.js` の先頭に置いて、1件ずつ検査に掛けた。

```
import '../backend/js/supabase-auth.js';                → EXIT 1  backend/ への参照
import { createClient } from '@supabase/supabase-js';   → EXIT 1  Supabase の SDK
const r = await fetch('/api/pets');                     → EXIT 1  API の呼び出し先
const u = 'https://trimmer-system.kouheikosehira.com';  → EXIT 1  外部への URL
new WebSocket('wss://x');                               → EXIT 1  通信そのもの
戻した exit=0
```

違反1件を置いたときの実際の出力:

```
[isolation] src/ を走査: 全 34 ファイル / index.html から到達 23 / 中身を読んだ 4

❌ 隔離できていません（1 件）

【条件B】UI からバックエンド・外部への繋がりが 1 件あります。
    src/js/ui.js:1  backend/ への参照
      import '../backend/js/supabase-auth.js';
  F1 は「UI とバックエンドの隔離」です。UI は src/js/dummy.js の仮データだけで動くこと。
exit=1
```

#### 直しを戻した（また赤）
`isolation.mjs` を外すと、同じ違反を置いても検査は何も言わなくなる。

```
#1 npm run check が走らせる検査: 3 本 / うち UI と backend の隔離を見るもの: 0 本
#2 src/index.html（2340 行）に置いた違反: 見逃した
#6 src/ の在庫を参照の有無で分類: 0 件
```

---

### 6. 「UI 以外が無い」の基準が無い
種別: 解決

**原因**: 何が「UI 以外」かを決めていなかったので、`src/assets/konva.min.js` のように
どこからも呼ばれないファイルが残っていても気づけなかった。
**直したこと**: 基準を「**`src/index.html` から辿り着けるか**」1本に決め、`isolation.mjs` の
条件A で全ファイルを分類するようにした。逃がせるのは `docs/deferred.md` に
**番号付きで登録されているものだけ**（無条件の例外リストは作らない・D-18 偽-3）。

**1件も削除していない。** 11件すべて F2 / F3 で使う予定か、マスター判断待ちなので、
`docs/deferred.md` の #1（解剖図2件）・#4（PWA 2件）・#5（アイコン等6件）・#6（konva）に登録した。

尺度: `src/` のファイルが、参照の有無で分類されているか。

#### 直す前（赤）
```
#6 src/ の在庫を参照の有無で分類: 0 件
```

#### 直した後（緑）
```
#6 src/ の在庫を参照の有無で分類: 34 件（到達 23 / 未到達 11）
```

登録前に検査を回したときの、実際の列挙:

```
【条件A】src/index.html からどこにも繋がっていないファイルが 11 件あります。
    src/assets/app-icon.png
    src/assets/body-side.png
    src/assets/icon-ear.png
    src/assets/icon-nail.png
    src/assets/icon-skin.png
    src/assets/icon-spa.png
    src/assets/icon-weight.png
    src/assets/konva.min.js
    src/assets/nail-diagram.png
    src/assets/teeth-diagram.jpg
    src/manifest.json
```

登録後:

```
[isolation] src/ を走査: 全 34 ファイル / index.html から到達 23 / 中身を読んだ 4
✅ 隔離 OK（条件A: 未到達 0 件・あと回し登録済み 11 件は除く / 条件B: 繋がり 0 件）
```

> 途中で検査側の不具合を1件見つけて直した。拡張子の候補を `js|mjs|json` の順に並べていたため
> `manifest.json` が `manifest.js` として拾われ、**登録したのに逃がされない**状態だった。
> `konva.min.js` も、ファイル名側に `.` を許していなかったため `min.js` として拾われていた。

#### 直しを戻した（また赤）
```
#6 src/ の在庫を参照の有無で分類: 0 件
```

---

### 7. 分けたのではなく、片方を消してしまっている
種別: 解決

**原因**: UI と backend を分けたとき `src/js/magazine-view.js` を移し忘れて消した。
呼び出し元の `backend/js/supabase-auth.js` は生きたままなので、import が解決できない。
**直したこと**: `git show '6685df5^:src/js/magazine-view.js' > backend/js/magazine-view.js` で復元した。
消したのは自分で、履歴に残っていたので、書き直さず**そのまま戻した**（579 行）。

#### 直す前（赤）
```
not ok 2 - backend/js/supabase-auth.js が import できる
  error: "Cannot find module '/home/user/siota-1/backend/js/magazine-view.js' imported from /home/user/siota-1/backend/js/supabase-auth.js"
not ok 3 - backend/js/supabase-staff.js が import できる
  error: "Cannot find module '/home/user/siota-1/backend/js/magazine-view.js' imported from /home/user/siota-1/backend/js/supabase-auth.js"
# fail 2
7-red exit=1
```

#### 直した後（緑）
```
# pass 6
# fail 0
7-green exit=0
```

#### 直しを戻した（また赤）
```
not ok 2 - backend/js/supabase-auth.js が import できる
  error: "Cannot find module '/home/user/siota-1/backend/js/magazine-view.js' imported from /home/user/siota-1/backend/js/supabase-auth.js"
not ok 3 - backend/js/supabase-staff.js が import できる
  error: "Cannot find module '/home/user/siota-1/backend/js/magazine-view.js' imported from /home/user/siota-1/backend/js/supabase-auth.js"
# fail 2
7-red2 exit=1
```

---

### 8. 検査は緑だが、中身が空っぽ
種別: 解決

**原因**: `npm test` が `backend/js/` のモジュールをほとんど import していなかった。
だから #7 のように **backend が壊れていても `npm test` は EXIT 0** で通った。
**直したこと**: `test/backend-import.test.mjs` を新設し、`npm test` に配線した（`test:backend`）。
対象はディレクトリを読んで決めるので、ファイルを足せば自動で対象になる。
対象が減ったときのために**下限4本**を別のテストで要求した（D-18 偽-2 対策）。

尺度: **backend/js を1本ずつ壊して `npm test` を回し、見逃した本数を数える。**
「検査が在るか」ではなく「壊れているものに気づくか」で測る。

```js
/* 計測: 各モジュールの先頭に、存在しない import を1行入れて npm test を回す */
for (const f of files) {
  const original = fs.readFileSync(p, 'utf8');
  fs.writeFileSync(p, `import './__broken_on_purpose__.js';\n${original}`);
  let code = 0;
  try { execSync('npm test', { stdio: 'ignore' }); } catch (e) { code = e.status || 1; }
  fs.writeFileSync(p, original);
  if (code === 0) missed += 1;   /* 壊れているのに緑 = 見逃し */
}
```

#### 直す前（赤）
```
backend/js の 5 本を1本ずつ壊して npm test を回した
  magazine-view.js             壊しても npm test は EXIT 0（見逃し）
  supabase-auth.js             壊しても npm test は EXIT 0（見逃し）
  supabase-staff.js            壊しても npm test は EXIT 0（見逃し）
  supabase-storage.js          npm test が EXIT 1 で捕まえた
  supabase-vendor-entry.mjs    壊しても npm test は EXIT 0（見逃し）
見逃し: 4 本 / 5 本
```

#### 直した後（緑）
```
backend/js の 5 本を1本ずつ壊して npm test を回した
  magazine-view.js             npm test が EXIT 1 で捕まえた
  supabase-auth.js             npm test が EXIT 1 で捕まえた
  supabase-staff.js            npm test が EXIT 1 で捕まえた
  supabase-storage.js          npm test が EXIT 1 で捕まえた
  supabase-vendor-entry.mjs    npm test が EXIT 1 で捕まえた
見逃し: 0 本 / 5 本
```

#### 直しを戻した（また赤）
```
backend/js の 5 本を1本ずつ壊して npm test を回した
  magazine-view.js             壊しても npm test は EXIT 0（見逃し）
  supabase-auth.js             壊しても npm test は EXIT 0（見逃し）
  supabase-staff.js            壊しても npm test は EXIT 0（見逃し）
  supabase-storage.js          npm test が EXIT 1 で捕まえた
  supabase-vendor-entry.mjs    壊しても npm test は EXIT 0（見逃し）
見逃し: 4 本 / 5 本
```

---

### 9. 検査の設定が、もう無い場所を指している
種別: 解決

**原因**: `src-dist-guard.config.json` の1項目が、削除済みの `src/design-samples/` を指していた。
検査側が `if (!fs.existsSync(srcDirFull)) continue;` で**黙って飛ばす**ため、
調べていないのに 0 件で合格していた。
**直したこと**: 死んだ設定項を削除し、検査を「**設定が実在しない場所を指したら EXIT 1**」に変えた。
設定を消すだけでは、次に同じことが起きたときまた黙って通る。

#### 直す前（赤）
```
#9 src-dist-guard の設定: 3 項目 / うち実在しない場所を指すもの: 1 件
     src/design-samples  ← Design samples → dist root
   その設定のまま検査を回した結果: EXIT 0（死んだ設定を黙って飛ばして合格にした）
```

#### 直した後（緑）
```
#9 src-dist-guard の設定: 2 項目 / うち実在しない場所を指すもの: 0 件
   その設定のまま検査を回した結果: EXIT 0
```

死んだ設定を**わざと戻したときに、検査が止めること**も確認した（設定を消しただけではない証拠）:

```
❌ src-dist-guard.config.json が、実在しない場所を指しています (1 件):
  [Design samples → dist root] srcDir: src/design-samples (NOT FOUND)

  → その場所を調べていないまま合格になります。設定から消すか、場所を直してください
exit=1
```

#### 直しを戻した（また赤）
```
#9 src-dist-guard の設定: 3 項目 / うち実在しない場所を指すもの: 1 件
     src/design-samples  ← Design samples → dist root
   その設定のまま検査を回した結果: EXIT 0（死んだ設定を黙って飛ばして合格にした）
```

---

### 10. まっさらな環境では、検査そのものが失敗する
種別: 解決

**原因**: `dist/` は `.gitignore` で管理外なので、クローン直後は必ず 0 ファイル。
そこへ `npm run check` を掛けると「src→dist drift detected」と出る。
**中身が食い違っているわけではなく、まだ組み立てていないだけ**なのに、同じ文面で出ていた。
初めての人はこれを「自分の環境が壊れている」と読む。

**直したこと**: `dist/` そのものが無い場合を区別し、次にやることを出すようにした。
**判定は緩めていない**——EXIT 1 のままで、合格にはしない（D-18 偽-4 を避ける）。
`dist/` が在って一部だけ欠けている場合は、これまでどおり drift として報告する。

#### 直す前（赤）
```
❌ src→dist drift detected (3 件):
  [Root HTML] src/index.html → dist/index.html (NOT FOUND)
  [JS files] src/js/dummy.js → dist/js/dummy.js (NOT FOUND)
  [JS files] src/js/ui.js → dist/js/ui.js (NOT FOUND)

  → npm run build を実行するか、dist に対応物を追加してください
exit=1
```

#### 直した後（緑）
```
まだ組み立てていません（dist/ が無い）。

  dist/ は git の管理外（.gitignore）なので、クローン直後には存在しません。
  新しい環境では、この順で実行してください:

    npm ci
    npm run build
    npm run check
exit=1
```

案内どおりに `npm run build` を実行したあと:

```
✅ src→dist parity OK
exit=0
```

**本物のドリフトは今も検出する**ことも確認した（`dist/js/ui.js` だけ消した場合）:

```
❌ src→dist drift detected (1 件):
  [JS files] src/js/ui.js → dist/js/ui.js (NOT FOUND)
```

#### 直しを戻した（また赤）
```
❌ src→dist drift detected (3 件):
  [Root HTML] src/index.html → dist/index.html (NOT FOUND)
  [JS files] src/js/dummy.js → dist/js/dummy.js (NOT FOUND)
  [JS files] src/js/ui.js → dist/js/ui.js (NOT FOUND)

  → npm run build を実行するか、dist に対応物を追加してください
exit=1
```
