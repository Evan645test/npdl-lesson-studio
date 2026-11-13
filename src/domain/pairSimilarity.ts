import type { Item } from './types';

// 只提示教師核對，不拒收：同主題情境本來就會共用字詞，是否算「新情境」由教師判斷。
export const HIGH_SIMILARITY = 0.6;

function bigrams(text: string): Map<string, number> {
  const clean = text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}\d]+/gu, '');
  const counts = new Map<string, number>();
  for (let i = 0; i < clean.length - 1; i++) { const gram = clean.slice(i, i + 2); counts.set(gram, (counts.get(gram) ?? 0) + 1); }
  return counts;
}

export function textSimilarity(a: string, b: string): number {
  const left = bigrams(a), right = bigrams(b);
  let total = 0, shared = 0;
  for (const count of left.values()) total += count;
  for (const count of right.values()) total += count;
  if (!total) return 0;
  for (const [gram, count] of left) shared += Math.min(count, right.get(gram) ?? 0);
  return (2 * shared) / total;
}

export interface PairSimilarity { context: number; data: number; prompt: number; high: boolean }

export function pairSimilarity(before: Pick<Item, 'context' | 'data' | 'prompt'>, after: Pick<Item, 'context' | 'data' | 'prompt'>): PairSimilarity {
  const context = textSimilarity(before.context, after.context), data = textSimilarity(before.data, after.data), prompt = textSimilarity(before.prompt, after.prompt);
  return { context, data, prompt, high: context >= HIGH_SIMILARITY || data >= HIGH_SIMILARITY };
}

// 新題有多少比例的字元二元組出現在舊題片段中；片段很長也不會稀釋（Dice 會）。
export function containment(text: string, source: string): number {
  const left = bigrams(text), right = bigrams(source);
  let total = 0, shared = 0;
  for (const [gram, count] of left) { total += count; shared += Math.min(count, right.get(gram) ?? 0); }
  return total ? shared / total : 0;
}
// R12：生成題目與教師貼上的舊前測逐段比較，只提示教師核對是否沿用了舊題。
// 先依空行或題號切段；過長片段再以 400 字、間隔 200 字的視窗切開，避免整份題本成為單一片段。
export function referenceChunks(reference: string): string[] {
  const parts = reference.split(/\n\s*\n|\n(?=\s*(?:第\s*)?(?:\d+|[一二三四五六七八九十]+|[QqＱ]\s*\d+)\s*(?:題)?[.、．:：)）\s])/).map(text => text.trim()).filter(text => text.length >= 10);
  return parts.flatMap(part => part.length <= 600 ? [part] : Array.from({ length: Math.ceil((part.length - 200) / 200) }, (_, i) => part.slice(i * 200, i * 200 + 400)));
}
export function referenceOverlaps(items: Array<Pick<Item, 'id' | 'context' | 'data' | 'prompt'>>, reference: string): Array<{ id: string; similarity: number }> {
  const chunks = referenceChunks(reference);
  if (!chunks.length) return [];
  return items.map(item => ({ id: item.id, similarity: Math.max(...chunks.map(chunk => containment(`${item.context}${item.data}${item.prompt}`, chunk))) })).filter(row => row.similarity >= HIGH_SIMILARITY);
}
export function similarityNotice(result: PairSimilarity): string | null {
  if (!result.high) return null;
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  return `前後測高度相似（情境 ${percent(result.context)}、資料 ${percent(result.data)}）。請確認後測不是只換人名、數字或用詞；若是，請單題重生後測。`;
}
