import { describe, expect, it } from 'vitest';
import { createSeed } from '../data/seed';
import { curriculum } from '../components/labels';
import { confirmDesign, confirmRules, reviewIndicators } from '../domain/lifecycle';
import { addGeneratedPair, buildPairPlan, buildPhasePlan } from '../domain/singlePair';
import indicatorData from '../data/indicators.json';
import { buildDocument, documentMarkdown } from '../documents/model';
import { fixedReflections, NO_EVIDENCE_LABEL, REFLECTION_QUESTIONS } from '../documents/fixedReflection';
import { mindsetWords } from './uxText';
import { buildSinglePlan } from './singlePath';
import { fullFixture } from './fullFixture.test-helper';

function readySeed() { const original = createSeed(); return confirmDesign(confirmRules(reviewIndicators(original, original.activeProjectId), original.activeProjectId), original.activeProjectId); }
function singleWithPair(capabilityCriteria = false) {
  const workspace = readySeed(), project = workspace.projects[0];
  project.workflow = 'single-v1'; project.assessments[1].reflection = [];
  const pre = structuredClone(project.assessments[0]), post = structuredClone(project.assessments[1]);
  for (const item of [...pre.capability, ...post.capability, ...post.application]) {
    item.shortResponse = { prompt: '請說明資料依據', example: '指出一項資料', evidence: '資料與推論相連' };
    if (item.applicationCriteria) item.curriculumIds = project.input.curriculumIds.filter(id => curriculum.find(row => row.id === id)?.kind === 'learning_performance');
  }
  // 模擬 AI 在能力題也填了學科應用判準。
  if (capabilityCriteria) for (const item of [...pre.capability, ...post.capability]) item.applicationCriteria = { academic: '多填的學科判準', capability: '多填的能力判準' };
  return addGeneratedPair(workspace, project.id, { pre: { capability: pre.capability, application: [], reflection: [] }, post: { capability: post.capability, application: post.application, reflection: [] } });
}

describe('R12-r12 能力題多填的應用判準由程式清掉', () => {
  it('不再因「能力比較與學科應用不可混用」退回，保存後能力題判準為 null', () => {
    const next = singleWithPair(true);
    const project = next.projects[0];
    const pre = project.assessments.find(a => a.id === project.activePreId)!, post = project.assessments.find(a => a.id === project.activePostId)!;
    expect([...pre.capability, ...post.capability].every(q => q.applicationCriteria === null)).toBe(true);
    expect(post.application.every(q => q.applicationCriteria !== null)).toBe(true);
  });
  it('放錯位置的應用題（帶課綱與應用判準）不會被靜默改成能力題，交給驗證退回', () => {
    const workspace = readySeed(), project = workspace.projects[0];
    project.workflow = 'single-v1'; project.assessments[1].reflection = [];
    const pre = structuredClone(project.assessments[0]), post = structuredClone(project.assessments[1]);
    for (const item of [...pre.capability, ...post.capability, ...post.application]) item.shortResponse = { prompt: '說明', example: '例', evidence: '證據' };
    const performance = project.input.curriculumIds.filter(id => curriculum.find(row => row.id === id)?.kind === 'learning_performance');
    for (const item of post.application) item.curriculumIds = performance;
    post.capability[0].curriculumIds = performance; post.capability[0].applicationCriteria = { academic: '學科', capability: '能力' };
    expect(() => addGeneratedPair(workspace, project.id, { pre: { capability: pre.capability, application: [], reflection: [] }, post: { capability: post.capability, application: post.application, reflection: [] } })).toThrow('能力比較與學科應用不可混用');
  });
});

describe('R12-r13 Codex 第二輪補強', () => {
  it('能力題只帶課綱編號時，程式拿掉課綱編號；輸出結構只有應用題接受 curriculumIds', () => {
    const workspace = readySeed(), project = workspace.projects[0];
    project.workflow = 'single-v1'; project.assessments[1].reflection = [];
    const pre = structuredClone(project.assessments[0]), post = structuredClone(project.assessments[1]);
    for (const item of [...pre.capability, ...post.capability, ...post.application]) item.shortResponse = { prompt: '說明', example: '例', evidence: '證據' };
    const performance = project.input.curriculumIds.filter(id => curriculum.find(row => row.id === id)?.kind === 'learning_performance');
    for (const item of post.application) item.curriculumIds = performance;
    for (const item of [...pre.capability, ...post.capability]) { item.curriculumIds = performance; item.applicationCriteria = null; }
    const next = addGeneratedPair(workspace, project.id, { pre: { capability: pre.capability, application: [], reflection: [] }, post: { capability: post.capability, application: post.application, reflection: [] } }).projects[0];
    const saved = [...next.assessments.find(a => a.id === next.activePreId)!.capability, ...next.assessments.find(a => a.id === next.activePostId)!.capability];
    expect(saved.every(q => !q.curriculumIds || q.curriculumIds.length === 0)).toBe(true);
    const schema = buildPairPlan(next).payload.outputSchema as { properties: { post: { properties: Record<string, { items: { properties: Record<string, unknown> } }> } } };
    expect(schema.properties.post.properties.capability.items.properties.curriculumIds).toBeUndefined();
    expect(schema.properties.post.properties.application.items.properties.curriculumIds).toBeDefined();
  });
  it('完整教案的本地規則不再要求標示比較狀態', () => {
    const { approved } = fullFixture();
    expect(buildSinglePlan(approved, 'full').instructions).not.toContain('可比較題必須更換實質情境');
  });
});

