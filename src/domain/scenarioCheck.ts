import { checkScenarioSets, SCENARIO_FORMAT } from './scenarioProgression';
import { checkClassroomKits } from './classroomKit';
import type { AssessmentVersion, DesignVersion, ItemSet, Project } from './types';
import type { ModeChoice } from './thresholdSet';

export const isScenario = (a: AssessmentVersion | undefined): boolean => a?.format === SCENARIO_FORMAT;

// 方式 E 的觀察表由已確認規準與相連活動組成，不經 AI；驗證時以同一規則比對（R34，Codex 複審第 5 項）。
export function observationSet(design: DesignVersion, mode: Pick<ModeChoice, 'indicatorId' | 'suggestedMode'>, prefix: string): ItemSet {
  const criteria = design.criteria.filter(row => row.indicatorId === mode.indicatorId);
  if (!criteria.length) throw new Error('方式 E 的子指標缺少已確認規準。');
  const criterionIds = criteria.map(row => row.id);
  const linked = design.activities.filter(activity => activity.criterionIds.some(id => criterionIds.includes(id)));
  if (!linked.length) throw new Error('方式 E 需要至少一節與該規準相連的活動；請先修正教案或改選情境進程題。');
  const c = criteria[0];
  const note = '課中觀察為主要證據，學生自評只作核對。';
  return { id: `${prefix}-${mode.indicatorId}`, indicatorId: mode.indicatorId, criterionIds, title: c.label, context: '', data: '', mode: 'E', suggestedMode: mode.suggestedMode,
    choices: [], opens: [], observation: { activityIds: linked.map(activity => activity.id), focus: c.observable, behaviors: [...c.stages] as [string, string, string, string] },
    conditions: { knowledge: note, reading: '無紙筆題。', complexity: note, reasoning: '依課中行為判讀。', prompts: '學生自評附固定反思問題。' } };
}


// 工作區驗證：結構、子指標涵蓋、前後測配對。fail 由呼叫端提供以沿用既有錯誤格式。
export function validateScenarioAssessment(p: Project, d: DesignVersion, a: AssessmentVersion, fail: (where: string, why: string) => never): void {
  if (a.capability.length || a.application.length || a.reflection.length || a.splitSequence || a.assessmentBlueprint || a.selfReport) fail('情境進程題', '不含舊格式題目、逐題藍圖或自陳題');
  const aspects = a.aspects ?? [], scenario = a.scenarioSets ?? [], eSets = a.sets ?? [];
  try { checkScenarioSets(scenario, aspects); } catch (error) { fail('情境進程題', error instanceof Error ? error.message : '格式不符'); }
  const covered = [...scenario.map(s => s.indicatorId), ...eSets.map(s => s.indicatorId)];
  const ids = d.inputSnapshot.indicatorIds;
  if (covered.length !== ids.length || ids.some(id => covered.filter(x => x === id).length !== 1)) fail('情境進程題', '每個子指標須剛好一種方式（情境題或課中觀察）');
  for (const s of eSets) {
    if (s.mode !== 'E' || !s.observation) fail('情境進程題', '課中觀察組須為方式 E 並有觀察表');
    let expected: ItemSet;
    try { expected = observationSet(d, s, s.id); } catch (error) { return fail('情境進程題', error instanceof Error ? error.message : '觀察表無法由規準組成'); }
    if ([...s.criterionIds].sort().join() !== [...expected.criterionIds].sort().join()) fail('情境進程題', '課中觀察組的規準須是該子指標的全部規準');
    if (JSON.stringify(s.observation) !== JSON.stringify(expected.observation)) fail('情境進程題', '觀察表須由該子指標的規準與相連活動組成');
  }
  if (a.classroomKits) {
    if (a.phase !== 'pre') fail('情境進程題', '學習單與勾選表只存在前測');
    try { checkClassroomKits(a.classroomKits, d, eSets.map(s => s.indicatorId)); } catch (error) { fail('情境進程題', error instanceof Error ? error.message : '學習單格式不符'); }
  }
  if (a.phase === 'post') {
    const pre = p.assessments.find(row => row.id === a.parentPreId);
    if (!pre || !isScenario(pre)) fail('情境進程題', '後測須配到情境進程題前測');
    if (!pre!.reviewedAt || a.createdAt < pre!.reviewedAt) fail('情境進程題', '後測必須在前測確認後產生');
    if (JSON.stringify(pre!.aspects) !== JSON.stringify(a.aspects)) fail('情境進程題', '前後測須使用同一組面向');
    if (JSON.stringify(pre!.sets?.map(s => s.indicatorId)) !== JSON.stringify(eSets.map(s => s.indicatorId))) fail('情境進程題', '前後測的測驗方式須相同');
    for (const set of scenario) for (const item of set.items) {
      const before = pre!.scenarioSets?.find(s => s.indicatorId === set.indicatorId)?.items.find(row => row.aspectId === item.aspectId);
      if (before && before.scenario === item.scenario) fail('情境進程題', '後測沿用了前測的情境，請再產生一次後測');
    }
  }
}
