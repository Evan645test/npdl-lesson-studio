// 課綱候選清單（2026-11-07 使用者選「程式篩選加編號」）：推薦課程方向前，程式依教師填的主題、單元名稱、
// 關鍵字、構想、驅動問題與最終作品，從本學科固定課綱挑出最相關的條目，各給短編號（學習表現 P1、P2…，學習內容 C1、C2…）。
// AI 只回傳短編號，由程式對應回正式編號，不必抄長編號；篩選漏掉的條目，教師仍可在「查看並選擇課綱」自行補選。
import { curriculum } from '../components/labels';
import type { SingleDraft } from './singlePath';

export const SHORTLIST_LIMIT = { performance: 16, content: 15 } as const;
export interface ShortlistRow { no: string; id: string; code: string; text: string }
type Row = (typeof curriculum)[number];
type Source = Pick<SingleDraft, 'subject' | 'topic' | 'title' | 'keywords' | 'ideas' | 'drivingQuestion' | 'finalProduct'>;

const SCIENCE = ['化學', '物理', '生物', '地球科學'];
export function subjectRows(subject: string): Row[] {
  return curriculum.filter(row => row.subject === subject || SCIENCE.includes(subject) && row.subject === '自然科學');
}
// 中文沒有空白分詞：以連續兩字（bigram）比對相近程度，關鍵字完整出現時加重計分。
const clean = (text: string) => text.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '');
function bigrams(text: string): Set<string> {
  const t = clean(text), out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}
export function shortlistQuery(draft: Source): { keywords: string[]; grams: Set<string> } {
  const keywords = draft.keywords.split(/[、，,\n]+/).map(s => clean(s)).filter(s => s.length >= 2);
  const text = [draft.topic, draft.title, draft.keywords, ...Object.values(draft.ideas ?? {}), draft.drivingQuestion ?? '', draft.finalProduct ?? ''].join('');
  return { keywords, grams: bigrams(text) };
}
function score(row: Row, query: { keywords: string[]; grams: Set<string> }): number {
  const text = clean(`${row.code}${row.text}`);
  const hits = query.keywords.filter(word => text.includes(word)).length;
  let overlap = 0; for (const gram of bigrams(row.text)) if (query.grams.has(gram)) overlap++;
  return hits * 5 + overlap;
}
function pick(rows: Row[], query: ReturnType<typeof shortlistQuery>, limit: number, prefix: 'P' | 'C'): ShortlistRow[] {
  const ranked = rows.map((row, index) => ({ row, index, value: score(row, query) })).sort((a, b) => b.value - a.value || a.index - b.index).slice(0, limit);
  return ranked.map((item, at) => ({ no: `${prefix}${at + 1}`, id: item.row.id, code: item.row.code, text: item.row.text }));
}
export function curriculumShortlist(draft: Source): { performances: ShortlistRow[]; contents: ShortlistRow[] } {
  const rows = subjectRows(draft.subject), query = shortlistQuery(draft);
  return {
    performances: pick(rows.filter(row => row.kind === 'learning_performance'), query, SHORTLIST_LIMIT.performance, 'P'),
    contents: pick(rows.filter(row => row.kind !== 'learning_performance'), query, SHORTLIST_LIMIT.content, 'C'),
  };
}
// 短編號 → 正式編號。AI 可能寫成「P3」「p3」「P3. pa-Ⅴa-2」，只取開頭的短編號。
export function shortlistHandles(draft: Source): Map<string, string> {
  const list = curriculumShortlist(draft);
  return new Map([...list.performances, ...list.contents].map(row => [row.no, row.id]));
}
export function resolveHandle(item: unknown, handles?: Map<string, string>): unknown {
  if (!handles || typeof item !== 'string') return item;
  const match = item.trim().normalize('NFKC').match(/^([PC])\s*(\d+)(?!\d)/i);
  return match ? handles.get(`${match[1].toUpperCase()}${match[2]}`) ?? item : item;
}
