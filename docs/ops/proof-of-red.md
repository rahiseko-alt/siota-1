# 検査の「赤になったところを見た」台帳

> **これは何か**（マスター指示・2026-08-28）
>
> > 「もはやルールじゃダメだろ。**16回中16回盛れない方法にしろ。**
> >  壊してみて赤にならないなら**検査自体が壊れてるとする**か」
>
> `docs/watch.md` W-1 の型（検査が実際の仕組みと違う所を見る）は **16回**起きた。
> `empty-pass.mjs` は**書き方**を見て止めるが、形で判るのは **5回分だけ**。
> 残り11回は**形が正常なまま嘘をついていた**。形をいくら足しても、次の11回目の形は
> 予測できない——**書き方の見張りでは 16/16 にならない。**
>
> そこで、見張るのをやめて**定義を置く**:
>
> **「壊して赤になったところを見ていない検査は、壊れているものとして数える」**
>
> 形に依存しないので**どんな嘘の付き方をしても逃げられない**。嘘をついている検査は、
> 定義上「壊したら赤になった証拠」を出せないからである。
>
> 機械: `node scripts/guard/proof-of-red.mjs`（`npm run check` から呼ばれる）

## いまの状態

| | |
|---|---|
| 機械が数えた検査 | **204件**（`scripts/verify-*.mjs`） |
| 壊して赤になったところを見た | **162件**（毒見 21 ＋ 1件ずつ壊す 141・2026-08-29） |
| まだ見ていない | **42件** |

> **この表は 112/71 のまま止まっていた**（`node scripts/guard/proof-of-red.mjs` は
> その間ずっと 142/41 と出していた）。数を数えているのは機械なので、**この表が
> 遅れても数が小さく見えるだけ**だが、遅れた表を根拠に判断されると困る。
> 2026-08-29 に機械の出力へ合わせ直した。**迷ったら表ではなく機械を見ること。**

**出発点は全件が未確認だった。** 毒見で埋め、天井に当たったあと（下の「⛔ 毒見の天井」）、
**1件ずつ壊す**（マスター判断 A）で続けている。**数は上の表だけが正**——
本文にも数を書いていたら今日5回ずれたので、**書く場所を1か所に減らした**。
`verify:*` が全部緑であることは、いまのところ**それ自体が何も保証していない**——
その緑が嘘でないことを、まだ一度も確かめていないため。

**この数は少なく見せられない。** 検査を消せば「台帳に在るが実体に無い」で赤になり、
台帳から行を消せば「台帳に無い検査」で赤になる。**逃げ道は塞いである。**

## 盛らせない造り

数ではなく、**検査を1件ずつ名前で**載せる（数だけの上限は、別の検査を消して枠を空ければ
通ってしまう）。機械が数え上げた全件について:

| | |
|---|---|
| 台帳のどちらの節にも無い | **赤**。新しい検査は、証拠と一緒でないと足せない |
| 台帳に在るが実体に無い | **赤**。古い台帳を放置させない（`W-8` の型） |

「未証明」に書けば通るが、**その1行が「まだ確かめていない」と名指しで残る**。

## 証拠の書き方

1件につき、**壊し方**と、**そのとき実際に出た赤の出力**を貼る。
「落ちるはず」は証拠ではない（`D-18`）。書いたら「未証明」から「証明済み」へ1行移す。

```
### verify-admin.mjs :: 16. ペットが実際に消えた
壊し方: 削除の RPC を呼ぶ行をコメントアウトする
出力:
    FAIL  16. ペットが実際に消えた  まだ居る（残り1頭）　画面の表示="削除しました"
```

## どう埋めるか（次の工程）

手で182件を壊すのは現実的でないので、**まとめて壊す**を作る:

**毒見（poison run）** — 接続先は `SUPABASE_LOCAL_URL` で差し替えられる
（`scripts/lib/local-stack.mjs:37`）。土台とアプリの間に**中身を空にして返す層**を挟み、
**その世界で `verify:*` を全部走らせる**。何も動いていない世界なのだから、
**すべての検査が赤にならなければおかしい**。そこで**緑のまま残った検査**が、
まさに「壊しても赤にならない検査」＝壊れている検査である。

1回の実行で全件に判定が付く。Docker が要るので**この環境では走らず、CI に置く**。

**毒見で判るのは「空の世界で緑になる」型まで。** 「正しく動いている世界で、
別のものを見ている」型（`F-20260827-43`）は毒見では出ないので、
そちらは1件ずつ壊すしかない。**この台帳は、その残りを名指しで残すためにも要る。**

## 証明済み（`- <ファイル> :: <検査の名前>`）

<!-- 証拠を書いたら、下の「未証明」から1行ここへ移す。 -->

### 徹底調査で見つけた穴 2件（2026-09-03・30回目の実測）

- verify-m6.mjs :: ⑤c-2. 確定後に「03」を押すと、組み立てていない④を開かず②へ戻す
- verify-m6.mjs :: ⑤c-3. 戻った②に、犬を選び直せる一覧が在る（押せただけで終わらせない）


### 体重の記録 9件（2026-09-03・29回目の実測）

- verify-carry-over.mjs :: 前回比が「前回の記録なし」ではない（5枚目の体重を引けている）
- verify-carry-over.mjs :: まだ量っていないので、前回の体重を出している（痩せたように見せない）
- verify-carry-over.mjs :: 体重を入れると前回比が出る（4.4 → 4.6 で +200g ▲）
- verify-carry-over.mjs :: カルテ1枚の応答に、確定カルテを横断した体重の履歴が載っている
- verify-carry-over.mjs :: 履歴の最後が、いま入れた体重（4.6kg）
- verify-carry-over.mjs :: ⑤の体重グラフに線が引かれている（点が2つ以上）
- verify-carry-over.mjs :: 7枚目の前回比は、6枚目で量った体重（4.6kg）を基準にする
- verify-carry-over.mjs :: カルテが1枚も無い犬では「前回の記録なし」のまま
- verify-carry-over.mjs :: カルテが1枚も無い犬では、引き継ぎの帯を出さない


### 管理者の入口 3件（2026-09-03・28回目の実測）

- verify-admin.mjs :: 1. 管理者も、みんなと同じカルテ画面に着く
- verify-admin.mjs :: 1b. 管理者には「管理」の入口が見えていて、指が届く
- verify-admin.mjs :: 1c. 「管理」を押すと管理画面に着く


### 6枚目を前回の続きから始める 20件（2026-09-03・27回目の実測）

- verify-carry-over.mjs :: 来店日が空
- verify-carry-over.mjs :: トリマーからのメッセージが空
- verify-carry-over.mjs :: 体重が空
- verify-carry-over.mjs :: ⑦使用オプションが1つも選ばれていない
- verify-carry-over.mjs :: 6枚目に __marks が載っている（次の回で印を引き継げる）
- verify-carry-over.mjs :: 7枚目に、6枚目で足した印まで引き継がれている
- verify-carry-over.mjs :: 7枚目のメッセージは空（6枚目の文が残っていない）
- verify-carry-over.mjs :: `帯が「${word}」を名指ししている`
- verify-carry-over.mjs :: 爪（前足）が5枚目と同じ
- verify-carry-over.mjs :: 爪（後ろ足）が5枚目と同じ
- verify-carry-over.mjs :: 耳（右）が5枚目と同じ
- verify-carry-over.mjs :: 耳（左）が5枚目と同じ
- verify-carry-over.mjs :: 歯の状態が5枚目と同じ
- verify-carry-over.mjs :: ベスト体重が5枚目と同じ
- verify-carry-over.mjs :: 犬体図に前回の印が描かれている
- verify-carry-over.mjs :: 白紙にすると、引き継ぎの帯が消える
- verify-carry-over.mjs :: 引き継いだ印に、今回の印を足せる
- verify-carry-over.mjs :: 引き継ぎが実際に走った（帯に字が入った）
- verify-carry-over.mjs :: 引き継ぎの帯が出ている
- verify-carry-over.mjs :: 白紙にすると、引き継いだ選択が全部外れる
- verify-carry-over.mjs :: 6枚目に爪が引き継がれている
- verify-carry-over.mjs :: 7枚目も「前回の続き」から始まる


### 「開店初日の店から、人と同じ操作で最後まで行けるか」17件（2026-09-02）

**なぜ足したか**: `verify:*` 15本と CI が全部緑、本番の `verify:prod` も 5/5 PASS の状態で、
マスターがログインしたら **犬が0件で、そこから先へ進めなかった**（`F-20260902-66`）。
既存の検査は**全部「犬が既に居る」状態から始めていた**（fixture が必ず犬を持っている）ので、
**店を開いた初日の状態を、どの検査も一度も通っていなかった**。
`scripts/verify-first-run.mjs` は、**犬0件から人の指で** 飼い主登録 → 犬登録 → 一覧に出る →
カルテを書く → ⑦使用オプションを選ぶ → 確定 → 客が招待から入る → その値が届く、まで歩く。

**壊し方①**: `src/js/ui.js` の `renderDogs()` 末尾、0件のときの案内を
`if (false && data.length === 0 && ...)` で出さなくする。

```
FAIL  2. 1頭も居ないとき、次にどうすればいいかが画面に出ている  案内=0件
16/17 PASS
```

**壊し方②**: `createNewKarte()` の案内文を、直す前の
「②一覧の『初回登録QR』から…」に戻す（**0件のとき画面に存在しない入口**を指す文）。

```
FAIL  4. 「新規カルテを作成する」の案内が、存在しない入口を指していない
        案内="新しい犬を登録するには、②一覧の「初回登録QR」から飼い主さんに登録してもらうか、管理画面の「②新規」から登録してくださ"
16/17 PASS
```

どちらも戻すと **17/17 PASS**。

- verify-first-run.mjs :: 0. 犬が1頭も居ない店から始めている
- verify-first-run.mjs :: 1. 入口から、自分の作業画面に着く
- verify-first-run.mjs :: 2. 1頭も居ないとき、次にどうすればいいかが画面に出ている
- verify-first-run.mjs :: 3. 案内が指す入口が、実際に画面に在る
- verify-first-run.mjs :: 4. 「新規カルテを作成する」の案内が、存在しない入口を指していない
- verify-first-run.mjs :: 5. 「管理」を押すと管理画面に着く
- verify-first-run.mjs :: 6. 飼い主を登録できた
- verify-first-run.mjs :: 7. その飼い主に犬を登録できた
- verify-first-run.mjs :: 8. 登録した犬が、作業画面の一覧に出る
- verify-first-run.mjs :: 9. 犬を押すとカルテ作成に着く
- verify-first-run.mjs :: 10. ④に使用オプションが出ている
- verify-first-run.mjs :: 11. その使用オプションに指が届く
- verify-first-run.mjs :: 12. 確定できた（カルテが1枚できた）
- verify-first-run.mjs :: 13. 客に渡す初回登録の URL が出る
- verify-first-run.mjs :: 14. 客がログインすると、自分の犬が出る
- verify-first-run.mjs :: 15. 客がカルテを開ける
- verify-first-run.mjs :: 16. スタッフが選んだ使用オプションが、客の画面に届いている
- verify-first-run.mjs :: 最後まで歩けた

### 「`/` が本物の入口として配られている」2件（2026-09-02）

**なぜ足したか**: 本番の `/`（お客さんが最初に開く場所・ホーム画面のアイコンの行き先）が
素の HTML のまま配られ、載っている「Google でログイン」が**ログインしなかった**
（`F-20260902-66`）。それまでの検査は `/` について「4画面ある」「段のタブが4つある」
「最初がログイン画面」しか見ておらず、**この3つは壊れた `/` でも全部緑になる**。
器ではなく中身（＝バックエンドが載っているか）を見る検査が1本も無かった。

- verify-screens.mjs :: 4b. `/` が本物の入口として配られている（ログインが繋がっている）
- verify-production.mjs :: `/ が本物の入口として配られている（注入 ${topWant.length} 本）`

**壊し方①（設定側）**: `worker/wrangler.local.toml` の `run_worker_first = ["/"]` を
コメントアウトする（`[assets]` が静的ファイルを先に返し、Worker が呼ばれなくなる）。

```
FAIL  4b. `/` が本物の入口として配られている（ログインが繋がっている）  __ENTRY__=false supabase-auth.js=false
21/22 PASS
```

**壊し方②（コード側）**: `worker/src/index.js` の上位振り分けにある
`&& env.DATA_BACKEND !== 'supabase'` を外す（`/` を素の HTML で横取りして返す）。

```
FAIL  4b. `/` が本物の入口として配られている（ログインが繋がっている）  __ENTRY__=false supabase-auth.js=false
21/22 PASS
```

どちらか片方を戻すだけで赤になる（＝両方が要る）。両方が入っている状態で **22/22 PASS**、
`__ENTRY__=true supabase-auth.js=true`。

**`1.`〜`4.` は①②のどちらの赤でも PASS のまま**だった——これがこの2件を足した理由そのもの。

**本番側（`verify-production.mjs`）の赤**: 直す前の本番（`f0b288e` デプロイ済み）に対して
実行した実測。

```
FAIL  / が本物の入口として配られている（注入 2 本）  HTTP 200
        注入されるはず（worker から）: /backend/js/supabase-vendor.js /backend/js/supabase-auth.js
        本番: /js/dummy.js /js/ui.js
        __ENTRY__ の印: **無い**
```

同じ実行で `/edit` 側（`4.`）は PASS——**`/edit` しか見ていなかった**ことがそのまま出ている。

### 毒見で赤になった 17件（2026-08-28）

壊し方: **土台ごと空にする** — `node scripts/poison-run.mjs`。
`scripts/lib/poison-stack.mjs` が「形だけ合っていて中身が空」の Supabase を立て、
`SUPABASE_LOCAL_URL` をそこへ向ける。犬も飼い主もカルテも写真も1件も無い世界。

出力（全文は `docs/ops/poison-run-result.md`）:

```
  赤になった（＝壊すと落ちることを確かめた）: 25件
  **緑のまま残った（＝何も無くても通る）: 18件**
```

**この25件のうち、台帳に移せたのは 17件。** 残り8件は下の「移せなかったもの」。

- verify-admin.mjs :: 検査を最後まで実行できた
- verify-delete.mjs :: 検査を最後まで実行できた
- verify-draft.mjs :: 0. 検査用の犬を登録できた
- verify-draft.mjs :: 検査を最後まで実行できた
- verify-edit.mjs :: 検査を最後まで実行できた
- verify-empty-pet.mjs :: 0. カルテ0件の犬を用意できた
- verify-empty-pet.mjs :: 検査を最後まで実行できた
- verify-invitation.mjs :: 0. 新しい飼い主を登録できた
- verify-invitation.mjs :: 検査を最後まで実行できた
- verify-m6.mjs :: 検査を最後まで実行できた
- verify-photo-roundtrip.mjs :: 検査を最後まで実行できた
- verify-portal.mjs :: 検査を最後まで実行できた
- verify-report-roundtrip.mjs :: 0. 検査用の犬を登録できた
- verify-report-roundtrip.mjs :: 検査を最後まで実行できた
- verify-screens.mjs :: 検査を最後まで実行できた
- verify-stack.mjs :: マイグレーションと seed が当たっている（seed の犬 X を id で引ける）
- verify-stack.mjs :: 鍵なしでは読めない（RLS/ゲートウェイが効いている）

### 移せなかった8件（`verify-xss.mjs`）

**毒見では赤になったが、台帳の鍵と結び付けられない。**
`verify-xss.mjs` は `check(label, false, …)` と**名前に変数**を使っており、
台帳（ソースを静的に読む）には `label` という文字列で載る。実行時の名前は
`犬の名前（見出しへ入る）` `staffNote（担当からの一言）` など8種で、**別物になる**。

さらに悪いことに、`check(label, …)` は**3か所**あるのに、台帳では
`verify-xss.mjs :: label` という**同じ鍵に潰れている**。
つまりこの3件は、いま**証明の単位として区別できていない**。

**鍵の潰れは直した**（2026-08-28）——同じ名前が複数あるときは出現順の番号を付ける
（`label #2` `label #3`）。これで **182件のうち4件が、数えられてはいるのに区別できて
いなかった**状態は解消した。

**ただし、実行時の名前と台帳の鍵を結び付ける問題は残っている。** 台帳はソースを
静的に読むので `label` としか書けず、毒見の出力は `犬の名前（見出しへ入る）` などになる。
**どの call site がどの行を出したかは、出力の文字だけからは決められない。**
→ この8件は**未証明のまま**置く。数を良く見せない。

直すなら、`check()` が**行番号か固定の id を一緒に印字する**しかない。
182か所を書き換えることになるので、マスター判断に回す。



### verify-stack.mjs :: マイグレーションと seed が当たっている（seed の犬 X を id で引ける）

