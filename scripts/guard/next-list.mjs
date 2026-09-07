/**
 * next-list.mjs — 「次の一手」（`docs/ops/plan.md`）の形を1か所に決める
 *
 * マスター指示（2026-09-06）:「大計画通りに進めろ。毎回そうしろ。**毎回そうする仕組みに変えろ**」。
 *
 * **読ませる仕組みは既に在った**（`plan-read-mark.mjs` / `plan-read.mjs`）。
 * だが「読んだ」と「その通りに進めた」は別物で、実際に **大計画を読んだ直後の
 * セッションが「どれから着手しますか」とマスターに訊いた**（2026-09-06・実測）。
 * 大計画に次の一手が書いてあるのに、選ばせていた。`F-20260906-67` と同じ型
 * （関所は在るが、見ている対象が本物と違う）。
 *
 * そこで**やる順番そのものを機械が持つ**。
 *
 *   1. `docs/ops/plan.md` の「次の一手」に `- [ ] N-1 …` を上から順に並べる
 *   2. `checkin.mjs` が**いちばん上の未了1件を自動で割り当て**、`.plan-doing` に印を書く
 *   3. `plan-next.mjs`（`npm run check` の2本目）が印を見る。無ければ EXIT 1
 *   4. `checkout.mjs` の項目9が、**割り当てられた1件が片づいたか**を見る
 *
 * 印の形（`.plan-doing`・`.gitignore` 済み・作業用）:
 *
 *   {"at":"2026-09-06T…","session":"…","id":"N-1","text":"…"}
 *
 * **既に在れば上書きしない**（`F-20260830-62`）。`checkin.mjs` はセッション開始の
 * 1回だけでなく、会話の圧縮・再開のたびに何度も呼ばれる。途中で上書きすると
 * 「割り当てたもの」と「片づけたか」の比較がずれる。
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sessionKey, MAX_AGE_MS } from './plan-read-mark.mjs';

export { ROOT, sessionKey };

export const DOING_PATH = path.join(ROOT, '.plan-doing');
export const PLAN = 'docs/ops/plan.md';

/** 「次の一手」の1行。`- [ ] N-1 …` ／ 済み `[x]` ／ やらない `[-]`（理由必須）。 */
const ITEM_RE = /^- \[([ x-])\] (N-\d+)\s+(.+?)\s*$/;

/** 節の見出し。ここから次の `## ` までを見る。 */
const HEADING_RE = /^##\s+次の一手/m;

/**
 * 「次の一手」を上から順に取り出す。節が無ければ `null`
 * （「0件」と区別する——節ごと消して緑にする手口を通さないため・`偽-2`）。
 */
