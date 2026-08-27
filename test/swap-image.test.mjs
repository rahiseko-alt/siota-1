/**
 * swap-image.test.mjs — 画像の差し替えが、参照ごと入れ替わること
 *
 * マスター指示 2026-08-27「画像はすべて交換可能にしろ」の機械側。
 *
 * ここで押さえるのは、**手で差し替えるとつまずく2か所**:
 *   1. **拡張子が違う場合**。`.jpg` の置き場所に `.png` を渡したとき、
 *      名前は役割のまま・拡張子だけ新しいものに合わせること
 *   2. **参照が複数ある場合**。`photo-trim-action.jpg` は3か所から参照されている。
 *      1か所だけ書き換わると**片方だけ変わる**——`D-12` の「押せた ではなく届いた」と同じで、
 *      「置き換えた」ではなく「**全部の参照が新しいほうを指した**」で見る
 *
 * 実ファイルは触らない（`write: false`）。書き込みの成否ではなく**書き換える場所の数**を見る。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { nextFileName, rewriteReferences } from '../scripts/swap-image.mjs';
import { IMAGE_ROLES, REFERENCE_FILES } from '../scripts/lib/image-roles.mjs';

test('名前は役割のまま、拡張子だけ新しいほうに合わせる', () => {
  assert.equal(nextFileName('photo-trim-action.jpg', '/tmp/新しい写真.png'), 'photo-trim-action.png');
  assert.equal(nextFileName('nail-diagram.png', '/tmp/scan.JPG'), 'nail-diagram.jpg');
  assert.equal(nextFileName('teeth-diagram.jpg', '/tmp/a.jpeg'), 'teeth-diagram.jpg', 'jpeg は jpg に寄せる');
  assert.equal(nextFileName('app-icon.png', '/tmp/icon.png'), 'app-icon.png', '同じ種類なら名前は変わらない');
});

test('同じ拡張子なら、参照は1か所も書き換えない（無駄な差分を作らない）', () => {
  const touched = rewriteReferences(process.cwd(), 'app-icon.png', 'app-icon.png', { write: false });
  assert.equal(touched.length, 0);
});

test('拡張子が変わると、参照している画面が全部書き換わる', () => {
  const touched = rewriteReferences(process.cwd(), 'photo-trim-action.jpg', 'photo-trim-action.png', { write: false });
  assert.ok(touched.length > 0, 'どの画面も書き換えていない');
  assert.ok(touched.some((t) => t.startsWith('src/index.html')), 'ログイン画面を書き換えていない');
});

test('相対で書いてある参照も拾う（manifest.json は `assets/…`）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swap-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src/manifest.json'),
    JSON.stringify({ icons: [{ src: 'assets/app-icon.png' }, { src: 'assets/app-icon.png' }] }),
  );
  const touched = rewriteReferences(dir, 'app-icon.png', 'app-icon.webp');
  assert.deepEqual(touched, ['src/manifest.json（2か所）']);
  assert.ok(fs.readFileSync(path.join(dir, 'src/manifest.json'), 'utf8').includes('assets/app-icon.webp'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('台帳の画像は、いま実在する', () => {
  for (const role of IMAGE_ROLES) {
    const full = path.join(process.cwd(), 'src', 'assets', role.file);
    assert.ok(fs.existsSync(full), `台帳の ${role.id} が指す ${role.file} が無い`);
  }
});

test('台帳の役割は、どれも「誰が見るか」を書いている（差し替えの緊急度が決まらないため）', () => {
  for (const role of IMAGE_ROLES) {
    assert.ok(role.id && /^[a-z0-9-]+$/.test(role.id), `役割の名前は ASCII（D-9）: ${role.id}`);
    assert.ok(role.what.length > 0, `${role.id} に「どこに出るか」が無い`);
    assert.ok(role.seenBy.length > 0, `${role.id} に「誰が見るか」が無い`);
  }
});

test('参照を探す場所に、実在しないファイルを並べていない', () => {
  for (const rel of REFERENCE_FILES) {
    assert.ok(fs.existsSync(path.join(process.cwd(), rel)), `${rel} が無い`);
  }
});
