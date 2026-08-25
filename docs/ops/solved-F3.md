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

---

### 3. トリマーが見つけた「しこり・イボ」が、どこにも残らず消える
種別: 解決

**原因**: `App.marks`（`src/js/ui.js:11`）は素の配列で、`pointerdown` で積んで
`drawCanvas()` で描くだけ。**取り出す道が1本も無かった**——`toDataURL` / `toBlob` /
`bodyMarkingImage` が `src/` に **0件**。一方で受け手 `backend/js/magazine-view.js:534` は
`data.bodyMarkingImage` を読む。**受ける側だけが在って、出す側が無い**状態だった。
画面を移れば `marks` は失われるので、トリマーが体を触って見つけた
**しこりが、飼い主にも記録にも残らずに消える**。

**直したこと**: `App.exportBodyMarking()` を足した。⑥の受け手が読む
`data.bodyMarkingImage` へ渡す**唯一の道**で、行き先は既にある設計に合わせただけ
（部位名の付け方などを自分で発明していない——`plan.md` 第3章）。

**黙って消えないことを、返り値の設計で担保した**:
- 印が1つも無いときは `null`。**白紙の絵を「所見あり」として残さない**
- 印が在るのに描き先が無いときは**投げる**。ここで黙って `null` を返すと、
  見つけた所見が消えたことに誰も気づけない（`#1` と同じ型）
- 取り出す前に `drawCanvas()` を通す。印を載せていない空の絵を出さない

`test/ui-body-marking.test.mjs` を新設し、**`test:unit` に組み込んだ**。
`src/js/ui.js` は古典スクリプトで `import` できないため、`vm` に最小限の
`document` を置いて読み込んでいる——**これ自体が `#10` の未解決の現れ**なので、
テストの冒頭にその旨を書いた。

#### 直す前（赤）
```
$ grep -cE "toDataURL|toBlob|bodyMarkingImage" src/js/ui.js src/index.html
src/js/ui.js:0
src/index.html:0            # 保存する道が1本も無い

$ grep -n "bodyMarkingImage" backend/js/magazine-view.js
534:  setImage(container, 'skin-image-frame', 'skin-image', data.bodyMarkingImage);
                            # 受ける側だけが在る

$ npm test
not ok 5 - 印が1つも無いときは null（白紙の絵を「所見あり」として残さない）
not ok 6 - 印を付けたら、カルテに残せる形で取り出せる
not ok 7 - 印の種類が変わっても、消えずに残る
not ok 8 - 印が在るのに描き先が無いときは、黙って null を返さず投げる
EXIT=1
```

#### 直した後（緑）
```
$ npm test
# pass 14   (test:unit)
# pass 51   (test:schema)
# pass 6    (test:migration)
# pass 6    (test:backend)
EXIT=0
```

3種類の印（`赤み` / `しこり/イボ` / `毛玉`）すべてで取り出せること、
印が在るのに描き先が無いときは投げること、**受け手が
`data.bodyMarkingImage` を読み続けていること**（出す側の行き先が消えていないこと）を
それぞれ検査している。`npm test` は 72件 → **77件**。

#### 直しを戻した（また赤）
`src/js/ui.js` だけを元に戻すと、同じ4件が落ちる。

```
$ git checkout -- src/js/ui.js
$ npm test
not ok 5 - 印が1つも無いときは null（白紙の絵を「所見あり」として残さない）
not ok 6 - 印を付けたら、カルテに残せる形で取り出せる
not ok 7 - 印の種類が変わっても、消えずに残る
not ok 8 - 印が在るのに描き先が無いときは、黙って null を返さず投げる
EXIT=1
```

**この記録の限界**: 作ったのは**道**であって、**まだ誰も通っていない**。
④の保存そのもの（`finalize_report` への結線）は F3 の本体作業で、未着手。
`exportBodyMarking()` を呼ぶ場所ができるまで、実際の絵は飼い主に届かない。

また、突き合わせたのは `bodyMarkingImage` **1キーだけ**。⑥は `data.*` を
**14キー**読んでおり（`bestWeight` `bodyLanguage` `date` `ear` `heroPhotos` `isoDate`
`nail` `pet` `skin` `staffNote` `teeth` `trimming` `weights`）、**残り13キーは
出す側がまだ無い**。`F-20260821-12/-13`「保存はされるのに復元で静かに消える」は
このズレから起きる型なので、④の保存を書くときは**キーの突き合わせから始める**
（`docs/ops/failure-check-F3-start.md` の持ち込み条件 1）。

---