壊し方: **土台ごと空にする**（`node scripts/poison-run.mjs verify-stack.mjs`）。
`scripts/lib/poison-stack.mjs` が「形だけ合っていて中身が空」の Supabase を立てる。

直す前は、その世界で**緑のまま**だった——これが `F-20260828-50`:

```
PASS  マイグレーションが当たっている（pets を実際に引ける）  HTTP 200 / 0件
```

`200 かつ配列` を合格条件にしていたが、**空の配列も配列**である。
seed にしか無いもの（犬 X を id で名指し）を引く形に直したあと、同じ毒見で:

```
FAIL  マイグレーションと seed が当たっている（seed の犬 X を id で引ける）  HTTP 200 / 0件
```

### 毒「noauth」で赤になった 2件（2026-08-28）

**毒は1種類では足りない。** `empty`（データが空）では
`verify-stack.mjs :: seed のアカウントで実ログインできる` が**緑のまま残った**——
何を送っても通すサーバ相手だったため。そこで**ログインを拒む毒**を足した。

壊し方: `node scripts/poison-run.mjs --flavor=noauth`。
`/auth/v1/*` が `400 invalid_grant` を返す世界（`/auth/v1/health` だけは生かす——
そこを止めると `ensureLocalSupabaseRunning()` の throw で何も走らなくなる）。

`verify-stack` の変化（毒を変えると判定できる範囲が変わる）:

```
empty  : 赤 2 / 緑のまま 2
noauth : 赤 4 / 緑のまま 1
```

全体（`docs/ops/poison-run-result-noauth.md`）: 赤 16件 / 緑のまま 15件。
うち**新しく証明できたのは 2件**（残り13件は `empty` で証明済み）。

- verify-stack.mjs :: seed のアカウントで実ログインできる
- verify-xss.mjs :: 検査を最後まで実行できた

### 両方の毒でも判定できない 15件

`verify-portal` 10件 ／ `verify-screens` 4件 ／ `verify-stack :: Supabase が起きている`。

**これらは緑が正しい。** 前の14件は「`/my` が配信される」「未ログインでログイン導線が
出る」など**静的配信と未ログイン画面**の検査で、土台が空でもログインできなくても
中身は変わらない。最後の1件も、その世界で土台は実際に応答している。

**毒見の判定力は「その検査の対象が、その毒に依存しているか」で決まる。**
この15件を判定するには、毒ではなく**配信物そのものを壊す**必要がある
（例: `dist/` を空にする）。まだ作っていない。

### 毒「nodist」で赤になった 2件（2026-08-28）

壊し方: `node scripts/poison-run.mjs --flavor=nodist`。
`worker/wrangler.poison.toml` が `dist/` の代わりに**空のディレクトリ**を配る。

**注意: この毒は「配信物が空」だけではない。** 土台側は `empty` の毒のままなので、
実際には**データも配信物も両方空**の世界である。より壊れている世界なので
「赤になった」の証拠としては足りるが、**配信物だけを壊した判定ではない**。

全体（`docs/ops/poison-run-result-nodist.md`）: 赤 26件 / 緑のまま 2件。
**うち新しく証明できたのは 2件だけ**（残りは `empty` / `noauth` で証明済み）。

- verify-m6.mjs :: ①. URL を開ける
- verify-m6.mjs :: ②a. 未ログインならログインの画面に導かれる

### 1件ずつ壊して赤になった 9件（2026-08-28・CI run #111）

壊し方: `node scripts/mutate-run.mjs`（`.github/workflows/ci.yml` の `mutate` ジョブ）。
**土台は本物のまま**、製品を1か所だけ壊す。検査は最後まで走り、気づいた項だけが赤になる。

出力（`docs/ops/mutate-run-result.md` は成果物として CI に上がる）:

```
  ✅ delete-assets      verify-delete.mjs              赤   2件
  ✅ delete-assets      verify-admin.mjs               赤   1件
  ✅ hydrate-assets     verify-photo-roundtrip.mjs     赤   6件
  ✅ upload-assets      verify-photo-roundtrip.mjs     赤   1件
  ✅ upload-assets      verify-delete.mjs              赤   1件
  赤になった（＝その壊しを検出できた）: **10件**
  製品のファイルに差分なし。すべて戻せている
```

**どの壊しがどれを赤にしたか**: `delete-assets` → `verify-delete` 4/5 と `verify-admin` 15。
`hydrate-assets` → `verify-photo-roundtrip` 6/7/8/9/11/12。`upload-assets` → 同「検査を最後まで実行できた」。

**3つの壊し全部に、検査が気づいた。新しい欠陥は出なかった。**
客に当たる経路（写真が届く・消したものが消える）について、
**検査が仕事をしていることが実測で確かめられた**——これがこの工程の目的である。

- verify-photo-roundtrip.mjs :: 11. 直しで開くと、付けた写真5枚が控えに残っている
- verify-photo-roundtrip.mjs :: 12. 直したあとも写真5枚が残っている
- verify-admin.mjs :: 15. カルテ1枚が実際に消えた
- verify-delete.mjs :: 4. 写真の実体が Storage から消えた（service_role で数える）
- verify-delete.mjs :: 5. 飼い主のページからカルテが消えている
- verify-photo-roundtrip.mjs :: 6. 飼い主: 表紙が、1枚目に入れた写真
- verify-photo-roundtrip.mjs :: 7. 飼い主: ギャラリーに2枚並ぶ
- verify-photo-roundtrip.mjs :: 8. 飼い主: 耳の写真が、耳の欄に
- verify-photo-roundtrip.mjs :: 9. 飼い主: 歯の写真が2枚、歯の欄に順番どおり

### 1件ずつ壊して赤になった 11件（2026-08-28・CI run #113・2回目）

壊し方を3つ足した回。`settext-off`（`setText` が何も書かない＝飼い主の画面に文字が1つも出ない）。

```
  ✅ text-as-html       verify-xss.mjs                 赤  18件
  ✅ settext-off        verify-report-roundtrip.mjs    赤  11件
  ⚠️  weight-graph-off   verify-report-roundtrip.mjs    赤   0件   ← 穴が出た
  赤になった: **39件**
```

- verify-report-roundtrip.mjs :: 3. 確認: 担当からの一言
- verify-report-roundtrip.mjs :: 4. 確認: 爪（前足/後ろ足）
- verify-report-roundtrip.mjs :: 5. 確認: 耳
- verify-report-roundtrip.mjs :: 7. 確認: 体重
- verify-report-roundtrip.mjs :: 9. 飼い主: 犬の名前
- verify-report-roundtrip.mjs :: 10. 飼い主: 担当からの一言（＋次回のおすすめご来店時期が末尾に付く）
- verify-report-roundtrip.mjs :: 11. 飼い主: 爪（前足/後ろ足）
- verify-report-roundtrip.mjs :: 12. 飼い主: 耳
- verify-report-roundtrip.mjs :: 14. 飼い主: 体重

**`verify-xss` の18件は移せない。** `text-as-html`（`setText` が `innerHTML` を使う＝
`F-20260821-17` の stored XSS そのもの）で **8つの細工すべて・3つの観点すべてが赤**になり、
**XSS の検査が本物であることは実測できた**。しかし出力の名前は
`ear.comment（耳のコメント）: 実行されない` のような実行時の値で、台帳の鍵
（ソース上の `` `${label}: 実行されない` ``）と文字が一致しないため紐付けられない。
**確かめられたのに数に入れられない**——これは台帳の鍵の付け方の問題である（上記）。

### 穴を塞いだ検査を、同じ壊し方で証明した 1件（2026-08-28・CI run #116）

`F-20260828-51`。**証拠は2回の実測の差**である:

```
run #114（14b を足す前）  ⚠️  weight-graph-off  verify-report-roundtrip.mjs  赤 0件  → EXIT 1
run #116（14b を足した後） ✅  weight-graph-off  verify-report-roundtrip.mjs  赤 ≥1件 → EXIT 0
```

`mutate-run.mjs` は「(壊し方 × 検査) の組で赤が0件」なら EXIT 1 で止まる造りなので、
**#116 が EXIT 0 で終わったこと自体が「赤が出た」の実測**である。
2回の間で `verify-report-roundtrip.mjs` に加えた変更は **`14b` の1件だけ**。

これは `D-18` の「直す前（赤）→ 直した後（緑）」を、**検査の側に向けた形**である——
壊しても赤にならなかった状態から、赤になる状態へ変わったことを2回の実行で示した。

- verify-report-roundtrip.mjs :: 14b. 飼い主: 体重のグラフが描かれている（数字だけでなく）

### 1件ずつ壊して赤になった 4件（2026-08-28・CI run #119・4回目）

壊し方を2つ足した回。`resume-draft-off`（書きかけが戻ってこない）と
`empty-back-off`（空の一覧に置き去り・`F-20260825-39` の再現）。**8個とも赤が出た。**

- verify-m6.mjs :: ★b. 戻った先に犬が並んでいる（空の一覧に置き去りにしない）
- verify-m6.mjs :: ★c. 戻ってから、もう一度同じ犬に入れる
- verify-draft.mjs :: 1. 記入が下書きとしてサーバに残った
- verify-draft.mjs :: 2. 離れて戻ると、続きから書ける

**1つ意外だった**: `verify-draft :: 1. 記入が下書きとしてサーバに残った` が
`resume-draft-off` で赤になった。再開を止めただけなのに「保存されたか」の項が落ちる——
検査の流れが**再開に依存している**ということで、項の名前と実際に測っているものが
少しずれている可能性がある。**証明としては有効**（製品の壊れに反応した）が、
`docs/watch.md` W-1 の型の疑いとして残す。

### アプリを壊しても届かない場所（2026-08-28 に判明）

**下書きが飼い主に見えないことと RLS は、アプリではなく DB（RLS）が守っている**
（`worker/src/data-stores/supabase-data-store.js:167` のコメント
「飼い主側は別経路（RLS が `status='final'` を…）」）。

つまり `verify-draft :: 3. 下書きは飼い主に見えない` や
`verify-portal :: 13. 他人の犬（Q）は見えない（RLS）` は、
**アプリのコードをいくら壊しても赤にならない**。守りが DB 側にあるからである。

証明するには**マイグレーションの SQL を壊して `supabase db reset` を掛ける**必要があり、
いまの `mutate-run.mjs` には無い仕組み。**残り141件のうち、RLS が守っている分は
この方法を作らないかぎり永久に埋まらない**。

→ **この仕組みを作った**（下の run #122）。上の「永久に埋まらない」は解消している。

### DB（RLS）を壊して赤になった 4件（2026-08-28・CI run #122・5回目）

`mutate-run.mjs` に `sql: true` の壊し方を足した。マイグレーションの SQL を書き換えたあと
**`npx supabase db reset` を掛ける**——ファイルを書き換えただけでは動いている DB は
古いポリシーのままで、**壊したつもりで何も壊れておらず「検査が気づかなかった」という
逆の結論が出る**。

```
  ✅ rls-any-owner-sees-any-dog verify-portal.mjs              赤   2件
  ⚠️  rls-any-owner-sees-any-dog verify-report-roundtrip.mjs    赤   0件   ← 穴が出た
  ✅ rls-drafts-leak    verify-draft.mjs               赤   1件
  ✅ rls-drafts-leak    verify-empty-pet.mjs           赤   1件
  赤になった: **48件**
```

`rls-any-owner-sees-any-dog` は `pets_customer_select` を
`using (active and private.is_owner_user(owner_id))` → `using (active)` に開く。
**ログインさえすれば全店の全頭が一覧に出る**状態である。
`rls-drafts-leak` は `reports_customer_select` から `status = 'final'` を落とす。
**確定前の下書きが飼い主にそのまま届く**状態である。

- verify-draft.mjs :: 3. 下書きは飼い主に見えない

**出た穴**: `verify-report-roundtrip :: 17. 他人には見えない（RLS）` は、
犬の RLS を全開にしても**緑のままだった**。
→ 名前を `17. 他人にはこのカルテが見えない（RLS）` に直し、
`rls-any-owner-sees-any-dog` の期待先から外した（`F-20260828-52`）。

### 逆側も剥がしてみたら、守りが二重だと分かった（run #124）

`rls-reports-open-to-strangers`（カルテ側の RLS だけを開ける）を掛けた。
**それでも `17.` は緑だった。** 2回の実測を並べると理由が出る:

```
run 122  犬の RLS だけ開ける      → カルテは private.can_read_pet(pet_id) が止める
run 124  カルテの RLS だけ開ける  → 画面が犬を引けず、そこで止まる
```

`17.` が測っているのは**結果（他人にカルテが届くか）**で、どちらか一方のポリシーではない。
片方が残っているかぎり届かないので、**どちらの回も緑が正しい**。
**この項は、単発の壊しでは原理的に判定できない。**

→ `mutate-run.mjs` に `edits`（2か所を同時に壊す）を足し、
`rls-both-layers-open`（犬とカルテを**両方**開ける）に置き換えた。
**run #126 で赤になった**——読みが当たったので、証明済みへ移す。

- verify-report-roundtrip.mjs :: 17. 他人にはこのカルテが見えない（RLS）

**ここで分かったこと**: 二重の守りは製品としては正しいが、**それを1本の項でしか
見ていないと、片方が壊れても誰も気づかない**。犬の RLS が全開になった状態を
捕まえたのは `verify-portal` の `11./13.` だけだった。**層ごとに、その層を
名指しで見る項が要る**——これは読んでも出ず、**2回壊して初めて出た**。

### `verify-xss` の18件を、3件として台帳に移した（同・run #122）

`text-as-html`（`setText` が `innerHTML` を使う＝`F-20260821-17` の stored XSS そのもの）で
**実行時の名前18件がすべて赤**になった。この18件は
`ear.comment` `nail.comment` `staffNote` `teeth.comment` `teeth.status` `犬の名前` の
**6つの細工 × 3つの観点**であり、`<細工の名前>: …` という形の名前を出す
`check()` は `verify-xss.mjs` に**この3か所しか無い**（`scripts/verify-xss.mjs:131,133,134`）。
18件すべてが赤なら、**3か所とも赤になったことが確定する**。
実行時の文字列と台帳の鍵が一致しないのは変わらないが、**証明としては成立している**ので移す。

（`check(label, false, …)` の3か所＝`label` `label #2` `label #3` は、
犬を作れない・カルテを作れない・確定できないときの早期脱出で、**この壊しでは通っていない**。
未証明のまま残る。）

- verify-xss.mjs :: `${label}: 細工が文字として飼い主の画面に出ている`
- verify-xss.mjs :: `${label}: 実行されない`
- verify-xss.mjs :: `${label}: 要素として注入されていない`

### 1回目: verify-admin を狙って赤になった 11件（2026-08-28・CI run #133）

壊し方を `ids` で10個に絞って走らせた（`admin-redirect-off` 〜 `pet-purge-broken`）。

```
  ✅ admin-redirect-off verify-admin.mjs               赤   2件
  ✅ admin-menu-title-lost verify-admin.mjs               赤   2件
  ✅ admin-owner-create-broken verify-admin.mjs               赤   2件
  ✅ admin-pet-create-broken verify-admin.mjs               赤   2件
  ✅ admin-revise-no-prefill verify-admin.mjs               赤   1件
  ✅ admin-revise-becomes-new-report verify-admin.mjs               赤   3件
  ✅ admin-revise-endpoint-broken verify-admin.mjs               赤   2件
  ✅ admin-delete-confirm-unlocked verify-admin.mjs               赤   1件
  ✅ admin-non-admin-gate-off verify-admin.mjs               赤   2件
  ⚠️  pet-purge-broken   verify-admin.mjs               赤   0件
  赤になった: **13件**（名前の重複2件を除くと11件が新規）
```

**`pet-purge-broken` は1件も赤にならなかった。** `#18`（写真がゼロのまま Storage を
見ていた構造欠陥）を直したあとの、初めての実測。これで `purgePetAssets` を壊すと
**本当に検出できることが確かめられた**ので、証明済みへ移す。

- verify-admin.mjs :: 5. 顧客アカウントが実際に作られた
- verify-admin.mjs :: 6. ペットアカウントが実際に作られた
- verify-admin.mjs :: 8. 修正で開くと、前に書いた中身が入っている
- verify-admin.mjs :: 9. 直す操作が最後まで進んだ（保存されて開き直した）
- verify-admin.mjs :: 10. 直しても同じカルテのまま（2枚目を作らない）
- verify-admin.mjs :: 11. 確定済みのカルテは1枚のまま
- verify-admin.mjs :: 12. 中身が直っている（確定済みが上書きされた）
- verify-admin.mjs :: 14. 名前を打つまで削除ボタンは押せない
- verify-admin.mjs :: 19. 管理者でないスタッフに管理者の操作を出していない
- verify-admin.mjs :: 20. 行き止まりにせず、その人が使える画面への入口を出している

