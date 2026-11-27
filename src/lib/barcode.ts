// Code 39 barcode encoding. It is the format a plain office barcode scanner reads by
// default, and it only needs digits, capitals and a few symbols, which is exactly what
// a challan number uses. Each character is nine elements that alternate bar and space,
// and three of them are wide. A star marks the start and the end of the code.
const PATTERNS: Record<string, string> = {
  '0': '111331311', '1': '311311113', '2': '113311113', '3': '313311111', '4': '111331113',
  '5': '311331111', '6': '113331111', '7': '111311313', '8': '311311311', '9': '113311311',
  A: '311113113', B: '113113113', C: '313113111', D: '111133113', E: '311133111',
  F: '113133111', G: '111113313', H: '311113311', I: '113113311', J: '111133311',
  K: '311111133', L: '113111133', M: '313111131', N: '111131133', O: '311131131',
  P: '113131131', Q: '111111333', R: '311111331', S: '113111331', T: '111131331',
  U: '331111113', V: '133111113', W: '333111111', X: '131131113', Y: '331131111',
  Z: '133131111', '-': '131111313', '.': '331111311', ' ': '133111311', '$': '131313111',
  '/': '131311131', '+': '131113131', '%': '111313131', '*': '131131311',
};

const NARROW = 1;
const WIDE = 3;
const GAP = NARROW;

export type BarcodeShape = { bars: { x: number; width: number }[]; width: number; height: number };

// Anything Code 39 cannot represent becomes a dash rather than being dropped, so the
// printed bars always decode back to a value of the same shape as the label beneath.
export function sanitizeBarcodeValue(value: string): string {
  return (value ?? '')
    .toUpperCase()
    .split('')
    .map((character) => (PATTERNS[character] && character !== '*' ? character : '-'))
    .join('')
    .slice(0, 40);
}

export function code39Shape(value: string, module = 2, height = 64): BarcodeShape {
  const payload = sanitizeBarcodeValue(value);
  const full = `*${payload}*`;
  const bars: { x: number; width: number }[] = [];
  let cursor = 0;

  for (const character of full.split('')) {
    const pattern = PATTERNS[character] ?? PATTERNS['-'];
    pattern.split('').forEach((element, index) => {
      const width = (element === '3' ? WIDE : NARROW) * module;
      if (index % 2 === 0) bars.push({ x: cursor, width });
      cursor += width;
    });
    cursor += GAP * module;
  }

  return { bars, width: cursor, height };
}
