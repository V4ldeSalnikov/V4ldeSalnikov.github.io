export const MAX_MODELS = 3;
export const DEFAULT_MODELS = ['google/gemma-4-E4B-it', 'Qwen/Qwen3.5-4B'];
export const normalize = (text: string) => text.normalize('NFC').trim().replace(/\s+/gu, ' ');
export type Difference = { kind: 'equal' | 'insert' | 'delete'; text: string };

export function validModels(ids: string[], available: string[]) {
  return [...new Set(ids)].filter(id => available.includes(id)).slice(0, MAX_MODELS);
}

// Visual word alignment; benchmark CER/WER always come from the saved report.
export function wordDiff(reference: string, prediction: string): Difference[] {
  const a = normalize(reference).split(' ').filter(Boolean);
  const b = normalize(prediction).split(' ').filter(Boolean);
  const pieces: Difference[] = [];
  const add = (kind: Difference['kind'], tokens: string[]) => {
    if (tokens.length) pieces.push({ kind, text: tokens.join(' ') });
  };
  // Bound work for pathological repetition. A coarse alignment still preserves all words.
  if ((a.length + 1) * (b.length + 1) > 1_000_000) {
    let start = 0, end = 0;
    while (start < Math.min(a.length, b.length) && a[start] === b[start]) start++;
    while (end < Math.min(a.length, b.length) - start && a[a.length - end - 1] === b[b.length - end - 1]) end++;
    add('equal', a.slice(0, start));
    add('delete', a.slice(start, a.length - end));
    add('insert', b.slice(start, b.length - end));
    add('equal', end ? a.slice(-end) : []);
    return pieces;
  }
  const width = b.length + 1;
  const costs = new Uint32Array((a.length + 1) * width);
  for (let i = 0; i <= a.length; i++) costs[i * width] = i;
  for (let j = 0; j <= b.length; j++) costs[j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    costs[i * width + j] = Math.min(costs[(i - 1) * width + j] + 1, costs[i * width + j - 1] + 1,
      costs[(i - 1) * width + j - 1] + Number(a[i - 1] !== b[j - 1]));
  }
  let i = a.length, j = b.length;
  const reversed: Difference[] = [];
  while (i || j) {
    const value = costs[i * width + j];
    if (i && j && a[i - 1] === b[j - 1]) { reversed.push({ kind: 'equal', text: a[--i] }); j--; }
    else if (i && j && value === costs[(i - 1) * width + j - 1] + 1) {
      reversed.push({ kind: 'insert', text: b[--j] }, { kind: 'delete', text: a[--i] });
    } else if (i && value === costs[(i - 1) * width + j] + 1) reversed.push({ kind: 'delete', text: a[--i] });
    else reversed.push({ kind: 'insert', text: b[--j] });
  }
  for (const piece of reversed.reverse()) {
    const last = pieces.at(-1);
    if (last?.kind === piece.kind) last.text += ` ${piece.text}`;
    else pieces.push({ ...piece });
  }
  return pieces;
}
