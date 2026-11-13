import { describe, expect, it } from 'vitest';
import { createSeed } from '../data/seed';
import { curriculum, indicators } from '../components/labels';
import { confirmDesign, confirmRules, reviewIndicators } from '../domain/lifecycle';
import { addGeneratedPair, buildPairPlan } from '../domain/singlePair';
import { reviseAssessmentItem } from '../domain/assessmentRevision';
import { buildSinglePlan, emptySingleDraft, validateSelection, validateSingleDraft, validateSingleResult, validateStart } from './singlePath';
import { addIntakeProject } from './intake';
import { directionFields, directionsProblem, emptyIdeas, singleToIntake, suggestedDirections, suggestedSelection } from './singlePath';
import { plainDirectionProblem } from './uxText';
import { buildLessonOverview } from '../documents/lessonOverview';
import { buildDocument, documentMarkdown } from '../documents/model';
import { plainProblem } from './uxText';
import { mergeFullDesign } from './fullDesign';
import { fullFixture } from './fullFixture.test-helper';

const performance = curriculum.find(row => row.subject === '化學' && row.kind === 'learning_performance') ?? curriculum.find(row => row.subject === '自然科學' && row.kind === 'learning_performance')!;
const indicator = indicators.entries[0];
function draft() { return { ...emptySingleDraft(), grade: '高二', subject: performance.subject, topic: '如何用生活資料判斷變化？', title: '生活資料判讀', keywords: '資料、證據、判讀', periods: '3', curriculumIds: [performance.id], indicatorIds: [indicator.id] }; }
function readySeed() { const original = createSeed(); return confirmDesign(confirmRules(reviewIndicators(original, original.activeProjectId), original.activeProjectId), original.activeProjectId); }

