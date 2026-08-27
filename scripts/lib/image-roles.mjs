/**
 * image-roles.mjs — 製品に出る画像の**役割の台帳**
 *
 * **なぜ要るか**（マスター指示 2026-08-27「画像はすべて交換可能にしろ」）
 *   画像はどれも「あとで自分の写真に差し替える」もの。だが差し替えたい人から見ると、
 *   **どのファイルがどの画面のどこに出るのか**が分からない。ファイル名を見ても
 *   `body-marking.png` が犬体図の下絵だとは分からないし、`photo-trim-action.jpg` が
 *   **ログイン前の誰にでも見える**ことは、コードを読まないと分からない。
 *
 *   さらに、拡張子が罠になる。手元の写真が `.png` なのに置き場所が `.jpg` だと、
 *   同じ名前で置いても**別のファイルになる**。参照側も直さないと画面から消える。
 *
 * **だからこうする**: 役割に短い名前を付け、置き場所と「誰が見るか」をここに1か所で持つ。
 *   - 差し替えは `node scripts/swap-image.mjs <役割> <新しいファイル>` の1回
 *     （拡張子が違っても、参照側までまとめて書き換える）
 *   - `scripts/guard/image-inventory.mjs` が `npm run check` で台帳と実体を突き合わせる
 *     ので、**台帳だけが古くなることが無い**
 *
 * **ここに無い画像は「製品に出ない画像」**。置いてあるだけのものは
 * `docs/deferred.md` の登録側で扱う（`#5` の未参照ファイル）。
 */

/**
 * `id` は役割の名前（ASCII・`D-9`）。`file` は `src/assets/` 内の実体。
 * `seenBy` は**誰の目に触れるか**——差し替えの緊急度はここで決まる。
 */
export const IMAGE_ROLES = [
  {
    id: 'login-photo',
    file: 'photo-trim-action.jpg',
    what: 'ログイン画面の「トリミング風景」と、⑤カルテのギャラリー1枚目',
    seenBy: '**ログインしていない誰でも** ＋ 飼い主',
    note: 'このリポジトリで最も露出が高い1枚',
  },
  {
    id: 'app-icon',
    file: 'app-icon.png',
    what: 'ホーム画面に追加したときのアイコン／ブラウザのタブのアイコン（3画面すべて）',
    seenBy: 'トリマー・飼い主・管理者',
    note: '`manifest.json` からも参照される',
  },
  {
    id: 'nail-diagram',
    file: 'nail-diagram.png',
    what: '④カルテ作成「② 爪のチェック」の基準図',
    seenBy: 'トリマー',
    note: '血管の位置を見て3段階を判定する図。**画質を落とさない**（`D-20260827-47`）',
  },
  {
    id: 'teeth-diagram',
    file: 'teeth-diagram.jpg',
    what: '④カルテ作成「④ 口・歯のチェック」の頭骨解剖図',
    seenBy: 'トリマー',
    note: '',
  },
  {
    id: 'body-marking',
    file: 'body-marking.png',
    what: '犬体図（手描きで印を付ける下絵）',
    seenBy: 'トリマー ＋ 印が飼い主に届く',
    note: '**絵が変わると、過去に付けた印の位置の意味が変わる**——差し替えるなら同じ構図で',
  },
];

/** 参照を探す場所。**画像を書いてよいのはここだけ**という宣言でもある。 */
export const REFERENCE_FILES = [
  'src/index.html',
  'src/my.html',
  'src/admin.html',
  'src/manifest.json',
];

export function roleById(id) {
  return IMAGE_ROLES.find((role) => role.id === id) || null;
}
