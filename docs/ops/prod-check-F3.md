# デプロイ済みの実物を確認した（2026-08-26）

`docs/handoff.md`「次に効いてくること」の1件目——**「デプロイ済みの実物が一度も確認されていない。
緑なのは手元と CI だけ」**——に答える記録。マスター指示により、この1件だけを片づけた。

**層は「調べる」**（`D-18`）。何も直していない。**本番は変えていない。**

---

## 結論

**本番（`https://trimmer-system.kouheikosehira.com`）は、F1 より前のデプロイのまま動いている。**
いま master に在るもの（F3 完了版）は、**一度もデプロイされていない。**

つまり、これまで緑にしてきた `build` / `check` / `test` / `verify:*` 11本 / `walk` の絵は、
**すべて手元と CI のバイト列についての話**であって、お客さんが開く URL が返すものとは関係が無かった。
`D-18` の偽-5（別の緑で覆う）が、リポジトリ全体の規模で起きていた状態にあたる。

**到達はできた。** 引き継ぎに「この環境から外部へ到達できない」とあるが（`deferred` #20）、
それは当時のコンテナの話で、**このセッションからは HTTPS で普通に届いた。**

---

## 何を確かめたか

一度 curl して終わりにすると、次のセッションでまた同じ穴が開く。**機械にした**（`D-7`）。

```
npm run verify:prod                                  ← 既定は本番
PROD_URL=https://例.example npm run verify:prod       ← 接続先を差し替える
```

実体は `scripts/verify-production.mjs`。見るのは4つで、**判定の右辺は全部 `dist/` と git から取る**
（「本番はこうであるはず」を人が書き写すと、書き写した側がズレる——`F-20260825-40` の型）。

| | 見るもの | 右辺の出どころ |
|---|---|---|
| 1 | 配信物 38本のバイト一致（sha256） | `dist/` の非 HTML 全部 |
| 2 | `/my` が `dist/my.html` と一致するか | `dist/my.html` |
| 3 | 削除済みの旧UI が 404 か | `git log --diff-filter=D` で消えた `src/js/*.js` `*.html` |
| 4 | `/edit` が正UI を配っているか | `dist/index.html` の `<script src>` の並び |

### この検査が保証しないこと

- **人が使えるかは見ない。** ログインした先で何が見えるか、動線が最後まで行くかは見ていない。
  それは `npm run walk` の絵と `D-14` の2問の領分。
- **本番のデータは一切見ない。** ログインもせず、お客さんの情報を取らない（`A-2`）。
- **正しさは見ない。** 手元と同じ版が配られているかだけを見る。
  手元が間違っていれば、本番も同じように間違ったまま緑になる。

---

## 証拠（実行した命令と、その出力）

### 本番に向けた（赤）

```
$ npm run verify:prod
[verify-production] 接続先: https://trimmer-system.kouheikosehira.com
FAIL  配信物が手元の dist と同じ（31/38 本）
        /backend/js/magazine-view.js → HTTP 404
        /backend/js/supabase-auth.js → HTTP 404
        /backend/js/supabase-staff.js → HTTP 404
        /backend/js/supabase-storage.js → HTTP 404
        /backend/js/supabase-vendor.js → HTTP 404
        /js/dummy.js → HTTP 404
        /js/ui.js → HTTP 404
FAIL  /my が dist/my.html と同じ  HTTP 200 / sha 94455906cb77 ≠ 75b43f977e02
FAIL  削除済みの旧UI が本番に残っていない（9 本を確認）
        /js/magazine-view.js → HTTP 200 (31815B)
        /js/ponchi-app.js → HTTP 200 (85576B)
        /js/ponchi-engine.js → HTTP 200 (60997B)
        /js/publish-client-ponchi.js → HTTP 200 (29908B)
        /js/supabase-auth.js → HTTP 200 (14618B)
        /js/supabase-staff.js → HTTP 200 (16543B)
        /js/supabase-storage.js → HTTP 200 (11428B)
FAIL  /edit が正UI（dist/index.html）を配っている（script 2 本）  HTTP 200
        手元: /js/dummy.js /js/ui.js
        本番: /assets/konva.min.js /js/supabase-vendor.js /js/supabase-auth.js /js/supabase-staff.js /js/ponchi-engine.js /js/ponchi-app.js /js/publish-client-ponchi.js /js/magazine-view.js

0/4 PASS
EXIT 1
```

