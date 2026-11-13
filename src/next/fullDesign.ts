import type { RequestPlan } from '../services/generation';
// R12-r8：已確認的目標、四階規準與核心活動由程式保存並組回完整教案。
// AI 只回傳新內容（逐節教案、四要素、整合規則、前後測配對）和編號參照，不被要求逐字照抄已確認文字，
// 因此只檢查結構與參照，不比對文字。
import type { DesignContent } from '../domain/lifecycle';
import { generationSchema, validateDesignContent } from '../domain/validate';
import type { SingleDraft } from './singlePath';

interface SchemaNode { type?: string; enum?: string[]; properties?: Record<string, SchemaNode>; items?: SchemaNode; required?: string[]; [key: string]: unknown }
type Row = Record<string, unknown>;

export const goalId = (index: number) => `goal-${index + 1}`;
export const criterionId = (index: number) => `criterion-${index + 1}`;
export const coreActivityId = (index: number) => `core-${index + 1}`;
const PAIR_STATUS = '比較條件待確認';

// 送給 AI 的已確認內容附上固定編號，AI 只用編號參照。
export function approvedOutline(draft: SingleDraft) {
  return {
    goals: draft.goals.map((row, index) => ({ id: goalId(index), ...row })),
    // 逐句對應只留在教師端；AI 參考組好的四階規準即可。
    criteria: draft.criteria.map((row, index) => { const { alignment: _alignment, ...rest } = row; void _alignment; return { id: criterionId(index), ...rest }; }),
    activities: draft.activities.map((row, index) => ({ id: coreActivityId(index), ...row })),
  };
}

export function fullDesignSchema(draft: SingleDraft): SchemaNode {
  const schema = structuredClone(generationSchema('design')) as SchemaNode;
  const properties = schema.properties!;
  properties.goals = { type: 'array', minItems: draft.goals.length, maxItems: draft.goals.length, items: { type: 'object', additionalProperties: false, required: ['id', 'curriculumIds'], properties: { id: { type: 'string', enum: draft.goals.map((_, index) => goalId(index)) }, curriculumIds: { type: 'array', items: { type: 'string', enum: draft.curriculumIds } } } } };
  delete properties.criteria;
  schema.required = schema.required!.filter(key => key !== 'criteria');
  const activity = properties.activities.items!;
  activity.properties!.coreActivityId = { type: 'string', enum: draft.activities.map((_, index) => coreActivityId(index)) };
  activity.required!.push('coreActivityId');
  const pair = properties.blueprint.items!;
  delete pair.properties!.status;
  delete pair.properties!.criterionIds;
  // 題號由程式依序指定（pre-n／post-n），AI 只寫配對理由（2026-11-09 實跑 AI 把活動編號當題號重複使用）。
  delete pair.properties!.preId;
  delete pair.properties!.postId;
  pair.required = pair.required!.filter(key => !['status', 'criterionIds', 'preId', 'postId'].includes(key));
  // R31：前後測配對依規準編號分組，每個規準固定 2–3 組；由輸出結構保證，不靠事後檢查退回（2026-11-09 實跑常漏一個子指標）。
  const criterionIds = draft.criteria.map((_, index) => criterionId(index));
  properties.blueprint = { type: 'object', additionalProperties: false, required: criterionIds,
    properties: Object.fromEntries(criterionIds.map(id => [id, { type: 'array', minItems: 2, maxItems: 3, items: pair }])) };
  return schema;
}

const isRow = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);
const list = (value: unknown, name: string): Row[] => {
  if (!Array.isArray(value) || value.some(row => !isRow(row))) throw new Error(`完整教案的 ${name} 必須是物件陣列。`);
  return value as Row[];
};
const ids = (value: unknown): string[] => Array.isArray(value) && value.every(id => typeof id === 'string') ? value as string[] : [];
function within(value: unknown, allowed: string[], label: string, allowEmpty = false): void {
  if (!Array.isArray(value) || !allowEmpty && !value.length || value.some(id => typeof id !== 'string' || !allowed.includes(id))) throw new Error(`${label}${allowEmpty ? '' : '至少要有一個，且'}只能使用 ${allowed.join('、') || '（無）'}。`);
}