**`admin-menu-title-lost` は謎が残っている。** 狙いは `2./3./4./13.`（見出しが
`strong` → `span` で読めなくなる）だったが、集計に載った2件の名前が特定できない
——`1.` と catch のどちらとも重ならないはずなのに、最終的な「赤になった」一覧に
`2./3./4./13.` のどれも現れない。**この4件は未証明のまま残す**（狙いどおりと
決めつけない・`D-18`）。次の回で `admin-menu-title-lost` **単体**を走らせ、
どの2件が赤になったかを切り分けて確かめる。

**この回でもう1つ分かったこと**: CI の「結果を枝にコミットする」段が
`git status --porcelain` で差分を見ていたが、**この呼び方は無視ファイル
（`.gitignore` の `mutate-run-partial.md`）を黙って見せない**。run 133 は
実際には10個すべて走って赤も出ていたのに、CI は「差分なし」と誤判定して
**一度もコミットしなかった**——記録が成果物（90日で消える）にしか残らない
ところだった。`git diff --cached`（無視設定と無関係に本当の差分を返す）へ
直した。上の内容は成果物から復元して手で移した。

### 2〜6回目分・`admin-menu-title-lost` の再実行 41件（2026-08-28・CI run #139）

`ids` に20個（`admin-menu-title-lost` の単体再実行 + 2〜5回目ぶん全部）を渡して走らせた。

**`admin-menu-title-lost` の謎が解けた。** run #133 で「狙いは4件なのに2件しか
赤にならない」と見えていたのは、**謎ではなく取り違い**だった——単体で走らせたら
`2./3./4./13.` の**4件とも**赤になった。run #133 の集計表示（`proven` を検査の
**名前**で `Map` に入れて重複を弾く仕組み）を読み違えていただけで、機械側の欠陥では
なかった。

**この run もまた `git status --porcelain` の無視ファイル問題を踏んだ**——
直前に別のコミット（`d9c93ce`）を push していたため、CI 側の push が
`rejected (fetch first)` で落ちた。**中身は正しく `docs/ops/mutate-run-partial.md`
に書けていた**ので、成果物 zip から復元して手で移した（`F-20260828-53` の続き）。

新たに ⚠️ が2種、4件出た:

```
⚠️  rls-any-owner-sees-any-dog verify-portal.mjs              赤   0件
⚠️  rls-any-owner-sees-any-dog verify-invitation.mjs          赤   0件
⚠️  edit-empty-photo-src-regress verify-edit.mjs                赤   0件
⚠️  edit-empty-photo-src-regress verify-report-roundtrip.mjs    赤   0件
```

`edit-empty-photo-src-regress` は原因が判明・修正済み（`F-20260828-54`。
`img.src=''` は**プロパティ**の代入で、`getAttribute('src')` で読む2つの検査には
そもそも見えない）。`scripts` から `verify-edit.mjs` と `verify-report-roundtrip.mjs`
を外し、狙いどおり動く `verify-photo-roundtrip.mjs` だけに絞った。

`rls-any-owner-sees-any-dog` は**未解決**。この壊し方は run #122・#126 で
**同じコードのまま** `verify-portal.mjs` を2回赤にしている。今回だけ0件になった
理由が、CI環境の一時的なもの（`db reset` 後 PostgREST がまだ古いポリシーの
キャッシュを見ていた、等）か、それとも本当に何かが変わったのかを、**まだ判別
できていない**。次の回で**この壊し方だけを単体で**再実行し、切り分ける。
`verify-invitation.mjs`（今回追加した分）の期待もその結果を見てから判断する。

#### 追記（CI run #144・単体再実行）: もう1回、赤0件を再現した

`ids` を `rls-any-owner-sees-any-dog app-throws-runtime-error portal-throws-runtime-error`
の3つだけに絞り、`rls-any-owner-sees-any-dog` を完全に単独で再実行した。
結果は同じ——`verify-portal.mjs` が**また1件も赤にならなかった**（`verify-invitation.mjs`
も0件）。これで **run #122・#126（赤になった・2回）と run #139・#144（赤にならない・2回）
が2対2で割れている**。

切り分けのため、次の仮説を調べたが**どれも決め手にならなかった**:

- 壊し方のコード自体がずれた → `grep -n "id: 'rls-any-owner-sees-any-dog'" -A 15
  scripts/mutate-run.mjs` で確認、run #122 時点と**バイト単位で同一**
- 別の migration がポリシーを上書きしている → `grep -rn "pets_customer_select"
  supabase/migrations/*.sql` は1か所のみ。定義は1つしかない
- 対象ペット（Q）の `active` フラグが立っていない → seed の INSERT は `active` を
  明示していない。列は `not null default true` なので既定で `true`。除外の説明にならない
- 他の permissive ポリシーが割り込んでいる → `pets_staff_all` は
  `is_shop_staff(shop_id)` が要るので customer ロールでは false のはず
- `mutate-run.mjs` の SQL 壊し全般が壊れている → **同じ run #144 のバッチに含まれる
  他の SQL 壊し方は正しく赤になっている**ので、一般的な「SQL 壊し・db reset が
  効いていない」という説明は成り立たない

残っている仮説は2つ、どちらも確かめていない:

1. **`ids` で絞った実行に固有の何か**（フル実行では違う結果になる可能性）
2. **CI 環境側の何かが本当に変わった**（PostgREST のスキーマキャッシュ、
   コネクションプール、runner イメージの更新など）

これは `pets_customer_select`（**他人の犬が見えないこと**）を守る RLS を検出する
検査で、**製品のセキュリティに直結する**。判別がつかないまま「証明済み」と
書くのは `D-18` に反する（同じ壊し方で2回連続赤にならなかったのに、過去の
2回だけを見て緑と決めるのは「落ちるはず」の側に立つことになる）ので、
`verify-portal.mjs :: 11.` と `13.` は**「証明済み」から一旦外し、下の「未証明」
へ戻す**。上の仮説1を切り分けるため、`ids` を絞らない**フル実行**（CI run #149）を
別途走らせている——結果はこのファイルへ追記する。

#### 追記（CI run #149・`ids` を絞らないフル実行）: 赤になった。ただし別の4件が今度は0件になった

`ids` を空にして（`MUTATIONS` 全44個・約30分）走らせた。結果:

```
- 11. ログイン後、自分の犬（X/Y/Z）が一覧に出て、他人の犬（Q）は出ない   ← rls-any-owner-sees-any-dog / verify-portal.mjs
- 13. 他人の犬（Q）は見えない（RLS）   ← rls-any-owner-sees-any-dog / verify-portal.mjs
- 7. 使い終わった招待は、別の人が使えない   ← rls-any-owner-sees-any-dog / verify-invitation.mjs
```

**`rls-any-owner-sees-any-dog` は3回赤になった**（run #122・#126・#149）。**2回赤にならなかった**
（run #139・#144、どちらも `ids` で絞った実行）。フル実行はこれで3戦3勝、`ids` を絞った実行は
2戦2敗——きれいに割れている。

そこで**仮説1（`ids` を絞った実行に固有の何か）が濃厚と見て**、`verify-portal.mjs :: 11.` /
`13.` を「証明済み」へ戻す。判断の根拠は「過去の成功を信じる」ではなく、**今日・この
コードで、フル実行が確かに赤にした**という直近の実測（run #149）が主体。

- verify-portal.mjs :: 11. ログイン後、自分の犬（X/Y/Z）が一覧に出て、他人の犬（Q）は出ない
- verify-portal.mjs :: 13. 他人の犬（Q）は見えない（RLS）

ただし**この run で新しい割れ方が出た**。今度は逆方向——**過去に `ids` を絞った実行
（run #139）で赤になったはずの4件が、このフル実行では0件（⚠️）だった**:

```
⚠️  delete-throws                       verify-delete.mjs             赤   0件
⚠️  draft-becomes-new-report             verify-draft.mjs               赤   0件
⚠️  report-roundtrip-teeth-value-mismatch verify-report-roundtrip.mjs   赤   0件
⚠️  report-roundtrip-finalize-broken     verify-report-roundtrip.mjs   赤   0件
```

これで見えてきたのは「`ids` を絞ると壊れる／絞らないと直る」という単純な話ではなく、
**この壊し方の機械（`mutate-run.mjs` ＋ Playwright ＋ ローカル Supabase）が、run ごとに
違う個別の壊し方をたまたま検出し損ねる、一般的な不安定さを持っている**可能性——
`rls-any-owner-sees-any-dog` はフル実行側で安定、この4件は絞った実行側で安定、という
非対称ではなく、**両方向で「特定の1回だけ検出漏れ」が起きている**。

このほかに今回新しく ⚠️ になった9件（`app-throws-runtime-error` 4件・
`portal-throws-runtime-error` 1件・`portal-flavor-broken`・
`portal-signout-hidden-after-login`・`empty-pet-fake-history-entry`、
`pet-purge-broken`）は**今回が初めての実行**なので、run #144（一部）で赤だった
`app-throws-runtime-error` / `portal-throws-runtime-error` の分と合わせて、
再現するかを次の実行で確かめる。

**再現性を確かめるため、失敗した2ジョブ（`mutate` / `walk`。`walk` は別件、下記）を
再実行した（CI run #149 の rerun_failed_jobs）。** 結果が出たらここに追記する。
「1回だけ0件」を根拠に恒久的な欠陥と決めつけない——CI babysit のルールどおり、
**flake の可能性は1回の再実行で確かめてから**判断する。

#### 追記（CI run #149・rerun_failed_jobs）: `walk` は再現せず（flake確定）。`mutate` は別の割れ方をした

`walk` ジョブは**再実行で通った**（「②一覧が出なかった」というログイン注入のタイムアウトは
1回だけで、2回連続では起きなかった）。**flake と確定**——製品コードの直しは要らない。

`mutate` ジョブ（フル実行・44個）はまた失敗したが、**⚠️ の中身が1回目と変わった**:

```
- [pet-purge-broken] verify-admin.mjs             赤   0件   ← 1回目・2回目とも0件（2/2）
- [invite-reusable]  verify-invitation.mjs        赤   0件   ← 1回目は赤だった（1/2）
```

1回目に ⚠️ だった `delete-throws` / `draft-becomes-new-report` /
`report-roundtrip-teeth-value-mismatch` / `report-roundtrip-finalize-broken` /
`app-throws-runtime-error`（4件）/ `portal-throws-runtime-error` /
`portal-flavor-broken` / `portal-signout-hidden-after-login` /
`empty-pet-fake-history-entry` の**9件は、2回目はすべて赤になった**（新規4件を
証明済みへ移した——下記）。**これで一般的な不安定さ説が濃厚**——同じ壊し方でも
run ごとに違う個別の項目が検出漏れを起こす。1回の0件では判定しない、を徹底する。

`pet-purge-broken` だけは**2回連続で0件**——これは flake ではなく実在の欠陥だった。
読み直したら `verify-admin.mjs :: 18.`（写真の実体が消えたか）の Storage 一覧 API 呼び出しに
`apikey` ヘッダが無く、Kong に弾かれて**常に失敗**していた。失敗を `listed.ok ? … : []` で
黙って「空」に丸め、`objects.length === 0` を合格にしていたため、**Storage 一覧が引けようが
引けまいが必ず PASS** する構造だった——16/17 で直したのと同じ「空で受けて合格にする」型
（`docs/watch.md` W-1）が、18 にはまだ残っていた（`F-20260828-56`）。`apikey` を足し、
失敗を握り潰さず投げるよう直した。**この直しの効果はまだ未証明**（次の `pet-purge-broken`
単体実行で赤になることを確かめる）。

もう1つ、CI 側の実インフラ不具合も見つかった。`結果を枝にコミットする` 段の
fetch+rebase+retry は**単純な競合（先を越されただけ）しか想定しておらず**、
`docs/ops/mutate-run-result.md`（フル実行のたびに丸ごと書き直すファイル）どうしの
**内容衝突**では `git rebase` 自体が止まり、この回の実測データが1つも枝に
残らないところだった（成果物 zip から手で復元した）。`git rebase … -X theirs`
（今回生成した中身を無条件に勝たせる）に直した——このファイルはスナップショットで
マージする意味が無いため。

- verify-portal.mjs :: 2. 起動分岐が立っている
- verify-portal.mjs :: 4. ポータルが起動している
- verify-portal.mjs :: 12. ログイン後はログアウトボタンが出る
- verify-empty-pet.mjs :: 4. 履歴の行が1つも出ていない

#### 追記（CI run #154・`apikey` 直し後のフル実行）: `mutate` の commit は直った。`pet-purge-broken` は3戦3敗で実欠陥と確定

`-X theirs` の直しを検証するため、`verify-admin.mjs` の `apikey` 直しと合わせて
フル実行（ids 無し）を CI に出した。**`結果を枝にコミットする` 段は今回衝突せず、
素直にコミット・push できた**（直し自体は次に衝突が起きたときに効くはずだが、
今回は競合が起きなかったので `-X theirs` の分岐は未通過。書き方としては正しい
はずだが、実際に衝突を通したところはまだ見ていない）。

`pet-purge-broken` は**3回目もまた `verify-admin.mjs` が0件**だった（run #149・
rerun・run #154 で3戦3敗）。`apikey` を足しても直らなかったため、手順全体を
読み直したところ、**2つ目の欠陥**が見つかった——直前の「⑤ 削除: カルテ1枚」
（`15.`）が、この犬の唯一の写真をすでに Storage から消していたため、
`purgePetAssets` に届く時点で対象が0件だった（`F-20260828-56` に追記）。
`15.` の直後にもう1枚カルテを確定させ、写真を残してから「⑤ 削除: ペット全データ」
へ進むよう直した。**この直しの効果はまだ未証明**——次の実行で赤になることを確かめる。

一方 `invite-reusable` は今回は赤に戻った（run #149-1回目: 赤／2回目: 0件／
run #154: 赤 → 3回中2回赤）。`rls-drafts-leak` が今回**新たに** 0件
（`verify-draft.mjs`・`verify-empty-pet.mjs` の両方）——ただし run #122 での証明
以降ずっと赤だったものが初めて0件になったのはこの1回だけなので、いまの時点では
一般的な不安定さ説の範囲として扱い、証明済みの `verify-draft.mjs :: 3.` /
`verify-empty-pet.mjs :: 6.` は動かさない。もう一度0件が出たら
`rls-any-owner-sees-any-dog` と同じ扱い（未証明へ戻して調べる）にする。

- verify-admin.mjs :: 2. 管理者ページに リピーター / 新規 / 削除 / 店舗設定 が在る
- verify-admin.mjs :: 3. リピーターに カルテ作成 / カルテ修正 が在る
- verify-admin.mjs :: 4. 新規に 顧客アカウント作成 / ペットアカウント作成 が在る
- verify-admin.mjs :: 13. 削除に 顧客 / ペット / カルテ の3つが在る
- verify-edit.mjs :: 1. /edit が配信される
- verify-edit.mjs :: 2. 正UI が配られている（screen-N が在る）
- verify-edit.mjs :: 3. App が名前で届く（インライン onclick の解決先）
- verify-edit.mjs :: 3b. App のメソッドが実際に呼べる
- verify-edit.mjs :: 3c. onclick="App.…" が実在する
- verify-edit.mjs :: 4. Supabase vendor が載っている
- verify-edit.mjs :: 5. staff モジュールが載っている（boot を持つ）
- verify-edit.mjs :: 6. 注入先が backend/js/ に直っている
- verify-edit.mjs :: 8. ②一覧が実データの犬になっている
- verify-edit.mjs :: 11. 件数が実データと合っている
- verify-edit.mjs :: 14. ⑤確認の器から意匠モックの既定文が消えている
- verify-edit.mjs :: 17. ④の入力欄が空で始まる（見本の文が入っていない）
- verify-portal.mjs :: 5. 未ログインでログイン導線が出る
- verify-portal.mjs :: 6. ログインボタンが押せる
- verify-portal.mjs :: 9. 犬を直接指す URL でもログイン導線が出る
- verify-portal.mjs :: 14. サインアウトでログイン画面に戻る
- verify-portal.mjs :: 15. 失効・リンク解除のあとでも、ログインボタンが出て押せる（詰まない）
- verify-m6.mjs :: ④. カルテを書く画面に、書く場所と確定の入口が在る
- verify-m6.mjs :: ⑤c. 確定後に④へ戻ると、その犬の名前が見出しに出ている
- verify-m6.mjs :: ⑥a. 飼い主は一覧から自分の犬に入れる
- verify-empty-pet.mjs :: 2. 正直な空の状態が出ている
- verify-empty-pet.mjs :: 3. 写真が1枚も出ていない
- verify-empty-pet.mjs :: 5. 見本の文章が出ていない
- verify-empty-pet.mjs :: 6. 確定していないカルテは飼い主に見えない
- verify-invitation.mjs :: 2. 一覧に初回登録（QR）の入口が出ている
- verify-invitation.mjs :: 3. 押すと初回登録の URL が出る
- verify-invitation.mjs :: 4. QR が画像として出ている
- verify-invitation.mjs :: 6. 招待を消化すると、自分の犬が見える
- verify-invitation.mjs :: 7. 使い終わった招待は、別の人が使えない
- verify-delete.mjs :: 3. 製品の削除の道が最後まで通った
- verify-draft.mjs :: 5. 確定すると下書きは残らない
- verify-draft.mjs :: 6. 次に開くと、確定済みの記入は蘇らない
- verify-report-roundtrip.mjs :: 1b. 押したボタンの表示が、そのまま保存される値になっている
- verify-report-roundtrip.mjs :: 2. 確定してカルテが1件できた
- verify-report-roundtrip.mjs :: 6. 確認: 歯
- verify-report-roundtrip.mjs :: 13. 飼い主: 歯
- verify-photo-roundtrip.mjs :: 10. 飼い主: 壊れた画像（ページURL を指す img）が無い

