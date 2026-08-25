/**
 * dummy.js — UI だけを完成させるための仮データ
 *
 * **ここ以外からデータを取らない。** バックエンド（Supabase / Worker / API）は
 * 一切呼ばない。UI が単独で成立していることを、この1本で担保する。
 * 実データに繋ぐのは、UI が動線の確認を通ってから（第3段）。
 *
 * 写真は入れていない。出所が確認できている犬の写真が無く、実店舗の初日も
 * 写真は0枚だからである。空スロットのまま並ぶのが正しい姿。
 */
window.DUMMY = {
  staff: { name: '塩田', role: 'admin' },

  dogs: [
    {
      id: 'd1', name: 'ポンチ', owner: '塩田 様', breed: 'トイプードル',
      age: 4, weight: 2.79, prevWeight: 2.67,
      lastVisit: '2026.08.15', staff: '塩田', incomplete: '爪',
    },
    {
      id: 'd2', name: 'レオ', owner: '田中 様', breed: '柴犬',
      age: 7, weight: 9.4, prevWeight: 9.6,
      lastVisit: '2026.08.02', staff: '塩田', incomplete: '',
    },
    {
      id: 'd3', name: 'モカ', owner: '佐藤 様', breed: 'ミニチュアダックス',
      age: 2, weight: 4.1, prevWeight: 4.0,
      lastVisit: '2026.07.28', staff: '塩田', incomplete: '耳',
    },
    {
      id: 'd4', name: 'モモ', owner: '鈴木 様', breed: 'ポメラニアン',
      age: 9, weight: 3.2, prevWeight: 3.3,
      lastVisit: '2026.07.11', staff: '塩田', incomplete: '',
    },
    {
      id: 'd5', name: 'モモ', owner: '高橋 様', breed: 'マルチーズ',
      age: 1, weight: 2.4, prevWeight: 2.2,
      lastVisit: '2026.06.30', staff: '塩田', incomplete: '',
    },
  ],
};
