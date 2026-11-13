// R12-r8 測試共用：由種子設計組出已核對草稿，與 AI 依新契約回傳的完整教案（只用編號參照）。
import { createSeed } from '../data/seed';
import { emptySingleDraft, type SingleDraft } from './singlePath';
import { coreActivityId, criterionId, goalId } from './fullDesign';

export function fullFixture() {
  const seed = createSeed();
  const source = seed.projects[0].designs[0];
  const approved: SingleDraft = { ...emptySingleDraft(), grade: '高二', subject: '化學', topic: '如何用生活資料判斷變化？', title: '生活資料判讀', keywords: '資料、證據、判讀', periods: String(source.activities.length),
    curriculumIds: seed.projects[0].input.curriculumIds, indicatorIds: seed.projects[0].input.indicatorIds,
    goals: source.goals.map(row => ({ kind: row.kind, indicatorId: row.kind === 'npdl' ? seed.projects[0].input.indicatorIds[0] : '', text: row.text, success: row.success })),
    criteria: [source.criteria[0]].map(row => ({ indicatorId: row.indicatorId, label: row.label, observable: row.observable, scope: row.scope, unobserved: row.unobserved, stages: row.stages })),
    activities: source.activities.map(row => ({ name: row.name, periods: 1, task: row.task, evidence: row.evidence })), stage: 'full' };
  const goalOf = (id: string) => goalId(source.goals.findIndex(row => row.id === id));
  const response = {
    summary: source.summary, rubricSource: source.rubricSource,
    goals: source.goals.map((row, index) => ({ id: goalId(index), curriculumIds: row.curriculumIds.filter(id => approved.curriculumIds.includes(id)) })),
    activities: source.activities.map((row, index) => ({ ...row, goalIds: row.goalIds.map(goalOf), criterionIds: [criterionId(0)], coreActivityId: coreActivityId(index) })),
    elements: source.elements,
    integration: source.integration.filter(row => row.indicatorId === approved.criteria[0].indicatorId).map(row => ({ ...row, status: 'draft' as const, criterionIds: [criterionId(0)] })),
    // R31：前後測配對依規準編號分組。
    blueprint: { [criterionId(0)]: source.blueprint.slice(0, 3).map(row => ({ reason: row.reason })) } as Record<string, { reason: string }[]>,
  };
  return { seed, approved, response };
}