### 6回目: 「アプリ由来のエラーが無い」系をまとめて狙った（CI run #144・部分実行）

`app-throws-runtime-error`（`ui.js init()` に遅延 throw を注入）と
`portal-throws-runtime-error`（`supabase-auth.js bootProtectedPortal()` に同型の注入）の
2つで、4本の検査ファイルにまたがる5件が同時に赤になった。

- verify-admin.mjs :: 21. アプリ由来のエラーが無い
- verify-edit.mjs :: 7. アプリ由来のエラーが無い
- verify-photo-roundtrip.mjs :: 13. アプリ由来のエラーが無い
- verify-report-roundtrip.mjs :: 18. アプリ由来のエラーが無い
- verify-portal.mjs :: 10. アプリ由来のコンソールエラーが無い（ログイン前）

### 9回目: `pet-purge-broken` の2つ目の直しが効いた 1件（2026-08-28・**手元で実測**）

`F-20260828-56` の2つ目の直し（`15.` の直後にもう1枚カルテを確定させ、
`purgePetAssets` に実際に消す対象を渡す）の効果を、**CI ではなく手元で**確かめた。
CI は run #156 以降ずっと即死しているが、**この作業場では Docker が動いた**ので
`npx supabase start` から先が全部走る（経緯は `docs/handoff.md` `0-K`）。

```
node scripts/mutate-run.mjs pet-purge-broken

  ✅ pet-purge-broken   verify-admin.mjs               赤   1件

    18. 消した犬の写真が Storage に残っていない   ← pet-purge-broken / verify-admin.mjs
```

**3戦3敗（run #149・rerun・#154）だったものが、直して初めて赤になった。**
`purgePetAssets` を壊すと `18.` が気づく——これで `F-20260828-56` は
「直したが未検証」ではなくなった。

- verify-admin.mjs :: 18. 消した犬の写真が Storage に残っていない

### 10回目: verify-edit の残りを狙った 5件（2026-08-28・**手元で実測**）

`## F4 を閉じる範囲` の残り42件のうち、`verify-edit` に固まっていた分を狙って
壊し方を4個足した。**CI ではなく手元の worktree で実測**（`docs/handoff.md` `0-K`）。

```
node scripts/mutate-run.mjs edit-dummy-dogs-leak edit-breed-mock-refill \
                            empty-photo-attr-page-url letter-section-always-shown

  ✅ edit-dummy-dogs-leak        verify-edit.mjs               赤   4件
  ✅ edit-breed-mock-refill      verify-edit.mjs               赤   3件
  ✅ empty-photo-attr-page-url   verify-edit.mjs               赤   3件
  ✅ empty-photo-attr-page-url   verify-report-roundtrip.mjs   赤   1件
  ✅ empty-photo-attr-page-url   verify-photo-roundtrip.mjs    赤   1件
  ✅ letter-section-always-shown verify-edit.mjs               赤   3件

  赤になった: 8件（⚠️ 0件）
```

**`empty-photo-attr-page-url` は `F-20260828-54` が残した宿題そのもの。**
あの回は「共通部品を直したから共通に効くはず」で `edit-empty-photo-src-regress` の
`scripts` を広げ、`verify-edit :: 15.` と `verify-report-roundtrip :: 16.` が
赤0件だった。原因は `img.src = ''`（**プロパティ**代入）と `getAttribute('src')`
（**素の属性**）の観測点の違いで、失敗記録には
「`getAttribute('src')` が実際に壊れた値を返す形の壊し方が要る」と書き残してあった。
今回はそのとおり `img.setAttribute('src', location.href)` で**属性そのものに**
書き込む形にしたので、**両方の観測点から見える**——狙った2件がどちらも赤になった。

- verify-edit.mjs :: 9. 仮データ（window.DUMMY）の犬が出ていない
- verify-edit.mjs :: 10. 持っていない項目（犬種・担当）が空で出ている
- verify-edit.mjs :: 15. 空の写真スロットがページURLを指していない
- verify-edit.mjs :: 16. 担当メッセージが無いカルテで、文例が出ていない
- verify-report-roundtrip.mjs :: 16. 飼い主: 壊れた画像（ページURL）が出ていない

### 11回目: 犬体図の印と、体重の見本値 3件（2026-08-28・**手元で実測**）

```
node scripts/mutate-run.mjs skin-image-blank weight-prefilled-sample

  ✅ skin-image-blank         verify-report-roundtrip.mjs   赤   2件
  ✅ weight-prefilled-sample  verify-report-roundtrip.mjs   赤   1件

    8. 確認: 犬体図の印が画像として出ている    ← skin-image-blank
    15. 飼い主: 犬体図の印が画像として届く      ← skin-image-blank
    19. 体重の欄が空で始まる（見本値が入っていない） ← weight-prefilled-sample
```

**`20.`（飼い主の画面に、量っていない体重が出ない）は緑のまま残した。**
既定値を入力欄に入れても、その値は飼い主まで届いていない——つまり
**症状そのものが起きていない**ので、緑が正しい。検査の欠陥ではないので
未証明のまま置く（`17.` と同じ扱い。`docs/failures.md` `F-20260828-52` 参照）。

**この回で2つ、記録しておくべきことがあった。**

1. **`weight-prefilled-sample` は、はじめ狙う場所を間違えていた。**
   `src/js/ui.js` の `applyReport()` にある `data.weights` を壊したが、
   あそこは**既存カルテを開いたときにしか走らない**。検査19 は「カルテの無い
   新しい犬」を開くので、1件も赤にならなかった（⚠️）。**壊し方が悪かったので
   あって、検査は正しかった**——`F-20260828-54` と同じ型。狙う場所を
   入力欄そのもの（`src/index.html` の `#input-weight`）に付け替えたら赤になった。
2. **`skin-image-blank` は、1回目の実行で `0. 検査用の犬を登録できた` と
   `検査を最後まで実行できた` が赤になり、狙った `8./15.` には届かなかった。**
   壊し方を手で当てて `npm run verify:roundtrip` を直接走らせたところ、
   **`8.` と `15.` だけが FAIL で他は全部 PASS**——狙いどおりだった。
   1回目はその回限りの不安定さ。**⚠️ を「検査が壊れている」と記録する前に、
   壊し方が本当に症状を起こしているかを直接見ること。**

- verify-report-roundtrip.mjs :: 8. 確認: 犬体図の印が画像として出ている
- verify-report-roundtrip.mjs :: 15. 飼い主: 犬体図の印が画像として届く
- verify-report-roundtrip.mjs :: 19. 体重の欄が空で始まる（見本値が入っていない）

### 12回目: 未ログインの `/my` 2件（2026-08-28・**手元で実測**）

```
node scripts/mutate-run.mjs portal-content-shown-logged-out portal-sample-image

  ✅ portal-content-shown-logged-out  verify-portal.mjs   赤   1件
  ✅ portal-sample-image              verify-portal.mjs   赤   1件

    7. 未ログインで中身とログアウトは隠れている  ← portal-content-shown-logged-out
    8. 見本画像を出していない                    ← portal-sample-image
```

- verify-portal.mjs :: 7. 未ログインで中身とログアウトは隠れている
- verify-portal.mjs :: 8. 見本画像を出していない

### 13回目: いま開いている画面 2件（2026-08-28・**手元で実測**）

```
node scripts/mutate-run.mjs screen-stale-panels-stay-active

  ✅ screen-stale-panels-stay-active  verify-edit.mjs   赤   4件

    8. ②一覧が実データの犬になっている
    11. 件数が実データと合っている
    12. 一覧の画面（screen-2）が開いている
    13. ⑤確認の画面（screen-4）が開いている
```

**1回目の壊し方は失敗した。記録しておく。** はじめ `goToStep()` の
`document.getElementById(\`screen-${stepNum}\`)` を `'screen-1'` に固定したが、
狙った `12./13.` には**1件も届かず** `検査を最後まで実行できた` だけが赤になった。
理由は「壊しすぎ」——**目的の画面が隠れたままなので `waitForSelector` が
タイムアウトし、検査がそこで死ぬ**。`⛔ 毒見の天井` と同じ型が、1件ずつ壊す
やり方でも起きる。

**画面を隠さずに、前の画面を閉じないだけ**にしたら通った。`is-active` が複数の
パネルに残るので `querySelector('.screen-panel.is-active')` は DOM 順で最初の
ものを返す——**流れは最後まで動いたうえで、「いま居る画面」の判定だけが狂う**。

> **狙う項の手前に `waitForSelector` があるなら、そこを通れる壊し方にする。**
> 通れないと、赤になるのは `検査を最後まで実行できた` だけで、狙った項は
> 何も証明できない。

- verify-edit.mjs :: 12. 一覧の画面（screen-2）が開いている
- verify-edit.mjs :: 13. ⑤確認の画面（screen-4）が開いている

### 14回目: 管理者の削除が DB に届いていない 2件（2026-08-28・**手元で実測**）

削除は「写真 → DB」の2段（`D-20260824-34`）。**DB を消す段だけ**を落とすと、
画面は成功したように見えるのに実体が残る——`16./17.` はそこを見ている。
写真の段は残すので、検査は最後まで動く。

```
node scripts/mutate-run.mjs admin-owner-delete-not-persisted
  ✅ 赤 1件   17. 顧客が実際に消えた

node scripts/mutate-run.mjs admin-pet-delete-not-persisted
  ✅ 赤 1件   16. ペットが実際に消えた
```

**2つを同時に走らせた1回目は、`admin-pet-delete-not-persisted` が
`1.` と `検査を最後まで実行できた` を赤にして `16.` に届かなかった。**
単体で走らせ直したら `16.` だけが赤になった——**一過性の不安定さ**。
このセッションで3回目（`skin-image-blank`・`screen-switch-stuck` の1回目・これ）。

> **狙った項に届かず `検査を最後まで実行できた` が赤になったときは、
> まず単体で走らせ直す。** 壊し方が悪いのか、その回限りの不安定さなのかは、
> 2回目を見るまで区別がつかない。

- verify-admin.mjs :: 16. ペットが実際に消えた
- verify-admin.mjs :: 17. 顧客が実際に消えた

### 15回目: カルテ0件の犬 3件（2026-08-28・**手元で実測**）

```
  ✅ screen-stale-panels-stay-active  verify-empty-pet.mjs  赤 1件
       8. トリマーは1件目を作る画面に入れる
  ✅ empty-pet-name-wrong             verify-empty-pet.mjs  赤 1件
       1. 犬の名前は出ている（ページ自体は開けている）
  ✅ commit-button-out-of-dock        verify-empty-pet.mjs  赤 1件
       9. 確定のボタンが在る（行き止まりでない）
```

`8.` は**既存の壊し方の `scripts` を広げて当てた**（`screen-stale-panels-stay-active`
に `verify-empty-pet.mjs` を追加）。`F-20260828-54` の教訓どおり、**広げてから
実測して**当たることを確かめている——広げただけで証明済みにはしていない。

**この回も2つ、壊し方のほうが間違っていた。**

1. **`empty-pet-name-lost`（見出しを空にする）は狙いに届かなかった。**
   見出しが不可視になり `waitForSelector('[data-testid="pet-name"]')` が
   タイムアウトして、検査がそこで死んだ（13回目とまったく同じ型）。
   **別の子の名前を出す**形（`empty-pet-name-wrong`）にしたら、見えたまま
   中身だけが違う状態になり、狙いどおり `1.` が赤になった
2. **`commit-button-out-of-dock` を `hidden` で作ったら ⚠️（赤0件）だった。**
   検査は `querySelector` で**在るかどうか**を見ているので、隠しても DOM には
   残る。**掴む名前のほう**（`class="boxbutton …"`）を変えたら赤になった。
   **「見えない」と「無い」は別物**——どちらを見ている検査なのかを先に読むこと

- verify-empty-pet.mjs :: 1. 犬の名前は出ている（ページ自体は開けている）
- verify-empty-pet.mjs :: 8. トリマーは1件目を作る画面に入れる
- verify-empty-pet.mjs :: 9. 確定のボタンが在る（行き止まりでない）

### 16回目: 犬の登録が「できた」と返さない 2件（2026-08-28・**手元で実測**）

**「土台の設営そのもの（`0.`/`1.` の用意できた系）は狙えない」は、思い込みだった。**
`0-I` 以来ずっと「個別に狙うと壊れる範囲が広すぎる」として後回しにしてきたが、
**状態コードだけを変えれば、実体は作られたまま「作れたと返さない」状態を作れる**。

```
node scripts/mutate-run.mjs pet-create-wrong-status

  ✅ pet-create-wrong-status  verify-delete.mjs      赤 2件
  ✅ pet-create-wrong-status  verify-invitation.mjs  赤 1件

    0. 検査用の犬を登録できた      ← verify-delete.mjs
    1. その飼い主の犬を登録できた  ← verify-invitation.mjs
```

壊し方は `worker/src/index.js` の `201` を `200` にするだけ。**犬そのものは
作られる**ので土台は壊れず、「作れたかどうかを状態コードで見ている」検査だけが
赤になる。実際の欠陥としても本物で、呼ぶ側は成功を判定できず、画面は
「登録できませんでした」に落ちて**同じ子が二重に作られる**。

> **「用意できた」系を狙うときは、実体ではなく“できたという知らせ”を壊す。**
> 実体を壊すと検査が最初の一歩で死んで何も証明できない（`⛔ 毒見の天井`）。

- verify-delete.mjs :: 0. 検査用の犬を登録できた
- verify-invitation.mjs :: 1. その飼い主の犬を登録できた

### 単発の壊しでは赤にできないと分かった 2件（2026-08-28・**手元で実測**）

> **見出しの付け方に注意。** この節ははじめ「判定できないと分かった 2件」という
> 見出しにしていた。`delivery-ready.mjs` は下の3つの節を**見出しの前方一致**で
> 探すため、この節が本来の除外リストを**乗っ取って**しまい、`npm test` が
> 「理由の無い未証明がある」で落ちた。**機械が捕まえてくれた。**
> さらに、その経緯をここに書いたとき**見出しの文字列をそのまま本文に書いてしまい、
> 今度はそちらが拾われて同じ罠を2度踏んだ**（`indexOf` は本文と見出しを区別しない）。
> 下の3つの節の名前は、**新しい見出しにも本文にも書かないこと。**

**`verify-delete :: 1. 写真つきのカルテを確定できた` と
`verify-admin :: 7. 直す対象のカルテを1枚確定できた` は、単発の壊しでは
原理的に赤にできない。** `F-20260828-52` の `17.` と同じ型なので、
埋めようとせずここに理由を残す。

どちらも「確定したあとの URL の最後が**36文字のカルテ番号**か」を見ている。
直前に `waitForURL(/\/edit\/p\/[0-9a-f-]+\/[0-9a-f-]+/)` があり、これは
**長さを見ない**ので、「短く切り詰められた番号なら待ちは通り、検査だけが赤になる」
——そう読んで `commit-report-id-truncated`（`saved.id` を8文字に切る）を作った。

**通らなかった。** 実測:

```
npm run verify:delete   （壊し方を手で当てた状態）
  PASS  0. 検査用の犬を登録できた  status=201
  FAIL  検査を最後まで実行できた  page.waitForURL: net::ERR_HTTP_RESPONSE_CODE_FAILURE
```

**サーバが、不正なカルテ番号のページをそもそも返さない。** 番号が壊れていれば
ページ取得の時点で HTTP エラーになり、`waitForURL` がそこで投げる。つまり
**この検査行に到達した時点で、番号が正しいことは既に保証されている**——
待ちとサーバ側の検証の二重で。到達したなら必ず緑になる。

