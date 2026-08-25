# F3 「該当した」10件の解決記録（3出力・D-18）

> `docs/ops/bad-scenarios-F3.md` で **`結果: 該当した`** になった項目について、
> 1件につき **① 直す前（赤） ② 直した後（緑） ③ 直しを戻した（また赤）** を貼る。
> 機械: `node scripts/guard/solved.mjs F3`
>
> **今回は提案の時点で10個すべてを実測した**（`F-20260825-32` の教訓）。
> ここに貼るのは「該当するか」ではなく「**原因が無くなったか**」の裏づけ。
>
> **潰す順は深刻さの順ではなく、道具から。** `#9`（結線すると検査が赤）と
> `#8`（合否の写真が撮れない）は他の8件を直すための**道具**なので先に直す。

---

### 9. F3 の結線を1行入れた瞬間、`npm run check` が赤になる
種別: 解決

**原因**: `scripts/guard/isolation.mjs` の条件B（UI から `backend/` `/api/` `fetch(` 外部URL への
参照が0）は **F1 の完了条件**だが、**F3 の仕事はまさにその結線**である。目的が正面から矛盾しており、
結線表（`plan.md` 第4章）の**どの行を実装しても必ず赤くなる**。フェーズを見ずに常時掛けていたのが原因。

**直したこと**: 条件Bを**フェーズで切り替える**ようにした（`D-20260825-42`・マスター判断）。
`B_PHASES = new Set(['F1', 'F2'])` に無いフェーズでは条件Bを見ない。**条件A は F3 でも残す**
（置いたきり誰からも呼ばれないファイルを増やさない検査で、結線とは矛盾しない）。

**A-4（検査を消して緑にしない）に触れないための造り**:
- `docs/ops/phase` が読めないときは**掛ける側に倒す**（`phase === null` なら B を掛ける）。検査は緩いほうへ倒さない
- **外した回は、外したと毎回声に出す。** 緑の行も `✅ 隔離 OK` ではなく
  `✅ 条件A のみ OK（… / 条件B: **見ていない**）` に変える。緑を見た人が「隔離も見た」と誤読しない（`D-18` 偽-2）
- 走査件数の表示も、B を見ていない回は `中身を読んだ 0` と正直に出す
- **書き換えなしで戻る。** `docs/ops/phase` を F1 / F2 に戻せば条件Bは自動的に復活する

#### 直す前（赤）
結線表どおりの最小の2行（`import { mapPet } …` と `fetch('/api/pets')`）を
まっさらな複製の `src/js/ui.js` に入れて、フェーズ F3 のまま検査した。

```
$ REPO_ROOT=$SB node scripts/guard/isolation.mjs src
[isolation] src/ を走査: 全 34 ファイル / index.html から到達 23 / 中身を読んだ 4

❌ 隔離できていません（1 件）

【条件B】UI からバックエンド・外部への繋がりが 3 件あります。
    src/js/ui.js:410  backend/ への参照
      import { mapPet } from '/backend/js/supabase-staff.js';
    src/js/ui.js:411  API の呼び出し先
      const res = await fetch('/api/pets');
    src/js/ui.js:411  通信そのもの
      const res = await fetch('/api/pets');
  F1 は「UI とバックエンドの隔離」です。UI は src/js/dummy.js の仮データだけで動くこと。
EXIT=1
```

#### 直した後（緑）
**同じ複製・同じ結線・同じ命令。** 違うのは `isolation.mjs` がフェーズを見るようになったことだけ。

```
$ REPO_ROOT=$SB node scripts/guard/isolation.mjs src
[isolation] src/ を走査: 全 34 ファイル / index.html から到達 23 / 中身を読んだ 0
⚠️  【条件B は見ていません】フェーズ F3 では UI→backend の隔離を検査しません（D-20260825-42）。
    F3 の仕事は UI と backend をつなぐことなので、B を掛けたままだと結線できません。
    **この実行が緑でも「隔離できている」ことの証明にはなりません。** 見たのは条件A だけです。
    B を戻すには docs/ops/phase を F1 / F2 に戻します（書き換えは要りません）。
✅ 条件A のみ OK（条件A: 未到達 0 件・あと回し登録済み 11 件は除く / 条件B: **見ていない**）
EXIT=0
```

**条件A は F3 でも生きている**ことを、孤児ファイルを置いて確かめた（消したのは B だけ）。

```
$ echo "console.log('orphan');" > $SB/src/js/orphan-probe.js
$ REPO_ROOT=$SB node scripts/guard/isolation.mjs src
❌ 隔離できていません（1 件）

【条件A】src/index.html からどこにも繋がっていないファイルが 1 件あります。
    src/js/orphan-probe.js
EXIT=1
```

