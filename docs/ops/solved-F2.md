# F2 「該当した」7件の解決記録（3出力・D-18）

> `docs/ops/bad-scenarios-F2.md` で **`結果: 該当した`** になった項目について、
> 1件につき **① 直す前（赤） ② 直した後（緑） ③ 直しを戻した（また赤）** を貼る。
> 機械: `node scripts/guard/solved.mjs F2`
>
> **提案の時点では確かめていなかった。** マスターの「根拠を持っているのか」という
> 指摘を受けて全件を実測し、3件が該当せず、11個目が見つかった（`docs/failures.md` F-20260825-32）。

---

### 1. 新しいお客さんの犬を、作る場所がどこにも無い
種別: 解決

**原因**: `design/mock-4step.html:1814` に在る「＋ 新規カルテを作成する」が `src/index.html` に無かった。
実体 `createNewKarte()` は `src/js/ui.js:127` に生きていて、**押す場所だけが消えていた**（`D-20260824-37` と同型・4回目）。
**直したこと**: モックの該当ブロック（6行）を `src/index.html` の犬一覧の直後へ**逐語で移した**。
自分でボタンを設計していない（`plan.md` 第3章「意匠モックが正。自分の発案を混ぜない」）。

#### 直す前（赤）
```
$ grep -c createNewKarte design/mock-4step.html src/index.html src/js/ui.js
design/mock-4step.html:2
src/index.html:0
src/js/ui.js:1
$ grep -cE '＋|新規' src/index.html
0
```

#### 直した後（緑）
```
$ grep -c createNewKarte src/index.html
1
（実ブラウザで押した結果）
  ボタンが見えているか: はい
  押した後の画面: screen-3 / 見出し: 新規わんちゃん カルテ作成
```

#### 直しを戻した（また赤）
移したブロックを外すと、実体は残ったまま押す場所が消える。

```
$ grep -c createNewKarte design/mock-4step.html src/index.html src/js/ui.js
design/mock-4step.html:2
src/index.html:0
src/js/ui.js:1
$ grep -cE '＋|新規' src/index.html
0
```

---

### 2. 戻る手段が、消す予定のタブに乗っている
種別: 保留

**なぜ「解決」と呼ばないか**: **意匠モックの `screen-3` にも戻るボタンは無い**（`onclick` を全部並べて
突き合わせた結果、モックと `src` は完全一致）。ここでボタンを足すのは
`plan.md` 第3章「自分の発案を混ぜない」に反する（`D-18` 偽-7）。
`01〜04` タブを撤去するかは**マスター判断**なので、**F2 では撤去しない**ことで担保する。

- 記録: `docs/deferred.md` **#2**（01〜04 タブの扱い・マスター判断待ち）
- 実測: `npm run walk mistakes` で、タブ経由なら **M1 は2タッチ・M2 と M3 は1タッチ**で戻れることを確認した
- **撤去した場合に何が起きるか**: `screen-3` から一覧へ戻る手段は HOME（→ `screen-1` ログイン画面）だけになり、
  やりたかった操作（正しい犬を選ぶ）に **3タッチ以上**かかる＝完了条件2を満たせなくなる

---

### 4. 写真が出ず、文字だけが並ぶ
種別: 解決

**原因**: `<img>` 14件のうち 11件が `src=""`。HTML の `src=""` は**空文字を URL として解決**するため、
`img.src` が**現在のページURL**を返す。これは `D-20260824-30` #3（空スロットにページURLが保存され、
飼い主に壊れた画像が届く）の**再発条件そのもの**。
**直したこと**: `src` 属性ごと落とした。属性が無ければ `img.src` は空文字を返す。
`#lightbox-img` は `ui.js:396` で代入するので影響しない。

> **絵として `alt` の文字が出ること自体は直していない**（仮データに写真が無いため）。
> 見た目の扱いはマスター判断として画像で提示する（ルール④「進める状態までしか直さない」）。

#### 直す前（赤）
```
$ grep -oE '<img[^>]*>' src/index.html | grep -c 'src=""'
11
（実ブラウザで）空 src の img が読もうとした先: 11件 → 例: http://127.0.0.1:8831/
```