守り自体は正しい（二重にあること自体は良い）。ただし**この2行は、その二重の
守りを1行で言い直しているだけ**で、単独で壊して赤にする方法が無い。
壊し方は取り除いた（残すと「効かない壊し方」が台帳に居座る）。

### 17回目: 動線の3件（2026-08-28・**手元で実測**）

**新しい壊し方は1つも書いていない。** 既にある本物の欠陥の形が、そのまま届いた。

```
  ✅ screen-stale-panels-stay-active  verify-m6.mjs  → ★. 間違えても1タッチで一覧へ戻れる
  ✅ settext-off                      verify-m6.mjs  → ⑤b. 確定した中身に、書いた一言が入っている
  ✅ settext-off                      verify-m6.mjs  → ⑥b. 飼い主はカルテを開ける
```

やったのは、既存2つの `scripts` に `verify-m6.mjs` を足して**実測しただけ**
（`F-20260828-54` の教訓どおり、広げただけで証明済みにはしない）。

**この回の入り方を残しておく。** 直前に「赤にすることが目的ではない」という
指摘を受けて、残りを**数ではなく「この検査は実際に壊れたとき客を守るのか」**で
仕分け直した。すると:

- `★` は「戻れるか」を見ている → **画面の状態が狂う**壊し方が当たるはず
- `⑤b`/`⑥b` は「書いた一言が届くか」を見ている → **文字が出ない**壊し方が当たるはず

どちらも**すでに実在の欠陥として作ってある形**で、新しく発明する必要が無かった。
**検査の側から「何から守っているか」を読むと、当てるべき壊し方は既に手元にある**
ことが多い。逆に、行を赤にするために壊れ方を発明し始めたら（`commit-report-id-truncated`）、
それは目的を見失った合図。

- verify-m6.mjs :: ★. 間違えても1タッチで一覧へ戻れる
- verify-m6.mjs :: ⑤b. 確定した中身に、書いた一言が入っている
- verify-m6.mjs :: ⑥b. 飼い主はカルテを開ける

### 18回目: 一覧に犬が並ばない 2件（2026-08-28・**手元で実測**）

```
node scripts/mutate-run.mjs edit-dog-list-empty

  ✅ edit-dog-list-empty  verify-m6.mjs  赤 2件（＋「検査を最後まで実行できた」）

    ②b. ログインすると作業画面に入れる
    ③. 名前で犬を選べる
```

**`②b` は `F-20260828-55` で `true` の直書きから直した行。** あのとき
「壊し方はまだ作っていない（未証明のまま）」と書き残してあったものを、ここで
実証した。直したあと**本当に測れる行になっている**ことが、これで確かめられた
——直しただけでは、また `true` に戻っていても誰も気づかない。

壊し方は `renderDogs()` の `data.forEach` を `[].forEach` にするだけ。
**画面には入れるがカードが0枚**という、この検査がまさに守っている状態を作る。

- verify-m6.mjs :: ②b. ログインすると作業画面に入れる
- verify-m6.mjs :: ③. 名前で犬を選べる

### 19回目: `verify-xss :: label`（89行目の分岐）1件（2026-08-28・**手元で実測**）

**まず前提の訂正。** このセッションの途中で「`verify-xss` の18件が実測で赤に
なったのに1件も数に入っていない」とマスターに報告したが、**それは誤りだった**。
台帳を読み直したところ、18件は既に**3件として証明済みに入っている**
（`### verify-xss の18件を、3件として台帳に移した`・run #122）。
残っていたのは `label` / `label #2` / `label #3` の3件だけで、これは
**細工が届かなかったときに理由を出す分岐**——性質がまったく違う。
**台帳を読まずに記憶で報告した。** `F-20260828-57` と同じ型を繰り返した。

そのうえで `label`（89行目・犬を登録できなかったとき）を実証した。

```
node scripts/mutate-run.mjs pet-create-wrong-status
  ✅ verify-xss.mjs  赤 8件（8つの細工それぞれで分岐が発火）
```

**名前だけでは、89 / 101 / 112 行のどれが発火したか区別できない**——3か所とも
同じ `label` 変数を名前に使っているため。断定せず、壊し方を手で当てて
`npm run verify:xss` を直接走らせ、**詳細メッセージ**で確かめた:

```
FAIL  犬の名前（見出しへ入る）  犬を登録できず、細工を届けられなかった (200)
FAIL  staffNote（担当からの一言）  犬を登録できず、細工を届けられなかった (200)
```

「**犬を登録できず**」＝ 89行目。101（カルテを作れず）・112（確定に失敗）は、
89 で `continue` するので到達しない。**残る2件は、それぞれ別の壊し方が要る。**

> **名前が変数の検査は、名前だけで紐付けない。** 詳細メッセージまで見るか、
> その壊し方で到達し得る分岐が1つだけであることを示すこと。

- verify-xss.mjs :: label

### 20回目: 記入欄がひとつ消える 1件（2026-08-28・**手元で実測**）

```
node scripts/mutate-run.mjs ear-right-input-missing

  ✅ ear-right-input-missing  verify-report-roundtrip.mjs  赤 2件

    1. 記入先の要素がすべて実在する
    検査を最後まで実行できた   ← 1. が落ちたら throw する設計なので、これは正しい道連れ
```

**この行が守っているもの**: 記入に使う要素が1つでも画面から消えると、トリマーは
その項目を記録できない。しかも**押せないだけで警告は出ない**ので、気づかずに
確定まで進み、飼い主にはその項目が空のまま届く。壊し方は
`<div class="segmented-stepper" data-ear="right">` から掴む名前を外すだけ。

- verify-report-roundtrip.mjs :: 1. 記入先の要素がすべて実在する

### 21回目: カルテ作成が「できた」と返さない 2件（2026-08-28・**手元で実測**）

`pet-create-wrong-status` と同じ型を、カルテ作成の状態コードに当てた（`201`→`200`）。
**実体は作られる**ので土台は壊れず、「作れたかどうかを状態コードで見ている」検査
だけが赤になる。

```
node scripts/mutate-run.mjs report-create-wrong-status

  ✅ verify-empty-pet.mjs  → 0b. 下書きのカルテを用意できた
  ✅ verify-xss.mjs        → 赤 8件（8つの細工それぞれで分岐が発火）
```

xss 側は前回（19回目）と同じく**名前だけでは分岐を特定できない**ので、
壊し方を手で当てて `npm run verify:xss` を直接走らせ、詳細で確かめた:

```
FAIL  犬の名前（見出しへ入る）  カルテを作れず、細工を届けられなかった (200)
```

「**カルテを作れず**」＝ 101行目 ＝ `label #2`。残るのは `label #3`（112行目・
確定に失敗）だけで、これは**確定だけを失敗させる**壊し方が要る。

- verify-empty-pet.mjs :: 0b. 下書きのカルテを用意できた
- verify-xss.mjs :: label #2

### 22回目: 確定の要求がエラーになる 1件（2026-08-28・**手元で実測**）

`verify-xss` の3つ目の分岐（112行目）を実証し、**`label` 3件がすべて揃った**。

```
node scripts/mutate-run.mjs finalize-returns-error
  ✅ verify-xss.mjs  赤 8件（8つの細工それぞれで分岐が発火）

npm run verify:xss （壊し方を手で当てて詳細を確認）
  FAIL  犬の名前（見出しへ入る）  確定に失敗 (500)。細工を飼い主の画面まで届けられなかった
```

「**確定に失敗**」＝ 112行目 ＝ `label #3`。

**この行が守っているもの**は他の検査と性質が違う。**細工が飼い主の画面まで
届かなかったことを報告する行**で、これが無いと「土台の都合で細工が届かなかった」
のに `verify-xss` が緑になる——**検査が実際には走っていないのに『XSS は安全』
という偽の安心を出す**。その意味で、これは客を守っている。

3つの分岐は、それぞれ別の壊し方でしか到達できない（前の段で `continue` するため）:

| 分岐 | 到達させる壊し方 |
|---|---|
| `label`（89行目・犬を登録できず） | `pet-create-wrong-status` |
| `label #2`（101行目・カルテを作れず） | `report-create-wrong-status` |
| `label #3`（112行目・確定に失敗） | `finalize-returns-error` |

- verify-xss.mjs :: label #3

### 写真の実体を見る2件も、単発の壊しでは赤にできない（2026-08-28・**手元で実測**）

`verify-delete :: 2. 写真の実体が Storage に在る` と
`verify-photo-roundtrip :: 5. 保存された写真4枚が実体になっている（asset://）`。
どちらも**確定のあと**に置かれていて、**写真がストレージに届かない壊し方は、
どれも確定そのものを止めてしまう**。実測:

```
buildAssetPath からカルテの階層を落とす（asset-path-loses-report）
  PASS  0. 検査用の犬を登録できた  status=201
  FAIL  検査を最後まで実行できた  page.waitForURL: Timeout 30000ms exceeded.
```

保存先のポリシーが階層を要求しているため、**上げること自体が失敗** →
`saveReport` が投げる → 画面が移らない → `waitForURL` が落ちる。`upload-assets`
（1枚も上げない）も同じで、記録に残っている赤は
`検査を最後まで実行できた` だけ（`docs/ops/mutate-run-result.md`）。

つまり**この2行に到達した時点で、写真が上がったことは既に保証されている**。
`verify-delete 1.` / `verify-admin 7.` と同じ型なので、埋めずに理由を残す。
効かない壊し方（`asset-path-loses-report`）は取り除いた。

> **ここまでで分かった一般則。** 「〜できた」を確認する行が**その動作の成功に
> 依存する待ちの後ろ**にあるとき、その行は単発の壊しでは赤にできない。
> 待ちが先に落ちるから。**守り自体は正しいが、その行は待ちを言い直している。**

### `verify-invitation :: 5.` も単発では赤にできない（2026-08-28・**手元で実測**）

`5. 招待を消化する前は、その犬を見られない`。守っているのは
`is_owner_user(owner_id)` のはず——と読んで `rls-any-owner-sees-any-dog`
（犬の RLS を全開にする）を当てたが、**赤になったのは `7.` だけで `5.` は緑のまま**
だった。

```
node scripts/mutate-run.mjs rls-any-owner-sees-any-dog
  ✅ verify-portal.mjs      → 11. / 13.
  ✅ verify-invitation.mjs  → 7. 使い終わった招待は、別の人が使えない
                              （5. は赤にならない）
```

**犬の RLS を1枚剥がしただけでは、招待未消化の人にその犬は見えない。**
アプリ側にも飼い主の紐付けを見る層があり、`5.` は**その二重の守りの結果**を
見ている——`F-20260828-52` の `17.`（「他人にはこのカルテが見えない」）と
まったく同じ形。2枚同時に剥がす壊し方（`edits`）を作らないかぎり赤にできない。

**いま作らない理由**: `17.` のときは `rls-both-layers-open` を作って解決したが、
あれは**どの層を剥がすかが自明**（犬とカルテ）だった。こちらは**2枚目の層が
どこなのか、読んでも特定できなかった**。**特定せずに当てずっぽうで剥がすのは、
行を赤にするための発明**になるので作らない。

**読んで確かめた範囲（どこに無かったか）**——次の人が同じ所を二度読まないように:

| 見た場所 | 結果 |
|---|---|
| `backend/js/supabase-auth.js` の `loadProtectedResource()` | 飼い主の紐付けで弾く分岐は**無い**。`/api/my/pets/{id}` を取りに行くだけ |
| `worker/src/index.js` の `/api/my/pets/{id}` | `store.getPet(petId)` を呼ぶだけ。**owner での絞り込みは無い** |
| `worker/src/data-stores/supabase-data-store.js` の `getPet()` | `pets` と `reports` を引くだけ。**owners との結合は無い** |
| `worker/src/auth-context.js` | トークンの検証だけ。**飼い主の紐付けは見ていない** |

つまり**アプリ側には見当たらない**。DB 側も見た:

- `pets` の SELECT ポリシー（`pets_customer_select`）を定義しているのは
  `202607160001_supabase_base.sql` **1か所だけ**（`grep` 済み）。後続の
  マイグレーションで再定義されてはいない
- `202607160007_owner_access_control.sql` は `private.is_owner_user` の**中身**を
  差し替えているが、**ポリシーの `using` 句そのものは触っていない**。壊し方は
  `using` 句を置き換えるので、この関数の差し替えとは干渉しない

**したがって「後続のマイグレーションに上書きされていた」説は否定できる。**
壊し方はちゃんと効いている（同じ回に `verify-portal` の `11./13.` が赤になっている）。

残る違いは**利用者の側**にある。`verify-portal` で赤になるのは
**飼い主として紐付いている人**が他人の犬を見る場合で、`verify-invitation :: 5.` が
見ているのは**どの犬にも紐付いていないアカウント**（`FIXTURE.uninvitedEmail`）。
犬の RLS を全開にしてもこの人には見えていない以上、**紐付いていない人を
別扱いしている経路が、まだどこかに在る**。**そこは特定できていない。**

**もう1つ潰した仮説**: 「そもそも guest がログインできていないから緑なのでは」
——これも否定できる。`uninvited@local.test` は `supabase/seed.sql` に
**auth ユーザーとして実在し**、他の fixture 利用者（`owner-a` など）と
**同じ対応表に載っている**。アカウントが無いから見えない、ではない。

> **ここで止める理由**: 当てずっぽうで2枚目を剥がせば赤にはできるが、それは
> **この検査が実際に何を守っているかを分からないまま「証明済み」にする**こと。
> 名前（「招待を消化する前は、その犬を見られない」）が守っていると言っている
> ものと、実際に守っている仕組みが一致しているかを、まだ誰も確かめていない。
>
### 決定打を実行した。**2枚目の層を特定した**（2026-08-28・手元で実測）

上の手順を実際にやった。`pets` の RLS を全開にして `db reset` し、
`uninvited@local.test` のトークンで PostgREST に直接問い合わせた:

```
curl "$API/rest/v1/pets?select=id,name,active&limit=5" -H "Authorization: Bearer <uninvited>"

[{"id":"…a1","name":"X","active":true},
 {"id":"…a2","name":"Y","active":true},
 {"id":"…a3","name":"Z","active":true},
 {"id":"…b1","name":"Q","active":true}]
```

**招待未消化の人が、犬を全部引けている。** つまり**止めているのは DB ではない。**

2枚目は `backend/js/supabase-auth.js` の `bootProtectedPortal()` にあった——
犬を取りに行く**前**の関門:

```js
const session = await (await authorizedFetch(supabase, '/api/session')).json();
if ((session.ownerLinks || []).length === 0 && (session.memberships || []).length === 0) {
  setMessage(status, invitationMessage || '登録されたお客様情報が見つかりません');
  show(loginPanel, false);
  return;                    // ← loadProtectedResource を呼ばずに戻る
}
```

紐付きも所属も無いアカウントは、**ここで止まって犬を取りに行かない**。
だから RLS を全開にしても `5.` は緑のままだった。

> **`verify-invitation :: 5.` の守りは2層**（DB の RLS ＋ この関門）。
> `F-20260828-52` の `17.` と同じで、**2枚同時に剥がさないと判定できない。**

**いま作れない理由（機械の制約）**: `applyMutation` は `m.file` **1つ**しか扱えず、
`edits` も**その1ファイルの中**での複数編集にしか対応していない。今回の2層は
`supabase/migrations/…sql` と `backend/js/supabase-auth.js` の**別ファイル**に
またがるため、**いまの機械では表現できない**。

**次にやること（小さい）**: `applyMutation` の `edits` に**編集ごとの `file`**を
許す（既定は `m.file`）。`test/mutate-run.test.mjs` の構文検査もファイルごとに
回すよう合わせる。そのうえで `invitation-both-layers-open` を作れば `5.` を判定できる。
**層は両方とも名指しで特定済みなので、これは当てずっぽうではない。**

**⚠️ 後片付けをした（この手順を踏むときの注意）**: この観測は
`supabase db reset` を伴うので、**終わったあとローカル DB は壊れたスキーマのまま
残る。** マイグレーションのファイルを戻しただけでは DB は戻らない——
**もう一度 `db reset` するまで、以降の実測はすべて壊れた土台の上で走る。**
戻したことは同じ観測で確かめた:

```
（戻したあと）uninvited  → []                    ← 引けない
（比較）      owner-a    → X / Y / Z のみ         ← 自分の犬だけ。他人の Q は出ない
```

ついでに分かったこと: **RLS は正しく効いている**。`owner-a` は自分の3頭だけが
見えて `Q` は見えない——`verify-portal :: 11./13.` が守っているものを、
画面を通さず DB の側から直接確かめた形になる。

**続きは下の「23回目」で実際に赤にした。** 上の「いま作れない理由（機械の制約）」は
2026-08-29 に解消してある（`applyMutation` が**ファイルをまたぐ `edits`** を扱えるようにした）。

