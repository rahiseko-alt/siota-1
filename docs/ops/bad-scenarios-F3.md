# F3 バッドシナリオ（10個）

承認: 未

> **F3 の完了条件（`docs/ops/plan.md` 第4章）**
> F2 の2問（①最後まで到達できた ／ ②間違えても2タッチ以内に戻れた）が、**実データでも**同じように通る。
>
> **並び順はマスター指定の「死ぬ順」。** 上ほど深刻。基準は次の4段で、上から順に並べた。
>
> | 段 | 何が起きるか |
> |---|---|
> | **I** | **実在のお客さんに、取り返しのつかない害が出る**（偽の手紙・消せない写真・情報漏れ） |
> | **II** | **黙って失う**（保存したつもり・届いたつもり。誰も気づかない） |
> | **III** | **気づく手段が無い**（検査そのものが存在しない） |
> | **IV** | **進めない／終わったと言えない**（結線すると赤くなる・合否の写真が撮れない） |
>
> **10個すべて、提案の時点で実行して確かめた**（`F-20260825-32` の教訓）。
> 前回は「確かめ方」だけ書いて承認を求め、実測したら3件が該当せず、最も重い1件が抜けていた。
> 今回は下の各項に、**実行した命令とその出力**を貼ってある。推測で書いた項は無い。
> ルールは2行で書く（`AGENTS.md` D-17）。**人間の行だけ読めば、承認の可否は判断できる。**

---

## 段 I — 実在のお客さんに、取り返しのつかない害が出る

### 1. 誰も書いていない手紙が、「担当トリマーから」としてお客さんに届く — 結果: 該当した
- **人間**: カルテの読み込みに失敗したとき、画面は**エラーを出さない**。代わりに、最初から埋め込んである「今月もとってもお利口に…」という**作り話の手紙**が、担当トリマーが書いたものとしてお客さんに表示される。お客さんは嘘の手紙を読む。店の信用が直接傷つく。
- **AI**: `renderMagazine(container, report)` は `if (!container || !report) return;`（`backend/js/magazine-view.js:515`）。**例外を投げず、器に触れずに帰る。** 器（`src/index.html` の `screen-4`）には既定文が**ハードコードされている**ので、それがそのまま残る。`D-2`（`null` を必ず失敗として扱う）と同型が、保存側ではなく**表示側**で起きる。

```
$ node probe-magazine.mjs      # renderMagazine に report=null を渡す
renderMagazine(container, null) の戻り値 : undefined
例外は投げたか                          : いいえ（ここに到達している）
器の中身は変わったか                    : いいえ（固定文がそのまま残る）
飼い主に見えるもの                      : 今月もとってもお利口にトリミングさせてくれました。…

$ grep -c "今月もとってもお利口" src/index.html
2                              # 1963行=④の入力欄 / 2086行=⑥のお客さん画面。別々の固定文
```

**2か所ある**のが効く。④で何も書かなくても入力欄が埋まって見え（`docs/deferred.md` #13）、
⑥は⑥で独立した固定文を出す。**どちらも人が書いたものではない。**

### 2. 消したはずの写真が残り、しかも誰も回収できなくなる — 結果: 該当した
- **人間**: 犬やお客さんを削除したとき、順番を間違えると**写真だけが残る**。しかも残った写真は、店の人にも本人にも**一覧に出ない・消せない**。画面上は「消えました」と出る。「削除したのに残っている」はお客さんの情報の扱いとして通らない。
- **AI**: `pets` を先に消すと FK カスケードで `reports` 行が消え、Storage ポリシー `private.storage_path_staff` の条件（当該 `reports` 行の存在）が偽になる。以後 `list` も `remove` も通らず、孤児の在処を示す `report_assets.storage_path` も道連れ（`D-20260824-34`）。**Storage → DB の順**が絶対。

```
$ grep -cniE "削除|delete|purge" src/js/ui.js
0                              # 削除導線は src/ に1件も無い。F3 で新規に作る＝これから踏める

$ grep -n "purgePetAssets\|順序" test/*.mjs
                               # 0件。順序を守らせる検査は1本も無い

$ git show --diff-filter=D --name-only 6685df5 | grep verify-delete
scripts/verify-delete.mjs      # 順序を見ていた唯一の検査は削除済み
```