describe('R12-r12 提示詞', () => {
  it('前後測要求數據標明模擬、不寫具體法條，能力題判準為 null', () => {
    const workspace = readySeed(); workspace.projects[0].workflow = 'single-v1';
    const plan = buildPairPlan(workspace.projects[0]);
    expect(plan.instructions).toContain('模擬資料');
    expect(plan.instructions).toContain('不引用具體法規條號');
    expect(plan.instructions).toContain('applicationCriteria 一律為 null');
  });
  it('分段重寫前測或後測也帶資料與法規規則', () => {
    const project = singleWithPair().projects[0];
    for (const phase of ['pre', 'post'] as const) expect(buildPhasePlan(project, phase).instructions).toContain('（模擬資料）');
  });
  it('目標、規準與完整教案要求只評看得見的表現；完整教案說明不含自評', () => {
    const { approved: draft } = fullFixture();
    expect(buildSinglePlan({ ...draft, stage: 'goals', goals: [], criteria: [], activities: [] }, 'goals').instructions).toContain('不要評量態度、動機');
    expect(buildSinglePlan({ ...draft, stage: 'evidence', criteria: [], activities: [] }, 'evidence').instructions).toContain('不要評量態度、動機');
    const full = buildSinglePlan(draft, 'full').instructions;
    expect(full).toContain('不要評量態度、動機');
    expect(full).toContain('前後測另外產生且不含自評');
    expect(full).toContain('（模擬資料）');
    expect(full).not.toContain('自評 descriptions');
    expect(full).not.toContain('後測完整包含新情境能力題、學科應用、自評');
  });
});

describe('R12-r12 規準心態詞提醒', () => {
  it('找出內在心態字眼；可觀察描述不提醒', () => {
    expect(mindsetWords(['學生展現真誠的志趣與勇氣'])).toEqual(expect.arrayContaining(['真誠', '勇氣', '志趣']));
    expect(mindsetWords(['能引用兩項資料說明方案限制'])).toEqual([]);
  });
});

describe('R12-r12 後測固定反思題與使用須知', () => {
  it('單一路徑的學生題本與教師手冊都有固定反思，每個子指標一組', () => {
    const project = singleWithPair().projects[0];
    const design = project.designs.find(d => d.id === project.activeDesignId)!;
    const groups = fixedReflections(design);
    expect(groups).toHaveLength(design.inputSnapshot.indicatorIds.length);
    expect(groups[0].stages.map(s => s.stage)).toEqual(['證據有限', '萌芽', '發展', '精熟']);
    for (const audience of ['student', 'teacher'] as const) {
      const md = documentMarkdown(buildDocument(project, audience));
      expect(md).toContain('後測第三部分：反思');
      expect(md).toContain(NO_EVIDENCE_LABEL);
      for (const q of REFLECTION_QUESTIONS) expect(md).toContain(q);
      expect(md).toContain('不改變能力題的結果');
    }
  });
  it('非單一路徑不加固定反思', () => {
    const workspace = readySeed(), project = workspace.projects[0];
    project.assessments.forEach(a => { if (a.phase === 'post') a.reflection = []; });
    expect(documentMarkdown(buildDocument(project, 'student'))).not.toContain('後測第三部分：反思');
  });
  it('四階描述逐字等於學生進程原文；產生文件不改動題組資料', () => {
    const project = singleWithPair().projects[0];
    const before = JSON.stringify(project.assessments);
    const design = project.designs.find(d => d.id === project.activeDesignId)!;
    for (const group of fixedReflections(design)) {
      const source = indicatorData.entries.find(row => row.name === group.name)!;
      expect(group.stages.map(s => s.text)).toEqual(source.stages);
    }
    buildDocument(project, 'student'); buildDocument(project, 'teacher');
    expect(JSON.stringify(project.assessments)).toBe(before);
  });
  it('學生題本不含版本編號、設計來源、確認或施測紀錄', () => {
    const project = singleWithPair().projects[0];
    const md = documentMarkdown(buildDocument(project, 'student'));
    for (const id of [project.activeDesignId, project.activePreId!, project.activePostId!]) expect(md).not.toContain(id);
    expect(md).not.toMatch(/設計來源|教師已確認|尚未記錄施測|題組版本|規準 rubric/);
  });
  it('教師手冊只在開頭說明一次課綱摘錄與形成性回饋，不再逐條逐節重複', () => {
    const md = documentMarkdown(buildDocument(singleWithPair().projects[0], 'teacher'));
    expect(md).toContain('## 使用須知');
    expect(md.match(/未重新逐字校對/g)).toHaveLength(1);
    expect(md).not.toContain('不納入情境階段');
  });
});