### 23回目: 招待未消化の人に、他人の犬が見える 1件（2026-08-29・**手元で実測**）

**上で名指しした2層を、同時に剥がした。** `invitation-both-layers-open`:

| 剥がした層 | どこ |
|---|---|
| (1) DB | `pets` の SELECT ポリシーから `is_owner_user(owner_id)` を外す |
| (2) アプリ | `bootProtectedPortal()` の「紐付きも所属も無ければ犬を取りに行かない」関門を外す |

**当てずっぽうではない。** どちらの層も、上の2節で**実測して名指しした**もの
（PostgREST への直接問い合わせで「DB は開いている／止めているのはアプリ側」まで
確定させてある）。層を発明したのではなく、**特定済みの層をそのまま剥がした**。

```
node scripts/mutate-run.mjs invitation-both-layers-open
  ✅ invitation-both-layers-open verify-invitation.mjs          赤   2件

    5. 招待を消化する前は、その犬を見られない   ← invitation-both-layers-open / verify-invitation.mjs
    7. 使い終わった招待は、別の人が使えない   ← invitation-both-layers-open / verify-invitation.mjs
```

**同じ壊し方をもう一度当てて、検査の生の出力も見た**（`偽-11`「一度の緑で終える」を
踏まないため。2回とも同じ結果）:

```
（壊す前・素の状態）node scripts/verify-invitation.mjs
  PASS  5. 招待を消化する前は、その犬を見られない
  8/8 PASS

（2層を剥がして）  node scripts/verify-invitation.mjs
  FAIL  5. 招待を消化する前は、その犬を見られない  ★ 見えている
  FAIL  7. 使い終わった招待は、別の人が使えない  ★ 別の人にも見えた
  6/8 PASS
```

**人間に何が起きるか**: 招待の紙をまだ渡していない相手が、`/my/pets/<犬のid>` を
開くだけで**他人の犬のページを読める**。`5.` はそこを見ていた——**名前のとおりの
ことを、実際に守っていた**。

**`7.` は既に `rls-any-owner-sees-any-dog` で証明済み。** ここで一緒に赤になったのは、
(1) だけでも `7.` は落ちるため（`docs/ops/mutate-run-result.md`）。新しく埋まるのは
`5.` の1件。

- verify-invitation.mjs :: 5. 招待を消化する前は、その犬を見られない

### 24回目: クライアント指示 C-1/C-4/C-9 の新項目4件（2026-08-29・**手元で実測**）

`docs/ops/plan.md` 第10章のクライアント指示（C-1 BCS・C-4 ベスト体重・C-9 コース
必須）で `verify-report-roundtrip.mjs` に足した新規 `check()` 7件のうち、
⑤⑥表示3組（コース・ベスト体重・BCS）＋必須検証1件の壊し方。

**壊し方**: `mutate-run.mjs` の壊しをそれぞれ手で当て、`node scripts/build-dist.mjs`
で dist に反映してから `node scripts/verify-report-roundtrip.mjs` を直接走らせた
（`mutate-run.mjs` 自体の実行でも同じ2件ずつが赤になることを確認済み）。

```
node scripts/mutate-run.mjs course-badge-blank
  ✅ course-badge-blank  verify-report-roundtrip.mjs  赤 2件
    3b. 確認: 来店コース
    9b. 飼い主: 来店コース

（壊し方を手で当てて詳細を確認）
FAIL  3b. 確認: 来店コース
        期待: "トリミングコース"
        実際: ""
FAIL  9b. 飼い主: 来店コース
        期待: "トリミングコース"
        実際: ""
===== 往復: 28/30 =====
```

```
node scripts/mutate-run.mjs best-weight-blank
  ✅ best-weight-blank  verify-report-roundtrip.mjs  赤 2件
    3c. 確認: ベスト体重
    9c. 飼い主: ベスト体重

（壊し方を手で当てて詳細を確認）
FAIL  3c. 確認: ベスト体重
        期待: "目標体重 3.2kg"
        実際: ""
FAIL  9c. 飼い主: ベスト体重
        期待: "目標体重 3.2kg"
        実際: ""
===== 往復: 28/30 =====
```

```
node scripts/mutate-run.mjs bcs-text-blank
  ✅ bcs-text-blank  verify-report-roundtrip.mjs  赤 2件
    3d. 確認: BCS
    9d. 飼い主: BCS

（壊し方を手で当てて詳細を確認）
FAIL  3d. 確認: BCS
        期待: "ok"
        実際: ""
FAIL  9d. 飼い主: BCS
        期待: "ok"
        実際: ""
===== 往復: 28/30 =====
```

```
node scripts/mutate-run.mjs course-required-off
  ✅ course-required-off  verify-report-roundtrip.mjs  赤 1件
    21. コースを選ばずに確定を押すと、案内が出て画面が進まない

（壊し方を手で当てて詳細を確認）
FAIL  21. コースを選ばずに確定を押すと、案内が出て画面が進まない
        期待: "ok"
        実際: "dialogs=0 url変化=true"
===== 往復: 29/30 =====
```

**この4行が守っているもの**: コース・ベスト体重・BCS は⑤トリマー確認と⑥飼い主
画面の**両方**に表示される約束（`D-12`）。表示側を空にする壊し方で、それぞれの
組が両方とも同時に赤になることを確かめた。`course-required-off` はコース未選択
のまま確定できてしまう壊し方で、案内（`alert`）が出ず画面が進んでしまうことを
確かめた——どのコースの記録か分からないカルテが残る不具合を防ぐ検証。

4つとも壊した後 `node scripts/build-dist.mjs` で元の製品コードに戻し、
`git diff --stat` で差分ゼロを確認済み。

- verify-report-roundtrip.mjs :: 3b. 確認: 来店コース
- verify-report-roundtrip.mjs :: 9b. 飼い主: 来店コース
- verify-report-roundtrip.mjs :: 3c. 確認: ベスト体重
- verify-report-roundtrip.mjs :: 9c. 飼い主: ベスト体重
- verify-report-roundtrip.mjs :: 3d. 確認: BCS
- verify-report-roundtrip.mjs :: 9d. 飼い主: BCS
- verify-report-roundtrip.mjs :: 21. コースを選ばずに確定を押すと、案内が出て画面が進まない

### 25回目: 飼い主に届く日付が確定日に戻る 1件（2026-08-29・**手元で実測**）

マスター指示のサブ3体による敵対検証（検証2）が発見した穴。C-3（体重の時系列を
来店日基準にする）で来店日入力欄を新設したが、`backend/js/magazine-view.js` の
表示側は元々「確定を押した日（`report.reportDate`）」を先に見る並びのままだった
ため、⑥飼い主の画面（`backend/js/supabase-auth.js :: renderReport()` が
`report.report_date` を渡す経路）では**来店日ではなく確定日が出続ける**穴が
残っていた。⑤トリマー確認（確定直後の in-memory 描画）はこの列を経由しないため
気づかれなかった。

修正: `data.isoDate || data.date || report.reportDate` の順に直し（来店日を優先し、
古い報告のための確定日フォールバックだけ残す）、`verify-report-roundtrip.mjs` に
`3e.`/`9e.` を追加。

```
node scripts/mutate-run.mjs report-date-confirm-wins
  ✅ report-date-confirm-wins  verify-report-roundtrip.mjs  赤 1件
    検査を最後まで実行できた   ← この回はサブ3体の敵対検証が同じ Supabase を
                              同時に叩いていたため確定クリックが timeout し、
                              9e. に届く前に落ちた（環境の混雑・下記で再現確認）

（壊し方を手で当てて詳細を確認。空いている状態で2回実行し、2回とも同じ赤）
FAIL  9e. 飼い主: 来店日（確定日ではなく）
        期待: "2026.07.20"
        実際: "2026.08.29"
===== 往復: 31/32 =====
```

**`3e.`（⑤トリマー確認）は壊しても赤にならない。** ⑤は確定直後、`src/js/ui.js` が
`reportDate: report.isoDate || report.date || ''` という別の（すでに来店日優先の）
オブジェクトを組み立てて `renderMagazine()` に渡す経路（`report.report_date` という
DB列そのものを持たない）ため、`magazine-view.js` 側の並びを壊しても影響しない。
**これは検査の欠陥ではなく、⑤と⑥が別経路であることの反映**——⑥だけが実際に
DB の `report_date` 列と衝突する。

- verify-report-roundtrip.mjs :: 9e. 飼い主: 来店日（確定日ではなく）

### 26回目: 「次回のおすすめご来店時期」新設 11件（2026-08-29・**手元で実測**）

マスター指示（`D-20260829-58`）: 「デフォルトは30日後、別途修正できるようにする。
修正はデフォルト自体の修正も犬ごとの修正も可能とする。」で新設した
`scripts/verify-revisit-interval.mjs`（12 `check()`）のうち、11件を1件ずつ壊して赤にした。
残り1件（`9.`）は下の「未証明」へ。

**壊し方**: `mutate-run.mjs` に8つの壊し方を足し、`node scripts/mutate-run.mjs <id>`
（本物の Supabase を通す）で実測。RLS の壊し（`shops-admin-update-rls-open`）だけは
migration ファイルの書き換えなので `npx supabase db reset` を挟んでから検査、
確認後に元へ戻して再度 `db reset`（`git diff --stat` で差分ゼロを確認済み）。

```
node scripts/mutate-run.mjs shops-admin-update-rls-open
  ✅ shops-admin-update-rls-open  verify-revisit-interval.mjs  赤 1件
    0. 一般スタッフは店舗の既定日数を変えられない

（壊し方を手で当てて詳細を確認。RLS の using/with check を true に緩めた）
FAIL  0. 一般スタッフは店舗の既定日数を変えられない
        期待: "404"
        実際: "200"
===== 次回のおすすめご来店時期: 10/11 =====
```

```
node scripts/mutate-run.mjs shop-patch-route-off
  ✅ shop-patch-route-off  verify-revisit-interval.mjs  赤 3件
    1. 管理者は店舗の既定日数を変えられる
    1b. 変えた値が読み返せる
    3. 確認: 次回日（上書き無し・店舗の既定日数）

（壊し方を手で当てて詳細を確認。PATCH /api/shop の分岐を丸ごと無効化）
FAIL  1. 管理者は店舗の既定日数を変えられる
        期待: "200"
        実際: "404"
FAIL  1b. 変えた値が読み返せる
        期待: "45"
        実際: "null"
===== 次回のおすすめご来店時期: 9/11 =====
```

（`3.` は、店舗の既定日数がまだ30（migration の既定値）のままの、まっさらな
`supabase db reset` 直後に走らせたときだけ赤になる——PATCH が死んで45に変わらない
ため、来店日+30日で計算された値と期待値+45日がずれる。手で当て直した2回目は、
直前の別の検査が既定日数を45に変えたあとの状態が残っていたため`3.`はPASSのまま
だったが、これは検査対象の状態依存であって壊し方の効き目とは無関係——
`mutate-run.mjs` 本体の実行が、まっさらな状態での赤を実測している。）

```
node scripts/mutate-run.mjs revisit-edit-stays-hidden
  ✅ revisit-edit-stays-hidden  verify-revisit-interval.mjs  赤 2件
    4. 確認: 編集欄がスタッフ側に出ている
    検査を最後まで実行できた

（壊し方を手で当てて詳細を確認。編集欄の unhide だけを外す）
FAIL  4. 確認: 編集欄がスタッフ側に出ている
        期待: "ok"
        実際: "出ていない"
FAIL  検査を最後まで実行できた
        期待: "ok"
        実際: "page.fill: Timeout 30000ms exceeded.
        - element is not visible"
===== 次回のおすすめご来店時期: 5/7 =====
```

```
node scripts/mutate-run.mjs revisit-save-stale-display
  ✅ revisit-save-stale-display  verify-revisit-interval.mjs  赤 1件
    5. 確認: 保存直後にその場で日付が変わる

（壊し方を手で当てて詳細を確認。保存直後の再描画を古い値に戻す）
FAIL  5. 確認: 保存直後にその場で日付が変わる
        期待: "2026.07.30"
        実際: "2026.09.03"
===== 次回のおすすめご来店時期: 10/11 =====
```

```
node scripts/mutate-run.mjs revisit-override-not-persisted
  ✅ revisit-override-not-persisted  verify-revisit-interval.mjs  赤 2件
    6. 確認: 読み直しても上書きが残っている
    7. 飼い主: 上書き後の次回日が同じ値で届く

（壊し方を手で当てて詳細を確認。PATCH本文の値を常に null に固定＝保存は200で
成功するがサーバには残らない）
FAIL  6. 確認: 読み直しても上書きが残っている
        期待: "2026.07.30"
        実際: "2026.09.03"
FAIL  7. 飼い主: 上書き後の次回日が同じ値で届く
        期待: "2026.07.30"
        実際: "2026.09.03"
===== 次回のおすすめご来店時期: 9/11 =====
```

```
node scripts/mutate-run.mjs revisit-owner-override-dropped
  ✅ revisit-owner-override-dropped  verify-revisit-interval.mjs  赤 1件
    7. 飼い主: 上書き後の次回日が同じ値で届く

（壊し方を手で当てて詳細を確認。⑥飼い主向けの応答だけ revisitDaysOverride を
常に null にする——⑤は別経路なので無事）
FAIL  7. 飼い主: 上書き後の次回日が同じ値で届く
        期待: "2026.07.30"
        実際: "2026.09.03"
===== 次回のおすすめご来店時期: 10/11 =====
```

```
node scripts/mutate-run.mjs revisit-edit-leaks-to-owner
  ✅ revisit-edit-leaks-to-owner  verify-revisit-interval.mjs  赤 1件
    8. 飼い主画面に編集欄が出ない（編集はスタッフ限定）

（壊し方を手で当てて詳細を確認。編集欄の表示条件から onRevisitDaysChange の
有無チェックを外す）
FAIL  8. 飼い主画面に編集欄が出ない（編集はスタッフ限定）
        期待: "ok"
        実際: "出た"
===== 次回のおすすめご来店時期: 10/11 =====
```

```
node scripts/mutate-run.mjs pet-create-wrong-status
  ✅ pet-create-wrong-status  verify-revisit-interval.mjs  赤 1件
    2. 検査用の犬を登録できた
  （同時に verify-delete.mjs / verify-invitation.mjs / verify-xss.mjs も赤——既存の壊し方）

（壊し方を手で当てて詳細を確認。POST /api/owners/{id}/pets の成功コードを201→200に）
FAIL  2. 検査用の犬を登録できた
        期待: "201"
        実際: "200"
===== 次回のおすすめご来店時期: 10/11 =====
```

8つとも壊した後 `node scripts/build-dist.mjs` で元の製品コードに戻し（SQLの壊しは
`npx supabase db reset` も再実行）、`git diff --stat` で差分ゼロを確認済み。

**この11行が守っているもの**: 店舗の既定来店間隔は管理者しか変えられない（RLS）・
変えれば実際に反映される・上書きが無い犬には既定日数が使われる・この犬だけの
上書き入力欄は⑤（スタッフ）にだけ出る・保存すればその場でもサーバでも新しい値が
使われる・⑥（飼い主）にも同じ計算結果が届くが編集欄は出ない——という
`D-20260829-58` の全条件。

- verify-revisit-interval.mjs :: 0. 一般スタッフは店舗の既定日数を変えられない
- verify-revisit-interval.mjs :: 1. 管理者は店舗の既定日数を変えられる
- verify-revisit-interval.mjs :: 1b. 変えた値が読み返せる
- verify-revisit-interval.mjs :: 2. 検査用の犬を登録できた
- verify-revisit-interval.mjs :: 3. 確認: 次回日（上書き無し・店舗の既定日数）
- verify-revisit-interval.mjs :: 4. 確認: 編集欄がスタッフ側に出ている
- verify-revisit-interval.mjs :: 5. 確認: 保存直後にその場で日付が変わる
- verify-revisit-interval.mjs :: 6. 確認: 読み直しても上書きが残っている
- verify-revisit-interval.mjs :: 7. 飼い主: 上書き後の次回日が同じ値で届く
- verify-revisit-interval.mjs :: 8. 飼い主画面に編集欄が出ない（編集はスタッフ限定）
- verify-revisit-interval.mjs :: 検査を最後まで実行できた

### 使用オプションの復活（2026-08-31・マスター指示）で足した2件

- verify-report-roundtrip.mjs :: 8b. 確認: 使用オプション
- verify-report-roundtrip.mjs :: 16b. 飼い主: 使用オプション

壊し方: `backend/js/magazine-view.js` の `renderOptionTags(container, data.options);`
（`renderMagazine()` 内、⑤⑥共有の「カット」カードを描く箇所）を1行コメントアウトする
——選んだオプションをタグとして描く呼び出しそのものを止める。