**さらに悪いのは、素直に作り直した検査が必ず合格してしまうこと。** 消えた `verify-delete.mjs`
の冒頭にこう書いてある——「**RLS 越しに見てはいけない。削除後は『残っていても見えない』ので、
RLS 越しの確認は必ず合格してしまう。service_role で実体を数える**」。
**偽の緑を作る条件が、検査の作り方の中に埋まっている**（`D-18` 偽-5 の型）。

### 3. 本番の鍵3本が、公開後もそのままになっている — 結果: 該当した（マスター作業・未着手）
- **人間**: 作業中に使った**店の合鍵3本**を、本番を公開した後もまだ作り直していない。うち1本は、**すべての鍵を無視して全部のデータを読める**もの。実際のお客さんの情報を入れ始める前に作り直す必要がある。F3 はまさにその段。
- **AI**: `D-20260824-31` は **`Kind: open`（マスター作業）のまま**。`.cftoken` / `.sbtoken` / `.srkey` の3本で、`.srkey`（service_role）は **RLS を完全に無視できる**。リポジトリと git 履歴に無いことは確認済み（入っているのは publishable key のみ・設計通り）。`A-1` `A-2` の territory。

```
$ grep -n "D-20260824-31" docs/decisions.md
281:### [D-20260824-31] 秘密情報のローテーションを推奨する
                               # Kind: open。解決済みに変わった記録は無い
```

**これは私の作業ではなく、マスターがダッシュボードで再発行する作業。**
F3 が実データに触る前に済ませる必要があるので、順序として一番上の段に置いた。

---

## 段 II — 黙って失う

### 4. 写真の取得に失敗すると、その写真だけ黙って消える — 結果: 該当した
- **人間**: お客さんのカルテに載るはずの写真が、取得に失敗すると**エラーも出ずに、その写真だけ無かったことになる**。店の人は「載せたはず」、お客さんは「載っていない」。どちらも気づけない。
- **AI**: `hydrateAssetReferences` は `const { data: blob, error } = await client.storage.from(bucket).download(...)` の直後で **`if (error || !blob) continue;`**（`backend/js/supabase-storage.js:158-159`）。握りつぶしで、件数の報告も無い。`#1` と重なると「手紙は偽物・写真は欠落」の両方が無言で起きる。

```
$ sed -n '157,160p' backend/js/supabase-storage.js
    const { data: blob, error } = await client.storage.from(bucket).download(asset.storage_path);
    if (error || !blob) continue;
                               # 失敗を数えても報告してもいない
```

### 5. SQL を壊しても `npm test` は緑のまま — 結果: 該当した
- **人間**: データベースの設計図を壊しても、**検査は「全部OK」と言う**。マスターが本番に貼って初めてエラーになる。これは**一度実際に起きた事故**で、F3 は設計図を触る段。
- **AI**: `npm test` は `test:unit` `test:schema` `test:migration` `test:backend` の4本で、**実 PostgreSQL に流す唯一の検査 `verify:migrations` を呼んでいない**（`docs/deferred.md` #9）。`test:schema` は SQL を**文字列として** grep するだけなので構文エラーを見ない。`F-20260821-24`（予約語 `window`）の再来条件がそのまま残っている。

```
$ # git archive したまっさらな複製に、本番が絶対に受け付けない SQL を1行足して:
$ printf '\ncreate table as window (id uuid);\n' >> supabase/migrations/202607160001_supabase_base.sql

$ npm test
EXIT=0                         # ← 緑。壊れているのに通る
$ npm run verify:migrations
EXIT=1                         # ← 赤。これだけが捕まえる
```

**赤を実際に見た上で書いている。**（`npm run verify:migrations` 単体は現状 7/7 PASS・EXIT 0）

---

## 段 III — 気づく手段が無い

### 6. お客さんに届く中身を見る検査が、1本も存在しない — 結果: 該当した
- **人間**: 「お客さんの画面に、正しい中身が出ているか」を見る検査が**全部消えている**。しかも**消えたものの記録が間違っていて、一番大事な1本が記録から漏れている**。無いものは、無いと分かっていないと作り直せない。
- **AI**: `6685df5` が `scripts/verify-*.mjs` を **9本**削除。`docs/deferred.md` #8 は「**7本**（`m6`/`roundtrip`/`empty`/`xss`/`portal`/`all`/`preview`）」と書くが、`all` と `preview` は**ファイルではなく npm の集約スクリプト**。実体で消えたのに記録に無いのは **`delete` / `draft` / `invitation` / `screens` の4本**——うち `verify-delete.mjs` は `#2` の唯一の防波堤。`AGENTS.md` D-9〜D-12 の機械強制は**現在ゼロ**。