### 4. 写真の取得に失敗すると、その写真だけ黙って消える
種別: 解決

**原因**: `hydrateAssetReferences` が `download` の失敗を **`if (error || !blob) continue;`**
で捨てていた（`backend/js/supabase-storage.js:158-159`）。件数の報告も無い。
そこから先は**黙って消える経路が繋がっていた**:

```
download 失敗 → 記録なし（continue）
  → replaceMarkers: `urls.get(id) || ''` で **空文字**に置換
    → setImage: `has === false` なので枠ごと `hidden`
      → 飼い主の画面には、**その写真が最初から無かったように見える**
```

店の人は「載せたはず」、飼い主は「載っていない」。**どちらも気づけない。**

**直したこと**:
1. `hydrateAssetReferences` が **`failed`** を返す。`error.message` が無い場合
   （`blob` が空）も「中身が空でした」として拾う——**`error` が無いから成功、にしない**
2. **投げない。** 1枚読めないだけでカルテ全体を止めるのは飼い主にとって損なので、
   読めた分は表示し、読めなかった分を報告する
3. **呼び出し側が必ず見えるところに出す。** `backend/js/supabase-auth.js` の
   `renderReport` が `showAssetFailures()` で件数を画面に出す。
   **報告する値を誰も読まなければ、握りつぶしと同じ**なので、そこまでを1組にした
4. 飼い主の画面に**保存先のパスは出さない**。件数と、やり直す方法だけ

#### 直す前（赤）
```
$ sed -n '157,160p' backend/js/supabase-storage.js
    const { data: blob, error } = await client.storage.from(bucket).download(asset.storage_path);
    if (error || !blob) continue;
                            # 失敗を数えても報告してもいない

$ npm test
not ok 26 - 写真が読めなかったら、黙って消さずに報告する
not ok 27 - 中身が空でも失敗として報告する（error が無くても見逃さない）
not ok 28 - 読めた写真だけが URL になり、読めた分は失敗に数えない
not ok 29 - 全部読めたときは、失敗は 0 件
not ok 30 - 呼び出し側が failed を必ず見ている（握りつぶしに戻っていない）
EXIT=1
```

#### 直した後（緑）
```
$ npm test
# pass 14   (test:unit)
# pass 56   (test:schema)
# pass 6    (test:migration)
# pass 6    (test:backend)
EXIT=0
```

**握りつぶしに戻れないよう、呼び出し側も検査している**——
`supabase-auth.js` が `hydrated.failed` を読み、`showAssetFailures` を持つことを
テストが要求する。片方だけ戻すと落ちる。`npm test` は 77件 → **82件**。

#### 直しを戻した（また赤）
`backend/js/supabase-storage.js` と `supabase-auth.js` を元に戻すと、同じ5件が落ちる。

```
$ git checkout -- backend/js/supabase-storage.js backend/js/supabase-auth.js
$ npm test
not ok 26 - 写真が読めなかったら、黙って消さずに報告する
not ok 27 - 中身が空でも失敗として報告する（error が無くても見逃さない）
not ok 28 - 読めた写真だけが URL になり、読めた分は失敗に数えない
not ok 29 - 全部読めたときは、失敗は 0 件
not ok 30 - 呼び出し側が failed を必ず見ている（握りつぶしに戻っていない）
EXIT=1
```

**この記録の限界**: 確かめたのは**報告されること**と**呼び出し側が読んでいること**まで。
**実際の画面にその字が出ることは見ていない**（`D-18` 偽-5）。絵で確かめるのは
`npm run walk` の領分だが、⑥はまだ結線されていないので撮れない（`#7` `#10` が未解決）。

また、`magazine-view.js:322` の **`img.src = has ? src : ''`** はそのまま。
空文字を入れると `img.src` はページURLを返す（`D-20260824-30 #3` の再発条件）。
いまは枠が `hidden` なので見えないが、**繋ぐ前に直す**必要がある。
`docs/deferred.md` #16 に登録した。

---

### 5. SQL を壊しても `npm test` は緑のまま
種別: 解決

**原因**: 実 PostgreSQL に流す唯一の検査 `verify:migrations` が **`npm test` から
呼ばれていなかった**（`docs/deferred.md` #9）。`test:schema` は SQL を**文字列として**
grep するだけなので構文を見ない。`F-20260821-24`（予約語 `window` でパースすら
通らず、マイグレーションが**一度も実行されたことがなかった**）の再発条件が、
そのまま残っていた。気づいたのはマスターが本番の SQL Editor に貼ったときだった。