#### 直しを戻した（また赤）
`docs/ops/phase` を `F1` に戻すだけで、**同じ結線が同じ3件で止まる**。
検査は消えておらず、フェーズで寝ているだけであることの裏づけ。

```
$ echo "F1" > $SB/docs/ops/phase
$ REPO_ROOT=$SB node scripts/guard/isolation.mjs src
[isolation] src/ を走査: 全 34 ファイル / index.html から到達 23 / 中身を読んだ 4

❌ 隔離できていません（1 件）

【条件B】UI からバックエンド・外部への繋がりが 3 件あります。
    src/js/ui.js:410  backend/ への参照
      import { mapPet } from '/backend/js/supabase-staff.js';
    src/js/ui.js:411  API の呼び出し先
      const res = await fetch('/api/pets');
    src/js/ui.js:411  通信そのもの
      const res = await fetch('/api/pets');
  F1 は「UI とバックエンドの隔離」です。UI は src/js/dummy.js の仮データだけで動くこと。
EXIT=1
```

**この記録の限界**: ここで確かめたのは「結線しても検査が止めなくなったこと」だけで、
**結線が正しく動くことは何も確かめていない**（`D-18` 偽-5）。それは `#1`〜`#7` と `#10` の領分。

---

### 8. 合否の根拠になる写真が、まっさらなコンテナで撮れない
種別: 解決

**原因**: `playwright@1.59.1` は chromium revision **1217** を同梱前提にしているが、
この環境に在るのは **1194**。`chromium.launch()` が `Executable doesn't exist` で落ち、
**`npm run walk` が1コマも撮れない**。D-14 の合否は**この絵だけ**で決まるので、
落ちると「合格とも不合格とも言えない」状態になる。
マスターの PC では版が一致していたため、**前のコンテナでの「walk EXIT 0・3回連続」は正しく、
新しいコンテナでだけ赤くなる**——`F-20260825-33`「自分が動かせる環境でしか確かめていない」の型。

**アプリの不具合ではない**ことを先に切り分けた。`WALK_CHROMIUM` に在る実行ファイルを
渡すと **5コマ・EXIT 0** で最後まで通る。壊れているのは**ブラウザの探し方だけ**。

**直したこと**: `scripts/walk-human.mjs` に4段の選び方を入れた。
①`WALK_CHROMIUM` の明示指定 → ②既定で起動できればそれ → ③駄目なら**入っているものを探して**使う
（ビルド番号の大きいものを選ぶ・Linux / macOS / Windows の置き場所を見る）→ ④無ければ
**何をすれば直るかを言って**落ちる。

**黙って別のブラウザに差し替えない。** ③で拾ったときは
`playwright が期待する版が無いので、この環境に在るものを使う: <パス>` と毎回出力する。
マスターの PC では①か②で決まるので、この行は出ない。

#### 直す前（赤）
```
$ npm run walk
browserType.launch: Executable doesn't exist at /opt/pw-browsers/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell
║ Looks like Playwright was just installed or updated.       ║
EXIT=1

$ ls /opt/pw-browsers/
chromium  chromium-1194  chromium_headless_shell-1194  ffmpeg-1011
```

アプリ側は無事であることの切り分け（在る実行ファイルを手で渡す）:

```
$ WALK_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run walk
01  01 URLを開いた
02  02 ログインした
03  03 犬の名前を選んだ
04  04 カルテを書いた
05  05-06 確認と顧客ページ（同一画面・screen-4）
EXIT=0
```

#### 直した後（緑）
**素の `npm run walk`**（環境変数を渡さない）。使ったブラウザを自分から言っている。

```
$ npm run walk
[build] 完了  34件
[walk] playwright が期待する版が無いので、この環境に在るものを使う: /opt/pw-browsers/chromium-1194/chrome-linux/chrome
       （絵の判定には十分だが、マスターの PC とビルド番号が違うことは意識すること）
01  01 URLを開いた
02  02 ログインした
03  03 犬の名前を選んだ
04  04 カルテを書いた
05  05-06 確認と顧客ページ（同一画面・screen-4）
EXIT=0
```

**1回通っただけを根拠にしない**（`F-20260821-23`）。3回連続と、間違えたときの8コマも確かめた。

```
$ for i in 1 2 3; do npm run walk; done
walk 1回目 EXIT=0
walk 2回目 EXIT=0
walk 3回目 EXIT=0

$ npm run walk mistakes
01  M1-0 違う犬を選んでしまった
02  M1-1 タッチ1 一覧へ
03  M1-2 タッチ2 正しい犬
04  M2-0 記入中
05  M2-1 一覧へ戻ってしまった
06  M2-2 タッチ1 同じ犬に戻った 書きかけは残っているか
07  M3-0 顧客ページまで進んだ
08  M3-1 タッチ1 カルテ作成へ戻った
EXIT=0
```

