/**
 * plan-read-mark.mjs — 「このセッションが大計画を読んだ」印の形を1か所に決める
 *
 * 書くのは `checkin.mjs`、読むのは `plan-read.mjs`。**両方が同じ形を見る**ように
 * ここに寄せる（形が2か所に散ると、片方だけ直して食い違う——`W-1` の型）。
 *
 * 印（`.plan-read`・`.gitignore` 済み）の中身:
 *
 *   {"at":"2026-09-06T08:00:00.000Z","session":"…","shown":["docs/ops/roadmap.md", …]}
 *
 * **なぜ時刻1行では足りなかったか。** 以前の印は時刻だけで、関所は
 * 「ファイルが在るか」しか見ていなかった。そのため
 * **前のセッションが残した印で、次のセッションが素通りできた**
 * （2026-09-06 に実測——前日 2026-09-05 の印のまま `npm run check` が通っていた）。
 * 印に「どのセッションが」「何を読んだか」を残し、関所がそれを突き合わせる。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const MARK_PATH = path.join(ROOT, '.plan-read');

/** 大計画の現物。これを画面に出していないチェックインは、印を書いても関所で止まる。 */
export const ROADMAP = 'docs/ops/roadmap.md';

/** 一緒に出すもの（出したことを印に残す）。 */
export const SHOWN = [ROADMAP, 'docs/ops/phase', 'docs/ops/plan.md'];

/** 鍵が取れないときの有効期限。 */
export const MAX_AGE_MS = 8 * 60 * 60 * 1000;

/**
 * このセッションを表す鍵。
 *
 * **特定の AI に依存しない**（`CLAUDE.md`「どの AI でも実行できるコマンドにする」）。
 * 見つかった最初のものを使い、どれも無ければ空文字。
 */
export function sessionKey(env = process.env) {
  for (const name of ['CLAUDE_CODE_SESSION_ID', 'CODEX_SESSION_ID', 'AI_SESSION_ID']) {
    const value = (env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

export function writePlanReadMark(env = process.env) {
  const mark = { at: new Date().toISOString(), session: sessionKey(env), shown: SHOWN };
  fs.writeFileSync(MARK_PATH, `${JSON.stringify(mark)}\n`);
  return mark;
}

export function readPlanReadMark(raw) {
  const text = raw ?? (fs.existsSync(MARK_PATH) ? fs.readFileSync(MARK_PATH, 'utf8') : null);
  if (text === null) return null;
  try {
    const mark = JSON.parse(text);
    return mark && typeof mark === 'object' ? mark : null;
  } catch {
    /* 旧い形（時刻1行）。**通さない。** これを通すと、仕組みを入れ替えた意味が無い。 */
    return null;
  }
}

/**
 * 印を判定する。合格なら `{ ok: true }`、不合格なら理由つき。
 *
 * **【限界】** セッション鍵がどれも取れない環境では、同じ場所で
 * 8時間以内に始まった2つ目のセッションを区別できない。鍵が無ければ原理的に
 * 見分けられないので、そこは時間で切る。前日の印で素通りはできない。
 */
export function judgePlanReadMark(mark, { env = process.env, now = Date.now() } = {}) {
  if (!mark) return { ok: false, why: 'まだ大計画を読んでいない（印が無いか、古い形式）' };
  if (!Array.isArray(mark.shown) || !mark.shown.includes(ROADMAP)) {
    return { ok: false, why: `印に ${ROADMAP} が無い（チェックインが大計画を画面に出していない）` };
  }
  const key = sessionKey(env);
  if (key) {
    if (mark.session !== key) {
      return { ok: false, why: '別のセッションが残した印（このセッションはまだ読んでいない）' };
    }
    return { ok: true, why: `読んだ（${mark.at}）` };
  }
  const at = Date.parse(mark.at || '');
  if (!Number.isFinite(at)) return { ok: false, why: '印の時刻が読めない' };
  if (now - at > MAX_AGE_MS) {
    return { ok: false, why: `印が古い（${mark.at}）。セッション鍵が無い環境なので8時間で切る` };
  }
  return { ok: true, why: `読んだ（${mark.at}・セッション鍵は無い環境）` };
}