**素直に `npm test` へ足すのは誤り**（`F-20260825-33` を繰り返す）。
`verify-migrations.mjs` は実 PostgreSQL を起動し、`sh -c command -v`・
`/usr/lib/postgresql`・`su postgres` を使う。**マスターの環境は Windows** なので、
直接足すと `findPgBin()` が `null` を返して**マスターの `npm test` が必ず落ちる**。

**直したこと**: 「SQL の中身の指紋」と「その指紋で**実際に流して通った**記録」を
突き合わせる検査 `scripts/guard/sql-verified.mjs` を作り、`npm test` に組み込んだ
（`test:sql`）。

- **SQL を触ったら、実際に流すまで緑にならない**
- **触っていなければ、PostgreSQL の無い環境でも緑のまま**——マスターの `npm test` は壊れない
- 記録 `supabase/.sql-verified` は **git に入る**ので、まっさらな作業場でも
  PostgreSQL 無しで照合できる（`checkout.mjs` の6番目もこの条件で通る）
- **「動かせないから飛ばす」分岐は作らない**（`D-18` 偽-2）。
  PostgreSQL が無ければ緑にできない、と検査自身が言う
- 記録を更新するのは `verify:migrations` が **EXIT 0 のときだけ**。
  失敗したときは更新しない（壊れた SQL の指紋が記録されない）

#### 直す前（赤）
`F-20260821-24` と同じ形（予約語 `window`）を実際に入れて測った。

```
$ printf '\ncreate table as window (id uuid);\n' >> supabase/migrations/202607160001_supabase_base.sql

$ npm test
EXIT=0                      # ← 緑。壊れているのに通る

$ npm run verify:migrations
EXIT=1                      # ← これだけが捕まえる（npm test からは呼ばれない）

$ node -e "console.log(require('./package.json').scripts.test)"
npm run test:unit && npm run test:schema && npm run test:migration && npm run test:backend
                            # verify:migrations は入っていない
```

#### 直した後（緑）
同じ壊し方をして `npm test` を通す。

```
$ printf '\ncreate table as window (id uuid);\n' >> supabase/migrations/202607160001_supabase_base.sql
$ npm test
❌ SQL が「実際に流して通った」記録と一致しません
      npm run verify:migrations
  PostgreSQL が無い環境（Windows 等）では流せません。**その場合は緑にできません**
npm test EXIT=1             # ← 止まるようになった

$ npm run verify:migrations
FAIL  202607160001_supabase_base.sql
6/7 PASS
verify EXIT=1               # 失敗したので記録は更新されない
```

壊した箇所を戻すと緑に戻る。

```
$ git checkout -- supabase/migrations/202607160001_supabase_base.sql
$ npm test
[sql-verified] SQL 8 本を照合
✅ SQL は、いまの中身のまま実際の PostgreSQL を通っている
npm test EXIT=0
```

**PostgreSQL の無い作業場でも通る**ことを、まっさらな複製で確かめた
（マスターの Windows と同じ条件＝SQL を触っていない場合）。

```
$ cd $SB && node scripts/guard/sql-verified.mjs
[sql-verified] SQL 8 本を照合
✅ SQL は、いまの中身のまま実際の PostgreSQL を通っている
EXIT=0
```

#### 直しを戻した（また赤）
`npm test` から `test:sql` を外すと、壊れた SQL が**また素通りする**。

```
$ # package.json の test から `&& npm run test:sql` を外す
$ printf '\ncreate table as window (id uuid);\n' >> supabase/migrations/202607160001_supabase_base.sql
$ npm test
EXIT=0                      # ← 緑。壊れているのに通る
```

**この記録の限界**: 見ているのは**構文とスキーマ内の参照**まで（`verify-migrations.mjs`
自身がそう書いている）。**RLS が実際に誰に何を見せるか**は含まない。
記録は手で書き換えれば通せる——**手で書かないこと**をファイル自身に書いてあるが、
機械で防いではいない。`#2` の限界と同じく、実体を確かめる検査は `#6` の領分。

---

### 10. 画面側と裏側で、部品の作りが違ってそのままでは繋がらない
種別: 解決

**原因**: `src/index.html` は古典スクリプトで `js/ui.js` を読み（`type="module"` は **0件**）、
`backend/js/*.js` は全ファイルが `export` の ES モジュール（**21件**）。規格が違う。

**素直な直し方（`ui.js` を `type="module"` にする）が、いちばん危ない。**
モジュールのトップレベル宣言はモジュール内に閉じるので `const App` がグローバルから消え、
`src/index.html` の**インライン `onclick="App.…"` が 63件すべて壊れる**。
しかも**構文エラーにならない**ので、画面を開いてボタンを押すまで分からない。

