import { BLUEPRINT_SUPPORT, MODE_PLAN, MODES, STAGES, THRESHOLDS, type AssessmentVersion, type DesignVersion, type Project, type Workspace } from './types';
import indicators from '../data/indicators.json';
import curriculum from '../data/curriculum.json';
import { inspectLegacy } from '../storage/legacy';
import { strategiesFor } from './assessmentStrategy';
import { checkSelfReport } from './selfReport';
import { validateScenarioAssessment } from './scenarioCheck';
import { checkAlignment } from './progressionAlignment';
import { BLUEPRINT_LIMITS, checkBlueprintSupport, sameItemBlueprint, validateItemBlueprint } from './itemBlueprint';

type Schema = { type: 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object'; max?: number; min?: number; values?: readonly unknown[]; items?: Schema; fields?: Record<string, Schema>; optional?: boolean } | { any: Schema[]; optional?: boolean };
const str: Schema = { type: 'string', max: 20000 };
const id: Schema = { type: 'string', min: 1, max: 160 };
const time: Schema = { type: 'number', min: 1, max: 9007199254740991 };
const nullable = (value: Schema): Schema => ({ any: [value, { type: 'null' }] });
const arr = (items: Schema, min = 0, max = 100): Schema => ({ type: 'array', items, min, max });
const obj = (fields: Record<string, Schema>): Schema => ({ type: 'object', fields });
const one = (values: readonly string[]): Schema => ({ type: 'string', values });
const four = arr({ type: 'string', min: 1, max: 20000 }, 4, 4);
const inputV1 = obj({ title: id, subject: id, grade: id, periods: { type: 'number', min: 1, max: 60 }, topic: str,
  startingPoint: obj({ status: one(['unknown', 'provided']), text: str, assumptions: arr(str, 0, 20) }),
  originalSource: obj({ kind: one(['manual-example', 'teacher']), text: { type: 'string', max: 60000 } }), curriculumIds: arr(id, 0, 12), indicatorIds: arr(id, 1, 2) });
const input = obj({ ...('fields' in inputV1 ? inputV1.fields : {}), teacherNotes: { type: 'string', max: 60000 }, drivingQuestion: { type: 'string', max: 2000, optional: true }, finalProduct: { type: 'string', max: 2000, optional: true }, indicatorReview: obj({ signature: { type: 'string', max: 1000000 }, confirmedAt: nullable(time) }) });
const contentText: Schema = { type: 'string', min: 1, max: 2000 };
const conditions = obj({ knowledge: contentText, reading: contentText, complexity: contentText, reasoning: contentText, prompts: contentText });
const item = obj({ id, title: id, context: str, data: str, prompt: contentText, criterionIds: arr(id, 1, 8),
  options: arr(obj({ id, text: contentText, supports: arr(str, 1, 8), limitations: arr(str, 1, 8) }), 2, 8), conditions,
  applicationCriteria: nullable(obj({ academic: contentText, capability: contentText })),
  shortResponse: { ...obj({ prompt: contentText, example: contentText, evidence: contentText }), optional: true },
  curriculumIds: { ...arr(id, 0, 12), optional: true } });
// 門檻題組：一個子指標一組，5 題 2–2–1 門檻選擇題（各 4 選項、恰一個門檻以上）＋三段非選題。
const thresholdItem = obj({ id, threshold: one(THRESHOLDS), prompt: contentText,
  options: arr(obj({ id, text: contentText, above: { type: 'boolean' }, thinking: contentText }), 4, 4) });
const openStep = obj({ threshold: one(THRESHOLDS), guide: contentText, sentenceStarter: contentText, aboveFeatures: contentText, aboveExample: contentText, belowExample: contentText });
// 題數與段數依測驗方式（MODE_PLAN）在 validateSetAssessment／checkSetModes 檢查；方式 E 只有觀察表。
const setFields = { id, indicatorId: id, criterionIds: arr(id, 1, 8), title: id, context: str, data: str,
  choices: arr(thresholdItem, 0, 6), opens: arr(obj({ prompt: contentText, steps: arr(openStep, 1, 3) }), 0, 2),
  observation: { ...obj({ activityIds: arr(id, 1, 30), focus: contentText, behaviors: four }), optional: true }, conditions };
// AI 只回傳題目內容；mode 與 suggestedMode 由程式依教師選擇寫入。
const generatedSet = obj(setFields);
const itemSet = obj({ ...setFields, mode: one(MODES), suggestedMode: one(MODES) });
const design = obj({ id, createdAt: time, confirmedAt: nullable(time), origin: one(['manual-example', 'teacher', 'ai']), inputSnapshot: input,
  summary: str, rubricVersion: id, rubricSource: id,
  goals: arr(obj({ id, kind: one(['academic', 'npdl']), text: contentText, success: contentText, curriculumIds: arr(id, 0, 12) }), 2, 12),
  criteria: arr(obj({ id, indicatorId: id, label: id, observable: str, scope: str, unobserved: str, stages: four, alignment: { ...arr(arr({ type: 'string', min: 1, max: 600 }, 1, 3), 4, 4), optional: true } }), 1, 10),
  activities: arr(obj({ id, name: id, periods: { type: 'number', min: 0.01, max: 60 }, goalIds: arr(id, 1, 12), criterionIds: arr(id, 1, 10), task: str, knowledgeUse: str, evidence: str, formative: str,
    scaffolds: arr(obj({ stage: one(STAGES), support: contentText, fading: contentText }), 4, 4) }), 1, 30),
  elements: arr(obj({ name: one(['學習夥伴關係', '學習環境', '教學實踐', '數位利用']), practice: str, limitation: str }), 4, 4),
  integration: arr(obj({ indicatorId: id, status: one(['draft', 'confirmed', 'missing']), criterionIds: arr(id, 1, 10), rule: str }), 1, 2),
  blueprint: arr(obj({ preId: id, postId: id, criterionIds: arr(id, 1, 10), status: one(['可作有限比較', '比較條件待確認', '不宜比較', '只有單次資料']), reason: str }), 1, 100) });
const smallCount = (max: number): Schema => ({ type: 'number', min: 1, max });
const workload = obj({ evidenceUnits: smallCount(BLUEPRINT_LIMITS.evidenceUnits), operations: smallCount(BLUEPRINT_LIMITS.operations), support: one(BLUEPRINT_SUPPORT) });
const blueprintSlot = obj({ indicatorId: id, kind: one(['choice', 'open']), question: smallCount(6), step: nullable(smallCount(3)), threshold: one(THRESHOLDS),
  judgment: { type: 'string', max: BLUEPRINT_LIMITS.judgment }, evidence: { type: 'string', max: BLUEPRINT_LIMITS.evidence },
  pre: workload, post: workload, balanceNote: { type: 'string', max: BLUEPRINT_LIMITS.balanceNote } });
const itemBlueprint = obj({ version: { type: 'number', values: [1] }, slots: arr(blueprintSlot, 1, BLUEPRINT_LIMITS.slots) });
const assessment = obj({ id, phase: one(['pre', 'post']), parentPreId: nullable(id), designId: id, rubricVersion: id, createdAt: time,
  reviewedAt: nullable(time), administeredAt: nullable(time), capability: arr(item, 0, 100), application: arr(item, 0, 30),
  reflection: arr(obj({ indicatorId: id, descriptions: four, activityIds: arr(id, 1, 30), evidencePrompt: contentText, noEvidenceLabel: contentText }), 0, 2),
  format: { ...one(['threshold-set-v1', 'scenario-progression-v1']), optional: true }, sets: { ...arr(itemSet, 0, 2), optional: true }, splitSequence: { type: 'number', values: [1], optional: true },
  assessmentBlueprint: { ...obj({ strategyId: id, postActivityId: nullable(id), itemBlueprint: { ...itemBlueprint, optional: true } }), optional: true },
  aspects: { ...arr(obj({ indicatorId: id, aspects: arr(obj({ id, label: { type: 'string', min: 1, max: 30 }, description: { type: 'string', min: 1, max: 300 }, anchors: { ...arr({ type: 'string', min: 1, max: 400 }, 4, 4), optional: true } }), 1, 3) }), 0, 2), optional: true },
  scenarioSets: { ...arr(obj({ indicatorId: id, items: arr(obj({ id, aspectId: id, scenario: { type: 'string', min: 1, max: 600 }, prompt: { type: 'string', min: 1, max: 200 }, reasonPrompt: { type: 'string', min: 1, max: 200 },
    options: arr(obj({ label: one(['A', 'B', 'C', 'D']), text: { type: 'string', min: 1, max: 200 }, stage: { type: 'number', values: [0, 1, 2, 3] } }), 4, 4),
    anchors: arr({ type: 'string', min: 1, max: 400 }, 4, 4) }), 1, 3), extension: { ...obj({ prompt: { type: 'string', min: 1, max: 300 }, anchors: arr({ type: 'string', min: 1, max: 400 }, 4, 4) }), optional: true } }), 0, 2), optional: true },
  classroomKits: { ...arr(obj({ indicatorId: id, worksheet: obj({ title: { type: 'string', min: 1, max: 40 }, intro: { type: 'string', min: 1, max: 200 }, questions: arr(obj({ activityId: id, prompt: { type: 'string', min: 1, max: 120 }, lines: { type: 'number', values: [4] } }), 3, 5) }),
    checklist: arr(obj({ criterionId: id, focus: { type: 'string', min: 1, max: 60 }, behaviors: arr({ type: 'string', min: 1, max: 120 }, 4, 4) }), 1, 10) }), 0, 2), optional: true },
  selfReport: { ...obj({ version: { type: 'number', values: [1] }, phase: one(['pre', 'post']), items: arr(obj({ id, indicatorId: id, scenario: { type: 'string', min: 1, max: 600 }, prompt: { type: 'string', min: 1, max: 200 },
    options: arr(obj({ label: one(['A', 'B', 'C', 'D']), text: { type: 'string', min: 1, max: 200 }, stage: { type: 'number', values: [0, 1, 2, 3] } }), 4, 4),
    pairedWith: nullable({ type: 'number', values: [1, 2] }), postOnly: { type: 'boolean' } }), 2, 3) }), optional: true } });
const schema = obj({ schemaVersion: { type: 'number', values: [2] }, activeProjectId: id, projects: arr(obj({ id, input, designs: arr(design, 1, 100), activeDesignId: id,
  assessments: arr(assessment, 0, 100), activePreId: nullable(id), activePostId: nullable(id), workflow: { ...one(['single-v1']), optional: true },
  referencePretest: { ...obj({ text: { type: 'string', min: 1, max: 60000 }, deidentifiedAt: nullable(time) }), optional: true } }), 1, 20),
  legacyImports: { ...arr(obj({ id, kind: one(['assessment-studio', 'course-workspace']), sourceVersion: { type: 'number', min: 1, max: 5 }, filename: id,
    title: id, importedAt: time, sha256: { type: 'string', min: 64, max: 64 }, raw: { type: 'string', min: 2, max: 8 * 1024 * 1024 } }), 0, 20), optional: true } });

const schemaV1 = structuredClone(schema);
if ('fields' in schemaV1 && schemaV1.fields) {
  schemaV1.fields.schemaVersion = { type: 'number', values: [1] };
  delete schemaV1.fields.legacyImports;
  const projectSchema = schemaV1.fields.projects;
  if ('items' in projectSchema && projectSchema.items && 'fields' in projectSchema.items && projectSchema.items.fields) {
    projectSchema.items.fields.input = inputV1;
    // 門檻題組欄位只存在於 v2；v1 備份夾帶時整份拒絕，舊格式能力題至少一題。
    const assessments = projectSchema.items.fields.assessments;
    if ('items' in assessments && assessments.items && 'fields' in assessments.items && assessments.items.fields) {
      delete assessments.items.fields.format; delete assessments.items.fields.sets; delete assessments.items.fields.splitSequence; delete assessments.items.fields.assessmentBlueprint; delete assessments.items.fields.selfReport; delete assessments.items.fields.aspects; delete assessments.items.fields.scenarioSets; delete assessments.items.fields.classroomKits;
      assessments.items.fields.capability = arr(item, 1, 100);
    }
    const designs = projectSchema.items.fields.designs;
    if ('items' in designs && designs.items && 'fields' in designs.items && designs.items.fields) {
      designs.items.fields.inputSnapshot = inputV1;
      const criteriaSchema = designs.items.fields.criteria;
      if ('items' in criteriaSchema && criteriaSchema.items && 'fields' in criteriaSchema.items && criteriaSchema.items.fields) delete criteriaSchema.items.fields.alignment;
      designs.items.fields.origin = one(['manual-example', 'teacher']);
    }
  }
}
function fail(path: string, message: string): never { throw new Error(`${path}：${message}`); }
function check(value: unknown, spec: Schema, path: string): void {
  if ('any' in spec) { for (const candidate of spec.any) { try { check(value, candidate, path); return; } catch { /* Try the next explicitly allowed type. */ } } fail(path, '型別不符'); }
  if (spec.type === 'null') { if (value !== null) fail(path, '必須為空值'); return; }
  if (spec.type === 'boolean') { if (typeof value !== 'boolean') fail(path, '必須為是或否'); return; }
  if (spec.values && !spec.values.includes(value)) fail(path, '版本或選項不支援');
  if (spec.type === 'string') { if (typeof value !== 'string') fail(path, '必須為文字'); if (value.length > (spec.max ?? 20000) || (spec.min && value.trim().length < spec.min)) fail(path, '文字長度不符'); return; }
  if (spec.type === 'number') { if (typeof value !== 'number' || !Number.isFinite(value) || value < (spec.min ?? -Infinity) || value > (spec.max ?? Infinity) || (spec.max === 9007199254740991 && !Number.isSafeInteger(value))) fail(path, '數值不符'); return; }
  if (spec.type === 'array') { if (!Array.isArray(value) || value.length < (spec.min ?? 0) || value.length > (spec.max ?? 100)) fail(path, '陣列數量不符'); value.forEach((v, i) => check(v, spec.items!, `${path}[${i}]`)); return; }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, '必須為物件');
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!Object.hasOwn(spec.fields!, key)) fail(`${path}.${key}`, '未知欄位，未保存，請使用相容版本');
  for (const [key, field] of Object.entries(spec.fields!)) { if (!Object.hasOwn(record, key)) { if (field.optional) continue; fail(`${path}.${key}`, '缺少必要欄位'); } check(record[key], field, `${path}.${key}`); }
}
function unique(values: string[], label: string) { if (new Set(values).size !== values.length) fail(label, 'ID 不可重複'); }
function refs(values: string[], permitted: string[], label: string) { unique(values, label); if (values.some(v => !permitted.includes(v))) fail(label, '參照不存在'); }
export function validateWorkspace(value: unknown): Workspace {
  const version = typeof value === 'object' && value !== null ? (value as Record<string, unknown>).schemaVersion : null;
  if (version !== 1 && version !== 2) fail('工作區版本', '版本不支援，原資料保留');
  check(value, version === 1 ? schemaV1 : schema, '工作區');
  const workspace = structuredClone(value) as Workspace;
  unique(workspace.projects.map(p => p.id), '專案');
  if (workspace.legacyImports) {
    unique(workspace.legacyImports.map(item => item.id), '舊備份副本');
    for (const item of workspace.legacyImports) {
      if (!/^[a-f0-9]{64}$/.test(item.sha256)) fail('舊備份指紋', '格式不正確');
      const facts = inspectLegacy(item.raw);
      if (facts.kind !== item.kind || facts.sourceVersion !== item.sourceVersion || facts.title.slice(0, 160) !== item.title) fail('舊備份來源', '標示與原文不一致');
    }
  }
  if (!workspace.projects.some(p => p.id === workspace.activeProjectId)) fail('目前專案', '不存在');
  for (const p of workspace.projects) {
    refs(p.input.indicatorIds, indicators.entries.map(i => i.id), '子指標'); refs(p.input.curriculumIds, curriculum.map(i => i.id), '課綱');
    if (!Number.isInteger(p.input.periods)) fail('總節數', '須為整數');
    if (workspace.schemaVersion === 2) validateReview(p.input);
    unique(p.designs.map(d => d.id), '設計版本'); unique(p.assessments.map(a => a.id), '評量版本');
    if (!p.designs.some(d => d.id === p.activeDesignId)) fail('目前設計', '不存在');
    for (const d of p.designs) {
      if (workspace.schemaVersion === 2) {
        validateReview(d.inputSnapshot);
        if (d.criteria.some(c => !c.observable.trim() || !c.scope.trim() || !c.unobserved.trim()) || d.activities.some(a => !a.task.trim() || !a.knowledgeUse.trim() || !a.evidence.trim() || !a.formative.trim()) || d.elements.some(e => !e.practice.trim() || !e.limitation.trim()) || d.blueprint.some(b => !b.reason.trim())) fail('設計內容', '觀察範圍、活動、學科用途及限制不可空白');
      }
      refs(d.inputSnapshot.indicatorIds, indicators.entries.map(i => i.id), '設計子指標'); refs(d.inputSnapshot.curriculumIds, curriculum.map(i => i.id), '設計課綱');
      if (!Number.isInteger(d.inputSnapshot.periods)) fail('設計總節數', '須為整數');
      unique(d.goals.map(g => g.id), '目標'); unique(d.criteria.map(c => c.id), '規準'); unique(d.activities.map(a => a.id), '活動'); unique(d.elements.map(e => e.name), '四要素');
      if (!d.goals.some(g => g.kind === 'academic') || !d.goals.some(g => g.kind === 'npdl')) fail('目標', '需含學科與 NPDL 目標');
      d.goals.forEach(g => refs(g.curriculumIds, d.inputSnapshot.curriculumIds, '目標課綱'));
      if (d.inputSnapshot.indicatorIds.some(id => !d.criteria.some(c => c.indicatorId === id))) fail('規準', '每個子指標需完整規準');
      d.criteria.forEach(c => refs([c.indicatorId], d.inputSnapshot.indicatorIds, '規準子指標'));
      for (const c of d.criteria) if (c.alignment) { try { checkAlignment(c.indicatorId, c.alignment, c.stages); } catch (error) { fail('規準逐句對應', error instanceof Error ? error.message : '格式不符'); } }
      if (Math.abs(d.activities.reduce((n, a) => n + a.periods, 0) - d.inputSnapshot.periods) > 0.01) fail('活動', '節數合計與設計不符');
      for (const a of d.activities) { refs(a.goalIds, d.goals.map(g => g.id), '活動目標'); refs(a.criterionIds, d.criteria.map(c => c.id), '活動規準'); unique(a.scaffolds.map(s => s.stage), '四階鷹架'); }
      unique(d.integration.map(r => r.indicatorId), '整合規則');
      refs(d.integration.map(r => r.indicatorId), d.inputSnapshot.indicatorIds, '整合指標');
      if (d.integration.length !== d.inputSnapshot.indicatorIds.length) fail('整合規則', '每個指標需明示規則或缺漏');
      for (const r of d.integration) { refs(r.criterionIds, d.criteria.filter(c => c.indicatorId === r.indicatorId).map(c => c.id), '整合規準'); if (r.status !== 'missing' && !r.rule.trim()) fail('整合規則', '需提供內容'); }
      if (d.confirmedAt && (d.confirmedAt < d.createdAt || d.integration.some(r => r.status !== 'confirmed'))) fail('設計確認', '時間順序或規則確認不符');
      unique(d.blueprint.map(b => b.preId), '前測藍圖'); unique(d.blueprint.map(b => b.postId), '後測藍圖'); d.blueprint.forEach(b => refs(b.criterionIds, d.criteria.map(c => c.id), '藍圖規準'));
    }
    for (const a of p.assessments) {
      const d = p.designs.find(d => d.id === a.designId); if (!d || a.rubricVersion !== d.rubricVersion) fail('評量規準', '設計或版本不一致');
      if (a.createdAt < d.createdAt) fail('評量时间', '題組不可早於設計');
      if (a.administeredAt && !a.reviewedAt) fail('施測', '須先確認題組');
      if ((a.reviewedAt && (a.reviewedAt < a.createdAt || (d.confirmedAt !== null && a.reviewedAt < d.confirmedAt))) || (a.administeredAt && (a.administeredAt < a.reviewedAt! || !d.confirmedAt || d.confirmedAt > a.administeredAt))) fail('評量時間', '確認/施測順序或設計確認不符');
      if (a.phase === 'pre' && (a.parentPreId || a.application.length || a.reflection.length)) fail('前測', '不能含課程應用、自評或配對前測');
      if (a.format === 'scenario-progression-v1') { validateScenarioAssessment(p, d, a, fail); continue; }
      if (a.format || a.sets) { validateSetAssessment(p, d, a); continue; }
      if (a.assessmentBlueprint || a.splitSequence) fail('題組格式', '舊格式不支援逐題藍圖或分開出題設定');
      if (a.selfReport) fail('題組格式', '舊格式不支援情境自陳題');
      if (!a.capability.length) fail('題組', '缺少能力題');
      if (a.phase === 'post') {
        const pre = p.assessments.find(x => x.id === a.parentPreId && x.phase === 'pre');
        if (!pre || pre.designId !== a.designId || pre.rubricVersion !== a.rubricVersion) fail('後測', '缺少同版前測');
        if (pre.format) fail('後測', '舊格式後測不能配新格式前測');
        if (a.createdAt < pre.createdAt) fail('後測時間', '後測不可早於前測');
        if (a.administeredAt && (!pre.administeredAt || a.administeredAt < pre.administeredAt)) fail('後測施測', '須在配對前測施測之後');
        if (!a.application.length || a.reflection.length !== (p.workflow === 'single-v1' ? 0 : d.inputSnapshot.indicatorIds.length)) fail('後測', p.workflow === 'single-v1' ? '課綱題或無自評結構不完整' : '三部分不完整');
        if (pre.capability.length !== d.blueprint.length || a.capability.length !== d.blueprint.length) fail('測驗藍圖', '能力題須完整配對');
        for (const pair of d.blueprint) {
          const before = pre.capability.find(q => q.id === pair.preId), after = a.capability.find(q => q.id === pair.postId);
          if (!before || !after) fail('前後配對', '題目不存在');
          if (JSON.stringify(before.criterionIds) !== JSON.stringify(pair.criterionIds) || JSON.stringify(after.criterionIds) !== JSON.stringify(pair.criterionIds)) fail('前後配對', '判讀項目不一致');
          // R12-r5：單一路徑不判定前後測可否比較，出題條件只供教師參考，不擋題目。
          if (p.workflow !== 'single-v1' && pair.status === '可作有限比較' && JSON.stringify(before.conditions) !== JSON.stringify(after.conditions)) fail('前後配對', '已知施測條件不同，請先標限制');
          // 不指定是哪一份要改：重寫前測或後測時，由被重寫的那一份改用新內容。
          if (after.context === before.context || after.data === before.data) fail(`配對題（${pair.preId} ↔ ${pair.postId}）`, after.context === before.context ? '前測與後測的情境文字完全相同，被重寫的那一份需改用新情境' : '前測與後測的資料完全相同，被重寫的那一份需改用新數據');
        }
      }
      if (a.phase === 'pre') {
        if (a.capability.length !== d.blueprint.length) fail('前測藍圖', '題目須完整');
        for (const pair of d.blueprint) { const q = a.capability.find(q => q.id === pair.preId); if (!q || JSON.stringify(q.criterionIds) !== JSON.stringify(pair.criterionIds)) fail('前測藍圖', '題目與規準不一致'); }
      }
      unique([...a.capability, ...a.application].map(q => q.id), '題目');
      for (const q of [...a.capability, ...a.application]) { refs(q.criterionIds, d.criteria.map(c => c.id), '題目規準'); if (q.curriculumIds) refs(q.curriculumIds, d.inputSnapshot.curriculumIds, '題目課綱'); unique(q.options.map(o => o.id), '選項'); unique(q.options.map(o => o.text), '選項文字'); }
      if ([...a.capability, ...a.application].some(q => !q.context.trim() || !q.data.trim() || q.options.some(o => o.supports.some(t => !t.trim()) || o.limitations.some(t => !t.trim())))) fail('題目內容', '情境、資料、支持與限制不可空白');
      if (a.capability.some(q => q.applicationCriteria !== null) || a.application.some(q => q.applicationCriteria === null)) fail('題目用途', '能力比較與學科應用不可混用');
      for (const r of a.reflection) { refs([r.indicatorId], d.inputSnapshot.indicatorIds, '自評指標'); refs(r.activityIds, d.activities.map(x => x.id), '自評活動'); }
      unique(a.reflection.map(r => r.indicatorId), '自評指標');
    }
    for (const [key, phase] of [['activePreId', 'pre'], ['activePostId', 'post']] as const) if (p[key] && !p.assessments.some(a => a.id === p[key] && a.phase === phase)) fail('目前評量', '版本或測次不符');
    const activePost = p.assessments.find(a => a.id === p.activePostId);
    if (activePost && activePost.parentPreId !== p.activePreId) fail('目前配對', '前後版本不一致');
  }
  return workspace;
}

