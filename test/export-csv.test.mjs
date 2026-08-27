/**
 * export-csv.test.mjs — CSV の作り方だけを見る（DB には触れない）
 *
 * **中身を取りに行く部分は検査しない。** それには実データと鍵が要る（`A-1`/`A-2`）。
 * ここで見るのは**壊れると黙って中身が変わる**ところ——引用符・カンマ・改行の扱いと、
 * Excel が日本語を読めるかどうか（BOM）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { csvCell, toCsv, EXPORTS } from '../scripts/export-csv.mjs';

test('カンマ・引用符・改行を含む値は、囲んで中の引用符を二重にする', () => {
  assert.equal(csvCell('ポンチ'), 'ポンチ');
  assert.equal(csvCell('しっぽ, 耳'), '"しっぽ, 耳"');
  assert.equal(csvCell('彼は"元気"でした'), '"彼は""元気""でした"');
  assert.equal(csvCell('1行目\n2行目'), '"1行目\n2行目"');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(0), '0');
});

test('オブジェクトは JSON にして1つのセルに入れる', () => {
  assert.equal(csvCell({ teeth: { status: 'ピカピカ✨' } }), '"{""teeth"":{""status"":""ピカピカ✨""}}"');
});

test('先頭に BOM が付く（無いと Excel で日本語が化ける）', () => {
  const csv = toCsv([], [['名前', (r) => r.name]]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
});

test('列の順は呼ぶ側が決める（行のキーの並びに依存しない）', () => {
  const rows = [{ b: '2', a: '1' }];
  const csv = toCsv(rows, [['A', (r) => r.a], ['B', (r) => r.b]]);
  assert.equal(csv, '﻿A,B\r\n1,2\r\n');
});

test('カルテの列は、飼い主に届く中身を拾っている', () => {
  const row = {
    id: 'r1',
    report_date: '2026-08-27',
    status: 'final',
    data: {
      staffNote: '耳を丁寧に洗いました',
      weights: [{ ym: '2026-08', kg: 3.42 }],
      teeth: { status: 'ピカピカ✨' },
      nail: { level: 2 },
    },
    pets: { name: 'ポンチ', owners: { name: '小瀬平' } },
  };
  const csv = toCsv([row], EXPORTS.reports.columns);
  const line = csv.split('\r\n')[1];
  for (const expected of ['2026-08-27', '確定', 'ポンチ', '小瀬平', '3.42', '2']) {
    assert.ok(line.includes(expected), `${expected} が CSV に出ていない: ${line}`);
  }
  assert.ok(line.includes('耳を丁寧に洗いました'), '担当からの一言が出ていない');
});

test('確定していないカルテは、状態がそのまま出る（確定と混ざらない）', () => {
  const csv = toCsv([{ status: 'draft' }], [['状態', (r) => (r.status === 'final' ? '確定' : r.status)]]);
  assert.ok(csv.includes('draft'));
  assert.ok(!csv.includes('確定'));
});