**実ブラウザで測った**（まっさらなページを1件ずつ使い、前の case の宣言が残らないようにした）:

```
① 古典スクリプト（いまの形） : title="App が呼べた" / エラー無し
② type="module" にした場合   : title=""            / ReferenceError: App is not defined
③ グローバル経由の橋         : title="backend から来た" / エラー無し
```

**橋は既に設計されていた。** `backend/js/*.js` は自分で
`globalThis.TrimmerSupabaseStorage` / `TrimmerStaffApi` / `TrimmerSupabaseStaff` /
`window.SaltyDogMagazine` を publish する。モジュールとして読み込めば自分で登録するので、
**`ui.js` は古典スクリプトのまま、そのグローバルを使えばよい**。
モジュールは defer なので `DOMContentLoaded` より先に走る（③が実測）。
**自分で新しい仕組みを発明していない**（`plan.md` 第3章）。

**直したこと**: `scripts/guard/ui-script-format.mjs` を新設し、`npm run check` に組み込んだ。
壊れ方が画面を開くまで分からない類なので、機械で止める。見るのは3つ:

1. `ui.js` を `type="module"` で読んでいないか（`onclick="App.…"` が在る限り）
2. `backend/` を古典スクリプトで読んでいないか（`export` が構文エラーになる）
3. `ui.js` にトップレベルの `import`/`export` を書いていないか（1と同じ壊れ方を招く）

あわせて `#8` で `walk-human.mjs` に入れたブラウザの探し方を
`scripts/lib/chromium.mjs` へ切り出した。作り直す `verify:*`（`#6`）が同じものを要るため。
切り出しで `walk` を壊していないことは、実際に走らせて確認した（EXIT 0・5コマ）。

#### 直す前（赤）
```
$ grep -c 'type="module"' src/index.html
0
$ grep -n "^export" backend/js/*.js | wc -l
21
$ grep -c 'onclick="App\.' src/index.html
61                          # ← グローバル App に依存している数（属性全体では 63件）
```

`ui.js` を `type="module"` にした複製（`onclick` 63件が壊れる状態）で、
当時の `npm run check` を通した。**何も言わない。**

```
$ # src/index.html の <script src="/js/ui.js"> を type="module" にする
$ npm run check
✅ 条件A のみ OK（条件A: 未到達 0 件・あと回し登録済み 11 件は除く / 条件B: **見ていない**）
✅ 条件A のみ OK（条件A: 未到達 0 件・あと回し登録済み 11 件は除く / 条件B: **見ていない**）
✅ src→dist parity OK
✅ design/ isolation OK
npm run check EXIT=0
```

#### 直した後（緑）
壊れる3通りを実際に作って、全部止まることを確かめた。

```
$ # A. ui.js を type="module" にする
❌ src/index.html が /js/ui.js を type="module" で読んでいます。
      インラインの onclick="App.…" が 63 件あり、モジュールにすると
      const App がグローバルから消えて **全部が ReferenceError になります**。
EXIT=1

$ # B. backend を古典スクリプトで読む
❌ src/index.html が /backend/js/supabase-storage.js を古典スクリプトで読んでいます。
      backend/js/*.js は ES モジュール（export）なので、type="module" が要ります。
EXIT=1

$ # C. ui.js にトップレベル import を書く
❌ src/js/ui.js:427 にトップレベルの import/export があります。
      import { mapPet } from '/backend/js/supabase-staff.js';
EXIT=1
```

**正常系も確かめた**（誤検出で仕事を止めないこと・`F-20260825-30` の教訓）。
正しい繋ぎ方——backend を `type="module"` で読み、`ui.js` は古典のまま——なら通る。

```
$ REPO_ROOT=$SB node scripts/guard/ui-script-format.mjs
[ui-script-format] グローバル App に依存する onclick: 63 件
✅ 繋ぎ方 OK（UI は古典スクリプト / backend はモジュール）
EXIT=0

$ npm run check
✅ 繋ぎ方 OK（UI は古典スクリプト / backend はモジュール）
check EXIT=0
```

#### 直しを戻した（また赤）
`npm run check` から `ui-script-format` を外すと、A・B・C のどれを置いても素通りする。

`npm run check` から `ui-script-format` を外すと、**①と一字一句同じ出力**に戻る。

