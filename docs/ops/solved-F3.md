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