出力（`npm run verify:roundtrip`。他34項目は無傷のまま、狙った2件だけが赤になった）:
```
FAIL  8b. 確認: 使用オプション
        期待: "アメージング"
        実際: ""
...
FAIL  16b. 飼い主: 使用オプション
        期待: "アメージング"
        実際: ""

===== 往復: 32/34 =====
```
戻して緑（34/34）に戻ることも確認済み。

## F4 を閉じる範囲（マスター判断・2026-08-28）

台帳を129件すべて埋めるのではなく、**客に当たる経路まで**で F4 を閉じる。
機械（`scripts/guard/delivery-ready.mjs`・`gate.mjs --end` から呼ぶ）が見るのは
下の3節。**節を離れて「だいたい埋まった」で判断させない**ため、範囲はファイル名で固定する。

### 客に当たる経路（ここが埋まったら F4 を閉じてよい）

以下の11本の**全件**が「証明済み」であること。1本でも減らせば `delivery-ready` が
「宣言した本数が減っている」で赤になる。

```
verify-admin.mjs / verify-edit.mjs / verify-portal.mjs / verify-m6.mjs /
verify-empty-pet.mjs / verify-invitation.mjs / verify-report-roundtrip.mjs /
verify-photo-roundtrip.mjs / verify-delete.mjs / verify-draft.mjs / verify-xss.mjs
```

### 判定できない（理由つきで除外・8件）

- **`verify-production.mjs` 4件** … 本番サイトへ出ていく検査で、**壊す対象がこの
  リポジトリに無い**。`mutate-run.mjs` の仕組みでは判定できない
- **`verify-stack.mjs` の残り4件** … 土台を落とす毒が要るが、それだと
  `ensureLocalSupabaseRunning()` の `throw` で止まり**判定行が出ない**
  （「⛔ 毒見の天井」と同じ構造）

### F4 の後に回す（21件）

- **`verify-screens.mjs`** … 正当な理由は無い。**単に高い**（21件が個別の静的構造で、
  1件あたりの壊しが重い）。「判定できない」ではなく「まだやっていない」として残す

## ⛔ 毒見の天井（2026-08-28 に判明）

**毒を3種類まで作って、埋まったのは 182件中 21件。ここで止まる。**

| 毒 | 赤 | そのうち新規 |
|---|---|---|
| `empty`（データが空） | 25 | **17** |
| `noauth`（ログイン不可） | 16 | **2** |
| `nodist`（配信物も空） | 26 | **2** |

理由は構造的なもので、毒の種類を増やしても解けない:

> **検査 N を判定するには、検査 1〜N-1 が通っていなければならない。**

`verify:*` は上から順に走る。毒で最初の1件が落ちると**そこで終わり**、
2件目以降は**実行すらされない**。`empty` の1回目で139件が判定行すら出なかったのも、
`nodist` が狙った15件のうち各1件しか判定できなかったのも、**同じ理由**である。

つまり毒見で埋まるのは「**各ファイルの、最初に落ちる1件の周辺**」だけ。
**「まとめて壊せば一気に埋まる」は成立しなかった。**

### 毒見が価値を出した場所

**証明の道具としてではなく、欠陥の発見器として。** 本物を2件掘り出した:

- `F-20260828-50` … 「マイグレーションが当たっている」が `HTTP 200 / 0件` で緑
- 同 … `check('Supabase が起きている', true)` の恒真の直書き

**残り161件をどう埋めるかは、マスター判断に回す**（`docs/handoff.md`）。

## 1項ごとに埋められない理由（機械が読む）

> **マスター判断 A（2026-08-28）。** 除外はそれまで**ファイル単位**でしか書けず、
> 「この項だけは埋められない」を機械に伝える場所が無かった。理由を台帳に書いても
> `delivery-ready.mjs` は数え続け、**F4 が構造上閉じられなかった**。ここがその置き場所。
>
> **書き方**: `- <ファイル> :: <検査の名前>` の次の行に、字下げして `理由:`。
> 名前は `node scripts/guard/proof-of-red.mjs` が出すものと**1字でも違ってはいけない**
> （違えば「実体に無い検査を指している」で赤になる）。
>
> **黙らせる道具ではない。** 機械が3つ見ている——理由が20字未満なら認めない／
> 実体に無い検査を指していれば赤／すでに証明済みの項に理由が付いていれば矛盾として赤。
> そして**何件をどの理由で外したかは、通ったときの出力に必ず出る**。
>
> **ここに足すのは「埋めるべきでないもの」だけ。** 埋められるのに面倒だから、は該当しない。
> 判断に迷ったら、まず壊し方を書いて実測すること。

- verify-carry-over.mjs :: 土台: 確定カルテが5枚ある犬を作った
  理由: 5枚を積む土台そのもの。ここを壊すと以降の全項が巻き添えで落ちるので、この行だけを狙って赤にする壊し方が無い（`verify-portal :: 1.` と同じ型）。
- verify-carry-over.mjs :: ② 一覧に犬が出ている
  理由: 同上。一覧に出ないと④へ入れず、検査は最初の一歩で死ぬ。赤になるのは「到達できなかった」ことであって、この行が守っているものではない。
- verify-carry-over.mjs :: ④ カルテ作成画面まで、押すだけで着いた
  理由: 同上。ここへ着けない壊し方は、引き継ぎ以前に②→④の動線を壊すもので、`verify-m6` が既に別の角度で見ている。
- verify-carry-over.mjs :: 確定できた（⑤へ進んだ）
  理由: 確定の経路そのものは `verify-report-roundtrip` と `verify-admin` が受け持っている。この検査では「6枚目を書き終えられる」ことの土台として置いており、単独で赤にする壊し方はそれらの担当。
- verify-carry-over.mjs :: 確定カルテが6枚になった
  理由: 同上。確定が保存されない壊し方は `verify:roundtrip` が先に赤になる。
- verify-carry-over.mjs :: ⑦使用オプションが選べる（帯が出ている）
  理由: オプションの帯そのものは `verify-options-human.mjs` が担当。ここでは「引き継ぎのあとでもオプションが選べる」ことの前提として置いている。
- verify-carry-over.mjs :: コースが空
  理由: **壊し方A（前回を丸ごとコピー）を当てても緑のままだった**（実測）。コースは `<select>` で、`applyReport()` が入れようとした前回の値が選択肢に無ければ空のままになる。つまり症状そのものが起きない。値が選択肢に在る形の壊し方をまだ書いていない。
- verify-carry-over.mjs :: 写真が1枚も入っていない
  理由: 壊し方Aでも緑のままだった（実測）。この検査の5枚目には写真を積んでいないので、丸ごとコピーしても入るものが無い。**5枚目に写真を積む形に作り直すのが正しい**——`docs/ops/plan.md` 第12章へ。
- verify-carry-over.mjs :: BCS が選ばれている
  理由: 画面の既定でボタンが1つ `is-active` のため、引き継ぎを壊しても件数は1のまま緑になる（壊し方Cで実測）。**この行は現状ほとんど何も守っていない。** 値まで見る形に作り直す必要がある——`docs/ops/plan.md` 第12章へ。
- verify-carry-over.mjs :: 触っていないので下書きは生えていない
  理由: 「引き継いだだけでは保存しない」を見る行。保存してしまう壊し方（引き継ぎ直後に `saveDraft()` を呼ぶ）はまだ書いていない。壊し方A〜Cはどれも保存の有無を変えないので、この行は3回とも緑のままだった。
- verify-carry-over.mjs :: 隠したら本当に消えている（hidden が CSS に負けていない）
  理由: この行は**実際にこの不具合を捕まえた**あとに足したもので、捕まえた時点ではまだ存在しなかった（当時の赤は「白紙にすると、引き継ぎの帯が消える」に出ている・27回目に記録）。CSS を戻す壊し方を台帳に足していない。
- verify-carry-over.mjs :: 6枚目のメッセージは今回書いたもの（前回の使い回しではない）
  理由: 壊し方Aでは、④の画面で前回の文が入ったまま**今回の文を上書きして**確定するため、6枚目の中身は今回の文になり緑のままだった（実測）。対になる「7枚目のメッセージは空」は同じ壊し方で赤になっており、そちらで同じ穴を証明済み。
- verify-carry-over.mjs :: 6枚目に前回の写真が混ざっていない
  理由: 上と同じく、5枚目に写真を積んでいないため症状が起きない。写真を積む形に作り直したときに、まとめて証明する——`docs/ops/plan.md` 第12章へ。

- verify-admin.mjs :: 7. 直す対象のカルテを1枚確定できた
  理由: 直前の `waitForURL` と、不正なカルテ番号のページを返さないサーバ側の検証が、同じことを既に保証している。この行に到達した時点で番号は正しい——つまり単発の壊しでは赤にできない（実測: `commit-report-id-truncated` は `net::ERR_HTTP_RESPONSE_CODE_FAILURE` で待ちが先に落ちた）。守り自体は正しく、この行はそれを言い直している。
- verify-delete.mjs :: 1. 写真つきのカルテを確定できた
  理由: `verify-admin :: 7.` と同じ型。直前の `waitForURL` とサーバ側の検証が同じことを保証しており、到達した時点で番号は正しい。単発の壊しでは赤にできない。
- verify-delete.mjs :: 2. 写真の実体が Storage に在る（service_role で数える）
  理由: 写真がストレージに届かない壊し方は、どれも確定そのものを止めてしまう（実測: `asset-path-loses-report` は保存先のポリシーに弾かれて `waitForURL` が落ちた。`upload-assets` も同様）。この行に到達した時点で、写真が上がったことは既に保証されている。
- verify-draft.mjs :: 4. 下書きの中身が漏れていない
  理由: いまの飼い主ページは一覧しか描かず、カルテの本文を出さない。RLS を開けて下書きが漏れても（`rls-drafts-leak`）、本文の文字列は画面に現れないので、この行は赤にならない。将来ここに本文を出す造りにしたときのための見張りで、いまの画面では症状を起こせない。
- verify-empty-pet.mjs :: 7. 下書きの中身が漏れていない
  理由: `verify-draft :: 4.` と同じ。いまの飼い主ページはカルテの本文を描かないので、下書きが漏れても本文の文字列は画面に出ず、この行は赤にならない。
- verify-m6.mjs :: ⑤. 確定すると確認の画面に着く
  理由: `verify-admin :: 7.` と同じ型。確定後の URL の最後が36文字のカルテ番号かを見ているが、番号が壊れていればページ取得の時点で落ちるので、到達した時点で保証されている。
- verify-photo-roundtrip.mjs :: `${kind === 'trimming' ? '1' : kind === 'ear' ? '2' : '3'}. ${kind} の写真を付けられた`
  理由: 検査の名前が実行時に決まる（`${kind}` を含むテンプレート文字列）ため、実行時に出る赤の名前と台帳の鍵が文字として一致せず、紐付けられない。**検査そのものは正しい**——同型の `verify-xss` の18件は、名前を3件にまとめ直すことで証明済みに入っている（`### verify-xss の18件を、3件として台帳に移した`）。ここも同じ手当てが要る。
- verify-photo-roundtrip.mjs :: 4. 写真つきで確定できた
  理由: `verify-admin :: 7.` と同じ型。直前の待ちとサーバ側の検証が同じことを保証しており、到達した時点で確定は済んでいる。
- verify-photo-roundtrip.mjs :: 5. 保存された写真5枚が実体になっている（asset://）
  理由: `verify-delete :: 2.` と同じ。写真がストレージに届かない壊し方は確定そのものを止めるので、この行に到達した時点で写真が上がったことは保証されている。
- verify-portal.mjs :: 1. /my が配信される
  理由: `/my` の配信を壊すと、この検査は最初の一歩で死ぬ（`⛔ 毒見の天井` と同じ構造）。赤になるのは「検査を最後まで実行できた」だけで、狙ったこの行は何も証明できない。
- verify-portal.mjs :: 3. Supabase vendor が読めている
  理由: vendor の読み込みを壊すとポータルが起動せず、以降の項が全部巻き添えで落ちる。この行だけを狙って赤にする壊し方が無い。
- verify-report-roundtrip.mjs :: 20. 飼い主の画面に、量っていない体重が出ない
  理由: 入力欄に既定値を入れても（`weight-prefilled-sample`）、その値は飼い主まで届かない——つまり**症状そのものが起きない**ので、緑が正しい判定である。検査の欠陥ではない。
- verify-report-roundtrip.mjs :: 3e. 確認: 来店日（確定日ではなく）
  理由: ⑤トリマー確認は確定直後、`src/js/ui.js` が `reportDate: report.isoDate || report.date || ''`（`report.report_date` という DB 列を持たない、既に来店日優先の別オブジェクト）を組み立てて描く経路なので、`backend/js/magazine-view.js` の並びをどう壊しても影響しない。実測（`report-date-confirm-wins`）でも `3e.` は2回ともPASSのまま、`9e.` だけが赤になった（`### 25回目`）。単発の壊しでは赤にできないが、対の `9e.`（⑥飼い主・実際にDB列と衝突する経路）で同じ穴を証明済み。
- verify-revisit-interval.mjs :: 9. アプリ由来の確認ダイアログが余計に出ていない
  理由: 「想定外の alert/confirm/prompt が出ていないか」だけを見る安全網で、対応する「出すべき場面」が無い（`21.` のようなコース必須の alert とは違い、この項は「出ない」ことしか守っていない）。この検査の他の項目（0〜8）を壊す壊し方はどれも値のずれ・欄の表示/非表示で赤になり、余計なダイアログを1つだけ出すピンポイントな壊し方をまだ書いていない。

### 27回目: 「6枚目を前回の続きから始める」新設 40件のうち 20件（2026-09-03・**手元で実測**）

マスター指示（`D-20260903-64`）で新設した `scripts/verify-carry-over.mjs`（40 `check()`）を、
**実 Supabase・実ブラウザ・人と同じクリック**で回しながら、3つの壊し方を当てた。
`mutate-run.mjs` の台帳には載せていない——この検査だけを狙う壊し方なので、
`src/js/ui.js` を直接書き換えて当て、確認後に `diff -q` で元に戻したことを確かめている。

**壊し方A: 前回のカルテを丸ごとコピーする**（空にすべき項目を落とさない）

```
carryOverReport(): const carried = {} → const carried = { ...source }

FAIL  来店日が空  value="2026-08-01"
FAIL  トリマーからのメッセージが空  value="前回のメッセージ。これは6枚目に出てはい"
FAIL  体重が空  value="4.4"
FAIL  ⑦使用オプションが1つも選ばれていない  active=1
FAIL  7枚目のメッセージは空（6枚目の文が残っていない）  value="6枚目のメッセージ。今回書いたもの。"
35/40 PASS
```

**壊し方B: 確定に `__marks` を載せない**（次の回で犬体図の印を引き継げなくなる）

```
commitReport(): { ...extractReport(), __marks: this.marks } → { ...extractReport() }

FAIL  6枚目に __marks が載っている（次の回で印を引き継げる）  marks=0
FAIL  7枚目に、6枚目で足した印まで引き継がれている  marks=0
38/40 PASS
```

**壊し方C: 前回のカルテを取りに行かない**（引き継ぎそのものが起きなくなる）

```
resumeDraft(): staff.findLastFinalReport(petId).then(…) → Promise.resolve(null).then(…)

FAIL  引き継ぎが実際に走った（帯に字が入った）
FAIL  引き継ぎの帯が出ている
FAIL  帯が「爪」を名指ししている        （耳・歯・BCS・ベスト体重・犬体図の印 も同じく赤・計6件）
FAIL  爪（前足）が5枚目と同じ  front=
FAIL  爪（後ろ足）が5枚目と同じ  rear=
FAIL  耳（右）が5枚目と同じ  right=1
FAIL  耳（左）が5枚目と同じ  left=1
FAIL  歯の状態が5枚目と同じ  teeth=ピカピカ✨
FAIL  ベスト体重が5枚目と同じ  value=""
FAIL  犬体図に前回の印が描かれている  {"ok":false,"colored":0}
FAIL  白紙にすると、引き継いだ選択が全部外れる  nail=0 teeth=1
FAIL  引き継いだ印に、今回の印を足せる  marks=1
FAIL  6枚目に爪が引き継がれている  front=undefined
FAIL  6枚目に __marks が載っている（次の回で印を引き継げる）  marks=1
FAIL  7枚目も「前回の続き」から始まる
FAIL  7枚目に、6枚目で足した印まで引き継がれている  marks=0
19/40 PASS
```

**この壊し方を1回目に当てたときは 14件で止まっていた。** 帯が出ていないので
「引き継ぎをやめて白紙にする」を押せず、そこで検査が例外で死に、**以降の項が
赤とも緑とも言われないまま消えていた**。検査の側を直して（押せないときは飛ばす／
確定に失敗しても続ける）、最後まで報告できるようにしてから測り直した数字が上の 19/40。
**途中で死ぬ検査は、壊したときに何を守れていないのかを言えない。**