#### 直した後（緑）
```
$ grep -oE '<img[^>]*>' src/index.html | grep -c 'src=""'
0
（実ブラウザで）空 src の img が読もうとした先: 11件 → 例: 
  400以上の応答: （無し）
```

#### 直しを戻した（また赤）
```
$ grep -oE '<img[^>]*>' src/index.html | grep -c 'src=""'
11
（実ブラウザで）空 src の img が読もうとした先: 11件 → 例: http://127.0.0.1:8831/
```

---

### 5. ⑤と⑥が同じ画面なので、「最後まで着いた」が言えない
種別: 解決

**原因**: 画面は `screen-1`〜`screen-4` の**4枚しかない**のに動線は6段階で、⑤も⑥も `goToStep(4)`。
これは意匠モックどおりの設計（`plan.md` 第4章「⑤と⑥は同一レンダラ」）なので**画面は変えない**。
問題は**判定の言葉**——絵を見る人が「⑤で止まったのか⑥に着いたのか」を判別できないこと。
**直したこと**: `walk-human.mjs` のコマのラベルを
`05 確認・顧客ページ` → **`05-06 確認と顧客ページ（同一画面・screen-4）`** にした。
別々に着いたように見せない。

#### 直す前（赤）
```
$ cat .human/correct/_操作ログ.txt
05  05 確認・顧客ページ
（⑥に着いたのか⑤で止まったのか、絵からもラベルからも判別できない）
```

#### 直した後（緑）
```
$ cat .human/correct/_操作ログ.txt
05  05-06 確認と顧客ページ（同一画面・screen-4）
```

#### 直しを戻した（また赤）
```
$ cat .human/correct/_操作ログ.txt
05  05 確認・顧客ページ
（⑥に着いたのか⑤で止まったのか、絵からもラベルからも判別できない）
```

---

### 6. 「2タッチ」の数え方を決めていない
種別: 解決

**調べたら想定と違った**: 数え方は既に決まっていた（`walk-human.mjs` が `M1-1 タッチ1` `M1-2 タッチ2` と
コマごとに番号を振る）。**本当の問題は #11**——その番号を振る前の「記入」が実際には行われておらず、
**M2「書きかけは残っているか」が検査として成立していなかった**。
**直したこと**: #11 を直した結果、M2 が意味を持つようになった。

#### 直す前（赤）
```
$ npm run walk mistakes
（M3 まで到達できず）
locator.tap: Timeout 30000ms exceeded.
  - <div>左耳 (L)</div> from <div class="editor-wrapper"> subtree intercepts pointer events
（M2-0 記入中 と M2-2 戻った の画像が同一＝書きかけが最初から無い）
```

#### 直した後（緑）
```
$ npm run walk mistakes   → EXIT 0
01  M1-0 違う犬を選んでしまった
02  M1-1 タッチ1 一覧へ
03  M1-2 タッチ2 正しい犬
04  M2-0 記入中
05  M2-1 一覧へ戻ってしまった
06  M2-2 タッチ1 同じ犬に戻った 書きかけは残っているか
07  M3-0 顧客ページまで進んだ
08  M3-1 タッチ1 カルテ作成へ戻った
（M2-2 の画像に「書きかけの所見です」が残っていることを目視で確認）
```

#### 直しを戻した（また赤）
```
$ npm run walk mistakes
（M3 まで到達できず）
locator.tap: Timeout 30000ms exceeded.
  - <div>左耳 (L)</div> from <div class="editor-wrapper"> subtree intercepts pointer events
（M2-0 記入中 と M2-2 戻った の画像が同一＝書きかけが最初から無い）
```

---

### 7. `src` を直したのに、画面は古いまま
種別: 解決

**原因**: `npm run serve` と `walk` が配るのは `dist/`（`scripts/serve-ui.mjs:14`）で、
`npm run build` を挟まないと `src/` の変更は画面に出ない。`dist/` は `.gitignore` 管理外。
**直したこと**: 実は `npm run walk` は既に `build` を含んでいた（`"walk": "node scripts/build-dist.mjs && node scripts/walk-human.mjs"`）。
足りなかったのは**それを知らずに `serve` だけを使う経路**なので、`AGENTS.md` に
「新しいクローンでは `npm ci` → `npm run build` → `npm run check` の順」を明記した（F1 の #10 で対応済み）。