```
$ git show --diff-filter=D --name-only 6685df5 | grep -c verify-
9
$ git show --diff-filter=D --name-only 6685df5 | grep verify-
verify-delete.mjs  verify-draft.mjs  verify-empty-pet.mjs  verify-invitation.mjs
verify-m6.mjs  verify-portal.mjs  verify-report-roundtrip.mjs  verify-screens.mjs  verify-xss.mjs

$ node -e "console.log(Object.keys(require('./package.json').scripts).filter(x=>x.startsWith('verify')))"
[ 'verify:migrations' ]        # 残っているのは1本だけ
```

### 7. ⑥の器そのものが `src/` に無く、その見張りも一緒に消えている — 結果: 該当した
- **人間**: **お客さんが見るページ（`my.html`）が、もう存在しない。** 前のセッションで作り直したはずのものが、UI をはがしたときに一緒に消えた。さらに、それを見張るための検査も同時に消えたので、**消えたこと自体を誰も報せない**。
- **AI**: `6685df5` が `src/my.html` と `test/supabase-auth.test.mjs` を**同時に**削除。後者は `bootProtectedPortal()` のソースから `querySelector` の引数を抜き出し、その全部が `my.html` に在ることを要求していた検査（P8-a で追加）。結線表の「⑥顧客ページ → `bootProtectedPortal` + `hydrateAssetReferences` + `renderMagazine`」に、**起動先の器が無い**。

```
$ ls src/my.html
★ src/my.html は存在しない
$ ls test/supabase-auth.test.mjs
★ 無い
$ git log --oneline --diff-filter=D -- src/my.html
6685df5 古いUIをはがし、正しいUIだけにする（第1段・第2段の途中）
```

---

## 段 IV — 進めない／終わったと言えない

### 8. 合否の根拠になる写真が、まっさらなコンテナで**撮れない** — 結果: 該当した
- **人間**: F3 の合格・不合格は「画面の写真だけで決める」と決まっている。ところが**その写真を撮る命令が、新しい入れ物では動かない**。しかも終了時の検査は動かして確かめないので、**壊れたまま「異常なし」で終われてしまう**。
- **AI**: `npm run walk` が **EXIT 1**。`playwright@1.59.1` は chromium revision **1217** を要求するが、この環境に在るのは **1194**（`/opt/pw-browsers/`）。`checkout.mjs` の6番目は `npm ci`→`build`→`check`→`test` を新しい作業場で走らせるが、**`walk` は含まない**ので、この赤を検出せず EXIT 0 になりうる。`F-20260825-33`「自分が動かせる環境でしか確かめていない」の型。

```
$ npm run walk
Executable doesn't exist at .../chromium_headless_shell-1217/...
walk EXIT=1                    # 引き継ぎの「walk EXIT 0・3回連続」は前のコンテナでの実測

$ ls /opt/pw-browsers/
chromium  chromium-1194  chromium_headless_shell-1194  ffmpeg-1011

$ grep -n "npm run build\|npm run check\|npm test\|walk" scripts/guard/checkout.mjs
104:  && run('npm run build', ...)  105:  && run('npm run check', ...)  106:  && run('npm test', ...)
                               # walk は無い
```

### 9. F3 の結線を1行入れた瞬間、`npm run check` が赤になる — 結果: 該当した
- **人間**: F3 の仕事は「画面と裏側をつなぐ」こと。ところが**つないだ瞬間に検査が赤くなる**。F1 で「つながっていないこと」を検査にしたから。**ここで検査のほうを緩めると、F1 でやったことが黙って消える。**
- **AI**: `isolation.mjs` の条件B が `backend/` `@supabase|createClient(` `'/api/` 外部URL **`fetch(`** を禁止し、`npm run check` から `src` と `dist` の両方に対して走る。**結線表の全行が違反になる。** 緩和は `A-4`（検査を消して緑にしない）に直行するので、**先にマスターの判断が要る**。

```
$ # まっさらな複製の src/js/ui.js に、結線表どおりの最小の2行を足して:
$ REPO_ROOT=$SB node scripts/guard/isolation.mjs src
【条件B】UI からバックエンド・外部への繋がりが 3 件あります。
    src/js/ui.js:410  backend/ への参照     import { mapPet } from '/backend/js/supabase-staff.js';
    src/js/ui.js:411  API の呼び出し先      const res = await fetch('/api/pets');
    src/js/ui.js:411  通信そのもの          const res = await fetch('/api/pets');
EXIT=1
```

