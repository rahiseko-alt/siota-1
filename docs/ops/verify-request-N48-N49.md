# 独立検証のお願い — 犬種の欄（N-48）と「管理者／スタッフ」の権限分け（N-49）

> この文書は、**このリポジトリを初めて見る別の AI** に、同じ検証をやり直してもらうための手紙です。
> 依頼主はマスター（このリポジトリの持ち主・非エンジニア）。作ったのは Claude で、**Claude とは別の目で確かめる**のが目的です。
> ルールの正は [`AGENTS.md`](../../AGENTS.md)。この手紙と食い違ったら `AGENTS.md` が勝ちます。

---

## 0. やってはいけないこと（先に読む）

- **コードを直さない。** 見つけたら報告するだけ。直すのは作った側です。
- **コミット・push・マージ・デプロイをしない。** 本番（`https://trimmer-system.kouheikosehira.com/`）にも本番のデータベースにも触らない。
- **鍵・パスワード・トークンを受け取らない、表示しない**（`AGENTS.md` A-1）。手元の検査用の値はリポジトリの中にあるもの（`supabase/seed.sql`・`scripts/lib/local-stack.mjs`）だけを使う。
- **検査を弱めて緑にしない**（A-4）。赤は赤のまま報告する。
- 実在のお客様の情報を使わない（A-2）。

## 1. 何を確かめるか

| | |
|---|---|
| リポジトリ | `https://github.com/rahiseko-alt/siota-1` |
| ブランチ | `claude/n42-breed-proposal` |
| 比べる元 | `c3ffe98`（master・変更前） |
| 検証する版 | このブランチの最新コミット（`git log -1` で確認。2026-11-19 時点の作業コミットは `484df7d`） |
| 差分 | `git diff c3ffe98..HEAD` |

### 変更の中身（＝「変えてよい範囲」。これを合意として照らし合わせる）

**N-48 犬種**（クライアントの要望「検索結果を 飼い主名・犬名・犬種 で出してほしい」）
- データベース: `supabase/migrations/202611190016_pet_breed.sql` — 犬に `breed` 列（空でもよい・1〜60文字）と、その列の更新許可。
- サーバー: `worker/src/api-schemas.js`（登録・変更で `breed` を受ける。空は null）、`worker/src/data-stores/supabase-data-store.js`（`listPetsWithOwner`・`createPet`・`updatePet` だけが `breed` を読み書き）。
- 画面: `backend/js/supabase-admin.js` — 犬の登録に犬種の欄（打つと候補が出る・候補に無ければ手で打てる）、「① リピーター → ③ 犬の情報を直す」（`/admin/repeat/pet`）、犬を選ぶ画面の行に犬種（検索窓で犬種でも探せる）。`backend/js/supabase-staff.js`・`src/js/ui.js` — 作業画面（`/edit`）の犬の一覧に犬種。

**N-49 権限**（クライアントは「管理者・スタッフ・顧客」の3つあると思っている。マスター指示で先に分けた）
- データベース: `supabase/migrations/202611190017_admin_staff_roles.sql` — `shop_memberships.role`（`admin`／`staff`・既定 `admin`）、`private.is_shop_admin()`。
  - **スタッフにできないこと（管理者だけ）**: 削除（顧客・犬・カルテ・写真の実体）、店舗設定（`shops` の更新）、スタッフ招待の発行と取り消し、顧客・犬を「使わない」（`active` を無効）にすること。
  - それ以外（カルテを書く・直す・写真・顧客と犬の登録・犬の情報を直す・飼い主の招待）は、これまでどおりスタッフもできる。
  - スタッフ招待で入った人がスタッフ。それ以外（店を作った人）が管理者。既存の人は「スタッフ招待を使って入った記録」があればスタッフ。
