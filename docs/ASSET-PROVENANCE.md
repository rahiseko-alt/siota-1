# 素材の出所台帳 (docs/ASSET-PROVENANCE.md)

> **これは何か**
> LEVEL D-4「出所未確認の素材を外部公開物へ転載禁止」を機能させるための台帳。
> `src/assets/` に入っている全ファイルについて、**分かっていることと分かっていないことを
> 分けて**書く。private リポジトリであることは権利問題を解決しない——飼い主に配る
> 公開ページ `/p/{slug}` に載る以上、これらは外部公開物である。
>
> **状態の意味**
> - `VERIFIED` — ライセンスが明示されており、再配布の可否が文書で確認できる
> - `AI-GENERATED` — C2PA の署名で生成元が特定できる。権利は生成サービスの利用規約に従う
> - `UNVERIFIED` — 出所が特定できない。**公開前に確認が要る**
>
> 調査日: 2026-08-21 / 調査方法: ファイル内の C2PA コンテンツ認証情報とライブラリのヘッダを実読

---

## 1. 同梱フォント — `VERIFIED`

`src/assets/fonts/`（18ファイル・568KB）

| ファミリ | 出所 | ライセンス | 再配布 |
|---|---|---|---|
| Fraunces | Google Fonts | SIL Open Font License 1.1 | 可 |
| Plus Jakarta Sans | Google Fonts | SIL Open Font License 1.1 | 可 |
| Inter | Google Fonts | SIL Open Font License 1.1 | 可 |

`scripts/vendor-fonts.mjs` で取得しなおせる。`src/assets/fonts/fonts.css` は自動生成物なので手で編集しない。

### 同梱していない日本語フォントと、その代償

Google Fonts への直リンクを外すにあたり、日本語4ファミリは**同梱しなかった**。実測した容量が理由。

| ファミリ | 実測 | 判断 |
|---|---|---|
| Noto Serif JP | 約 40 MB（496ファイル） | 同梱不可。リポジトリ全体の予算 20MB を単独で超える |
| Noto Sans JP | 約 30 MB（496ファイル） | 同上 |
| Zen Kaku Gothic New | 約 1.6 MB（484ファイル） | 容量は入るが、本文用ゴシックでシステムフォントとの差が小さい割にファイル数が多い |
| Yusei Magic | 約 0.45 MB（121ファイル） | **使用箇所は装飾1箇所のみ**。フォールバックが既に2段ある |

**代償**: 日本語は端末のシステムフォント（Hiragino / Yu Gothic / Noto CJK など）で表示される。
意匠の核である欧文（見出しの Fraunces、UI の Plus Jakarta Sans / Inter）は同梱したので保たれるが、
**和文の字面はマスターの手元と閲覧端末で完全には一致しない。** 一致が要件なら、
容量予算の見直し（受け入れ基準#10 の 20MB）から判断がいる。

---

## 2. ライブラリ — `VERIFIED`

| ファイル | 出所 | ライセンス |
|---|---|---|
| `konva.min.js` | Konva JavaScript Framework v10.3.0 / konvajs.org | MIT |

CDN からではなく同梱している（LEVEL D 準拠）。

---

## 3. AI 生成物 — `AI-GENERATED`

ファイル内の C2PA コンテンツ認証情報から生成元が特定できたもの。

| ファイル | 署名者 | 用途 | 備考 |
|---|---|---|---|
| `app-icon.png` | OpenAI Media Service API | PWA アイコン・favicon | 作成 2026-05-30。1254x1254 / 1.4MB |
| `dog-doodle.jpg` | Google C2PA Media Services | 検索一覧のデモ用アバター | `c2pa.created` + `c2pa.edited` |
| `dog-poodle.jpg` | Google C2PA Media Services | 同上 | 同上 |
| `body-marking.png` | Google C2PA Media Services | 犬体図（Konva の下絵） | `c2pa.converted` あり |
| `nail-diagram.png` | Google C2PA Media Services | 爪の状態図 | **6.1MB**。追跡対象13MB のうち約46%を占める |

**確認事項**: 生成サービスの利用規約上、生成物の商用利用可否と帰属表示の要否は
アカウントのプラン・生成時点の規約に依存する。**マスターが生成したものであれば問題ない**が、
第三者が生成したものを受け取っている場合は確認が要る。

---

## 4. 出所が特定できていないもの — `UNVERIFIED`

メタデータに手がかりが無く、このリポジトリの履歴（移設時の初回コミット）より前が辿れない。

| ファイル | 寸法 | 容量 | 用途 |
|---|---|---|---|
| `photo-dog-ear.jpg` | 1402x1122 | 376KB | 耳の状態ガイド |
| `photo-dog-skin.jpg` | 1402x1122 | 371KB | 皮膚の状態ガイド |
| `photo-dog-jump.jpg` | 1122x1402 | 190KB | 意匠用 |
| `photo-dog-paw-high.jpg` | 1122x1402 | 230KB | 検索一覧の既定アバター |
| `photo-dog-pawpad.jpg` | 1484x1060 | 196KB | 肉球画面の意匠 |
| `photo-trim-action.jpg` | 1536x1024 | 257KB | 意匠用 |
| `guide-nail-state.jpg` | 1440x1092 | 340KB | 爪の状態ガイド |
| `guide-teeth-state.jpg` | 1321x1191 | 257KB | 歯の状態ガイド |
| `teeth-diagram.jpg` | 700x1162 | 92KB | 歯式図 |
| `body-side.png` | 390x417 | 9KB | 犬体図（側面） |
| `icon-ear.png` / `icon-nail.png` / `icon-skin.png` / `icon-spa.png` / `icon-weight.png` | 512x512 | 各 106〜141KB | セクション見出しアイコン |

**特に確認が要るもの**: `photo-dog-*.jpg` と `guide-*.jpg` は**実写に見える**。
撮影者が誰か（サロンでの撮影か、ストックか）で扱いが変わる。飼い主に配るページに載るため、
第三者の犬が写っている場合はその飼い主の同意も要る。

**消せば画面は壊れる。** 出所が不明だからと黙って削除すると、状態ガイドが空欄になって
トリマーが判断に使えなくなる。差し替えるまでは残し、この台帳に `UNVERIFIED` と
書いてある状態を維持する——**分からないことを分かっているままにしておくのが、
分かったつもりで消すより安全**という判断。

---

## 5. 公開前にやること

- [ ] AI 生成5件について、生成したアカウントと当時の規約を確認する
- [ ] `UNVERIFIED` 15件の出所をマスターに確認する。実写4件（`photo-dog-ear` / `photo-dog-skin` / `guide-nail-state` / `guide-teeth-state`）が優先
- [ ] 出所が確認できないものは、権利の明確な素材へ差し替える（削除ではなく差し替え）
- [ ] `nail-diagram.png` 6.1MB の圧縮を検討する。ただし状態判断に使う図なので、画質を落とすかは用途の確認が先

## 6. 素材を足すときの手順

1. 出所とライセンスを**先に**確認する。確認できないものは入れない
2. この台帳に1行足す。`UNVERIFIED` のまま入れてよいのは、既存の穴を埋める場合だけ
3. 外部 CDN から読み込まない。ファイルを `src/assets/` に置く
4. `npm run build` で dist に入ることを確認する（`src/assets/` は再帰コピーされる）
