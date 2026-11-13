import { suggestedEvidence } from '../data/assessability';
import { inputSignature, validateWorkspace } from './validate';
import { SCENARIO_FORMAT, type AspectPlan, type ScenarioSet } from './scenarioProgression';
import { isScenario, observationSet } from './scenarioCheck';
export { isScenario, observationSet } from './scenarioCheck';
import type { ModeChoice } from './thresholdSet';
import type { AssessmentVersion, Project, Workspace } from './types';
import type { ClassroomKit } from './classroomKit';
import { checkClassroomKits } from './classroomKit';
import type { NarrativeKit } from './narrativeKit';
import { checkNarrativeKits } from './narrativeKit';

// R33：情境進程題題本的保存與核對。方式 E 的子指標沿用課中觀察表，由已確認的規準與相連活動直接組成，不經 AI。
export const scenarioIndicatorIds = (modes: ModeChoice[]) => modes.filter(row => row.mode !== 'E').map(row => row.indicatorId);

function projectOf(workspace: Workspace, projectId: string): Project {
  const project = workspace.projects.find(row => row.id === projectId);
  if (!project) throw new Error('專案不存在。');
  return project;
}
export function addScenarioAssessment(workspace: Workspace, projectId: string, phase: 'pre' | 'post', content: { aspects: AspectPlan[]; scenarioSets: ScenarioSet[] }, modes: ModeChoice[]): Workspace {
  const next = validateWorkspace(workspace), project = projectOf(next, projectId);
  const pre = phase === 'post' ? project.assessments.find(a => a.id === project.activePreId) : undefined;
  if (phase === 'post' && (!pre || !isScenario(pre))) throw new Error('請先保存並確認情境進程題前測。');
  if (phase === 'post' && !pre!.reviewedAt) throw new Error('請先確認前測，再產生後測。');
  const design = project.designs.find(d => d.id === (pre?.designId ?? project.activeDesignId))!;
  if (!design.confirmedAt) throw new Error('先確認課程設計，才可產生前後測。');
  if (inputSignature(project.input) !== inputSignature(design.inputSnapshot)) throw new Error('課程草稿已變更，請重新核對設計來源。');
  if (phase === 'post' && JSON.stringify(pre!.aspects) !== JSON.stringify(content.aspects)) throw new Error('後測必須沿用前測的面向。');
  const id = crypto.randomUUID();
  const eSets = modes.filter(row => row.mode === 'E').map(row => observationSet(design, row, id));
  // R41：重新產生前測時，同一設計、同樣的課中觀察子指標沿用上一份學習單與勾選表，不必再請 AI。
  const previous = phase === 'pre' ? project.assessments.find(a => a.id === project.activePreId) : undefined;
  // R43（Codex 複審第 2 項）：只沿用「子指標仍是同一種證據方式」的材料；E↔F 改選的子指標一律清除，交由教師重新產生。
  const evidenceOf = (row: ModeChoice) => row.evidence ?? suggestedEvidence(row.indicatorId);
  const idsWith = (kind: 'worksheet' | 'narrative') => new Set(modes.filter(row => row.mode === 'E' && evidenceOf(row) === kind).map(row => row.indicatorId));
  const reuse = previous && isScenario(previous) && previous.designId === design.id;
  const keep = <T extends { indicatorId: string }>(list: T[] | undefined, ids: Set<string>) => { const kept = reuse ? (list ?? []).filter(kit => ids.has(kit.indicatorId)) : []; return kept.length ? structuredClone(kept) : undefined; };
  const kits = keep(previous?.classroomKits, idsWith('worksheet'));
  const narratives = keep(previous?.narrativeKits, idsWith('narrative'));
  project.assessments.push({ id, phase, parentPreId: pre?.id ?? null, designId: design.id, rubricVersion: design.rubricVersion,
    createdAt: Math.max(Date.now(), design.createdAt, pre?.createdAt ?? 0, pre?.reviewedAt ?? 0), reviewedAt: null, administeredAt: null,
    capability: [], application: [], reflection: [], format: SCENARIO_FORMAT, sets: eSets,
    aspects: structuredClone(content.aspects), scenarioSets: structuredClone(content.scenarioSets), ...(kits ? { classroomKits: kits } : {}), ...(narratives ? { narrativeKits: narratives } : {}) });
  if (phase === 'pre') { project.activePreId = id; project.activePostId = null; } else project.activePostId = id;
  return validateWorkspace(next);
}