- サーバー: `/api/session` の各所属に `role` が付く。
- 画面: スタッフの管理画面には「① リピーター」「② 新規」だけが出る。削除・店舗設定・スタッフ招待の住所を直接開くと「この操作は管理者だけができます」と戻るボタンだけが出る。スタッフ招待の画面の説明文を変えた。
- ルール: `AGENTS.md` D-26 を「2つ」から「3つ」に書き直した。
- 文書: `docs/ops/plan.md`・`docs/runbook.md` 2-E・`docs/handoff.md`・`docs/failures.md`・`docs/ops/client-reply-C13-C14.md`。
- 検査の道具: `supabase/seed.sql`（スタッフ権限の試験口座 `limited-staff@local.test` を追加）、`scripts/lib/local-stack.mjs` と `scripts/mutate-run.mjs`（Windows でも走るようにした）、`scripts/verify-admin.mjs`（犬種 6a〜6h・スタッフ 22a〜22l）、`test/supabase-schema.test.mjs`・`test/supabase-store.test.mjs`。

**変えてはいけない範囲**: 飼い主の画面（`/my`）とその API（`/api/my/*`）の動きと返す中身、カルテの中身と飼い主への届き方、写真の上げ方・貼り替え、飼い主の招待、入口（`/`）とログイン、上に書いた以外の画面。

## 2. 合格条件（マスター指定・4つ）

**4つとも合格で、初めて合格。** 1つでも不合格なら全体が不合格です。

### ① セキュリティの危険が、一般的な基準に照らして数値で合格
- 攻撃する側の目で差分を見る。特に: スタッフが自分の `role` を書き換えられないか、データベースを直接（PostgREST に公開鍵＋スタッフのログイン）叩いて管理者だけの操作が通らないか、別の店のデータに届かないか、`active` の抜け道、招待の受け取りで役割が上がる・下がる道、犬種の欄からの XSS、入力の検査、エラーで中身が漏れないか、差分に鍵が入っていないか。
- **見つけた穴ごとに CVSS v3.1 の基本値（ベクトル付き）を付ける。合格 = 4.0 以上（中・高・重大）が 0 件。**
- アクセス制御は OWASP ASVS v4 の V4（4.1.1・4.1.3・4.2.1・4.3.1）に対応づけて ○／× を付ける。

### ② コードに破綻が無い
- `npm run build`・`npm test`・`npm run check` を走らせ、終了コードと件数を出す。
- 変更したすべての .js／.mjs に `node --check`。
- `node scripts/mutate-run.mjs --dry-run`（壊し方がすべて「壊して戻せる」か）。
- 差分を読んで: 書き間違い・食い違う参照（画面が期待する値をサーバーが本当に返すか、検査が使う目印が画面に実在するか）・置き忘れのデバッグ用コード（A-5）・Linux の CI で動きが変わっていないか（`local-stack.mjs` の Windows 分岐）。
- **既知で、赤でよいもの**: `npm test` の「いまのリポジトリは、全件が台帳に載っている」1件と、`npm run check` の `plan-read`／`plan-next`／`failure-match`／`proof-of-red`（セッションの印と、壊して赤を見た台帳。作った側が最後に埋める）。**これ以外の赤はすべて報告する。**

### ③ 変更した所以外に、意図しない影響が出ていない（範囲をすり合わせたうえで）
- 上の「変えてよい範囲」を合意として、`git diff --stat` の全ファイル・全差分を1つずつ照らす。範囲で説明できない差分を全部挙げる（無ければ「無し」）。
- 本物と同じ手元の環境で、検査を**1本ずつ順に**走らせ、各行の `N/N PASS` を出す（手順は 3.）:
  `verify:stack` `verify:portal` `verify:edit` `verify:xss` `verify:roundtrip` `verify:empty` `verify:screens` `verify:delete` `verify:draft` `verify:invitation` `verify:m6` `verify:admin` `verify:photo` `verify:carry-over` `verify:revisit` `verify:first-run`（最後に。データベースを空にする）。
- 飼い主向けの API（`/api/my/*`）が読む列が変わっていないことを、コードで確かめる。

