# `verify:*` 9本の復元台帳（`bad-scenarios-F3.md` #6 の本体）

> **この書類が「何が無いか」の正。** `docs/deferred.md` #8 は本数と顔ぶれを間違えていた
> （`all` と `preview` は npm の集約スクリプトでファイルではない／`delete`・`draft`・
> `invitation`・`screens` の4本が記録から漏れていた）。#8 はこの書類を指すように直した。
>
> 作成日 2026-08-25。根拠はすべて実行した命令とその出力（`docs/ops/failure-check-*` と同じ書き方）。

## 消えた9本（実測）

```
$ git show --diff-filter=D --name-only 6685df5 | grep verify-
verify-delete.mjs  verify-draft.mjs  verify-empty-pet.mjs  verify-invitation.mjs
verify-m6.mjs  verify-portal.mjs  verify-report-roundtrip.mjs  verify-screens.mjs  verify-xss.mjs
```

## いま在るもの

```
$ node -e "console.log(Object.keys(require('./package.json').scripts).filter(x=>x.startsWith('verify')))"
[ 'verify:migrations', 'verify:stack', 'verify:portal', 'verify:edit' ]
```

`migrations` と `stack` は土台の検査で、9本には含まれない。`edit` は 4-1 で**新しく書いた**もので、
これも9本には含まれない（`/edit` が正UI を配れているかまでしか見ない）。
**9本のうち戻っているのは `portal` の1本**（CI で 14/14 PASS）。

## 1本ずつ — 何を見て、何を要求するか

| # | 検査 | 状態 | 見るもの | 開くページ | 戻すのに要るもの |
|---|---|---|---|---|---|
| 1 | `portal` | 復元済み | `/my` が起動し、ログイン後に自分の犬だけ見えること（RLS） | `/my` | — CI で 14/14 PASS |
| 2 | `xss` | 未復元 | 保存されたカルテが飼い主のブラウザで**実行されない**こと（D-11） | `/my/pets/:pet/reports/:report` のみ | **結線を待たずに戻せる**（下記） |
| 3 | `report-roundtrip` | 未復元 | 書いたものが飼い主に**同じ値で届く**か（D-12・最重要） | `/edit` → `/my` | 4-1 の結線（記入・確定・公開） |
| 4 | `delete` | 未復元 | 削除したら写真が**実体として**消えること。`service_role` で数える | `/edit` | 4-1 の結線 ＋ 削除導線 |
| 5 | `draft` | 未復元 | 記入が黙って消えないこと（下書き・復帰・確定後は書けない） | `/edit` | 4-1 の結線 ＋ 下書き保持 |
| 6 | `empty-pet` | 未復元 | カルテ0件の犬に**存在しない履歴**を見せていないこと（D-10） | `/edit` → `/my` | 4-1 の結線（一覧・新規作成） |
| 7 | `invitation` | 未復元 | 新規のお客様が自分のカルテを見られるまで（`claim_invitation`） | `/edit` | 4-1 の結線 ＋ 招待発行の導線 |
| 8 | `m6` | 未復元 | 動線①〜⑥が一気通貫で通ること | `/edit` → `/my` | 4-1 の結線 全部 |
| 9 | `screens` | 未復元 | 各画面に**在るべきボタンが在る**か（手順の外を見る唯一の検査） | `/` `/my` `/edit` | 4-1 の結線 全部 |

> **この表は `node scripts/guard/verify-inventory.mjs` が毎回 git と突き合わせる。**
> 消えた検査が載っていない／状態が実体と食い違う／`復元済み` なのに `package.json` から
> 呼ばれていない、のどれかで EXIT 1 になる。**記録を人の記憶で保つのをやめるため**に置いた。
> 状態の語は `復元済み` / `未復元` の2つだけ（機械が読む）。

## 実測で分かった、計画との食い違い2点

**(1) `/edit` を要るのは 8本ではなく 7本。** `plan.md` 4-0-d の表は
「`/my` 1本 ／ `/edit` 8本」と書いているが、`verify-xss` は `/edit` を一度も開かない。
細工データは**スタッフ API で直接**入れ、見るのは飼い主の画面だけである。

```
$ git show 6685df5^:scripts/verify-xss.mjs | grep -oE "goto\(\`\\\$\{BASE\}[^\`]*|openStaffPage"
goto(`${BASE}/my/pets/${pet.id}/reports/${report.id}
```

要る入口はすべて実在する（`worker/src/index.js`）:
`POST /api/owners/:ownerId/pets` / `POST /api/pets/:petId/reports` /
`POST /api/pets/:petId/reports/:reportId/finalize` / `/my/*` → `my.html`。
**つまり `xss` は結線を待たずに戻せる。** 戻れば D-11 の機械強制がゼロでなくなる。

**(2) 残り7本は「復元」ではなく「書き直し」。** 掴んでいた目印が正UI に1つも無い。

```
$ for s in owner-pet-item archive-new-btn ponchi-commit-ok ponchi-btn-pub \
           screen-magazine heroDateInput data-field ponchi-new-karte-form; do
    echo "$s: $(grep -rl "$s" src/ | wc -l) 件"; done
owner-pet-item: 0 件      archive-new-btn: 0 件     ponchi-commit-ok: 0 件
ponchi-btn-pub: 0 件      screen-magazine: 0 件     heroDateInput: 0 件
data-field: 0 件          ponchi-new-karte-form: 0 件
```

正UI は `screen-1`〜`screen-4` / `.karte-card` / `onclick="App.…"` で出来ている。
`deferred.md` #8 の「復元元は `git show 6685df5^:…`」は**中身の仕様書としてだけ**使えて、
**そのままでは1本も動かない**。7本は「何を見るか」を引き継ぎ、掴む場所を書き直す。

## 関所（`gate.mjs`）が、この作業を止めている

```
$ node scripts/guard/gate.mjs scripts/verify-xss.mjs ; echo EXIT=$?
【関所】F3 の作業場はまだ開いていません。触ろうとした場所: scripts/verify-xss.mjs
  - ② バッドシナリオの**未解決が減っていない**（出発点 1件 → いま 1件）
EXIT=1
```

`gate.mjs` は「作業中は**未解決が減っていること**」を要求する。出発点（`origin/master`）の
未解決は **`#6` の1件だけ**なので、「減っている」＝「`#6` が解決済み」しかない。
ところが `#6` を解決するには `scripts/` と `src/` を触る必要がある——**最後の1件は、
着手できない。** これは 2026-08-25 にマスターが直した defect（「直す場所が作業場の中にある項は、
永久に着手できなくなっていた」）と**同じ形**で、残り1件のときだけ再発する。

`0件→減っていること` の緩和は 2件以上のときにしか効かない。**判断はマスターに預ける**
（`AGENTS.md`「範囲外を触る必要が本当にあるなら、マスターに言って判断を仰ぐ」）。