`/js/ponchi-app.js` が **200 で 85,576 バイト返る**。このファイルは `6685df5`「古いUIをはがし…」で
削除され、**リポジトリのどこにも無い**。正UI の `/js/ui.js` は逆に **404**。
これ以上の証拠は要らない——本番は F1 以前の版である。

### 「常に赤」ではないことの確認（緑）

赤い検査は、それ自体が壊れていても赤くなる。**同じ検査を、いまの `dist` を配る器に向けた**:

```
$ PROD_URL=http://127.0.0.1:8899 node scripts/verify-production.mjs
[verify-production] 接続先: http://127.0.0.1:8899
PASS  配信物が手元の dist と同じ（38/38 本）
PASS  /my が dist/my.html と同じ
PASS  削除済みの旧UI が本番に残っていない（9 本を確認）
PASS  /edit が正UI（dist/index.html）を配っている（script 2 本）

4/4 PASS
EXIT 0
```

同じコミット・同じ検査で、**向ける先を変えるだけで 0/4 と 4/4 が入れ替わる。**
赤は本物で、検査が恒真でないことも同時に示している（`docs/watch.md` W-1）。

### 併せて確認した本番の状態

| 経路 | 結果 | 中身 |
|---|---|---|
| `/` | 200 (7,629B) | 旧UI の入口 |
| `/edit` | **200** | 旧UI `ponchi-v2.html`（title「ポチページ デザイン v2.1」） |
| `/my` | 200 (9,796B) | 手元の `dist/my.html`（9,812B）と別物 |
| `/api/session` | 401 | 認証が要求されている |
| `/api/customers` | 401 `{"error":"authentication required"}` | **無認証で顧客一覧は取れない**（`D-20260823-03` の再発は無し） |
| `/assets/*`・フォント 31本 | 200・**バイト一致** | ここは F1 前後で変わっていない |

---

## `deferred` #20 への答え

#20 は「`/edit` が本番で **502** を返す」ことを心配していた。**実際は 502 ではなく 200 だった。**
理由は単純で、**削除済みテンプレートを読む版が、そもそもデプロイされていない**ため。
502 になるのは「`ponchi-v2.html` を消した後の worker をデプロイした場合」で、
本番の worker はそれより前の版のまま止まっている。

**つまり #20 の心配は、デプロイした瞬間には解消している**（4-1 で `/index.html` へ向け直したので、
いまの master をデプロイすれば `/edit` は正UI を配る）。**未確認なのは変わらない**——
デプロイしていないので、デプロイ後の本番はまだ誰も見ていない。

---

## ここで止めた理由と、次にマスターがやること

**デプロイはしていない。** 理由は2つ:

1. **Cloudflare の認証情報を扱わない**（`A-1`）。`wrangler deploy` には API トークンが要る。
2. **本番の差し替えは戻しにくい外向きの操作**で、いま動いているものをお客さんごと切り替える。
   `docs/handoff.md` の残り4件（**鍵3種のローテーション未実施**・本番のダミー犬3頭と孤児 owner・
   削除の入口・過去カルテの導線）が片づく前に切り替えてよいかは、**マスターの判断**である。

とくに **鍵のローテーション（7-3）が未実施のまま本番を新版へ切り替えると、`.srkey` が
RLS を丸ごと無視する状態のまま実顧客データに向く。** 順番としては鍵が先に見える。

デプロイしたら、その場で `npm run verify:prod` を走らせること。**4/4 PASS で初めて
「デプロイ済みの実物を確認した」と言える。**
