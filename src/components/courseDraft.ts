import type { CourseInput } from '../domain/types';

const fields = ['單元名稱', '學科', '年級', '節數', '學科問題', '學生起點', '原始來源', '課綱', '子指標', '教師註記'] as const;

export function courseDraftGap(input: CourseInput, snapshot: CourseInput): string[] {
  const differs = [
    input.title !== snapshot.title,
    input.subject !== snapshot.subject,
    input.grade !== snapshot.grade,
    input.periods !== snapshot.periods,
    input.topic !== snapshot.topic,
    JSON.stringify(input.startingPoint) !== JSON.stringify(snapshot.startingPoint),
    JSON.stringify(input.originalSource) !== JSON.stringify(snapshot.originalSource),
    JSON.stringify(input.curriculumIds) !== JSON.stringify(snapshot.curriculumIds),
    JSON.stringify(input.indicatorIds) !== JSON.stringify(snapshot.indicatorIds),
    (input.teacherNotes ?? '') !== (snapshot.teacherNotes ?? ''),
  ];
  return fields.filter((_, index) => differs[index]);
}

export function addCurriculumId(current: readonly string[], id: string): string[] {
  if (!id.trim()) throw new Error('請選擇一條課綱。');
  if (current.includes(id)) throw new Error('這條課綱已在輸入草稿。');
  if (current.length >= 12) throw new Error('輸入草稿最多 12 條課綱。請先移除再加入。');
  return [...current, id];
}

export function removeCurriculumId(current: readonly string[], id: string): string[] {
  return current.filter(item => item !== id);
}

export function addIndicatorId(current: readonly string[], id: string): string[] {
  if (!id.trim()) throw new Error('請選擇一項子指標。');
  if (current.includes(id)) throw new Error('這項子指標已在輸入草稿。');
  if (current.length >= 2) throw new Error('輸入草稿最多 2 項子指標。請先移除一項再更換。');
  return [...current, id];
}

export function removeIndicatorId(current: readonly string[], id: string): string[] {
  if (current.length <= 1) throw new Error('輸入草稿至少保留 1 項子指標。');
  if (!current.includes(id)) throw new Error('草稿中沒有這項子指標。');
  return current.filter(item => item !== id);
}

export function addAssumption(current: readonly string[], text: string): string[] {
  const next = text.trim();
  if (!next) throw new Error('起點假設不可空白。');
  if (next.length > 20000) throw new Error('起點假設超過長度上限。');
  if (current.length >= 20) throw new Error('起點假設最多 20 則。');
  if (current.includes(next)) throw new Error('這則假設已經在草稿中。');
  return [...current, next];
}

export function removeAssumption(current: readonly string[], index: number): string[] {
  if (!Number.isInteger(index) || index < 0 || index >= current.length) throw new Error('找不到這則假設。');
  return current.filter((_, itemIndex) => itemIndex !== index);
}

export { reviseDesignContent } from '../domain/revisions';
