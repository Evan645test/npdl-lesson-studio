// 完整教案分批產生（2026-11-07）：超過 4 節時每批最多 4 節，第 1 批另產生單元層級內容，最後由程式合併。
import { describe, expect, it } from 'vitest';
import { fullFixture } from './fullFixture.test-helper';
import { combineFullBatches, isBatchedFull, lessonBatches, mergeFullDesign, periodPlan } from './fullDesign';
import { batchOf, buildFullBatchPlan, singleToIntake, validateFullBatch, validateSingleResult } from './singlePath';
import { addIntakeProject } from './intake';
import { summarizePayload } from './requestSummary';
import { isFlowPlan } from '../services/consentMemory';

function tenPeriods() {
  const { seed, approved, response } = fullFixture();
  const core = approved.activities;
  const draft = { ...approved, periods: '10', activities: [{ ...core[0], periods: 3 }, { ...core[1], periods: 4 }, { ...core[2], periods: 3 }] };
  const lessons = periodPlan(draft).map(row => ({ ...response.activities[0], id: `lesson-${row.period}`, name: `第 ${row.period} 節`, periods: 1, coreActivityId: row.coreActivityId }));
  const { activities: _a, ...shared } = response; void _a;
  const parts = [{ ...shared, activities: lessons.slice(0, 4) }, { activities: lessons.slice(4, 8) }, { activities: lessons.slice(8) }];
  return { seed, draft, parts };
}

describe('完整教案分批產生', () => {
  it('超過 4 節才分批；10 節分成第 1–4、5–8、9–10 節三批', () => {
    const { draft } = tenPeriods();
    expect(isBatchedFull(draft)).toBe(true); expect(isBatchedFull({ ...draft, periods: '4' })).toBe(false);
    expect(lessonBatches(draft).map(b => [b.from, b.to])).toEqual([[1, 4], [5, 8], [9, 10]]);
    expect(periodPlan(draft).map(row => row.coreActivityId)).toEqual(['core-1', 'core-1', 'core-1', 'core-2', 'core-2', 'core-2', 'core-2', 'core-3', 'core-3', 'core-3']);
  });
  it('第 1 批產生單元層級內容與 4 節；之後各批只要 activities，附前面節次摘要；都沿用流程同意', () => {
    const { draft, parts } = tenPeriods();
    const first = buildFullBatchPlan(draft, 1, []);
    const schema = first.payload.outputSchema as { required: string[]; properties: { activities: { minItems: number; maxItems: number } } };
    expect(schema.required).toContain('blueprint');
    // R31：配對依規準分組，每個規準 2–3 組由結構保證。
    const grouped = (schema.properties as unknown as Record<string, { required: string[]; properties: Record<string, unknown> }>).blueprint;
    expect(grouped).toMatchObject({ type: 'object', additionalProperties: false });
    for (const key of grouped.required) expect(grouped.properties[key]).toMatchObject({ type: 'array', minItems: 2, maxItems: 3 }); expect(schema.properties.activities.minItems).toBe(4); expect(schema.properties.activities.maxItems).toBe(4);
    expect(first.instructions).toContain('分 3 批產生。這是第 1 批'); expect(isFlowPlan(first)).toBe(true);
    expect(summarizePayload(first.payload).join()).toContain('分 3 批');
    const second = buildFullBatchPlan(draft, 2, parts.slice(0, 1));
    expect((second.payload.outputSchema as { required: string[] }).required).toEqual(['activities']);
    expect(second.payload.earlierLessons).toHaveLength(4); expect(batchOf(second)).toMatchObject({ index: 2, from: 5, to: 8 });
    expect(second.payload.task).toBe('complete-lesson-design');
  });
  it('每批先檢查節數、periods、coreActivityId 與欄位；合併後通過完整教案檢查並可建立專案', () => {
    const { seed, draft, parts } = tenPeriods();
    const batches = lessonBatches(draft);
    validateFullBatch(draft, batches[0], parts[0], []);
    expect(() => validateFullBatch(draft, batches[0], { ...parts[0], activities: parts[0].activities.slice(0, 3) }, [])).toThrow('剛好 4 節');
    expect(() => validateFullBatch(draft, batches[1], { activities: parts[1].activities.map(row => ({ ...row, coreActivityId: 'core-3' })) }, parts.slice(0, 1))).toThrow('第 5 節的 coreActivityId 要是 core-2');
    expect(() => validateFullBatch(draft, batches[1], { ...parts[1], summary: '多的' }, parts.slice(0, 1))).toThrow('只回傳 activities');
    validateFullBatch(draft, batches[1], parts[1], parts.slice(0, 1));
    validateFullBatch(draft, batches[2], parts[2], parts.slice(0, 2));
    const combined = combineFullBatches(parts);
    expect((combined.activities as { id: string }[]).map(row => row.id)).toEqual(Array.from({ length: 10 }, (_, i) => `period-${i + 1}`));
    expect(() => validateSingleResult(draft, 'full', combined)).not.toThrow();
    const next = addIntakeProject(seed, singleToIntake(draft), mergeFullDesign(draft, combined));
    expect(next.projects.find(row => row.id === next.activeProjectId)!.designs[0].activities).toHaveLength(10);
  });
});