### ④ ブラウザで、人と同じように1操作ずつ進めて最後まで完了できる
- **入口 `/` から始め、押す・打つだけで1ページずつ進む。** 途中の住所を直接開かない。API を叩いた結果を証拠にしない（`AGENTS.md` D-23・D-27）。
- **判定は自分で撮って見た画面の写真だけ**（D-14）。問いは2つ: ①正しい手順で最後まで行けるか ②間違えたとき2タッチ以内で、やりたかった操作に戻れるか。
- スマホの大きさ（390×844）。Google のログインは手元では動かないので、ログインだけ `injectSession(page, メール)` を入口で使ってよい（そのあとはすべて押す・打つ）。
- 管理者 = `staff@local.test`（**名前は昔のままだが中身は管理者**）、スタッフ = `limited-staff@local.test`。
- 歩く道:
  - **管理者**: 入口 → 作業画面 →「管理」→ ② 新規 → ② ペットアカウントの新規作成 → 飼い主を選び、名前を打ち、犬種に「トイ」と打って「トイ・プードル」 → 登録する → 戻って ① リピーター → ① カルテ作成（「レポートを作成する犬を選ぶ」）→ 犬種で探す → 行に飼い主・犬・犬種が出る → 押すとカルテ作成の画面。さらに ③ 犬の情報を直す → 犬を探して選ぶ → 犬種を手で「ミックス（柴×チワワ）」に変えて保存。
  - **スタッフ**: 入口 →「管理」→ **リピーターと新規の2つだけ**が出ること → 犬を登録（犬種つき）→ 犬の情報を直す → 犬種で探してカルテ作成まで。
  - **間違い**: 違うメニューを押す・違う犬を選ぶ → 2タッチ以内で戻れるか。
- 写真に写らないもの（犬種の候補が開いた状態など）は「写真では確かめられなかった」と正直に書く。

## 3. 手元の環境の作り方

- Node.js 22 以上・Docker が要る。
- ```
  git clone https://github.com/rahiseko-alt/siota-1 && cd siota-1
  git checkout claude/n42-breed-proposal
  ```
  **Windows なら** `npm ci` の前に `git config --local core.autocrlf false` → `git checkout .`（改行が CRLF になるとテストが大量に赤になる・`F-20261119-93`）。
- `npm ci` → `npm run build`。**`npm install` は使わない**（新しい部品を足す扱いで止められる）。
- 本物と同じデータベース: `npx supabase start`（**Windows では** `npx supabase start -x logflare,vector`。集計の部品が Windows で動かない）。中身を最初の状態に戻すのは `npx supabase db reset`。
- `npm run verify:migrations` は PostgreSQL のプログラムを手元に要する（Linux）。Windows なら Docker の Linux コンテナで走らせる（例: `node:22-bookworm` に `postgresql` を入れ、リポジトリをマウントして `node scripts/verify-migrations.mjs`）。**この検査は記録ファイル `supabase/.sql-verified` を書き換えるので、走らせたら書き換わった分は報告だけして、コミットしない。**
- 検査は**同時に走らせない**（同じデータベースと番号を取り合い、互いの作ったデータで赤になる。2026-11-19 に実際に起きた）。

## 4. 返してほしいもの

1. **4つそれぞれの判定（合格／不合格）と、全体の判定。**
2. ①: 見つけた穴の表（場所・内容・CVSS 値とベクトル・再現手順）、重さごとの件数、ASVS の表。
3. ②: 命令ごとの終了コードと件数の表。既知以外の赤があれば、そのまま貼る。
4. ③: 範囲で説明できない差分の一覧（無ければ「無し」）と、検査ごとの `N/N PASS` の表。
5. ④: 道ごとに「段・操作・写真のファイル名・写真に何が写っているか・○×」の表と、2つの問いへの答え。
6. 人が実際に困りそうなこと（作業を止めないものも）。
7. **確かめられなかったこと**を、確かめられなかったと書く。推測を「確認した」と書かない（`AGENTS.md` D-18・D-23）。

参考: Claude 側で行った同じ検証の結果は `docs/handoff.md` 冒頭「0-CF」にある。**先に読まず、自分で確かめたあとで見比べてください。**
