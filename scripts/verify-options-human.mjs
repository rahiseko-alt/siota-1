/**
 * verify-options-human.mjs — ⑦使用オプションの帯を「人間と同じ操作」で見る
 *
 * マスター指示 2026-09-01。
 * 「うまくできていると主張し続けているが、人間が操作してダメなら無意味だ」
 * 「受け入れ条件は人間と同じ操作をしてスクショで画像確認できることだ」
 *
 * **この検査は合否を出さない。出すのは写真だけ。** 合否は人が写真を見て決める
 * （`D-14` と同じ立て付け）。機械が数える「ボタンが N 個ある」は、
 * `F-20260821-11` で一度「押せた＝届いた」と読み違えた種類の証拠なので、
 * ここでは根拠にしない。
 *
 * ## 何をどう再現しているか
 *
 * 本番の `/edit` は **Worker が `dist/index.html` に script を3本注入して**配っている
 * （`worker/src/index.js` の `renderAppPage`）。`dist/index.html` をそのまま配ると
 * バックエンドが載らず、マスターが見ている画面とは別物になる。だから土台
 * （`scripts/lib/options-human-fixture.mjs`）でも**同じ3本を同じ順で注入する**。
 *
 * 載るのは実物である（`dist/js/ui.js` / `supabase-auth.js` / `supabase-staff.js`）。
 * 差し替えるのは**外の世界の2つだけ**——Supabase の SDK（ログイン済みの体にする）と
 * `/api/*` の応答（パターンごとに変える）。
 *
 * ## 使い方
 *
 *   node scripts/verify-options-human.mjs          10パターン全部
 *   OPTIONS_ONLY=02 node scripts/verify-options-human.mjs   1本だけ
 *
 * 写真は `.human/options/` に出る（`npm run walk` と同じく追跡外）。
 */

import { runPatterns } from './lib/options-human-run.mjs';

process.exit(await runPatterns());