### 10. 画面側と裏側で、部品の作りが違って**そのままでは繋がらない** — 結果: 該当した
- **人間**: 画面の部品と裏側の部品は、**書き方の規格が違う**。片方をもう片方にそのまま差し込むと動かない。つなぐ前に、どちらに合わせるかを決めておかないと、後から全部書き直しになる。
- **AI**: `src/index.html` は `<script src="/js/dummy.js">` `<script src="/js/ui.js">` の**古典スクリプト**（`type="module"` は **0件**）。`backend/js/*.js` は全ファイルが `export` の **ES モジュール**。古典スクリプトの中に `import` を書くと構文エラーで**ファイルごと実行されない**。`build-dist.mjs` は `node:fs` `node:path` `node:url` しか使わない**素のコピー**で、変換は入らない（`esbuild` は `package.json` に宣言だけあって `scripts/` から未使用）。

```
$ grep -c 'type="module"' src/index.html
0
$ grep -n "^export" backend/js/*.js | wc -l
21                             # 全部 ES モジュール
$ grep -rn "esbuild" scripts/
                               # 0件。build は変換しない素のコピー
```

---

## 実測のまとめ

**10個すべてを承認前に実行した。結果は 該当した 10 / 該当せず 0。**

| # | 段 | 結果 | 決め手になった出力 |
|---|---|---|---|
| 1 | I | 該当した | `renderMagazine(_, null)` が例外なく無変更で帰る／固定文が **2か所** |
| 2 | I | 該当した | 削除導線 **0件**・順序の検査 **0件**・`verify-delete.mjs` 削除済み |
| 3 | I | 該当した | `D-20260824-31` が **open** のまま |
| 4 | II | 該当した | `if (error || !blob) continue;`（報告なし） |
| 5 | II | 該当した | 壊した SQL で `npm test` **EXIT 0** / `verify:migrations` **EXIT 1** |
| 6 | III | 該当した | 消えたのは **9本**、記録は **7本**（`delete` ほか4本が記録漏れ） |
| 7 | III | 該当した | `src/my.html` と `test/supabase-auth.test.mjs` が**同時に**消えている |
| 8 | IV | 該当した | `walk` **EXIT 1**（chromium 1217 要求 / 1194 在庫）・`checkout` は walk を見ない |
| 9 | IV | 該当した | 結線2行で条件B **3件**・EXIT 1 |
| 10 | IV | 該当した | `type="module"` **0件** vs `export` **21件** |

**10個とも該当した。** 前回（F2）は10個中3個が該当せずだったので、
「該当せずが0件」は選び方が甘い可能性を自分で疑ったが、**#1〜#10 はいずれも
`plan.md` 第4章の結線表の行に1対1で対応する**もので、水増しは入れていない。
逆に、確かめた上で**落とした**候補を下に残す。

## 確かめた上で落とした候補（該当しなかったもの）

- **`finalize_report` の `null` を成功として扱う（`D-2`）** — **該当せず。**
  `worker/src/data-stores/supabase-data-store.js:255` が `if (!finalized) throw new StoreError(409, 'storage_incomplete')`
  で処理済み。`test/supabase-store.test.mjs` に `null` を返させて **409** を要求する検査も在る。
  ただし**画面がその 409 をトリマーに見せるか**は F3 で作る部分なので、`#1` の同型として作業中に見る。
- **RLS が有効になっていない** — **該当せず。** `enable row level security` **11テーブル**、
  `create policy` **27本**（23+3+1）。`verify:migrations` も 7/7 PASS。
- **`purgePetAssets` 自体の順序が逆** — **該当せず。** 実装は Storage の掃除だけを行い
  DB 行に触れず、失敗時は例外で削除自体を止める。**関数は正しい。** 危ないのは
  `#2` のとおり**呼び出す側をこれから作ること**と、**守らせる検査が無いこと**。

## 承認後にやること

1. `承認: 未` を `承認: 済` に書き換える
2. **`#3` はマスターの作業**（ダッシュボードでの再発行）。着手時期の指示を待つ
3. **`#9` は緩和の可否がマスター判断**。`A-4` に触れるため、勝手に条件Bを緩めない
4. 残りを潰し、見出しを `結果: 該当した ／ 解決済み` にして `docs/ops/solved-F3.md` に3出力（赤→緑→戻して赤）を貼る
5. 1つでも手つかずの `該当した` が残る間、`src/` の作業場は開かない（`scripts/guard/gate.mjs` が止める）
