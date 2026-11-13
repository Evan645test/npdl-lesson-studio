import indicators from '../data/indicators.json';
import curriculum from '../data/curriculum.json';
import type { CourseInput } from '../domain/types';

export type IndicatorEntry = typeof indicators.entries[number];
export type CurriculumEntry = typeof curriculum[number];

export function indicatorById(id: string): IndicatorEntry | undefined {
  return indicators.entries.find(item => item.id === id);
}

export function indicatorLabel(id: string): string {
  const item = indicatorById(id);
  return item ? `${item.dimension}／${item.name}` : id;
}

export function curriculumById(id: string): CurriculumEntry | undefined {
  return curriculum.find(item => item.id === id);
}

export function curriculumKind(kind: string): string {
  if (kind === 'learning_content') return '學習內容';
  if (kind === 'learning_performance') return '學習表現';
  return kind;
}

export function formatIndicatorList(ids: readonly string[]): string {
  return ids.map(indicatorLabel).join('、');
}

export function snapshotLines(input: CourseInput, snapshot: CourseInput): { draftSubject: string; snapshotSubject: string; draftCurriculum: string; snapshotCurriculum: string; draftIndicators: string; snapshotIndicators: string } {
  return {
    draftSubject: `輸入草稿學科：${input.subject}`,
    snapshotSubject: `設計快照學科：${snapshot.subject}`,
    draftCurriculum: `輸入草稿課綱：${input.curriculumIds.length} 條`,
    snapshotCurriculum: `設計快照課綱：${snapshot.curriculumIds.length} 條`,
    draftIndicators: `輸入草稿子指標：${formatIndicatorList(input.indicatorIds)}`,
    snapshotIndicators: `設計快照子指標：${formatIndicatorList(snapshot.indicatorIds)}`,
  };
}

export { indicators, curriculum };