const setLabel = (index: number) => `第 ${index + 1} 組題組`;
// 門檻題組的結構與配對檢查（舊格式的藍圖配對不適用）。
// 依測驗方式檢查題數、門檻順序、選項與觀察表。AI 回應與已保存資料共用。
export function checkSetMode(s: import('./types').ItemSet, label: string): void {
  const plan = MODE_PLAN[s.mode];
  if (s.mode === 'E') {
    if (!s.observation) fail(label, '方式 E 需要課中觀察表');
    if (s.choices.length || s.opens.length) fail(label, '方式 E 不出紙筆題');
    return;
  }
  if (s.observation) fail(label, '只有方式 E 有觀察表');
  if (!s.title.trim() || !s.context.trim() || !s.data.trim()) fail(label, '標題、情境與資料不可空白');
  if (s.choices.length !== plan.choices.length) fail(label, `方式 ${s.mode} 應有 ${plan.choices.length} 題選擇題，目前 ${s.choices.length} 題`);
  s.choices.forEach((c, i) => {
    if (c.threshold !== plan.choices[i]) fail(`${label}第 ${i + 1} 題`, `門檻應為「${plan.choices[i]}」（方式 ${s.mode} 的選擇題門檻依序為 ${plan.choices.join('、')}）`);
    if (c.options.filter(o => o.above).length !== 1) fail(`${label}第 ${i + 1} 題`, '4 個選項中恰好 1 個呈現門檻以上的表現');
    unique(c.options.map(o => o.id), `${label}第 ${i + 1} 題選項`); unique(c.options.map(o => o.text.trim()), `${label}第 ${i + 1} 題選項文字`);
  });
  if (s.opens.length !== plan.opens.length) fail(label, `方式 ${s.mode} 應有 ${plan.opens.length} 題非選題，目前 ${s.opens.length} 題`);
  s.opens.forEach((open, k) => {
    const expected = plan.opens[k];
    if (open.steps.length !== expected.length || open.steps.some((step, i) => step.threshold !== expected[i])) fail(`${label}非選題第 ${k + 1} 題`, `應有 ${expected.length} 段，門檻依序為 ${expected.join('、')}`);
  });
}
function validateSetAssessment(p: Project, d: DesignVersion, a: AssessmentVersion): void {
  const sets = a.sets ?? [];
  if (a.format !== 'threshold-set-v1' || !sets.length) fail('題組格式', '門檻題組缺少格式或題組');
  if (a.splitSequence && (a.phase !== 'pre' || (sets.some(set => set.mode !== 'E') && !a.assessmentBlueprint?.itemBlueprint))) fail('分開出題', '只標記前測，紙筆前測必須有逐題藍圖');
  if (a.capability.length || a.application.length || a.reflection.length) fail('題組格式', '門檻題組不含舊格式題目、課程應用或自評');
  if (a.assessmentBlueprint) {
    if (!d.confirmedAt || !sets.some(set => set.mode !== 'E')) fail('評量出題設定', '須引用已確認的紙筆題組設計');
    const { strategyId, postActivityId } = a.assessmentBlueprint;
    if (!strategiesFor(d.inputSnapshot.subject).some(strategy => strategy.id === strategyId)) fail('評量出題策略', '不屬於該設計的學科');
    if (postActivityId !== null && !d.activities.some(activity => activity.id === postActivityId)) fail('後測情境活動', '參照不存在');
  }
  const indicatorIds = d.inputSnapshot.indicatorIds;
  const separate = a.splitSequence || (a.phase === 'post' && p.assessments.some(pre => pre.id === a.parentPreId && pre.splitSequence));
  if (sets.length !== indicatorIds.length) fail('題組數', `每個子指標一組，應有 ${indicatorIds.length} 組，目前 ${sets.length} 組`);
  refs(sets.map(s => s.indicatorId), indicatorIds, '題組子指標');
  if (a.selfReport) {
    try { checkSelfReport(a.selfReport, a.phase, indicatorIds); } catch (error) { fail('情境自陳題', error instanceof Error ? error.message : '格式不符'); }
    const pre = p.assessments.find(row => row.id === a.parentPreId);
    if (a.selfReport.items.some(item => item.pairedWith !== null) && !pre?.selfReport) fail('情境自陳題', '配對的前測沒有自陳題');
  }
  unique([...sets.map(s => s.id), ...sets.flatMap(s => s.choices.map(c => c.id))], '題組與題目');
  sets.forEach((s, index) => {
    const label = setLabel(index);
    const expected = d.criteria.filter(c => c.indicatorId === s.indicatorId).map(c => c.id);
    refs(s.criterionIds, expected, `${label}規準`);
    if ([...s.criterionIds].sort().join() !== [...expected].sort().join()) fail(`${label}規準`, '須包含該子指標的全部規準');
    checkSetMode(s, label);
    if (s.observation) {
      const allowed = separate ? d.activities.filter(activity => activity.criterionIds.some(id => s.criterionIds.includes(id))) : d.activities;
      refs(s.observation.activityIds, allowed.map(activity => activity.id), `${label}觀察表活動`);
    }
  });
  const modes = indicatorIds.map(indicatorId => sets.find(s => s.indicatorId === indicatorId)!);
  if (a.assessmentBlueprint?.itemBlueprint) {
    const blueprint = validateItemBlueprint(a.assessmentBlueprint.itemBlueprint, modes);
    checkBlueprintSupport(sets, a.phase, blueprint);
  }
  if (a.phase === 'post') {
    const pre = p.assessments.find(x => x.id === a.parentPreId && x.phase === 'pre');
    if (!pre || pre.designId !== a.designId || pre.rubricVersion !== a.rubricVersion) fail('後測', '缺少同版前測');
    if (pre.format !== a.format) fail('後測', '前後測格式不同');
    if (pre.splitSequence && (!pre.reviewedAt || a.createdAt < pre.reviewedAt)) fail('分開出題', '後測必須在配對前測核對完成後產生');
    if (pre.assessmentBlueprint?.strategyId !== a.assessmentBlueprint?.strategyId || pre.assessmentBlueprint?.postActivityId !== a.assessmentBlueprint?.postActivityId) fail('前後配對', '前後測的出題策略與後測情境須一致');
    if (!sameItemBlueprint(pre.assessmentBlueprint?.itemBlueprint, a.assessmentBlueprint?.itemBlueprint, modes)) fail('前後配對', '前後測的逐題藍圖須一致');
    if (a.createdAt < pre.createdAt) fail('後測時間', '後測不可早於前測');
    if (a.administeredAt && (!pre.administeredAt || a.administeredAt < pre.administeredAt)) fail('後測施測', '須在配對前測施測之後');
    for (const s of sets) {
      const before = pre.sets?.find(x => x.indicatorId === s.indicatorId);
      if (!before) fail('前後配對', '前測缺少同一子指標的題組');
      if (s.mode !== before.mode || s.suggestedMode !== before.suggestedMode) fail(`題組（${s.indicatorId}）`, '同一子指標的前後測須用同一種測驗方式');
      if (s.mode === 'E') continue;
      if (s.context === before.context || s.data === before.data) fail(`題組（${s.indicatorId}）`, s.context === before.context ? '前測與後測的情境文字完全相同，被重寫的那一份需改用新情境' : '前測與後測的資料完全相同，被重寫的那一份需改用新數據');
    }
  }
}
function validateReview(input: import('./types').CourseInput): void {
  const review = input.indicatorReview;
  if (review?.confirmedAt && review.signature !== inputSignature(input)) fail('子指標核對', '核對脈絡已過期');
}
export function inputSignature(input: import('./types').CourseInput): string {
  const { indicatorReview, ...content } = input; void indicatorReview;
  return JSON.stringify(content);
}