// R34（Codex 複審第 4 項）：已保存前測的面向只在「情境題／方式 E 配置」與目前選擇相同時才可沿用；否則須重新整理面向。
export function reusableAspects(pre: AssessmentVersion | undefined, modes: ModeChoice[]): AspectPlan[] | null {
  if (!pre || !isScenario(pre)) return null;
  const scenarioIds = scenarioIndicatorIds(modes), eIds = modes.filter(row => row.mode === 'E').map(row => row.indicatorId);
  const savedScenario = (pre.scenarioSets ?? []).map(s => s.indicatorId), savedE = (pre.sets ?? []).map(s => s.indicatorId);
  const same = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x));
  return same(savedScenario, scenarioIds) && same(savedE, eIds) ? pre.aspects ?? [] : null;
}
export function aspectsMatch(plans: AspectPlan[] | null, modes: ModeChoice[]): boolean {
  const ids = scenarioIndicatorIds(modes);
  return !!plans && plans.length === ids.length && ids.every(id => plans.some(p => p.indicatorId === id));
}

// R41：保存 AI 產生的學習單與勾選表到目前的情境進程題前測（前測確認前才可改）。
export function setClassroomKits(workspace: Workspace, projectId: string, kits: ClassroomKit[]): Workspace {
  const next = validateWorkspace(workspace), project = projectOf(next, projectId);
  const pre = project.assessments.find(a => a.id === project.activePreId);
  if (!pre || !isScenario(pre) || pre.phase !== 'pre') throw new Error('請先產生情境進程題前測。');
  if (pre.reviewedAt) throw new Error('前測已確認，學習單已鎖定；要修改請重新產生前測。');
  const design = project.designs.find(row => row.id === pre.designId)!;
  checkClassroomKits(kits, design, kits.map(kit => kit.indicatorId));
  const narrativeIds = new Set((pre.narrativeKits ?? []).map(kit => kit.indicatorId));
  if (kits.some(kit => narrativeIds.has(kit.indicatorId))) throw new Error('同一子指標不可同時使用學習單與經驗敘述。');
  pre.classroomKits = structuredClone(kits);
  return validateWorkspace(next);
}
export function setNarrativeKits(workspace: Workspace, projectId: string, kits: NarrativeKit[]): Workspace {
  const next = validateWorkspace(workspace), project = projectOf(next, projectId);
  const pre = project.assessments.find(a => a.id === project.activePreId);
  if (!pre || !isScenario(pre) || pre.phase !== 'pre') throw new Error('請先產生情境進程題前測。');
  if (pre.reviewedAt) throw new Error('前測已確認，經驗敘述已鎖定；要修改請重新產生前測。');
  const design = project.designs.find(row => row.id === pre.designId)!;
  checkNarrativeKits(kits, design, kits.map(kit => kit.indicatorId));
  const worksheetIds = new Set((pre.classroomKits ?? []).map(kit => kit.indicatorId));
  if (kits.some(kit => worksheetIds.has(kit.indicatorId))) throw new Error('同一子指標不可同時使用學習單與經驗敘述。');
  pre.narrativeKits = structuredClone(kits);
  return validateWorkspace(next);
}
// 確認前測前的條件：每個課中評量子指標都必須有一份 F 或 E 材料。
export function kitsMissing(pre: AssessmentVersion | undefined): boolean {
  const expected = (pre?.sets ?? []).map(set => set.indicatorId);
  const covered = [...(pre?.classroomKits ?? []).map(kit => kit.indicatorId), ...(pre?.narrativeKits ?? []).map(kit => kit.indicatorId)];
  return expected.length > 0 && (covered.length !== expected.length || expected.some(id => !covered.includes(id)));
}