```
$ # package.json の check から `&& node scripts/guard/ui-script-format.mjs` を外す
$ # ui.js を type="module" にする（onclick 63件が壊れる状態）
$ npm run check
✅ 条件A のみ OK（条件A: 未到達 0 件・あと回し登録済み 11 件は除く / 条件B: **見ていない**）
✅ 条件A のみ OK（条件A: 未到達 0 件・あと回し登録済み 11 件は除く / 条件B: **見ていない**）
✅ src→dist parity OK
✅ design/ isolation OK
npm run check EXIT=0        # ← 緑。63件が壊れているのに通る
```

**この記録の限界**: 固定したのは**規格**だけで、**まだ1本も繋いでいない**。
`src/index.html` に backend のモジュールを読む行は入れていない——それは `#7`（⑥の器）と
④の保存の結線で、F3 の本体作業。この検査は、その作業が**間違った道に入ったときに止める**
ためのもの。繋いだ結果が正しく動くことは何も言っていない（`D-18` 偽-5）。

---

### 7. ⑥の器そのものが `src/` に無く、その見張りも一緒に消えている
種別: 解決

**原因**: `6685df5`「古いUIをはがし、正しいUIだけにする」が、`src/my.html`（飼い主の
マイページ）と `test/supabase-auth.test.mjs`（その見張り）を**同時に**消していた。
さらに `scripts/build-dist.mjs` から **vendor バンドルの生成手順ごと**消していた
（`esbuild` が devDependency に宣言されたまま `scripts/` から未使用だったのは、そのため）。
結線表の「⑥顧客ページ → `bootProtectedPortal` + `hydrateAssetReferences` +
`renderMagazine`」に、**起動先の器が無い**状態だった。

**マスター指定により、逐語で戻した**（自分で意匠を足していない）。
`git show 6685df5^:src/my.html`。**架空のカルテは 0件**で、P8-a の掃除は保たれていた。

**逐語から変えたのは、F1 の移設で強制される置き場所だけ**:

| 変えた場所 | 前 | 後 | 理由 |
|---|---|---|---|
| `src/my.html` の2行 | `/js/supabase-vendor.js` `/js/supabase-auth.js` | `/backend/js/…` | F1 が `src/js/` → `backend/js/` へ移した |
| テストの import 4行 | `../src/js/…` | `../backend/js/…` | 同上 |
| テストの vendor 検査 | `src="/js/…"` | `src="/backend/js/…"` | 同上（**見ている中身は同じ**——vendor が先・portal は `type="module"`） |

**戻せなかった 12件は、削ったのではなく「見張る実体が無い」。**
`publish-client-ponchi.js` / `ponchi-app.js` / `ponchi-engine.js` は `6685df5` が
消した古い UI で、戻すと即座に `ENOENT` で落ちる。**失われた知見のうち、いま効く2つは
引き継ぎ先を作って明記した**（テストファイル内に全文を残した）:

1. **`img.src`（プロパティ）を読んではいけない**——空のとき**ページURL**が返る。
   同じ形が `magazine-view.js:322` に在り、`docs/deferred.md` #16 に登録済み
2. **削除の順序**（`beforeDelete()` が `DELETE` より前・間に `.catch(` を挟まない・
   導線3つ全部に付いている）。いまは `delete-order.mjs` が引き継ぐが、
   **ここに在った版のほうが強い**（順序まで見ていた）。`#2` の限界に追記した

**あわせて直したもの**:
- `isolation.mjs` の起点を **`index.html` + `my.html` の2つ**にした。片方だけを起点に
  すると、もう片方が丸ごと「どこからも繋がっていない」と出る（実際に出た）。
  起点を増やせば条件Aは通しやすくなるので、**使った起点を必ず出力する**
- `build-dist.mjs` に `my.html` と `backend/js` の配布、および vendor バンドルの
  生成（`iife` + `globalName` → `globalThis.TrimmerSupabaseVendor`）を戻した。
  `6685df5^` から置き場所だけ読み替えたもの
- `supabase-staff.js` は**トリマー側**の部品で読み込む側がまだ無いため、
  検査が用意している正規の手順どおり `docs/deferred.md` #17 に番号付きで登録した

#### 直す前（赤）
```
$ ls src/my.html
★ src/my.html は存在しない
$ ls test/supabase-auth.test.mjs
★ 無い
$ git log --oneline --diff-filter=D -- src/my.html
6685df5 古いUIをはがし、正しいUIだけにする（第1段・第2段の途中）

$ grep -rn "esbuild" scripts/
                            # 0件。vendor の生成手順も一緒に消えていた
```

#### 直した後（緑）
器と見張りが戻り、**実ブラウザで起動する**ことまで確かめた。