interface JsonSchema { [key: string]: unknown; properties?: Record<string, JsonSchema>; items?: JsonSchema }
function jsonSchema(spec: Schema): JsonSchema {
  if ('any' in spec) return { anyOf: spec.any.map(jsonSchema) };
  const result: JsonSchema = { type: spec.type };
  if (spec.values) result.enum = spec.values;
  if (spec.type === 'object') { result.properties = Object.fromEntries(Object.entries(spec.fields!).map(([key, value]) => [key, jsonSchema(value)])); result.required = Object.entries(spec.fields!).filter(([, field]) => !field.optional).map(([key]) => key); result.additionalProperties = false; }
  if (spec.type === 'array') { result.items = jsonSchema(spec.items!); result.minItems = spec.min ?? 0; result.maxItems = spec.max ?? 100; }
  if (spec.type === 'string') { if (spec.min) result.minLength = spec.min; result.maxLength = spec.max ?? 20000; }
  if (spec.type === 'number' && !spec.values) { if (spec.min !== undefined) result.minimum = spec.min; if (spec.max !== undefined) result.maximum = spec.max; }
  return result;
}
export function generationSchema(kind: 'design' | 'pre' | 'post'): Record<string, unknown> {
  if (kind === 'design' && 'fields' in design) {
    const fields = { ...design.fields };
    for (const key of ['id', 'createdAt', 'confirmedAt', 'origin', 'inputSnapshot', 'rubricVersion']) delete fields[key];
    const result = jsonSchema(obj(fields));
    const status = result.properties?.integration.items?.properties?.status;
    if (!status) throw new Error('整合規則結構不存在。');
    status.enum = ['draft', 'missing'];
    return result;
  }
  if ('fields' in assessment) return jsonSchema(obj(Object.fromEntries(['capability', 'application', 'reflection'].map(key => [key, assessment.fields![key]]))));
  throw new Error('生成結構不存在。');
}
// 門檻題組的 AI 輸出結構：只有 sets。
export function setGenerationSchema(): Record<string, unknown> { return jsonSchema(obj({ sets: arr(generatedSet, 1, 2) })); }
export function validateSetContent(content: unknown): void { check(content, obj({ sets: arr(itemSet, 1, 2) }), '生成題組');
}
export function validateDesignContent(content: unknown): void {
  if (!('fields' in design)) throw new Error('設計結構不存在。');
  const fields = { ...design.fields };
  for (const key of ['id', 'createdAt', 'confirmedAt', 'origin', 'inputSnapshot', 'rubricVersion']) delete fields[key];
  check(content, obj(fields), '生成設計');
}
export function validateAssessmentContent(content: unknown): void {
  if (!('fields' in assessment)) throw new Error('題組結構不存在。');
  check(content, obj(Object.fromEntries(['capability', 'application', 'reflection'].map(key => [key, assessment.fields![key]]))), '生成題組');
}