**作っている途中で、実ブラウザだけが見つけた不具合が1件ある。**
帯の CSS（`.carry-over { display: flex }`）がブラウザ既定の
`[hidden] { display: none }` を上書きしており、引き継ぎが起きていない初回の犬にも
空の帯が出ていた。`.carry-over[hidden] { display: none; }` を足して直した。
単体テストでは出ない型（`D-14`「絵で判定する」の理由そのもの）。

`歯の状態` が最初の実測で赤だったのは、検査側が実在しないラベル（`軽度の歯石`）を
見本に使っていたためで、`applyReport()` が「名前が一致するボタンしか押さない」
（`D-10`）とおりに振る舞った結果。見本を実在するラベル（`歯石が厚い😥`）に直した。

**この赤が、実際に1件の不具合を捕まえた**——`[hidden]` を CSS で潰していた件は
これで見つかり、`.carry-over[hidden] { display: none; }` を足して直した。
`歯の状態` は、検査側が実在しないラベル（`軽度の歯石`）を見本に使っていたための赤で、
`applyReport()` が「名前が一致するボタンしか押さない」（`D-10`）とおりに振る舞った結果。
見本を実在するラベル（`歯石が厚い😥`）に直した。

**マウスで印を足す**ところも、待ちと操作が足りずに赤を通っている:

```
FAIL  引き継いだ印に、今回の印を足せる  marks=1
```

犬体図の既定の置き方は「なぞる」で、**なぞらずに触れただけの点1つは捨てる**仕様
（見えない印を残さない）。クリック1回では増えない。押して・動かして・離す形に直し、
さらに `scrollIntoViewIfNeeded()` を入れて（表示域の外を押していた）緑になった。

**まだ見ていない20件**は下の「未証明」に名前で残す。

### 28回目: 管理者の入口3件（2026-09-03・**手元で実測**）

`0-AK`（2026-09-02）で仕様を「入口は1つ、管理者にだけ『管理』が出る」に作り替えたとき、
`verify-admin.mjs` の `1.` `1b.` `1c.` を新設したが、**赤になるところを見ないまま**
未証明に置いていた。`delivery-ready.mjs` / `gate.mjs --end` が閉じられない唯一の原因が
これだったので、3件とも壊して赤を見た。

壊し方を2つ足した（`admin-lands-elsewhere` / `admin-link-wrong-destination`）。
`admin-link-hidden` は既にあったもの。**1件ごとに、狙った行だけが赤になる**ように
分けてある——入口を消すと押した先まで届かないので、`1c.` は「押せるが行き先が違う」
別の壊し方でないと測れない。

**`admin-lands-elsewhere`: 管理者だけ着く先が変わる**（2026-08-26 まで実際にそうだった形）

```
supabase-auth.js: location.replace('/edit')
  → location.replace(admin ? '/admin' : '/edit')

FAIL  1. 管理者も、みんなと同じカルテ画面に着く  path=/admin
FAIL  1b. 管理者には「管理」の入口が見えていて、指が届く  出ていない
0/3 PASS
```

**`admin-link-hidden`: 管理者にも「管理」が出ない**（今回マスターが実際に詰まった形）

```
supabase-staff.js: adminLink.hidden = false → true

PASS  1. 管理者も、みんなと同じカルテ画面に着く  path=/edit
FAIL  1b. 管理者には「管理」の入口が見えていて、指が届く  出ていない
1/3 PASS
```

**`admin-link-wrong-destination`: 押せるが、行き先が違う**（`D-12`「押せた ではなく 着いた」）

```
index.html: <a href="/admin" … data-admin-link> → href="/edit"

PASS  1. 管理者も、みんなと同じカルテ画面に着く  path=/edit
PASS  1b. 管理者には「管理」の入口が見えていて、指が届く  left=90 right=126 幅=390
FAIL  1c. 「管理」を押すと管理画面に着く  path=/edit
2/4 PASS
```

**注意**: `node scripts/mutate-run.mjs admin-link-wrong-destination` の要約は
この3件を「1. と 1b. が赤」と**取り違えて出す**（実際は `1c.` だけが赤）。
上の出力は `npm run verify:admin` を直接回して読んだもの。要約の取り違えは
`docs/ops/plan.md` 第12章 `#44` へ。

### 29回目: 体重の記録9件（2026-09-03・**手元で実測**）

マスター指示「納品して問題あるなら直せ」。体重まわりに2つの不具合があった。

- **④の「前回比」が常に「前回の記録なし」**。`currentDog.prevWeight` に値が入る経路は
  仮データ（`src/js/dummy.js`）だけで、実データでは常に `null`。確定カルテが5枚ある
  犬でも前回の体重を引けていなかった
- **⑥飼い主の「体重推移」が常に点1つ**。`renderWeightGraph()` はカルテ1枚の
  `weights`（＝その回の1件）を描いていた。`polyline` は2点未満では線を引けないので、
  **推移は一度も飼い主に届いていない**。既存の `verify:roundtrip` の
  `14b. 飼い主: 体重のグラフが描かれている` は**箱の中に要素が在るか**しか見ておらず、
  点1つでも緑になる——これが見逃されていた理由

新しい9件を、5つの壊し方で1件ずつ赤にした。

**A: 履歴を最後の1件だけにする**（`listWeightHistory` に `.slice(-1)`）

```
FAIL  カルテ1枚の応答に、確定カルテを横断した体重の履歴が載っている  点=1
FAIL  ⑤の体重グラフに線が引かれている（点が2つ以上）  {"ok":false,"points":1}
47/49 PASS
```

**B: 前回の体重を入れない**（`resumeDraft` の `prevWeight` 代入を落とす）

```
FAIL  前回比が「前回の記録なし」ではない（5枚目の体重を引けている）  badge="前回の記録なし"
FAIL  まだ量っていないので、前回の体重を出している（痩せたように見せない）  badge="前回の記録なし"
FAIL  体重を入れると前回比が出る（4.4 → 4.6 で +200g ▲）  badge="前回の記録なし"
FAIL  7枚目の前回比は、6枚目で量った体重（4.6kg）を基準にする  badge="前回の記録なし"
45/49 PASS
```

**C: 履歴を新しい順にする**（`order=report_date.asc` → `desc`）

```
FAIL  履歴の最後が、いま入れた体重（4.6kg）  最後=4.4kg
48/49 PASS
```

**D: 前回が無いとき見本の体重で引き算する**（`prevWeight || 2.67`・2026-08 まで実際にこうだった形）

```
FAIL  カルテが1枚も無い犬では「前回の記録なし」のまま  badge="前回 2.67kg"
48/49 PASS
```

> **この D は、1回目は赤にならなかった。** 検査が
> 「**計算して記録が無かった**」と「**一度も計算していない**」を区別できておらず、
> 画面に出ていた「前回の記録なし」は HTML の初期値のままだった（`docs/watch.md` W-1 の型）。
> `resumeDraft()` が**前回が無かったときも必ず `renderWeightDiff()` を呼ぶ**ように
> 実装を直してから、赤になった。**検査を弱めずに、製品側を直して見分けられるようにした。**

**E: 引き継ぐものが無くても引き継ぎの帯を出す**（`previous` の有無を見ない＋`labels.length === 0` の門を外す・2か所）

```
FAIL  カルテが1枚も無い犬では、引き継ぎの帯を出さない
48/49 PASS
```

### 30回目: 徹底調査で見つけた穴の8件（2026-09-03・**手元で実測**）

マスター指示「配線は全てつながっているのか、コードや緑/赤しか見てない箇所は正しく動くのか、
致命的な見落としはないか、人間として操作して目的の動作はすべて完了するか、イレギュラーな操作を
して壊れる事は無いか、脆弱性はないか、を徹底リサーチして記録に残せ」。
見つけたものと直したものは `docs/ops/audit-2026-09-03.md` に全部書いた。ここは**赤の実測**だけ。

**A: ④の入力欄が「選ばれて見えるのに保存されない」形に戻す**

BCS・右耳・歯を、それぞれ出荷時の状態（`is-active` 付き）に戻した。3通りとも赤。

```
--- 壊し方A: BCS を出荷時の状態（点いている）に戻す
not ok 1 - ④の入力欄が、選ばれて見えるのに保存されない状態で出荷されていない
not ok 2 - ④の入力欄の初期値は、ドックの「未記入」の見方と揃っている
--- 壊し方B: 耳を出荷時の状態に戻す
not ok 1 - ④の入力欄が、選ばれて見えるのに保存されない状態で出荷されていない
--- 壊し方C: 歯を出荷時の状態に戻す
not ok 1 - ④の入力欄が、選ばれて見えるのに保存されない状態で出荷されていない
=== 直した状態 ===  # pass 2 / # fail 0
```

**B: `pickWeightSeries()` を、空の配列で短絡する形に戻す**

```
--- 壊し方: return (report || {}).weightHistory;
not ok 8  - 確定カルテが1枚も無い犬では、今日量った体重が捨てられない
not ok 9  - 履歴が取れなかった回（null）も、今日の体重に落ちる
--- 壊し方: return (data || {}).weights;
not ok 10 - 履歴があるときは履歴が勝つ（点1つに戻らない）
=== 直した状態 ===  # pass 10 / # fail 0
```

**C: 体重履歴のクエリから門を外す**

```
--- 壊し方: status=eq.final& を外す（下書き・削除待ちの体重が混ざる）
not ok 26 - 体重の履歴は、確定したカルテだけを、古い順に、体重の列だけ取る
--- 壊し方: 新しい順にする（線が前後する）
not ok 26 - 体重の履歴は、確定したカルテだけを、古い順に、体重の列だけ取る
=== 直した状態 ===  # pass 26 / # fail 0
```

**D: ⑤が `selectKarte()` を呼ぶ形（＝穴を開け直す）**

⑤確認から段のタブ「03」を押すと、組み立てていない④が開いていた穴。

```
--- 壊し方: showReport() の setDogIdentity を selectKarte に戻す
FAIL  検査を最後まで実行できた  page.waitForSelector: Timeout 20000ms exceeded.
=== 直した状態 ===  15/15 PASS
```

**⚠️ 関所の変数だけを戻しても赤にならない。** `goToStep(3)` の判定を
`karteInputReady` → `karteReady` に戻すだけでは `⑤c-2` は緑のままだった（実測）
——`showReport()` が `selectKarte()` を呼ばなくなったので `karteReady` 自体が立たないため。
**直しは2箇所に効いていて、片方だけでも塞がる。** 検査が見ているのは「どこに着いたか」
なので、これは検査の弱さではなく、直しの厚さ。

**足した8件**

- ui-default-state.test.mjs :: ④の入力欄が、選ばれて見えるのに保存されない状態で出荷されていない
- ui-default-state.test.mjs :: ④の入力欄の初期値は、ドックの「未記入」の見方と揃っている
- weight-history.test.mjs :: 確定カルテが1枚も無い犬では、今日量った体重が捨てられない
- weight-history.test.mjs :: 履歴が取れなかった回（null）も、今日の体重に落ちる
- weight-history.test.mjs :: 履歴があるときは履歴が勝つ（点1つに戻らない）
- supabase-store.test.mjs :: 体重の履歴は、確定したカルテだけを、古い順に、体重の列だけ取る
- verify-m6.mjs :: ⑤c-2. 確定後に「03」を押すと、組み立てていない④を開かず②へ戻す
- verify-m6.mjs :: ⑤c-3. 戻った②に、犬を選び直せる一覧が在る（押せただけで終わらせない）

## 未証明（**壊して赤になるところを、まだ見ていない**）

- verify-carry-over.mjs :: 土台: 確定カルテが5枚ある犬を作った
- verify-carry-over.mjs :: ② 一覧に犬が出ている
- verify-carry-over.mjs :: ④ カルテ作成画面まで、押すだけで着いた
- verify-carry-over.mjs :: 確定できた（⑤へ進んだ）
- verify-carry-over.mjs :: 確定カルテが6枚になった
- verify-carry-over.mjs :: ⑦使用オプションが選べる（帯が出ている）
- verify-carry-over.mjs :: コースが空
- verify-carry-over.mjs :: 写真が1枚も入っていない
- verify-carry-over.mjs :: BCS が選ばれている
- verify-carry-over.mjs :: 触っていないので下書きは生えていない
- verify-carry-over.mjs :: 隠したら本当に消えている（hidden が CSS に負けていない）
- verify-carry-over.mjs :: 6枚目のメッセージは今回書いたもの（前回の使い回しではない）
- verify-carry-over.mjs :: 6枚目に前回の写真が混ざっていない


> **2026-09-02 追記**: マスター指示で仕様が変わり（「入口は1つ、管理者ページが
> 表示されるかされないかの差だけでいい」）、`verify-admin.mjs` の①を作り替えた。
> 旧「1. 管理者が /my を開くと管理者画面へ送られる」は**証明済みから外した**
> ——その挙動自体をやめたので、指す先がもう無い。代わりの3件を下に置く。
> 壊し方の台帳（`mutate-run.mjs`）も `admin-redirect-off` → `admin-link-hidden` に
> 差し替えてあり、**件数は減らしていない**。


- verify-stack.mjs :: seed のアカウントで実ログインできる #2
- verify-stack.mjs :: マイグレーションと seed が当たっている（seed の犬 X を id で引ける） #2
- verify-admin.mjs :: 7. 直す対象のカルテを1枚確定できた
- verify-delete.mjs :: 1. 写真つきのカルテを確定できた
- verify-delete.mjs :: 2. 写真の実体が Storage に在る（service_role で数える）
- verify-draft.mjs :: 4. 下書きの中身が漏れていない
- verify-empty-pet.mjs :: 7. 下書きの中身が漏れていない
- verify-m6.mjs :: ⑤. 確定すると確認の画面に着く
- verify-photo-roundtrip.mjs :: `${kind === 'trimming' ? '1' : kind === 'ear' ? '2' : '3'}. ${kind} の写真を付けられた`
- verify-photo-roundtrip.mjs :: 4. 写真つきで確定できた
- verify-photo-roundtrip.mjs :: 5. 保存された写真5枚が実体になっている（asset://）
- verify-portal.mjs :: 1. /my が配信される
- verify-portal.mjs :: 3. Supabase vendor が読めている
- verify-report-roundtrip.mjs :: 3e. 確認: 来店日（確定日ではなく）
- verify-production.mjs :: `配信物が手元の dist と同じ（${sameCount}/${staticFiles.length} 本）`
- verify-production.mjs :: /my が dist/my.html と同じ
- verify-production.mjs :: `削除済みの旧UI が本番に残っていない（${deletedUiPaths.length} 本を確認）`
- verify-production.mjs :: `/edit が正UI を配っている（手元 ${want.length} 本 ＋ 注入 ${injected.length} 本）`
- verify-report-roundtrip.mjs :: 20. 飼い主の画面に、量っていない体重が出ない
- verify-revisit-interval.mjs :: 9. アプリ由来の確認ダイアログが余計に出ていない
- verify-screens.mjs :: 1. `/` が配信される
- verify-screens.mjs :: 2. `/` に4画面が乗っている
- verify-screens.mjs :: 3. `/` に段のタブが4つ在る
- verify-screens.mjs :: 4. `/` はログイン画面から始まる
- verify-screens.mjs :: 5. スタッフ兼飼い主は `/my` に留まる
- verify-screens.mjs :: 6. その人に作業画面（`/edit`）への入口が出ている
- verify-screens.mjs :: 7. サインアウトの入口も出ている
- verify-screens.mjs :: 8. その入口を押すと、犬の一覧に着く
- verify-screens.mjs :: 9. 飼い主だけの人に作業画面の入口を出していない
- verify-screens.mjs :: 10. 飼い主には自分の犬が並んでいる
- verify-screens.mjs :: 11. ②一覧に犬のカードが並んでいる
- verify-screens.mjs :: 12. ②一覧に探す手段が在る
- verify-screens.mjs :: 13. ②一覧から新規カルテを作れる入口が在る
- verify-screens.mjs :: 13c. ②一覧に初回登録（QR）の入口が在る
- verify-screens.mjs :: 13b. 犬の名前を押すと画面が移る
- verify-screens.mjs :: 14. 犬を選ぶと③カルテ作成に着く
- verify-screens.mjs :: 15. ③に確定の入口が在る（行き止まりでない）
- verify-screens.mjs :: 16. ③に犬体図が在る
- verify-screens.mjs :: 17. 招待の入口を押しても、犬の選択には移らない
- verify-screens.mjs :: 18. 招待の入口を押すと、その場で出る
- verify-screens.mjs :: 19. 飼い主の画面で拡大を禁止していない
- verify-stack.mjs :: Supabase が起きている
- verify-stack.mjs :: seed のアカウントで実ログインできる
