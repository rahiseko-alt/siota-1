/**
 * export-csv.mjs — 中身を CSV で取り出す（**製品の機能ではない**）
 *
 * **なぜ「機能として付けない」のか**（マスター指示・2026-08-27）
 *   バックアップ／書き出しは見積もりに入っていない。だから画面にボタンは作らない。
 *   ただし「あとで CSV に出せる」ことだけは、いま用意しておく——
 *   カルテは何年も積み上がり、**作り直せない**（`D-20260827-46`）。
 *   クライアントの意向は「納品後、使いながら考える」。そのとき**ゼロから作らずに済む**ようにしておく。
 *
 * **鍵は受け取らない**（`A-1`）。実行する人が環境変数で渡す。AI はこの命令を実行しない。
 *
 * **中身は標準出力に出す。** ファイルを勝手に作らない——実顧客の情報を
 * リポジトリの中に落とさないため（`A-2`）。置き場所は実行する人が決める。
 *
 *   SUPABASE_URL=https://xxxx.supabase.co \
 *   SUPABASE_SECRET_KEY=sb_secret_xxx \
 *   node scripts/export-csv.mjs owners > owners.csv
 *
 *   取り出せるもの: owners（飼い主）/ pets（犬）/ reports（カルテ）
 *
 * **Excel で開くことを前提にしている。** 先頭に BOM を付けないと、日本語が化ける。
 */

/** CSV の1つの値。**引用符・カンマ・改行を含む値は囲んで、中の引用符は二重にする。** */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

/**
 * 行の配列を CSV にする。
 *
 * `columns` は `[見出し, 取り出し方]` の並び。**見出しの順＝列の順**で、
 * 呼ぶ側が決める（行のキーの並び順に依存しない——DB の列順が変わっても崩れない）。
 *
 * 先頭の `﻿` は BOM。**これが無いと Excel が UTF-8 と気づかず日本語が化ける。**
 */
export function toCsv(rows, columns) {
  const head = columns.map(([label]) => csvCell(label)).join(',');
  const body = rows.map(
    (row) => columns.map(([, pick]) => csvCell(pick(row))).join(','),
  );
  return `﻿${[head, ...body].join('\r\n')}\r\n`;
}

/** 取り出せるもの。**PostgREST の埋め込み**で名前も一緒に取る（id だけでは読めない）。 */
export const EXPORTS = {
  owners: {
    path: 'owners?select=id,name,active,created_at&order=created_at.asc',
    columns: [
      ['飼い主ID', (r) => r.id],
      ['名前', (r) => r.name],
      ['有効', (r) => (r.active ? 'はい' : 'いいえ')],
      ['登録日', (r) => r.created_at],
    ],
  },
  pets: {
    path: 'pets?select=id,name,template,active,created_at,owners(name)&order=created_at.asc',
    columns: [
      ['犬ID', (r) => r.id],
      ['犬の名前', (r) => r.name],
      ['飼い主', (r) => (r.owners || {}).name],
      ['ひな型', (r) => r.template],
      ['有効', (r) => (r.active ? 'はい' : 'いいえ')],
      ['登録日', (r) => r.created_at],
    ],
  },
  reports: {
    path: 'reports?select=id,report_date,status,created_at,data,pets(name,owners(name))&order=report_date.asc',
    columns: [
      ['カルテID', (r) => r.id],
      ['施術日', (r) => r.report_date],
      ['状態', (r) => (r.status === 'final' ? '確定' : r.status)],
      ['犬の名前', (r) => (r.pets || {}).name],
      ['飼い主', (r) => ((r.pets || {}).owners || {}).name],
      ['担当からの一言', (r) => (r.data || {}).staffNote],
      ['体重kg', (r) => (((r.data || {}).weights || [])[0] || {}).kg],
      ['歯', (r) => ((r.data || {}).teeth || {}).status],
      ['爪レベル', (r) => ((r.data || {}).nail || {}).level],
      /* **写真は出ない。** 中身は `asset://{id}` の参照で、実体は Storage に在る。
         写真まで持ち出すなら別の手順が要る——ここでは触れない（`deferred` #35）。 */
      ['中身すべて（JSON）', (r) => r.data],
    ],
  },
};

/** 実行された場合だけ動く。**import しただけでは何もしない**（テストから読めるように）。 */
async function main(argv) {
  const what = argv[2];
  const spec = EXPORTS[what];
  if (!spec) {
    process.stderr.write(
      `取り出せるもの: ${Object.keys(EXPORTS).join(' / ')}\n`
      + '  SUPABASE_URL=… SUPABASE_SECRET_KEY=… node scripts/export-csv.mjs owners > owners.csv\n',
    );
    process.exit(1);
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    /* **鍵をここに書かない。** 実行する人が渡す（`A-1`）。 */
    process.stderr.write('SUPABASE_URL と SUPABASE_SECRET_KEY を環境変数で渡してください。\n');
    process.exit(1);
  }
  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${spec.path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    process.stderr.write(`取り出せませんでした（HTTP ${res.status}）。鍵と URL を確かめてください。\n`);
    process.exit(1);
  }
  process.stdout.write(toCsv(await res.json(), spec.columns));
}

if (process.argv[1] && process.argv[1].endsWith('export-csv.mjs')) await main(process.argv);
