# ④保存 と ⑥読み出し のキー突き合わせ（`plan.md` 4-1「繋ぐ前に必ず片づけること」）

> **なぜ先にやるか**: ⑥は `data.*` を **14キー**読む。出す側（④）に何が在るかを
> 突き合わせずに繋ぐと、**書いたのに届かない**項目が黙って生まれる。
> それが `F-20260821-12`/`-13` の型で、実際に「トリマーが記入した所見の大半が
> 飼い主に届いていなかった」事故が起きている（`docs/handoff.md` の当該節）。
>
> 作成 2026-08-25。根拠は実行した命令とその出力。

## ⑥が読むキー（実測・14）

```
$ grep -o "data\.[A-Za-z_]*" backend/js/magazine-view.js | sort -u
data.bestWeight  data.bodyLanguage  data.bodyMarkingImage  data.date
data.ear  data.heroPhotos  data.isoDate  data.nail  data.pet  data.skin
data.staffNote  data.teeth  data.trimming  data.weights
```

## ④（`src/index.html` の screen-3）に在る入力（実測）

```
$ sed -n '1749,1995p' src/index.html | grep -oE '<(input|textarea|select)[^>]*'
<input type="number" id="input-weight" …>      体重
<select …>  6mm / 8mm / 10mm / ハサミオールシザー   カットの長さ
<select …>  テディベアカット / アフロ風マッシュ / 足先すっきりブーツ   スタイル
<textarea id="editor-trimmer-letter" …>        担当からの一言
```

ほかに button 群（爪レベル3・耳 左右 各3・歯 6種）と、犬体図のカンバス。

```
$ sed -n '1749,1995p' src/index.html | grep -c "写真\|photo"
0
$ sed -n '1749,1995p' src/index.html | grep -c "日付\|来店\|date"
0
$ sed -n '1749,1995p' src/index.html | grep -c "目標体重"
0
```

## 突き合わせ

| ⑥が読むキー | ④の出どころ | 出せるか |
|---|---|---|
| `pet` | `globalThis.__REPORT_CONTEXT__.petName`（backend が置く） | ✅ |
| `staffNote` | `#editor-trimmer-letter` | ✅ |
| `nail` | 爪レベルの button（`level`） | ⚠️ level のみ。**コメント欄が無い** |
| `ear` | 右耳・左耳の button（`right` / `left`） | ⚠️ 左右のみ。**コメント欄が無い** |
| `teeth` | 歯の pill（`status`） | ⚠️ status のみ。**コメント欄が無い** |
| `weights` | `#input-weight` | ⚠️ 1点のみ。**月（`ym`）の入力が無い**ので推移が描けない |
| `bodyMarkingImage` | `App.exportBodyMarking()` | ✅ |
| `trimming` | カットの長さ・スタイルの `select` 2つ | ⚠️ **写真の入力が無い** |
| `date` / `isoDate` | — | ❌ **来店日の入力が無い** |
| `bestWeight` | — | ❌ **目標体重の入力が無い** |
| `skin` | — | ❌ **皮膚の行（部位・大きさ・種類・変化）の入力が無い** |
| `heroPhotos` | — | **使わないと決めた（2026-08-27）。** 写真の入力は作ったが、⑥は `heroPhotos` が空なら `trimming.photos` の1枚目を表紙にする（`magazine-view.js:549`）。入口を2つ作ると「表紙用」と「仕上がり用」を人が選び分けることになるので、**入口は1つ**にして `trimming.photos` に入れる。ここが `—` のままなのは欠落ではない |
| `bodyLanguage` | — | ❌ 同上 |

**14キー中、いま完全に出せるのは3つ。** 部分的に出せるのが5つ、出どころが無いのが6つ。

## この結果をどう扱うか

**入力欄を新しく作らない**（重要ルール①「現状あるものだけで完成させる」・
③「機能追加を目的に含めない」）。④は**在る入力だけを、⑥が読む形で出す**。

出どころが無い6キーは、⑥側で**空として正しく出る**ことを確かめる。
`renderMagazine` は空なら節を隠すか「記録がありません。」と出す作りなので、
**見本が出ることはない**（`D-10`）。それを機械で押さえるのが `verify:empty`（`#16`）。

`skin` と写真は F2 の意匠モックにも無い。**無いものを勝手に足すのではなく、
「無い」ことをマスターに見えるようにする**のがこの書類の役目である。
足すかどうかは F3 完了後の棚卸し（`plan.md` 第6章）で決める。

## 機械強制

`node scripts/guard/key-parity.mjs` が、⑥の読むキーと ④の出すキーを毎回突き合わせる。
`npm run check` に入っている。**片方だけ増えたら止まる**——⑥に読む先を足したのに
④が出していない（＝黙って消える）、④が出しているのに⑥が読まない（＝届かない）、
のどちらも同じ事故なので、両方向を見る。
