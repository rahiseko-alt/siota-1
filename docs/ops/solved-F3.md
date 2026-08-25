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

---

### 1. 誰も書いていない手紙が、「担当トリマーから」としてお客さんに届く
種別: 解決

**原因**: `renderMagazine(container, report)` の先頭が `if (!container || !report) return;` で、
**例外も投げず、器にも触れずに帰っていた**。⑥の器（`src/index.html` の `screen-4`）には
意匠モック由来の「担当トリマーからのメッセージ」の文例が入っているので、カルテが取れなかった
とき**その文例が、担当トリマーが書いたものとして飼い主に見え続ける**。
`AGENTS.md` D-2「`null` は必ず失敗として扱う」の、保存側ではなく**表示側**。

**文例そのものは消していない。** `design/mock-4step.html` にも同じ文が **2件**在り、
意匠モックが正（`plan.md` 第3章「自分の発案を混ぜない」）。加えて既定文の存廃は
**マスター判断待ち**（`docs/deferred.md` #13・`plan.md` 第6章）。
ここで直したのは**失敗したときに文例が生き残る経路**だけで、意匠には触れていない。

**直したこと**:
1. `report` が無いときは **`EMPTY_HTML` で器を空にしてから投げる**。
   呼び出し側が握りつぶしても、**偽の手紙だけは残らない**
2. `container` が無いときも投げる（黙って帰らない）
3. 空の状態に**文例を置かない**。「担当トリマーからのメッセージ」の見出しごと消す——
   見出しだけ残ると、本文が空でも「書いたが空だった」ように読めてしまう
4. `test/magazine-view.test.mjs` を新設し、**`npm test` から呼ぶようにした**
   （`test:unit` に追加）。検査に入れていないものは、次に誰かが戻せる

#### 直す前（赤）
```
$ node --test test/magazine-view.test.mjs
not ok 1 - カルテが無いとき、静かに帰らずに失敗として投げる
not ok 2 - カルテが無いとき、器に前の内容を残さない（偽の手紙を見せない）
not ok 3 - 空の状態に、文例を混ぜない
not ok 4 - 描画先の器が無いときも、静かに帰らない
# pass 5
# fail 4
EXIT=1
```

実際に何が見えるかも測った（`renderMagazine` に `report=null` を渡す）:

```
renderMagazine(container, null) の戻り値 : undefined
例外は投げたか                          : いいえ（ここに到達している）
器の中身は変わったか                    : いいえ（固定文がそのまま残る）
飼い主に見えるもの                      : 今月もとってもお利口にトリミングさせてくれました。…
```

#### 直した後（緑）
```
$ npm test
# tests 9
# pass 9
# fail 0
npm test EXIT=0
```

`test:unit` に組み込んだので、`npm test` を通せば必ず走る。

```
$ node -e "console.log(require('./package.json').scripts['test:unit'])"
node --test test/worker-unit.test.mjs test/magazine-view.test.mjs
```

#### 直しを戻した（また赤）
`backend/js/magazine-view.js` だけを元に戻すと、同じ4件が落ちる。

```
$ git checkout -- backend/js/magazine-view.js
$ npm test
not ok 1 - カルテが無いとき、静かに帰らずに失敗として投げる
not ok 2 - カルテが無いとき、器に前の内容を残さない（偽の手紙を見せない）
not ok 3 - 空の状態に、文例を混ぜない
not ok 4 - 描画先の器が無いときも、静かに帰らない
# pass 5
# fail 4
EXIT=1
```

**この記録の限界**: 塞いだのは「**描画に失敗したとき**に文例が生き残る経路」。
**⑥が一度も描画されない場合**（JS が動かない・器が無い）は、静的な文例がそのまま見える。
そこは **`#7`（⑥の器が `src/` に無い）と `#10`（古典スクリプトと ES モジュール）** の領分で、
**どちらもまだ未解決**。両方が閉じるまで F3 は閉じられないので、この穴が素通りすることはない。
既定文そのものの存廃は**マスター判断待ち**（`deferred` #13）。

---

### 2. 消したはずの写真が残り、しかも誰も回収できなくなる
種別: 解決

**原因**: 順序を守らせる仕組みが**1つも無かった**。片付けの関数
（`purgePetAssets` / `purgeOwnerAssets`）は `backend/js/supabase-storage.js` に在って
**実装は正しい**が、①**呼ぶ順序を守らせる検査が無い** ②**その関数自体のテストが 0件**
③唯一の防波堤 `verify-delete.mjs` は `6685df5` で削除済み、の3点が重なっていた。
`src/` に削除導線はまだ無く、**F3 でこれから書く**ので、書いた瞬間に踏める。