// R31（2026-11-09 使用者決定）：內容檢查標出未通過的段落，第二次只重做那一段，已通過的部分保留。
export const REPAIRABLE_SECTIONS = ['goals', 'activities', 'integration', 'blueprint'] as const;
export type RepairSection = typeof REPAIRABLE_SECTIONS[number];
export class SectionProblem extends Error {
  constructor(public readonly section: RepairSection, message: string) { super(message); }
}
export function inSection<T>(section: RepairSection, run: () => T): T {
  try { return run(); } catch (error) {
    if (error instanceof SectionProblem) throw error;
    throw new SectionProblem(section, error instanceof Error ? error.message : String(error));
  }
}
// 局部修正請求：沿用原請求的資料（已同意），只要求重新輸出未通過的段落。
export function sectionRepairPlan(plan: RequestPlan, section: RepairSection, problem: string, previous: unknown): RequestPlan {
  const schema = plan.payload.outputSchema as SchemaNode;
  const part = schema.properties?.[section];
  if (!part) throw new Error(`這次回應沒有 ${section} 段落可局部修正。`);
  return { ...plan, attempt: 0, payload: { ...plan.payload, outputSchema: { type: 'object', additionalProperties: false, required: [section], properties: { [section]: part } },
    sectionRepair: { section, problem: problem.slice(0, 1200), previous } },
    instructions: `${plan.instructions} 這是局部修正：上一份回應只有 ${section} 未通過檢查，原因見 sectionRepair.problem，原內容見 sectionRepair.previous。其他段落已通過並由程式保留，不要回傳；只依 outputSchema 重新輸出完整的 ${section}，修正這個問題，並維持與已確認目標、規準、核心活動的編號關係。` };
}
export function mergeSection(value: unknown, section: RepairSection, repaired: unknown): Row {
  if (!isRow(value) || !isRow(repaired) || Object.keys(repaired).join() !== section) throw new SectionProblem(section, `局部修正只能回傳 ${section}。`);
  return { ...value, [section]: repaired[section] };
}

// partial：分批產生時檢查前幾批，還沒產生的核心活動先不算漏掉。
export function mergeFullDesign(draft: SingleDraft, value: unknown, partial = false): DesignContent {
  if (!isRow(value)) throw new Error('完整教案回應格式不符。');
  const expected = Object.keys(fullDesignSchema(draft).properties!).sort();
  const extra = Object.keys(value).filter(key => !expected.includes(key) && key !== 'criteria');
  const missing = expected.filter(key => !(key in value));
  if (extra.length || missing.length) throw new Error(`完整教案欄位不符${missing.length ? `，缺少 ${missing.join('、')}` : ''}${extra.length ? `，多出 ${extra.join('、')}` : ''}。`);
  const goalIds = draft.goals.map((_, index) => goalId(index));
  const criterionIds = draft.criteria.map((_, index) => criterionId(index));
  const coreIds = draft.activities.map((_, index) => coreActivityId(index));

  const goalRefs = inSection('goals', () => {
    const rows = list(value.goals, 'goals');
    if (rows.length !== goalIds.length || goalIds.some(id => rows.filter(row => row.id === id).length !== 1)) throw new Error(`goals 要剛好各列一次 ${goalIds.join('、')}，只填 id 與 curriculumIds。`);
    rows.forEach(row => within(row.curriculumIds, draft.curriculumIds, `目標 ${String(row.id)} 的 curriculumIds `, true));
    return rows;
  });
  const goals = draft.goals.map((row, index) => ({ id: goalIds[index], kind: row.kind, text: row.text, success: row.success, curriculumIds: ids(goalRefs.find(ref => ref.id === goalIds[index])!.curriculumIds) }));
  const criteria = draft.criteria.map((row, index) => ({ id: criterionIds[index], indicatorId: row.indicatorId, label: row.label, observable: row.observable, scope: row.scope, unobserved: row.unobserved, stages: [...row.stages] as [string, string, string, string], ...(row.alignment ? { alignment: row.alignment.map(stage => [...stage]) } : {}) }));

  const lessons = inSection('activities', () => {
    const rows = list(value.activities, 'activities');
    rows.forEach((row, index) => {
      if (!coreIds.includes(row.coreActivityId as string)) throw new Error(`第 ${index + 1} 節的 coreActivityId 要是 ${coreIds.join('、')} 之一。`);
      within(row.goalIds, goalIds, `第 ${index + 1} 節的 goalIds `);
      within(row.criterionIds, criterionIds, `第 ${index + 1} 節的 criterionIds `);
    });
    const uncovered = coreIds.filter(id => !rows.some(row => row.coreActivityId === id));
    if (uncovered.length && !partial) throw new Error(`核心活動 ${uncovered.join('、')} 沒有對應到任何一節，每個核心活動至少要有一節。`);
    return rows;
  });
  const activities = lessons.map(row => { const { coreActivityId: _core, ...rest } = row; void _core; return rest; });

  inSection('integration', () => list(value.integration, 'integration').forEach(row => {
    if (!draft.indicatorIds.includes(row.indicatorId as string)) throw new Error(`integration 的 indicatorId 只能是 ${draft.indicatorIds.join('、')}。`);
    within(row.criterionIds, criterionIds.filter((_, index) => draft.criteria[index].indicatorId === row.indicatorId), `整合規則 ${String(row.indicatorId)} 的 criterionIds `);
  }));
  const blueprint = inSection('blueprint', () => {
    if (!isRow(value.blueprint)) throw new Error('完整教案的 blueprint 須依規準編號分組。');
    const grouped = value.blueprint;
    const strayKeys = Object.keys(grouped).filter(key => !criterionIds.includes(key));
    if (strayKeys.length) throw new Error(`前後測配對的規準編號只能使用 ${criterionIds.join('、')}。`);
    return criterionIds.flatMap(id => {
      const rows = list(grouped[id] ?? [], `blueprint.${id}`);
      if (rows.length < 2 || rows.length > 3) throw new Error(`規準 ${id} 需有 2–3 組前後測配對，收到 ${rows.length} 組。`);
      return rows.map(row => ({ criterionIds: [id], status: PAIR_STATUS, reason: row.reason }));
    }).map((row, index) => ({ preId: `pre-${index + 1}`, postId: `post-${index + 1}`, ...row }));
  });

  const content = { summary: value.summary, rubricSource: value.rubricSource, goals, criteria, activities, elements: value.elements, integration: value.integration, blueprint };
  if (!partial) validateDesignContent(content);
  return content as unknown as DesignContent;
}