```
$ npm run build
[build] backend/js  4件
[build] backend/js  supabase-vendor.js（bundle）
[build] 完了  35件

$ npm run check
✅ 条件A のみ OK（起点 index.html + my.html / 未到達 0 件）
✅ src→dist parity OK
check EXIT=0

$ npm test
# pass 14 / 56 / 6 / 24      → 100件（それまで 82件）
test EXIT=0
```

**実ブラウザで `/my.html` を開いた**（静的サーバ配信）:

```
vendor グローバル      : object / createClient: function
data-portal            : customer
フック（6種のうち）    : 6
画面に出ている文言     : "表示できません"
ページのエラー         : なし
```

`createClient` がグローバルに載っているのは、`#10` で固定した橋
（`iife` + `globalName` → 古典スクリプトから見える）が実際に働いているということ。
**「表示できません」は正しい振る舞い**——静的サーバに `/api` が無いので設定を取れず、
`bootProtectedPortal` が**そう言って止まっている**。架空の中身を出していない（`#1` と同じ原則）。

#### 直しを戻した（また赤）
`src/my.html` を消すと、**①とまったく同じ状態**に戻る。違うのは、
いまは**見張りがそれを報せる**ことだけ。

```
$ rm src/my.html
$ ls src/my.html
★ src/my.html は存在しない

$ npm test
not ok 2 - test/supabase-auth.test.mjs
npm test EXIT=1
```

①では同じ `★ src/my.html は存在しない` が出ても、**`npm test` は EXIT 0 だった**
（見張りが消えていたので誰も気づけなかった）。そこが直った部分。

**この記録の限界**: 戻したのは**器と見張りと配り方**まで。
`/my` が実データを出すには Supabase の設定を配る経路（`/api/config`）が要り、
それは Worker 側＝**F3 の結線本体**。ここでは静的配信での起動しか見ていない。
戻せなかった 12件の検査は、はがした UI を作り直すときに
`git show 6685df5^:test/supabase-auth.test.mjs` から読み直すこと。


### 6. お客さんに届く中身を見る検査が、1本も存在しない
種別: 解決

**この項が言っていたのは2つ**——(a)「お客さんに届く中身を見る検査が**1本も無い**」と
(b)「**消えたものの記録が間違っていて**、一番大事な1本が記録から漏れている」。

**(a) は成り立たなくなった。** `verify:portal`（`/my` を実ログイン・実データ・RLS 下で見る
14項目）が戻り、CI で 14/14 PASS している。**ただし戻ったのは 9本中1本**で、
残り8本は `#12`〜`#19` に1本ずつ立て直した（すべて未解決のまま）。
**この項が緑であることを「検査が戻った」と読まないこと**（D-18 偽-5）。

**(b) の原因に触れた。** 原因は「記録を人が書くだけで、**実体と突き合わせる機械が無かった**」こと。
`docs/deferred.md` #8 は消えた検査を「7本」と書き、`all` と `preview`（npm の集約スクリプトで
ファイルではない）を数え、実体で消えた `delete`・`draft`・`invitation`・`screens` の4本を
落としていた。書き直すだけでは同じズレがまた起きるので（D-7）、次の3つを置いた:

| 置いたもの | 何をするか |
|---|---|
| `docs/ops/verify-restore-F3.md` | 9本の台帳（正）。1本ずつ **状態**（`復元済み` / `未復元`）と、戻すのに要るものを書く |
| `scripts/guard/verify-inventory.mjs` | **毎回 git と突き合わせる。** 消えた検査が台帳に無い／状態が実体と食い違う／`復元済み` なのに `package.json` から呼ばれていない、で EXIT 1 |
| `npm run check` への追加 | 忘れても止まる（`AGENTS.md` D-7） |

**この検査が保証しないこと**: 戻っている検査の**中身が正しいか**は見ない。本数と名前と
状態が実体と一致しているかだけを見る（D-18 偽-5 への自己申告）。

**あわせて計画の誤りを1つ直した。** `plan.md` 4-0-d は「`/edit` を開く8本は戻せない」と
書いていたが、実測すると **`verify-xss` は `/edit` を一度も開かない**（細工はスタッフ API で
入れ、見るのは飼い主の画面だけ）。要る入口は `worker/src/index.js` に全部実在するので、
**`#12` は結線を待たずに戻せる**。台帳に記載した。

#### 直す前（赤）

`origin/master` の記録の状態（台帳が無く、`deferred.md` #8 が「検査7本」と書いている）。