#### 直しを戻した（また赤）
`git checkout -- scripts/walk-human.mjs` で選び方だけを戻すと、同じ環境で同じように落ちる。

```
$ git checkout -- scripts/walk-human.mjs
$ npm run walk
browserType.launch: Executable doesn't exist at /opt/pw-browsers/chromium_headless_shell-1217/chrome-headless-shell-linux64/chrome-headless-shell
║ Looks like Playwright was just installed or updated.       ║
EXIT=1
```

**この記録の限界**: 直したのは**絵を撮れるようにしたこと**だけで、
**絵の中身が合格かどうかは何も言っていない**（`D-18` 偽-5）。合否はマスターが絵を見て決める。
また `scripts/guard/checkout.mjs` は依然 `walk` を走らせないので、
**終了時の検査は「絵が撮れること」を保証しない**。ここは `docs/deferred.md` に登録した。

---

### 11. 関所が「見た」と言いながら、コミットしたものを一度も見ていない
種別: 解決

**原因**: `scripts/guard/run.mjs` が変更集合を `git status --porcelain`（＝**HEAD との差分＝未コミット分だけ**）
で作っていた。`git commit` した瞬間に `files.length === 0` になり `[guard] 変更なし` で EXIT 0。
②③の関所（`missingArtifacts`）は**そもそも呼ばれない**。
**検査を1文字も書き換えずに `A-4` を破れる**形だった。

**この項の「赤」は EXIT 1 ではない。** 症状は逆で、**止まるべきときに止まらない**こと。
だから ① と ③ が EXIT 0、② が EXIT 1 になる。

**直したこと**: 変更集合を「**出発点（`origin/master`）からこの枝で変えたもの**」にした。
コミット済みの差分（`git diff merge-base HEAD`）＋ 未コミットの変更。
出発点が見つからないときは従来どおり未コミット分だけを見る（判定できないときに緩めない）。

**あわせて関所の条件も変えた**（マスター判断・`D-20260825-43`）。
**作業中は「未解決が減っていること」・閉じるときは「0件」**を要求する。
常に0件を要求すると、`#8` `#9` のように**直す場所が作業場の中にある項**は永久に着手できず、
**地雷を潰す作業そのものが止まっていた**。数えるのは**出発点に在った項目だけ**にした——
新しく見つけた項目を分母に入れると、**見つけて記録するほど条件が厳しくなり、
記録しないほうが得**になるため。新しい項目も閉じるときには 0件を要求されるので逃がしていない。

#### 直す前（赤）
未解決を1件も減らさずに `src/js/ui.js` を触り、**コミットした**状態。止まらなければならない。

```
$ node scripts/guard/run.mjs
[guard] いまのフェーズ: F3（正UI とバックエンドをつなぐ）
[guard] 変更なし
EXIT=0
```

#### 直した後（緑）
**同じ枝・同じコミット・同じ命令。** 違うのは `run.mjs` が出発点から見るようになったことだけ。

```
$ node scripts/guard/run.mjs
  - ② バッドシナリオの**未解決が減っていない**（出発点 11件 → いま 11件） → docs/ops/bad-scenarios-F3.md
   作業場を触ってよいのは、**この書類の未解決を減らす変更**のときだけです。
   1件でも解決して（見出しを「結果: 該当した ／ 解決済み」にし、docs/ops/solved-F3.md に3出力を貼る）から進めてください。
   まだ手つかず: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11
EXIT=1
```

逃げ道も塞いだことを、別々に確かめた。

```
$ # 「該当した（あとで見る）」と注記を足して数から外そうとする
$ node scripts/guard/gate.mjs src/js/ui.js
- ② バッドシナリオの**未解決が減っていない**（出発点 9件 → いま 9件）
EXIT=1

$ # フェーズを閉じるときは、いまも 0件必須
$ node scripts/guard/gate.mjs --end
- ② バッドシナリオに**手つかずの「該当した」が 9件**残っている
   フェーズを閉じるには 0 件にすること。
EXIT=1
```

#### 直しを戻した（また赤）
`run.mjs` だけを元の版に戻すと、同じ枝・同じコミットで、また素通りする。

```
$ git show master:scripts/guard/run.mjs > scripts/guard/run.mjs
$ node scripts/guard/run.mjs
[guard] いまのフェーズ: F3（正UI とバックエンドをつなぐ）
[guard] 変更なし
EXIT=0
```

**この記録の限界**: 直したのは**関所が見る範囲**だけで、
**過去にコミットされた変更が正しかったことは何も言っていない**（`D-18` 偽-5）。
この枝より前の履歴は、依然として一度も関所を通っていない。
