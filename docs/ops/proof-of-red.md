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
| 機械が数えた検査 | **182件**（`scripts/verify-*.mjs`） |
| 壊して赤になったところを見た | **17件**（毒見・2026-08-28） |
| まだ見ていない | **164件** |

**出発点は182件すべてが未確認だった。** 毒見（土台ごと空にする）で17件が赤になり、証明済みへ移った。
**残り164件は、まだ「壊したら赤になるか」を見ていない。**
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

→ 台帳の鍵の付け方に欠陥がある（名前が動的な検査を扱えない）。
   直すまで、この8件は**未証明のまま**にしておく。数を良く見せない。



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

## 未証明（**壊して赤になるところを、まだ見ていない**）

- verify-admin.mjs :: 1. 管理者が /my を開くと管理者画面へ送られる
- verify-admin.mjs :: 2. 管理者ページに リピーター / 新規 / 削除 が在る
- verify-admin.mjs :: 3. リピーターに カルテ作成 / カルテ修正 が在る
- verify-admin.mjs :: 4. 新規に 顧客アカウント作成 / ペットアカウント作成 が在る
- verify-admin.mjs :: 5. 顧客アカウントが実際に作られた
- verify-admin.mjs :: 6. ペットアカウントが実際に作られた
- verify-admin.mjs :: 7. 直す対象のカルテを1枚確定できた
- verify-admin.mjs :: 8. 修正で開くと、前に書いた中身が入っている
- verify-admin.mjs :: 9. 直す操作が最後まで進んだ（保存されて開き直した）
- verify-admin.mjs :: 10. 直しても同じカルテのまま（2枚目を作らない）
- verify-admin.mjs :: 11. 確定済みのカルテは1枚のまま
- verify-admin.mjs :: 12. 中身が直っている（確定済みが上書きされた）
- verify-admin.mjs :: 13. 削除に 顧客 / ペット / カルテ の3つが在る
- verify-admin.mjs :: 14. 名前を打つまで削除ボタンは押せない
- verify-admin.mjs :: 15. カルテ1枚が実際に消えた
- verify-admin.mjs :: 16. ペットが実際に消えた
- verify-admin.mjs :: 17. 顧客が実際に消えた
- verify-admin.mjs :: 18. 消した犬の写真が Storage に残っていない
- verify-admin.mjs :: 19. 管理者でないスタッフに管理者の操作を出していない
- verify-admin.mjs :: 20. 行き止まりにせず、その人が使える画面への入口を出している
- verify-admin.mjs :: 21. アプリ由来のエラーが無い
- verify-delete.mjs :: 0. 検査用の犬を登録できた
- verify-delete.mjs :: 1. 写真つきのカルテを確定できた
- verify-delete.mjs :: 2. 写真の実体が Storage に在る（service_role で数える）
- verify-delete.mjs :: 3. 製品の削除の道が最後まで通った
- verify-delete.mjs :: 4. 写真の実体が Storage から消えた（service_role で数える）
- verify-delete.mjs :: 5. 飼い主のページからカルテが消えている
- verify-draft.mjs :: 1. 記入が下書きとしてサーバに残った
- verify-draft.mjs :: 2. 離れて戻ると、続きから書ける
- verify-draft.mjs :: 3. 下書きは飼い主に見えない
- verify-draft.mjs :: 4. 下書きの中身が漏れていない
- verify-draft.mjs :: 5. 確定すると下書きは残らない
- verify-draft.mjs :: 6. 次に開くと、確定済みの記入は蘇らない
- verify-edit.mjs :: 1. /edit が配信される
- verify-edit.mjs :: 2. 正UI が配られている（screen-N が在る）
- verify-edit.mjs :: 3. App が名前で届く（インライン onclick の解決先）
- verify-edit.mjs :: 3b. App のメソッドが実際に呼べる
- verify-edit.mjs :: 3c. onclick="App.…" が実在する
- verify-edit.mjs :: 4. Supabase vendor が載っている
- verify-edit.mjs :: 5. staff モジュールが載っている（boot を持つ）
- verify-edit.mjs :: 6. 注入先が backend/js/ に直っている
- verify-edit.mjs :: 7. アプリ由来のエラーが無い
- verify-edit.mjs :: 8. ②一覧が実データの犬になっている
- verify-edit.mjs :: 9. 仮データ（window.DUMMY）の犬が出ていない
- verify-edit.mjs :: 10. 持っていない項目（犬種・担当）が空で出ている
- verify-edit.mjs :: 11. 件数が実データと合っている
- verify-edit.mjs :: 12. 一覧の画面（screen-2）が開いている
- verify-edit.mjs :: 13. ⑤確認の画面（screen-4）が開いている
- verify-edit.mjs :: 14. ⑤確認の器から意匠モックの既定文が消えている
- verify-edit.mjs :: 15. 空の写真スロットがページURLを指していない
- verify-edit.mjs :: 16. 担当メッセージが無いカルテで、文例が出ていない
- verify-edit.mjs :: 17. ④の入力欄が空で始まる（見本の文が入っていない）
- verify-empty-pet.mjs :: 0b. 下書きのカルテを用意できた
- verify-empty-pet.mjs :: 1. 犬の名前は出ている（ページ自体は開けている）
- verify-empty-pet.mjs :: 2. 正直な空の状態が出ている
- verify-empty-pet.mjs :: 3. 写真が1枚も出ていない
- verify-empty-pet.mjs :: 4. 履歴の行が1つも出ていない
- verify-empty-pet.mjs :: 5. 見本の文章が出ていない
- verify-empty-pet.mjs :: 6. 確定していないカルテは飼い主に見えない
- verify-empty-pet.mjs :: 7. 下書きの中身が漏れていない
- verify-empty-pet.mjs :: 8. トリマーは1件目を作る画面に入れる
- verify-empty-pet.mjs :: 9. 確定のボタンが在る（行き止まりでない）
- verify-invitation.mjs :: 1. その飼い主の犬を登録できた
- verify-invitation.mjs :: 2. 一覧に初回登録（QR）の入口が出ている
- verify-invitation.mjs :: 3. 押すと初回登録の URL が出る
- verify-invitation.mjs :: 4. QR が画像として出ている
- verify-invitation.mjs :: 5. 招待を消化する前は、その犬を見られない
- verify-invitation.mjs :: 6. 招待を消化すると、自分の犬が見える
- verify-invitation.mjs :: 7. 使い終わった招待は、別の人が使えない
- verify-m6.mjs :: ①. URL を開ける
- verify-m6.mjs :: ②a. 未ログインならログインの画面に導かれる
- verify-m6.mjs :: ②b. ログインすると作業画面に入れる
- verify-m6.mjs :: ③. 名前で犬を選べる
- verify-m6.mjs :: ④. カルテを書く画面に、書く場所と確定の入口が在る
- verify-m6.mjs :: ★. 間違えても1タッチで一覧へ戻れる
- verify-m6.mjs :: ★b. 戻った先に犬が並んでいる（空の一覧に置き去りにしない）
- verify-m6.mjs :: ★c. 戻ってから、もう一度同じ犬に入れる
- verify-m6.mjs :: ⑤. 確定すると確認の画面に着く
- verify-m6.mjs :: ⑤b. 確定した中身に、書いた一言が入っている
- verify-m6.mjs :: ⑤c. 確定後に④へ戻ると、その犬の名前が見出しに出ている
- verify-m6.mjs :: ⑥a. 飼い主は一覧から自分の犬に入れる
- verify-m6.mjs :: ⑥b. 飼い主はカルテを開ける
- verify-photo-roundtrip.mjs :: `${kind === 'trimming' ? '1' : kind === 'ear' ? '2' : '3'}. ${kind} の写真を付けられた`
- verify-photo-roundtrip.mjs :: 4. 写真つきで確定できた
- verify-photo-roundtrip.mjs :: 5. 保存された写真4枚が実体になっている（asset://）
- verify-photo-roundtrip.mjs :: 6. 飼い主: 表紙が、1枚目に入れた写真
- verify-photo-roundtrip.mjs :: 7. 飼い主: ギャラリーに2枚並ぶ
- verify-photo-roundtrip.mjs :: 8. 飼い主: 耳の写真が、耳の欄に
- verify-photo-roundtrip.mjs :: 9. 飼い主: 歯の写真が、歯の欄に
- verify-photo-roundtrip.mjs :: 10. 飼い主: 壊れた画像（ページURL を指す img）が無い
- verify-photo-roundtrip.mjs :: 11. 直しで開くと、付けた写真が控えに残っている
- verify-photo-roundtrip.mjs :: 12. 直したあとも写真4枚が残っている
- verify-photo-roundtrip.mjs :: 13. アプリ由来のエラーが無い
- verify-portal.mjs :: 1. /my が配信される
- verify-portal.mjs :: 2. 起動分岐が立っている
- verify-portal.mjs :: 3. Supabase vendor が読めている
- verify-portal.mjs :: 4. ポータルが起動している
- verify-portal.mjs :: 5. 未ログインでログイン導線が出る
- verify-portal.mjs :: 6. ログインボタンが押せる
- verify-portal.mjs :: 7. 未ログインで中身とログアウトは隠れている
- verify-portal.mjs :: 8. 見本画像を出していない
- verify-portal.mjs :: 9. 犬を直接指す URL でもログイン導線が出る
- verify-portal.mjs :: 10. アプリ由来のコンソールエラーが無い（ログイン前）
- verify-portal.mjs :: 11. ログイン後、自分の犬（X/Y/Z）が一覧に出て、他人の犬（Q）は出ない
- verify-portal.mjs :: 12. ログイン後はログアウトボタンが出る
- verify-portal.mjs :: 13. 他人の犬（Q）は見えない（RLS）
- verify-portal.mjs :: 14. サインアウトでログイン画面に戻る
- verify-portal.mjs :: 15. 失効・リンク解除のあとでも、ログインボタンが出て押せる（詰まない）
- verify-production.mjs :: `配信物が手元の dist と同じ（${sameCount}/${staticFiles.length} 本）`
- verify-production.mjs :: /my が dist/my.html と同じ
- verify-production.mjs :: `削除済みの旧UI が本番に残っていない（${deletedUiPaths.length} 本を確認）`
- verify-production.mjs :: `/edit が正UI を配っている（手元 ${want.length} 本 ＋ 注入 ${injected.length} 本）`
- verify-report-roundtrip.mjs :: 1. 記入先の要素がすべて実在する
- verify-report-roundtrip.mjs :: 1b. 押したボタンの表示が、そのまま保存される値になっている
- verify-report-roundtrip.mjs :: 2. 確定してカルテが1件できた
- verify-report-roundtrip.mjs :: 3. 確認: 担当からの一言
- verify-report-roundtrip.mjs :: 4. 確認: 爪
- verify-report-roundtrip.mjs :: 5. 確認: 耳
- verify-report-roundtrip.mjs :: 6. 確認: 歯
- verify-report-roundtrip.mjs :: 7. 確認: 体重
- verify-report-roundtrip.mjs :: 8. 確認: 犬体図の印が画像として出ている
- verify-report-roundtrip.mjs :: 9. 飼い主: 犬の名前
- verify-report-roundtrip.mjs :: 10. 飼い主: 担当からの一言
- verify-report-roundtrip.mjs :: 11. 飼い主: 爪
- verify-report-roundtrip.mjs :: 12. 飼い主: 耳
- verify-report-roundtrip.mjs :: 13. 飼い主: 歯
- verify-report-roundtrip.mjs :: 14. 飼い主: 体重
- verify-report-roundtrip.mjs :: 15. 飼い主: 犬体図の印が画像として届く
- verify-report-roundtrip.mjs :: 16. 飼い主: 壊れた画像（ページURL）が出ていない
- verify-report-roundtrip.mjs :: 17. 他人には見えない（RLS）
- verify-report-roundtrip.mjs :: 19. 体重の欄が空で始まる（見本値が入っていない）
- verify-report-roundtrip.mjs :: 20. 飼い主の画面に、量っていない体重が出ない
- verify-report-roundtrip.mjs :: 18. アプリ由来のエラーが無い
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
- verify-stack.mjs :: seed のアカウントで実ログインできる
- verify-xss.mjs :: label
- verify-xss.mjs :: label
- verify-xss.mjs :: label
- verify-xss.mjs :: `${label}: 細工が文字として飼い主の画面に出ている`
- verify-xss.mjs :: `${label}: 実行されない`
- verify-xss.mjs :: `${label}: 要素として注入されていない`
- verify-xss.mjs :: 検査を最後まで実行できた