```
$ grep -c "検査7本" docs/deferred.md
1
$ node scripts/guard/verify-inventory.mjs; echo EXIT=$?
[verify-inventory] 消えた検査 9本を台帳と突き合わせた
❌ 台帳そのものが無い: docs/ops/verify-restore-F3.md

台帳の正は docs/ops/verify-restore-F3.md。実体に合わせて直すこと。
EXIT=1
```

#### 直した後（緑）

```
$ grep -c "検査7本" docs/deferred.md
0
$ node scripts/guard/verify-inventory.mjs; echo EXIT=$?
[verify-inventory] 消えた検査 9本を台帳と突き合わせた
✅ 台帳 OK（本数と名前と状態が実体と一致。**中身の正しさは見ていない**）
EXIT=0
```

#### 直しを戻した（また赤）

台帳を消し、`deferred.md` を `origin/master` の版に戻した。**①と同じ症状の行が出る**
（`diff` で完全一致を確認済み）。

```
$ grep -c "検査7本" docs/deferred.md
1
$ node scripts/guard/verify-inventory.mjs; echo EXIT=$?
[verify-inventory] 消えた検査 9本を台帳と突き合わせた
❌ 台帳そのものが無い: docs/ops/verify-restore-F3.md

台帳の正は docs/ops/verify-restore-F3.md。実体に合わせて直すこと。
EXIT=1
```

**機械が本当に噛むことを、別の壊し方でも確かめた**——台帳の状態だけを実体からズラす:

```
$ sed -i 's/| 1 | `portal` | 復元済み |/| 1 | `portal` | 未復元 |/' docs/ops/verify-restore-F3.md
$ node scripts/guard/verify-inventory.mjs; echo EXIT=$?
[verify-inventory] 消えた検査 9本を台帳と突き合わせた
❌ 台帳が実体と食い違う: verify-portal.mjs（台帳=未復元 / 実体=在る）
EXIT=1
```


### 12. 保存されたカルテが、飼い主のブラウザで実行される（`verify:xss` が無い）
種別: 解決

**原因**: `6685df5` が `scripts/verify-xss.mjs` を消し、`AGENTS.md` D-11 の機械強制が
ゼロになっていた。`/api` の無認証は意図された前提（D-3）なので、守るのは**出口**だけ
——`renderMagazine()` が描画したものが飼い主のブラウザで実行されないこと。それを見る
検査が1本も無かった。

**戻すにあたって、合格条件を実際の仕組みに合わせて書き直した。** `6685df5^` の版は
`!fired`——「実行されなければ合格」しか見ておらず、**細工が飼い主の画面に届いていなくても
合格**した（ページが出ない・カルテが見えない・確定に失敗した、のどれでも
`window.__XSS_FIRED` は undefined になる）。`F-20260825-35`/`-36` で2回やった
「期待する成功の形を、実際の仕組みに合わせて書かずに検査を書いた」と同じ型である。
いまは1件につき3つ、すべて「こうなっていれば合格」の形で書いてある:

1. 細工した文字列が、**文字として**飼い主の画面に出ている（`<img` が `textContent` に在る）← 届いた証拠
2. `window.__XSS_FIRED` が立っていない ← 実行されていない
3. `img[src="x"]` が DOM に無い ← HTML として解釈されていない

**仕掛ける場所も1つ直した。** 旧版は `data.pet` に入れていたが、飼い主の画面の見出しは
`report.pet.name`（DB の値）を使い、`data.pet` は petName が空のときしか描画されない
（`backend/js/supabase-auth.js` の `renderReport`）。つまりその項は**必ず合格する検査**
だった。犬の名前そのものに仕掛ける形にした。

**この検査が保証しないこと**: 入り口（保存時）の無害化は見ない。出口だけを見る。
また `setText` を通らない描画経路（`skin[].loc` の行・体重グラフのラベル）は
別々に `textContent` を使っており、下の③でもそこは緑のまま残る——**1か所を壊したら
全部赤くなる、という作りではない**ことは自覚して書いている。

#### 直す前（赤）

`origin/master` の `package.json`。検査そのものが存在しない。

```
$ npm run verify:xss
npm error Missing script: "verify:xss"
npm error
npm error To see a list of scripts, run:
npm error   npm run
EXIT=1
```

#### 直した後（緑）

CI の `verify` ジョブ（c8437db・実 Supabase・実ログイン・実 RLS）。