describe('單一路徑邊界', () => {
  it('第一畫面只需五項，進入設計須選學習表現及子指標', () => {
    const first = draft();
    expect(() => validateStart({ ...first, periods: '', curriculumIds: [], indicatorIds: [] })).not.toThrow();
    expect(() => validateSelection({ ...first, curriculumIds: [] })).toThrow('學習表現');
    expect(() => validateSelection({ ...first, indicatorIds: [] })).toThrow('NPDL');
    expect(() => validateSelection(first)).not.toThrow();
    expect(() => validateStart({ ...first, keywords: '資料、證據' })).toThrow('3–5');
  });
  it('發想草稿拒絕未知欄位，推薦只送必要輸入與固定課綱', () => {
    const current = draft();
    expect(validateSingleDraft(current)).toEqual(current);
    expect(() => validateSingleDraft({ ...current, secret: '不應保存' })).toThrow('欄位');
    const plan = buildSinglePlan(current, 'recommend');
    // 候選課綱只送短編號、代碼與條文，不送正式長編號。
    expect(JSON.stringify(plan.payload)).not.toContain(performance.id); expect((plan.payload.learningPerformances as { no: string }[])[0].no).toBe('P1');
    expect(JSON.stringify(plan.payload)).not.toContain('startingPoint');
  });
  it('成對請求明確要求簡短說明且不要求自評', () => {
    const project = readySeed().projects[0];
    const plan = buildPairPlan(project);
    const schema = plan.payload.outputSchema as { properties: { pre: { properties: { capability: { items: { required: string[] } } } } } };
    expect(schema.properties.pre.properties.capability.items.required).toContain('shortResponse');
    expect(plan.instructions).toContain('post.reflection 都是空陣列');
    expect(plan.instructions).not.toContain('自評與一項課程證據');
  });
  it('驅動問題與最終作品帶進後續請求、正式專案、課程一覽與教師文件', () => {
    const { seed, approved, response } = fullFixture();
    const chosen = { ...approved, drivingQuestion: '快一點，就能證明嗎？', finalProduct: '給學弟妹的實驗判讀指南' };
    for (const kind of ['goals', 'full'] as const) {
      const plan = buildSinglePlan(kind === 'goals' ? { ...chosen, goals: [], criteria: [], activities: [] } : chosen, kind);
      expect(plan.payload.course).toMatchObject({ drivingQuestion: '快一點，就能證明嗎？', finalProduct: '給學弟妹的實驗判讀指南' });
      expect(plan.instructions).toContain('course.drivingQuestion');
    }
    expect(buildSinglePlan({ ...approved, goals: [], criteria: [], activities: [] }, 'goals').payload.course).not.toHaveProperty('drivingQuestion');
    const next = addIntakeProject(seed, singleToIntake(chosen), mergeFullDesign(chosen, response), directionFields(chosen));
    const project = next.projects.find(row => row.id === next.activeProjectId)!;
    expect(project.input).toMatchObject({ drivingQuestion: '快一點，就能證明嗎？', finalProduct: '給學弟妹的實驗判讀指南' });
    expect(project.designs[0].inputSnapshot.drivingQuestion).toBe('快一點，就能證明嗎？');
    expect(buildLessonOverview(project)).toMatchObject({ drivingQuestion: '快一點，就能證明嗎？', finalProduct: '給學弟妹的實驗判讀指南' });
    expect(documentMarkdown(buildDocument(project, 'teacher'))).toContain('最終作品：給學弟妹的實驗判讀指南');
    const old = addIntakeProject(seed, singleToIntake(approved), mergeFullDesign(approved, response));
    const oldProject = old.projects.find(row => row.id === old.activeProjectId)!;
    expect(oldProject.input).not.toHaveProperty('drivingQuestion');
    expect(buildLessonOverview(oldProject).drivingQuestion).toBe(oldProject.input.topic);
  });
  it('逐節教案由程式套用已核對目標與規準，AI 只用編號參照', () => {
    const { seed, approved, response } = fullFixture();
    const content = mergeFullDesign(approved, response);
    expect(content.goals.map(row => row.text)).toEqual(approved.goals.map(row => row.text));
    expect(content.criteria[0].stages).toEqual(approved.criteria[0].stages);
    expect(() => validateSingleResult(approved, 'full', response)).not.toThrow();
    expect(() => addIntakeProject(seed, singleToIntake(approved), content)).not.toThrow();
    const plan = buildSinglePlan(approved, 'full');
    const schema = plan.payload.outputSchema as { required: string[]; properties: Record<string, unknown> };
    expect(schema.required).not.toContain('criteria');
    expect(plan.instructions).not.toContain('不可改寫');
    expect(JSON.stringify(plan.payload.approvedOutline)).toContain('criterion-1');
  });
  it('前後測一次保存且失敗時不留下半份題組', () => {
    const workspace = readySeed();
    const project = workspace.projects[0];
    project.workflow = 'single-v1';
    project.assessments[1].reflection = [];
    const pre = structuredClone(project.assessments[0]);
    const post = structuredClone(project.assessments[1]);
    for (const item of [...pre.capability, ...post.capability, ...post.application]) {
      item.shortResponse = { prompt: '請說明資料依據', example: '指出一項資料', evidence: '資料與推論相連' };
      if (item.applicationCriteria) item.curriculumIds = project.input.curriculumIds.filter(id => curriculum.find(row => row.id === id)?.kind === 'learning_performance');
    }
    const before = project.assessments.length;
    expect(() => addGeneratedPair(workspace, project.id, { pre: { capability: pre.capability, application: [], reflection: [] }, post: { capability: post.capability, application: post.application, reflection: [] } })).not.toThrow();
    const next = addGeneratedPair(workspace, project.id, { pre: { capability: pre.capability, application: [], reflection: [] }, post: { capability: post.capability, application: post.application, reflection: [] } });
    expect(next.projects[0].assessments).toHaveLength(before + 2);
    expect(next.projects[0].assessments.find(row => row.id === next.projects[0].activePostId)?.parentPreId).toBe(next.projects[0].activePreId);
    expect(workspace.projects[0].assessments).toHaveLength(before);
    expect(() => addGeneratedPair(workspace, project.id, { pre: { capability: pre.capability, application: [], reflection: [] }, post: { capability: post.capability, application: [], reflection: [] } })).toThrow('課綱題');
    expect(workspace.projects[0].assessments).toHaveLength(before);
  });
  it('單題修訂保留原題用途及前後配對，且拒絕漏掉簡短說明', () => {
    const workspace = readySeed();
    const project = workspace.projects[0];
    project.workflow = 'single-v1';
    project.assessments[1].reflection = [];
    for (const assessment of project.assessments) for (const item of [...assessment.capability, ...assessment.application]) {
      item.shortResponse = { prompt: '請說明理由', example: '以資料解釋', evidence: '指出資料' };
      if (item.applicationCriteria) item.curriculumIds = [project.input.curriculumIds[0]];
    }
    const pre = project.assessments.find(row => row.id === project.activePreId)!;
    const item = pre.capability[0];
    const changed = { ...item, title: `${item.title}（修訂）` };
    const next = reviseAssessmentItem(workspace, project.id, pre.id, item.id, changed);
    const current = next.projects[0];
    expect(current.activePreId).not.toBe(project.activePreId);
    expect(current.activePostId).not.toBe(project.activePostId);
    expect(current.assessments.find(row => row.id === current.activePostId)?.parentPreId).toBe(current.activePreId);
    expect(project.assessments.find(row => row.id === project.activePostId)?.parentPreId).toBe(project.activePreId);
    expect(() => reviseAssessmentItem(workspace, project.id, pre.id, item.id, { ...changed, shortResponse: undefined })).toThrow('簡短說明');
  });
});