// 完整教案分批產生（2026-11-07 使用者決定）：超過 LESSON_BATCH 節時，每批最多 LESSON_BATCH 節，
// 第 1 批同時產生單元摘要、四要素、整合規則與前後測配對；之後各批只產生該批的逐節教案，最後由程式合併。
export const LESSON_BATCH = 4;
export interface LessonBatch { index: number; total: number; from: number; to: number }
export function lessonBatches(draft: SingleDraft): LessonBatch[] {
  const periods = Number(draft.periods), total = Math.ceil(periods / LESSON_BATCH);
  return Array.from({ length: total }, (_, k) => ({ index: k + 1, total, from: k * LESSON_BATCH + 1, to: Math.min(periods, (k + 1) * LESSON_BATCH) }));
}
export const isBatchedFull = (draft: SingleDraft) => Number(draft.periods) > LESSON_BATCH;
// 每一節屬於哪個核心活動（依教師確認的核心活動節數順序），各批共用，避免核心活動被漏掉或重複。
export function periodPlan(draft: SingleDraft): { period: number; coreActivityId: string; coreName: string }[] {
  return draft.activities.flatMap((row, index) => Array.from({ length: row.periods }, () => ({ coreActivityId: coreActivityId(index), coreName: row.name }))).map((row, index) => ({ period: index + 1, ...row }));
}
export function batchSchema(draft: SingleDraft, batch: LessonBatch): SchemaNode {
  const full = fullDesignSchema(draft), count = batch.to - batch.from + 1;
  const activities = { ...full.properties!.activities, minItems: count, maxItems: count };
  if (batch.index === 1) return { ...full, properties: { ...full.properties, activities } };
  return { type: 'object', additionalProperties: false, required: ['activities'], properties: { activities } };
}
export function batchInstruction(batch: LessonBatch, periods: number): string {
  return batch.index === 1
    ? `完整教案共 ${periods} 節，分 ${batch.total} 批產生。這是第 1 批：activities 只產生第 ${batch.from}–${batch.to} 節（剛好 ${batch.to - batch.from + 1} 項）；summary、goals、elements、integration、blueprint 照常產生，涵蓋整個單元的 ${periods} 節。每一節的 coreActivityId 依 periodPlan 指定。`
    : `完整教案共 ${periods} 節，分 ${batch.total} 批產生。這是第 ${batch.index} 批：只回傳 activities，剛好第 ${batch.from}–${batch.to} 節（${batch.to - batch.from + 1} 項），接續 earlierLessons 的前面節次，不重複前面已做過的任務；每一節的 coreActivityId 依 periodPlan 指定。不要回傳其他欄位。`;
}
// 各批合併成一份完整回應；節次編號由程式依順序重設，避免各批的 id 重複。
export function combineFullBatches(parts: Row[]): Row {
  const activities = parts.flatMap(part => list(part.activities, 'activities')).map((row, index) => ({ ...row, id: `period-${index + 1}` }));
  return { ...parts[0], activities };
}