export function parseNextList(planText) {
  const start = planText.search(HEADING_RE);
  if (start === -1) return null;
  const rest = planText.slice(start);
  const end = rest.slice(1).search(/^##\s/m);
  const body = end === -1 ? rest : rest.slice(0, end + 1);
  const items = [];
  for (const line of body.split('\n')) {
    const m = line.match(ITEM_RE);
    if (!m) continue;
    const [, mark, id, text] = m;
    items.push({
      id,
      text,
      done: mark === 'x',
      dropped: mark === '-',
      /** やらないと決めた行は、同じ行に理由が要る（記録だけして消える、を防ぐ）。 */
      reason: mark === '-' ? /理由\s*:/.test(text) : true,
    });
  }
  return items;
}

/** いちばん上の未了（`[ ]`）。無ければ `null`。 */
export function topOpen(items) {
  return (items || []).find((i) => !i.done && !i.dropped) || null;
}

/**
 * このセッションに1件を割り当てる。
 *
 * **これまでに割り当てた番号を `ids` に積む。** 割り当ては途中で動く——
 * ①その1件が片づいたとき ②**マスター指示が上に割り込んだとき**（`D-21` の優先度）。
 * 動いた後も「このセッションが何を持たされたか」を全部残しておかないと、
 * 項目9（片づけたか）が**直前の1件しか見られず**、片づけた実績を落とす。
 */
export function writeDoingMark(item, env = process.env, previous = null) {
  const ids = [...new Set([...(previous && previous.ids ? previous.ids : []), item.id])];
  const mark = {
    at: new Date().toISOString(), session: sessionKey(env), id: item.id, text: item.text, ids,
  };
  fs.writeFileSync(DOING_PATH, `${JSON.stringify(mark)}\n`);
  return mark;
}

/** 印が持っている番号の全部（古い形の印にも耐える）。 */
export function markIds(mark) {
  if (!mark) return [];
  return Array.isArray(mark.ids) && mark.ids.length > 0 ? mark.ids : [mark.id];
}

export function readDoingMark(raw) {
  const text = raw ?? (fs.existsSync(DOING_PATH) ? fs.readFileSync(DOING_PATH, 'utf8') : null);
  if (text === null) return null;
  try {
    const mark = JSON.parse(text);
    return mark && typeof mark === 'object' && mark.id ? mark : null;
  } catch { return null; }
}

/**
 * 印を判定する。**このセッションのものか**と、**指す番号が実在するか**の2つだけ。
 *
 * 「いちばん上か」はここでは見ない。割り当ては `checkin.mjs` が機械でやるので
 * ずれようが無く、逆に途中で割り込み（マスター指示）が上に足された瞬間に
 * **直しようのない赤**になる（印は上書きしない造りだから）。それは強制ではなく故障。
 */
export function judgeDoingMark(mark, items, { env = process.env, now = Date.now() } = {}) {
  if (items === null) return { ok: false, why: `${PLAN} に「次の一手」の節が無い` };
  if (topOpen(items) === null && !mark) {
    return { ok: true, why: '未了の一手が0件（次にやることを足すこと）' };
  }
  if (!mark) return { ok: false, why: 'このセッションがどの一手をやるか、まだ割り当てられていない' };
  if (!items.some((i) => i.id === mark.id)) {
    return { ok: false, why: `印が指す ${mark.id} が「次の一手」に無い（番号を消したか、書き換えた）` };
  }
  const key = sessionKey(env);
  if (key) {
    if (mark.session !== key) return { ok: false, why: '別のセッションが残した印' };
    return { ok: true, why: `${mark.id} ${mark.text}` };
  }
  const at = Date.parse(mark.at || '');
  if (!Number.isFinite(at)) return { ok: false, why: '印の時刻が読めない' };
  if (now - at > MAX_AGE_MS) {
    return { ok: false, why: `印が古い（${mark.at}）。セッション鍵が無い環境なので8時間で切る` };
  }
  return { ok: true, why: `${mark.id} ${mark.text}（セッション鍵は無い環境）` };
}

/**
 * `checkout.mjs` 項目9 — このセッションが持たされた一手を片づけたか。
 *
 * **見るのは「1件でも閉じたか」**。割り当ては途中で動く（上の `writeDoingMark`）ので、
 * 「いま持っている1件」だけを見ると、**閉じた直後に次を割り当てられた回が必ず赤**になり、
 * 閉じても閉じても終われない罠になる。持たされた番号のどれか1つが閉じていればよい。
 */
export function judgeDoingClosed(mark, items) {
  if (!mark) return { ok: false, why: '割り当ての印（.plan-doing）が無い（checkin.mjs を通していない）' };
  if (items === null) return { ok: false, why: `${PLAN} に「次の一手」の節が無い` };
  const ids = markIds(mark);
  const missing = ids.filter((id) => !items.some((i) => i.id === id));
  if (missing.length === ids.length) {
    return { ok: false, why: `${missing.join(' / ')} が「次の一手」から消えている（行ごと消して片づけない）` };
  }
  const closed = items.filter((i) => ids.includes(i.id) && (i.done || (i.dropped && i.reason)));
  if (closed.length > 0) {
    return { ok: true, why: closed.map((i) => `${i.id} ${i.text}`).join('\n      ') };
  }
  const bad = items.find((i) => ids.includes(i.id) && i.dropped && !i.reason);
  if (bad) return { ok: false, why: `${bad.id} を [-] にしたが、同じ行に「理由:」が無い` };
  const open = items.filter((i) => ids.includes(i.id));
  return {
    ok: false,
    why: `${open.map((i) => `${i.id} ${i.text}`).join(' / ')} がまだ [ ] のまま\n`
      + '      片づいたなら [x]、やらないと決めたなら [-] にして同じ行に「理由:」を書くこと。',
  };
}