describe('逐欄發想（課程方向構想）', () => {
  it('舊草稿沒有構想欄位時補空白；未知欄位仍整份拒絕', () => {
    const old = { ...emptySingleDraft() } as Record<string, unknown>; delete old.ideas;
    expect(validateSingleDraft(old).ideas).toEqual(emptyIdeas());
    expect(() => validateSingleDraft({ ...emptySingleDraft(), ideas: { ...emptyIdeas(), extra: '' } })).toThrow('課程構想');
  });
  it('有填的構想會送進推薦與各段請求，並帶入正式專案的教師註記與學生起點', () => {
    const draft = { ...emptySingleDraft(), grade: '高二', subject: '化學', topic: '如何判斷反應快慢？', title: '反應速率', keywords: '反應速率、證據、變因', ideas: { ...emptyIdeas(), startingPoint: '學生學過莫耳濃度', activityIdea: '碘鐘反應實驗' } };
    const plan = buildSinglePlan(draft, 'recommend');
    expect(plan.payload.teacherIdeas).toEqual({ startingPoint: '學生學過莫耳濃度', activityIdea: '碘鐘反應實驗' });
    expect(plan.instructions).toContain('teacherIdeas');
    const intake = singleToIntake({ ...draft, periods: '3', curriculumIds: [curriculum.find(row => row.kind === 'learning_performance' && ['化學', '自然科學'].includes(row.subject))!.id], indicatorIds: ['critical-evaluate-information'] });
    expect(intake.startingPoint).toBe('學生學過莫耳濃度'); expect(intake.activityIdea).toBe('碘鐘反應實驗');
  });
  it('沒填構想時不送 teacherIdeas', () => {
    const draft = { ...emptySingleDraft(), grade: '高二', subject: '化學', topic: '如何判斷反應快慢？', title: '反應速率', keywords: '反應速率、證據、變因' };
    expect(buildSinglePlan(draft, 'recommend').payload.teacherIdeas).toBeUndefined();
  });
});

