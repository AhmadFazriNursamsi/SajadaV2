/** Palet merek Sajada: hanya hijau #005641 dan emas #c8992b (dari logo); sisanya turunan keduanya. Merah hanya untuk status bahaya. */
export const C = {
  bg: '#f5f8f7', panel: '#ffffff', line: '#d1e1dd', ink: '#00271d', muted: '#2a5b4e', green: '#005641', side: '#005641',
  gold: '#c8992b', goldInk: '#644c16', ok: ['#e0ebe8', '#005641'], warn: ['#f1e4c8', '#644c16'], bad: ['#fbe9e5', '#a3321f'], neutral: ['#e8f0ee', '#00271d'],
} as const;
export type Tone = 'ok' | 'warn' | 'bad' | 'neutral';
