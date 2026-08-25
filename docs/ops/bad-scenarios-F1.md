# F1 バッドシナリオ（10個）

承認: 未

> F1 の完了条件（`docs/ops/plan.md`）
> **A**: `src/` に UI 以外が無い ／ **B**: UI から `backend/` への参照が 0（**機械で確認**） ／ **C**: `npm run build` / `npm run check` / `npm test` が EXIT 0
>
> 判定基準: 「これを1つ見落としたら、A・B・C のどれかが満たせなくなるか」だけ。
> **未実行**（承認前）。`結果` はすべて `未`。

| # | 見落とし | これを外すと完了条件のどれが満たせないか | 確かめ方 | 結果 |
|---|---|---|---|---|
| 1 | `npm run check` に隔離の検査が**1本も無い**。中身は `src-dist-drift-guard`（dist に同名ファイルが在るか）と `design-isolation-guard`（`design/` だけ）の2本で、`backend` という語がどちらにも1度も出てこない | **B**。「機械で確認」が存在しないので、いま緑でも B は未達。緑が「隔離できている」を意味しない | `grep -n '"check"' package.json; grep -rc backend scripts/src-dist-drift-guard.mjs scripts/design-isolation-guard.mjs` | 未 |
| 2 | 隔離検査を足すとき、走査先を `src/js/*.js` にしてしまい **`src/index.html` を見ない**。UI の実体は 2,339行の index.html 側にあり、`.js` は 448行しかない | **B**。UI 本体が素通りするので、参照0を数えたことにならない | `wc -l src/index.html src/js/ui.js src/js/dummy.js; printf '\n<script src="/../backend/js/supabase-auth.js"></script>\n' >> src/index.html; npm run check; echo "EXIT=$?"; git checkout src/index.html` | 未 |
| 3 | 「`backend/` への参照」を**文字列 `backend/` だけで数える**。実際に繋ぐときは `backend/` と書かない — `@supabase/supabase-js` の直 import（`backend/js/supabase-vendor-entry.mjs` がまさにこの形）、`fetch('/api/...')`、`https://….supabase.co`、そして**もう1つのバックエンド `worker/`** | **B**。数え方が狭いと 0 と出るが、UI は繋がっている | `grep -rn -e backend -e supabase -e /api/ -e "fetch(" -e "http" -e worker/ src/` | 未 |
| 4 | 足した検査が「**わざと違反を置いたら赤くなる**」ことを一度も確かめていない。常に緑を返す検査は無い検査と同じ（`F-20260821-23` / `F-20260823-01` と同じ形） | **B・C**。検査が偽物なら B は永久に未達のまま、C の EXIT 0 も嘘になる | `printf '\nimport "../../backend/js/supabase-auth.js";\n' >> src/js/ui.js; npm run check; echo "EXIT=$?"; git checkout src/js/ui.js` | 未 |
| 5 | 検査対象を `src/` だけにして、**実際に配信される `dist/` を見ない**。人が触るのは `scripts/serve-ui.mjs` が配る dist の方 | **B**。src が0でも、配信物が0である保証にならない | `npm run build; grep -rn -e backend -e supabase dist/; diff -rq src dist` | 未 |
| 6 | 条件 **A（`src/` に UI 以外が無い）にも機械確認が無い**。しかも「UI 以外」の基準が決まっていない。現に `src/assets/konva.min.js` は UI から1行も呼ばれていない第三者ライブラリとして残っている | **A**。人の目でしか見ておらず、「無い」と宣言できない | `ls -R src/; grep -rn -e Konva -e konva src/; grep -rno "assets/[A-Za-z0-9._/-]*" src/index.html src/js/ui.js` | 未 |
| 7 | 隔離が「**移設**」ではなく「**削除**」になっている。`backend/js/supabase-auth.js` は消えた `magazine-view.js` を import したままで、**いま import できない**（`Cannot find module`）。UI 側を消せば B は 0 になるが、それは隔離ではなく破壊 | **A・B の達成の仕方**。「UI と backend を隔離した」が成立していない。F3 で繋ぎ直す相手が壊れている | `ls backend/js/; node --input-type=module -e "import('./backend/js/supabase-auth.js').then(()=>console.log('OK')).catch(e=>console.log('IMPORT FAIL:',e.message))"` | 未 |
| 8 | `npm test` が **UI を1行も見ておらず、backend の検査も消えている**。残るのは `worker/` 3本と `backend/js/supabase-storage.js` 1本だけ。隔離のとき `test/supabase-auth.test.mjs`（466行）を削除している | **C**。EXIT 0 が「何も見ていないから緑」になる。C を満たしても隔離の裏付けにならない | `npm test; grep -rn -e "../src/" -e "../backend/" -e "../worker/" test/; git show --stat 6685df5 -- test/` | 未 |
| 9 | `npm run check` の drift-guard は **dist に同名ファイルが在るかだけ**を見て中身を見ない。さらに config の3項目のうち1つは**既に削除された `src/design-samples/`** を指しており、`existsSync` が false で**黙って0件**になる。`manifest.json` と `assets/` は最初から検査対象外 | **C**。check の緑が「src と dist が一致している」を意味しない。検査項目が黙って消えても誰も気づかない | `cat src-dist-guard.config.json; ls src/design-samples; echo "EXIT=$?"; printf 'x' >> dist/js/ui.js; npm run check; echo "EXIT=$?"; npm run build` | 未 |
| 10 | `dist/` は `.gitignore` されており **リポジトリに1ファイルも入っていない**。clean clone / CI では `npm run build` より先に `npm run check` を走らせると drift-guard が必ず EXIT 1 になる。手元には dist が残っているので気づけない | **C**。「3本とも EXIT 0」が手元でだけ成立し、他所では成立しない | `git ls-files dist; grep -n "^dist/" .gitignore; rm -rf dist; npm run check; echo "EXIT=$?"; npm run build; npm run check` | 未 |

---

## 水増しを避けるために落とした候補

- `scripts/build-dist.mjs` の `ENTRIES` が4つ固定（`index.html` / `manifest.json` / `js` / `assets`）で、これに無いものは dist に出ないまま build が EXIT 0 になる → いま src はちょうどこの4つで、F1 で UI を足す予定も無い。**将来の話**なので出さない。
- `src/manifest.json` が `src/index.html` から一度も読み込まれていない（`<link rel="manifest">` が無い）→ A・B・C のどれも崩さない。
- `src/assets/` に UI から参照されない図版が8件残っている（`icon-*.png` / `nail-diagram.png` / `teeth-diagram.jpg` / `body-side.png`）→ 掃除の話で、完了条件を崩さない。#6 で「UI 以外の基準が無い」として1本にまとめた。