```
> trimmer-system@0.1.0 verify:xss
> node scripts/build-dist.mjs && node scripts/verify-xss.mjs

PASS  犬の名前（見出しへ入る）: 細工が文字として飼い主の画面に出ている
PASS  犬の名前（見出しへ入る）: 実行されない
PASS  犬の名前（見出しへ入る）: 要素として注入されていない  img[src="x"]=0
PASS  staffNote（担当からの一言）: 細工が文字として飼い主の画面に出ている
PASS  staffNote（担当からの一言）: 実行されない
PASS  staffNote（担当からの一言）: 要素として注入されていない  img[src="x"]=0
PASS  skin[].loc（皮膚の部位）: 細工が文字として飼い主の画面に出ている
PASS  skin[].loc（皮膚の部位）: 実行されない
PASS  skin[].loc（皮膚の部位）: 要素として注入されていない  img[src="x"]=0
PASS  ear.comment（耳のコメント）: 細工が文字として飼い主の画面に出ている
PASS  ear.comment（耳のコメント）: 実行されない
PASS  ear.comment（耳のコメント）: 要素として注入されていない  img[src="x"]=0
PASS  nail.comment（爪のコメント）: 細工が文字として飼い主の画面に出ている
PASS  nail.comment（爪のコメント）: 実行されない
PASS  nail.comment（爪のコメント）: 要素として注入されていない  img[src="x"]=0
PASS  teeth.status（歯の状態）: 細工が文字として飼い主の画面に出ている
PASS  teeth.status（歯の状態）: 実行されない
PASS  teeth.status（歯の状態）: 要素として注入されていない  img[src="x"]=0
PASS  teeth.comment（歯のコメント）: 細工が文字として飼い主の画面に出ている
PASS  teeth.comment（歯のコメント）: 実行されない
PASS  teeth.comment（歯のコメント）: 要素として注入されていない  img[src="x"]=0
PASS  weights[].ym（体重グラフのラベル）: 細工が文字として飼い主の画面に出ている
PASS  weights[].ym（体重グラフのラベル）: 実行されない
PASS  weights[].ym（体重グラフのラベル）: 要素として注入されていない  img[src="x"]=0

24/24 PASS
```

#### 直しを戻した（また赤）

**直したのは「検査が存在しないこと」**なので、戻すのは `package.json` の口である。
`verify:xss` の行を消して実行した。**①と同じ症状の行が出る。**

```
$ npm run verify:xss
npm error Missing script: "verify:xss"
npm error
npm error To see a list of scripts, run:
npm error   npm run
EXIT=1
```

#### 補足: この検査が空でないことの確認（別の壊し方）

「口が在る」ことと「中身が効く」ことは別である（D-18 偽-5「別の緑で覆う」）。
**出口の無害化そのものを壊して、この検査が本当に噛むかを見た。**
`magazine-view.js` の `setText` を `textContent` → `innerHTML` に戻し、コミット
32b861f で**意図的に壊して** CI にかけた（次のコミットで戻してある）。
**`★ 実行された` が出る**——飼い主のブラウザで実際にコードが動いた。

```
FAIL  犬の名前（見出しへ入る）: 細工が文字として飼い主の画面に出ている  ★ 届いていない。この項は何も検査できていない
FAIL  犬の名前（見出しへ入る）: 実行されない  ★ 実行された
FAIL  犬の名前（見出しへ入る）: 要素として注入されていない  img[src="x"]=1
FAIL  staffNote（担当からの一言）: 実行されない  ★ 実行された
FAIL  ear.comment（耳のコメント）: 実行されない  ★ 実行された
FAIL  nail.comment（爪のコメント）: 実行されない  ★ 実行された
FAIL  teeth.status（歯の状態）: 実行されない  ★ 実行された
FAIL  teeth.comment（歯のコメント）: 実行されない  ★ 実行された
PASS  skin[].loc（皮膚の部位）: 実行されない
PASS  weights[].ym（体重グラフのラベル）: 実行されない

6/24 PASS

保存されたデータが飼い主のブラウザで実行されている、または細工が届いていない。Critical。
##[error]Process completed with exit code 1.
```

`skin[].loc` と `weights[].ym` が緑のまま残るのは、その2つが `setText` を通らず
自前で `textContent` を使っているため。**1か所を壊したら全部赤くなる作りではない。**

**この壊し方を、他の検査は1本も捕まえなかった**（手元で実測）:

```
$ npm run build ; echo $?
0
$ npm run check ; echo $?
0
$ npm test ; echo $?
0
```

飼い主のブラウザでカルテが実行される状態を、いまの機械検査で捕まえられるのは
`verify:xss` だけである。**この検査が要る理由そのもの**なので、ここに残す。