describe('課綱推薦：AI 寫成代碼或名稱時由程式對應', () => {
  const draft = { ...emptySingleDraft(), grade: '高二', subject: '化學', topic: '如何判斷反應快慢？', title: '反應速率', keywords: '反應速率、證據、變因', stage: 'start' as const };
  const perf = curriculum.find(row => row.kind === 'learning_performance' && ['化學', '自然科學'].includes(row.subject))!;
  const content = curriculum.find(row => row.kind !== 'learning_performance' && row.subject === '化學')!;
  it('課綱代碼、子指標名稱、超過 12 節與超過上限的條目都會被整理後通過', () => {
    const value = { title: '反應速率', periods: 16, curriculumIds: [content.code, perf.code, perf.id, content.id, 'x1', 'x2'], indicatorIds: ['能評估資訊和論點', 'critical-evaluate-information'], reason: '理由' };
    const dir = (row: object) => ({ drivingQuestion: '快一點就能證明嗎？', finalProduct: '給學弟妹的實驗判讀指南', ...row });
    // 對不上的 x1、x2 略過，其他整理後通過。
    validateSingleResult(draft, 'recommend', { directions: [dir(value)] });
    expect(() => validateSingleResult(draft, 'recommend', { directions: [dir({ ...value, curriculumIds: ['x1'] })] })).toThrow('缺學習表現');
    const ok = { ...value, curriculumIds: [content.code, perf.code] };
    validateSingleResult(draft, 'recommend', { directions: [dir(ok)] });
    const result = suggestedSelection(ok, '化學');
    expect(result.curriculumIds[0]).toBe(perf.id); expect(result.curriculumIds).toContain(content.id);
    expect(result.indicatorIds).toEqual(['critical-evaluate-information']); expect(result.periods).toBe(12);
  });
  it('3 個課程方向：各含驅動問題與最終作品；不合格的方向略過，全部不合格才退回', () => {
    const good = (n: number) => ({ title: `方向${n}`, drivingQuestion: `問題${n}？`, finalProduct: `作品${n}`, periods: 3, performanceIds: [perf.id], contentIds: [content.id], indicatorIds: ['critical-evaluate-information'], reason: '理由' });
    const list = suggestedDirections({ directions: [good(1), { ...good(2), drivingQuestion: '' }, good(3)] }, '化學');
    expect(list.map(row => row.title)).toEqual(['方向1', '方向3']);
    expect(list[0]).toMatchObject({ drivingQuestion: '問題1？', finalProduct: '作品1' });
    expect(() => suggestedDirections({ directions: [{ ...good(1), finalProduct: ' ' }] }, '化學')).toThrow('驅動問題或最終作品');
    expect(() => suggestedDirections(good(1), '化學')).toThrow('directions');
    expect(plainProblem('課程方向缺少驅動問題或最終作品。')).toContain('少了驅動問題或最終作品');
    const plan = buildSinglePlan({ ...draft, finalProduct: '班級海報' }, 'recommend');
    expect(JSON.stringify(plan.payload.outputSchema)).toContain('"directions"'); expect(plan.instructions).toContain('3 個明顯不同的課程方向');
    expect(plan.payload.teacherDirection).toEqual({ finalProduct: '班級海報' });
  });
  it('不足 3 個合格方向時，列出哪個方向哪裡不合格並請 AI 修正；教師看到白話原因', () => {
    const good = (n: number) => ({ title: `方向${n}`, drivingQuestion: `問題${n}？`, finalProduct: `作品${n}`, periods: 3, performanceIds: [perf.id], contentIds: [content.id], indicatorIds: ['critical-evaluate-information'], reason: '理由' });
    expect(directionsProblem({ directions: [good(1), good(2), good(3)] }, '化學')).toBeNull();
    // 方向 2 課綱對不上、方向 3 只有學習內容：都不合格，各自說明原因。
    const problem = directionsProblem({ directions: [good(1), { ...good(2), performanceIds: ['不存在'] }, { ...good(3), performanceIds: [] }] }, '化學')!;
    expect(problem).toMatch(/^課程方向不足：只有 1 個方向符合規定/);
    expect(problem).toContain('方向 2：課程方向缺學習表現（另有 1 條課綱對不上本學科）'); expect(problem).toContain('方向 3：課程方向缺學習表現。');
    expect(plainProblem(problem)).toContain('只有 1 個符合規定');
    expect(plainDirectionProblem('方向 2：課程方向缺學習表現（另有 1 條課綱對不上本學科）。')).toBe('方向 2：缺學習表現（部分課綱對不上本學科）');
    expect(plainDirectionProblem('方向 3：課程方向缺學習內容。')).toBe('方向 3：缺學習內容');
    expect(() => suggestedDirections({ directions: [{ ...good(1), indicatorIds: [] }] }, '化學')).toThrow('缺子指標');
    expect(() => suggestedDirections({ directions: [{ ...good(1), contentIds: [] }] }, '化學')).toThrow('缺學習內容');
    // AI 把學習表現放進 contentIds：程式依課綱資料重新歸類，照樣通過。
    const swapped = suggestedDirections({ directions: [{ ...good(1), performanceIds: [content.code], contentIds: [perf.code] }] }, '化學')[0];
    expect(swapped.curriculumIds).toEqual([perf.id, content.id]);
    const plan = buildSinglePlan(draft, 'recommend');
    expect(plan.instructions).toContain('三欄都一定要有'); expect(plan.payload).not.toHaveProperty('curriculum');
    expect((plan.payload.learningPerformances as unknown[]).length).toBeGreaterThan(0); expect((plan.payload.learningContents as unknown[]).length).toBeGreaterThan(0);
    expect(plainDirectionProblem('方向 2：課綱建議不在指定學科固定資料。')).toBe('方向 2：課綱條目對不上本學科');
    expect(plainDirectionProblem('方向 3：推薦須包含學習表現且不超過 12 節。')).toBe('方向 3：只有學習內容，沒有學習表現');
    expect(directionsProblem({ directions: [good(1)] }, '化學')).toContain('只回傳 1 個方向');
  });
  it('舊草稿沒有驅動問題與最終作品時補空白；有填才帶進後續請求', () => {
    const { drivingQuestion: _d, finalProduct: _f, ...old } = { ...draft }; void _d; void _f;
    expect(validateSingleDraft(old)).toMatchObject({ drivingQuestion: '', finalProduct: '' });
    expect(() => validateSingleDraft({ ...draft, drivingQuestion: 'x'.repeat(2001) })).toThrow('驅動問題或最終作品');
  });
  it('只推薦學習內容時，白話說明原因', () => {
    expect(plainProblem('推薦須包含學習表現且不超過 12 節。')).toContain('沒有學習表現');
    expect(plainProblem('課綱建議不在指定學科固定資料。')).toContain('課綱條目對不上');
  });
});