犬を先に消すと FK カスケード（pets → reports → report_assets）で `reports` 行が消え、
Storage ポリシー `private.storage_path_staff` の条件が偽になる。以後その写真は
**スタッフからも飼い主からも列挙も削除もできない**。回収は service_role のみで、
孤児の在処を示す `report_assets.storage_path` も道連れ。画面上は「消えました」と出る。

**実行時に確かめる検査は作れない。** 消えた `verify-delete.mjs` の冒頭にこうある——
「**RLS 越しに見てはいけない。削除後は『残っていても見えない』ので、RLS 越しの確認は
必ず合格してしまう**」。だから**呼ぶ順序を静的に**見る検査にした。

**直したこと**:
1. `scripts/guard/delete-order.mjs` を新設。ブラウザ側（`src/` と `backend/js/`）で
   犬・飼い主を `DELETE` する場所が、同じファイルで片付けを呼んでいるかを見る。
   **`npm run check` に組み込んだ**ので、忘れても止まる
2. `purgePetAssets` / `purgeOwnerAssets` のテストを **4件**追加（それまで 0件）。
   **Storage だけを触り DB 行に一切触らない**ことを、DB を変える呼び出しが来たら
   落ちる偽 `api` で固定した。失敗時に投げること（＝犬の削除自体を止めること）も
3. サーバ側（`worker/`）は対象外。service_role を持たないので片付けられない——
   **片付けはブラウザ側の責任**という既存の契約をそのまま機械化した

#### 直す前（赤）
`src/js/ui.js` に、F3 が書きそうな**片付けを忘れた削除**を置いて、既存の検査を全部通した。

```
$ cat >> src/js/ui.js
async function deleteDog(petId) {
  await fetch(`/api/pets/${petId}`, { method: 'DELETE' });
}
$ npm run build && ...
  隔離 src        EXIT=0
  隔離 dist       EXIT=0
  src↔dist parity EXIT=0
  design 隔離     EXIT=0
  npm test        EXIT=0
  purge のテスト件数: 0
  → どれも止めない
```

`check` の中身に削除順序を見るものが在るかも数えた。

```
$ node -e "console.log(require('./package.json').scripts.check)" | tr '&' '\n' | grep -c delete-order
0 本（削除順序を見る検査は無い）
```

#### 直した後（緑）
同じ危ない削除を、新しい検査に通す。

```
$ REPO_ROOT=$SB node scripts/guard/delete-order.mjs
[delete-order] ブラウザ側を走査: 9 ファイル

❌ 写真を片付けずに削除している場所が 1 件あります

    src/js/ui.js
      犬を削除しているのに purgePetAssets() を呼んでいません

  **Storage → DB の順**です（D-20260824-34）。逆にすると、写真は残るのに
  スタッフからも飼い主からも見えず・消せなくなります（回収は service_role のみ）。
  **実行して確かめようとしないこと**——削除後は「残っていても見えない」ので、
  RLS 越しの確認は必ず合格します。
EXIT=1
```

**正常系も確かめた**（誤検出で仕事を止めないこと・`F-20260825-30` の教訓）。
片付けを1行足すと通る。飼い主側でも同じように効く。

```
$ # purgePetAssets({ client, api, petId }) を削除の前に足す
$ REPO_ROOT=$SB node scripts/guard/delete-order.mjs
✅ 削除の順序 OK（Storage を片付けずに DB を消す場所は 0 件）
EXIT=0

$ # 飼い主を purge 無しで消す行を足す
❌ 写真を片付けずに削除している場所が 1 件あります
    src/js/ui.js
EXIT=1
```

片付け関数そのものにもテストが付いた（0件 → 4件）。`npm test` は 64件 → **72件**。

```
$ npm run check
[delete-order] ブラウザ側を走査: 9 ファイル
✅ 削除の順序 OK（Storage を片付けずに DB を消す場所は 0 件）
check EXIT=0
$ npm test
EXIT=0
```

#### 直しを戻した（また赤）
`npm run check` から `delete-order` を外すと、同じ危ない削除が**また素通りする**。

```
$ # package.json の check から delete-order を外す
$ npm run check
  隔離 src        EXIT=0
  隔離 dist       EXIT=0
  src↔dist parity EXIT=0
  design 隔離     EXIT=0
  npm test        EXIT=0
  → どれも止めない
```

**この記録の限界**: 見ているのは**呼んでいるかどうか**だけで、
**実際に順序どおり動くこと・写真が本当に消えること**は何も言っていない（`D-18` 偽-5）。
同じファイルの中で片付けを**削除の後**に書いても、この検査は通ってしまう。
実体を数える検査（`verify-delete.mjs` の作り直し）は **`#6`** の領分で、
service_role が要るため**まだ作れていない**。`#6` はまだ未解決。
