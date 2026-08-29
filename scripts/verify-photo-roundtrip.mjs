/**
 * verify-photo-roundtrip.mjs — 撮った写真が、飼い主にそのまま届くか
 *
 * **「写真つき美容レポート」の核**（`F-20260827-44`）。裏側（`replaceDataUrlAssets` /
 * `uploadReportAssets` / `hydrateAssetReferences`）は前から在ったのに、
 * **入口が無かった**ので写真は1枚も届いていなかった。入口を作った以上、
 * 「入口が在る」ではなく **「入れたものが同じものとして届く」** を見る。
 *
 * **同じ色を2度測らない。** 入れる絵は Node 側で作った**単色の PNG**（枠ごとに違う色）で、
 * 受け取り側は**飼い主の画面に出ている img を canvas に描いて画素を読む**。
 * 左辺（入れた色）と右辺（届いた色）は別の場所から来る（`F-20260825-40` の教訓）。
 * 縮小で JPEG になるので、完全一致ではなく ±12 で見る。
 *
 * 見るもの:
 *   1〜3  入口が実在し、3か所に付く
 *   4     確定できる
 *   5     保存された中身が `asset://`（＝実体が上がっている。data: のままなら finalize が拒否する）
 *   6〜9  飼い主の画面で、表紙・ギャラリー枚数・耳・歯が**入れたとおり**
 *   10    壊れた画像（ページURL を指す img）が無い
 *   11〜12 **直し（revise）で写真が落ちない**——落とすと、届いていた写真が消える
 *
 *   npm run verify:photo
 */