#### 直す前（赤）
`dist/` だけを書き換えて配信元を確かめた（`src/` は無変更）。

```
配信された HTML に「【dist を直接書き換えた】」が含まれるか: 含まれる → 配信元は dist
src/index.html は無変更のまま: はい
```

#### 直した後（緑）
```
$ grep '"walk"' package.json
    "walk": "node scripts/build-dist.mjs && node scripts/walk-human.mjs",
$ npm run walk   → EXIT 0（build を経由するので src の変更が必ず画面に出る）
```

#### 直しを戻した（また赤）
`build` を挟まなければ、`dist/` の内容がそのまま配られる。

```
配信された HTML に「【dist を直接書き換えた】」が含まれるか: 含まれる → 配信元は dist
src/index.html は無変更のまま: はい
```

---

### 11. 検査が「カルテを書いた」と言いながら、実際には何も書いていない
種別: 解決

**原因**: `walk-human.mjs` が `[contenteditable="true"]` を探していたが、**現 UI に `contenteditable` は 0件**。
`scrollIntoViewIfNeeded()` と `tap()` の失敗は `.catch(() => {})` で握りつぶされ、
`keyboard.type()` はフォーカスの無いまま流れていた。だから「04 カルテを書いた」の写真は
**何も書かれていない画面**だった。
**直したこと**: `writeKarte()` を新設し、実在する `#editor-trimmer-letter` に `fill()` して、
**入った値を読み返して照合する**。一致しなければ例外を投げて止める（握りつぶさない）。

#### 直す前（赤）
```
$ grep -c contenteditable src/index.html
0
$ npm run walk
01  01 URLを開いた
02  02 ログインした
03  03 犬の名前を選んだ
locator.waitFor: Timeout 30000ms exceeded.
exit=1
```

#### 直した後（緑）
```
$ npm run walk   → EXIT 0
01  01 URLを開いた
02  02 ログインした
03  03 犬の名前を選んだ
04  04 カルテを書いた
05  05-06 確認と顧客ページ（同一画面・screen-4）
（04 の画像で、⑦担当トリマーからのメッセージに「今日はおとなしくしていました。」が入っていることを確認）
```

#### 直しを戻した（また赤）
入力先を `[contenteditable="true"]` に戻すと、書けないまま止まる。

```
$ grep -c contenteditable src/index.html
0
$ npm run walk
01  01 URLを開いた
02  02 ログインした
03  03 犬の名前を選んだ
locator.waitFor: Timeout 30000ms exceeded.
exit=1
```

---

## 463px 問題（`D-20260825-39`・マスター承認済み）

バッドシナリオの番号は付いていないが、**F2 の完了条件1（最後まで到達できた）を直接塞いでいた**ので
同じ形式で残す。

種別: 解決

**原因**: `.editor-columns { grid-template-columns: 1fr }` の `1fr` は `minmax(auto, 1fr)`＝下限が min-content。
中の1要素が縮まないと枠ごと広がり、iPhone 13（390px）で 465px になって確定ボタンのタップを別要素が奪っていた。
**直したこと**: `minmax(0, 1fr)` に変えた。**文字サイズも余白も変えていない**（＝「レイアウト縮小」ではない）。

#### 直す前（赤）
```
$ npm run walk
01  01 URLを開いた
02  02 ログインした
03  03 犬の名前を選んだ
04  04 カルテを書いた
locator.tap: Timeout 30000ms exceeded.
  - <div class="editor-col-card">…</div> from <div class="editor-wrapper">…</div> subtree intercepts pointer events
```

#### 直した後（緑）
```
$ npm run walk   → EXIT 0（3回連続で EXIT 0・5コマ）
  1 回目: EXIT 0 / コマ数 5
  2 回目: EXIT 0 / コマ数 5
  3 回目: EXIT 0 / コマ数 5
（4画面の実測: screen-1 390px / screen-2 390px / screen-3 390px / screen-4 390px）
```

#### 直しを戻した（また赤）
```
$ npm run walk
01  01 URLを開いた
02  02 ログインした
03  03 犬の名前を選んだ
04  04 カルテを書いた
locator.tap: Timeout 30000ms exceeded.
  - <div class="editor-col-card">…</div> from <div class="editor-wrapper">…</div> subtree intercepts pointer events
```