import zlib from 'node:zlib';
import {
  startLocalWorker, injectSession, passwordLogin, FIXTURE, LOCAL_PASSWORD,
} from './lib/local-stack.mjs';
import { launchChromium } from './lib/chromium.mjs';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}\n`);
}

/* ── 単色 PNG を作る（依存を足さない） ── */
const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(Buffer.concat([Buffer.from(type, 'ascii'), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** `size`×`size` の単色 PNG。`色` は [r,g,b]。 */
function solidPng([r, g, b], size = 48) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   /* bit depth */
  ihdr[9] = 2;   /* color type: truecolor */
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; /* filter: none */
    for (let x = 0; x < size; x += 1) {
      raw[row + 1 + x * 3] = r;
      raw[row + 2 + x * 3] = g;
      raw[row + 3 + x * 3] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 枠ごとに違う色。**どれがどこへ行ったか**を色で見分ける。
    `teeth2` は口の写真2枚目（マスター指示 2026-08-29・C-11で複数枚に対応）。 */
const COLOR = {
  hero: [220, 40, 40],      /* 仕上がり1枚目 → 表紙 */
  gallery: [40, 160, 60],   /* 仕上がり2枚目 → ギャラリー */
  ear: [40, 60, 200],       /* 耳 */
  teeth: [230, 180, 30],    /* 歯（1枚目） */
  teeth2: [180, 90, 220],   /* 歯（2枚目） */
};

const file = (name, color) => ({ name, mimeType: 'image/png', buffer: solidPng(color) });

/** 画面に出ている img の中心の色を読む。**届いた側から測る。**

    **読み込みを待つ。** 待たずに `drawImage` すると、まだ絵の無い img からは
    透明（0,0,0）が返る——どの色を入れても不一致になり、**何を入れても落ちる検査**に
    なってしまう（恒真の裏返しで、同じくらい役に立たない）。 */
const pixelOf = (page, view) => page.evaluate(async (selector) => {
  const img = document.querySelector(`[data-view="${selector}"]`);
  if (!img || !img.getAttribute('src')) return null;
  if (!img.complete || img.naturalWidth === 0) {
    await new Promise((resolve) => {
      const done = () => resolve();
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
      setTimeout(done, 10_000);
    });
  }
  if (img.naturalWidth === 0) return 'まだ絵が入っていない';
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, 8, 8);
  const d = ctx.getImageData(4, 4, 1, 1).data;
  return [d[0], d[1], d[2]];
}, view);

const near = (got, want) => Array.isArray(got)
  && got.every((v, i) => Math.abs(v - want[i]) <= 12);

/** ギャラリー（`data-view` が付いた container の中の `img` 全部）の中心色を
    順番に読む。歯の写真が複数枚になった（C-11）ので、単一 img の `pixelOf` では
    2枚目を見られない。 */
const pixelsOfGallery = (page, view) => page.evaluate(async (selector) => {
  const imgs = [...document.querySelectorAll(`[data-view="${selector}"] img`)];
  const out = [];
  for (const img of imgs) {
    if (!img.complete || img.naturalWidth === 0) {
      await new Promise((resolve) => {
        const done = () => resolve();
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
        setTimeout(done, 10_000);
      });
    }
    if (img.naturalWidth === 0) { out.push('まだ絵が入っていない'); continue; }
    const canvas = document.createElement('canvas');
    canvas.width = 8; canvas.height = 8;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, 8, 8);
    const d = ctx.getImageData(4, 4, 1, 1).data;
    out.push([d[0], d[1], d[2]]);
  }
  return out;
}, view);

const PET_NAME = `写真犬${Math.random().toString(36).slice(2, 7)}`;
const { base: BASE, stop } = await startLocalWorker({ port: Number(process.env.PHOTO_PORT || 8798) });
let browser = null;

try {
  const staffSession = await passwordLogin(FIXTURE.staffEmail, LOCAL_PASSWORD);
  const authHeaders = { Authorization: `Bearer ${staffSession.access_token}`, 'Content-Type': 'application/json' };

  const petRes = await fetch(`${BASE}/api/owners/${FIXTURE.ownerAOwnerId}/pets`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ ownerId: FIXTURE.ownerAOwnerId, name: PET_NAME, template: 'ponchi' }),
  });
  const pet = (await petRes.json()).pet;
  if (!pet) throw new Error('検査用の犬を作れなかった');

  browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto(`${BASE}/my`);
  await injectSession(page, FIXTURE.staffEmail);
  await page.goto(`${BASE}/edit/p/${pet.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-3.is-active', { timeout: 20_000 });

  /* ── ①〜③ 入口が在り、実際に付く ── */
  for (const [kind, files] of [
    ['trimming', [file('finish-1.png', COLOR.hero), file('finish-2.png', COLOR.gallery)]],
    ['ear', [file('ear.png', COLOR.ear)]],
    /* 口の写真は最大2枚（マスター指示 2026-08-29・C-11）。 */
    ['teeth', [file('teeth-1.png', COLOR.teeth), file('teeth-2.png', COLOR.teeth2)]],
  ]) {
    const input = page.locator(`[data-field="photo-${kind}"]`);
    const exists = await input.count();
    await input.setInputFiles(files);
    /* **付いたことを、画面に出た枚数で見る。** 入力欄に値が入ったかではなく、
       縮小まで終わって控えに載ったかを見る（`onPhotoPick` は非同期）。 */
    await page.waitForFunction(
      ([k, n]) => document.querySelectorAll(`[data-photo-thumbs="${k}"] .photo-pick__thumb`).length === n,
      [kind, files.length],
      { timeout: 20_000 },
    ).catch(() => {});
    const thumbs = await page.locator(`[data-photo-thumbs="${kind}"] .photo-pick__thumb`).count();
    check(`${kind === 'trimming' ? '1' : kind === 'ear' ? '2' : '3'}. ${kind} の写真を付けられた`,
      exists === 1 && thumbs === files.length, `入力欄=${exists} 付いた枚数=${thumbs}`);
  }

  /* コースは必須（マスター指示 2026-08-29・C-9）。選ばないと確定できない。 */
  await page.selectOption('[data-field="course"]', 'トリミングコース');
  /* ── ④ 確定 ── */
  await Promise.all([
    page.waitForURL((u) => /^\/edit\/p\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 60_000 }),
    page.click('.dock-action-wrap .boxbutton'),
  ]);
  const reportId = new URL(page.url()).pathname.split('/').pop();
  check('4. 写真つきで確定できた', /^[0-9a-f-]{36}$/.test(reportId), `id=${reportId}`);

  /* ── ⑤ 実体が上がっている（data: のままなら finalize が拒否する） ──
     写真の枚数は 5（仕上がり2 + 耳1 + 歯2・マスター指示 2026-08-29・C-11）。 */
  const saved = await (await fetch(
    `${BASE}/api/pets/${pet.id}/reports/${reportId}`, { headers: authHeaders },
  )).json();
  const savedData = (saved.report || {}).data || {};
  const savedPhotos = [
    ...((savedData.trimming || {}).photos || []),
    (savedData.ear || {}).photo,
    ...((savedData.teeth || {}).photos || []),
  ].filter(Boolean);
  check('5. 保存された写真5枚が実体になっている（asset://）',
    savedPhotos.length === 5 && savedPhotos.every((v) => v.startsWith('asset://')),
    `${savedPhotos.length}件 / ${JSON.stringify(savedPhotos.map((v) => v.slice(0, 14)))}`);

  /* ── ⑥〜⑩ 飼い主の画面で、入れたとおりに出る ── */
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`${BASE}/my`);
  await injectSession(ownerPage, FIXTURE.ownerAEmail);
  await ownerPage.goto(`${BASE}/my/pets/${pet.id}/reports/${reportId}`, { waitUntil: 'networkidle' });
  await ownerPage.waitForSelector('.magazine-container', { timeout: 20_000 });

  const hero = await pixelOf(ownerPage, 'hero-photo');
  check('6. 飼い主: 表紙が、1枚目に入れた写真', near(hero, COLOR.hero), `色=${JSON.stringify(hero)}`);

  const gallery = await ownerPage.evaluate(
    () => document.querySelectorAll('[data-view="trimming-gallery"] img').length,
  );
  check('7. 飼い主: ギャラリーに2枚並ぶ', gallery === 2, `${gallery}枚`);

  const ear = await pixelOf(ownerPage, 'ear-image');
  check('8. 飼い主: 耳の写真が、耳の欄に', near(ear, COLOR.ear), `色=${JSON.stringify(ear)}`);

  /* 口の写真は2枚（C-11）。ギャラリーに順番どおり並ぶこと。 */
  const teethColors = await pixelsOfGallery(ownerPage, 'teeth-gallery');
  check('9. 飼い主: 歯の写真が2枚、歯の欄に順番どおり',
    teethColors.length === 2 && near(teethColors[0], COLOR.teeth) && near(teethColors[1], COLOR.teeth2),
    `${teethColors.length}枚 ${JSON.stringify(teethColors)}`);

  /* **`src=""` の img を数える。** 空文字はブラウザが**いま開いているページのURL**に
     解決するので、`img.src === location.href` で見分けられる。右辺を `/my/pets/` の
     ような文字列で書かず、**ブラウザ自身が解決した値**と突き合わせる。
     初回の実行でこれが 1件出た——拡大表示用の img に `src=""` が残っていた。 */
  const broken = await ownerPage.evaluate(
    () => [...document.querySelectorAll('img')]
      .filter((i) => i.src === location.href)
      .map((i) => i.getAttribute('data-view') || i.className || '(名前なし)'),
  );
  check('10. 飼い主: 壊れた画像（ページURL を指す img）が無い',
    broken.length === 0, broken.length ? `${broken.length}件 ${JSON.stringify(broken)}` : '');

  /* ── ⑪⑫ 直しても写真が落ちない ──
     `applyReport` が戻さなければ、次の確定で **届いていた写真が消える**。 */
  await page.goto(`${BASE}/edit/p/${pet.id}/${reportId}?revise=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#screen-3.is-active', { timeout: 20_000 });
  const keptThumbs = await page.locator('.photo-pick__thumb').count();
  check('11. 直しで開くと、付けた写真5枚が控えに残っている', keptThumbs === 5, `${keptThumbs}枚`);

  await page.fill('[data-field="staff-note"]', '写真はそのままで、文だけ直した。');
  await Promise.all([
    page.waitForURL((u) => /^\/edit\/p\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(u.pathname) && u.search === '', { timeout: 60_000 }),
    page.click('.dock-action-wrap .boxbutton'),
  ]);
  const afterRevise = await (await fetch(
    `${BASE}/api/pets/${pet.id}/reports/${reportId}`, { headers: authHeaders },
  )).json();
  const revisedData = (afterRevise.report || {}).data || {};
  const revisedPhotos = [
    ...((revisedData.trimming || {}).photos || []),
    (revisedData.ear || {}).photo,
    ...((revisedData.teeth || {}).photos || []),
  ].filter(Boolean);
  check('12. 直したあとも写真5枚が残っている', revisedPhotos.length === 5, `${revisedPhotos.length}件`);

  check('13. アプリ由来のエラーが無い', pageErrors.length === 0, pageErrors.join(' | '));
} catch (error) {
  check('検査を最後まで実行できた', false, error.message);
} finally {
  if (browser) await browser.close();
  await stop();
}

const passed = results.filter((r) => r.pass).length;
process.stdout.write(`\n${passed}/${results.length} PASS\n`);
process.stdout.write('撮った写真が、飼い主に同じものとして届くか（表紙・ギャラリー・耳・歯）。\n');
process.exit(passed === results.length ? 0 : 1);
