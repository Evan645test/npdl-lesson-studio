import { describe, expect, it, vi } from 'vitest';
import { createSeed } from '../data/seed';
import { curriculum } from '../components/labels';
import { confirmDesign, confirmRules, reviewIndicators } from './lifecycle';
import { addGeneratedPair, addRegeneratedPhase, buildPairPlan, buildPhasePlan, resolveCurriculumId } from './singlePair';
import { restoreItemIdentity, reviseAssessmentItem } from './assessmentRevision';
import { RepairFailed, RepairNeeded, problemOf, runRequest } from '../services/openai';
import { hasFreeText, summarizePayload } from '../next/requestSummary';
import { buildPrompt } from '../documents/prompt';
import { buildDocument } from '../documents/model';
import type { Workspace } from './types';

function ready(): Workspace {
  const seed = createSeed();
  const workspace = confirmDesign(confirmRules(reviewIndicators(seed, seed.activeProjectId), seed.activeProjectId), seed.activeProjectId);
  workspace.projects[0].workflow = 'single-v1';
  workspace.projects[0].assessments[1].reflection = [];
  return workspace;
}
function pairFrom(workspace: Workspace) {
  const project = workspace.projects[0];
  const pre = structuredClone(project.assessments[0]), post = structuredClone(project.assessments[1]);
  for (const item of [...pre.capability, ...post.capability, ...post.application]) {
    item.shortResponse = { prompt: '請說明資料依據', example: '指出一項資料', evidence: '資料與推論相連' };
    if (item.applicationCriteria) item.curriculumIds = project.input.curriculumIds.filter(id => curriculum.find(row => row.id === id)?.kind === 'learning_performance');
  }
  return { pre: { capability: pre.capability, application: [], reflection: [] }, post: { capability: post.capability, application: post.application, reflection: [] } };
}
const withPair = () => { const workspace = ready(); return addGeneratedPair(workspace, workspace.projects[0].id, pairFrom(workspace)); };

describe('R12-r5 不判定前後測可否比較', () => {
  it('單一路徑即使藍圖標了可作有限比較、出題條件文字不同，也照樣保存', () => {
    const workspace = ready();
    workspace.projects[0].designs[0].blueprint.forEach(row => { row.status = '可作有限比較'; });
    const pair = pairFrom(workspace);
    pair.post.capability[0].conditions = { ...pair.post.capability[0].conditions, reading: '另一種寫法的閱讀量描述' };
    expect(() => addGeneratedPair(workspace, workspace.projects[0].id, pair)).not.toThrow();
    const legacy = structuredClone(workspace); delete legacy.projects[0].workflow; legacy.projects[0].assessments[1].reflection = structuredClone(createSeed().projects[0].assessments[1].reflection);
    expect(() => addGeneratedPair(legacy, legacy.projects[0].id, { ...pair, post: { ...pair.post, reflection: legacy.projects[0].assessments[1].reflection } })).toThrow();
  });
  it('前後測情境完全相同仍退回，並指出是哪一組、哪一欄', () => {
    const workspace = ready(); const pair = pairFrom(workspace);
    pair.post.capability[0].context = pair.pre.capability[0].context;
    expect(() => addGeneratedPair(workspace, workspace.projects[0].id, pair)).toThrow(/pre-1 ↔ post-1.*情境文字完全相同/);
  });
  it('成對請求不再要求可比，附上老師建議並改變同意範圍', () => {
    const workspace = ready();
    const plan = buildPairPlan(workspace.projects[0], '情境改用校園生活');
    expect(plan.instructions).not.toMatch(/可比|可作有限比較/);
    expect(plan.instructions).toContain('不可照抄');
    expect(plan.payload.teacherSuggestion).toBe('情境改用校園生活');
    expect(plan.consentScope).toMatch(/suggestion:/);
    expect(JSON.stringify((plan.payload.design as { blueprint: unknown[] }).blueprint)).not.toContain('status');
    expect(() => buildPairPlan(workspace.projects[0], '字'.repeat(1001))).toThrow('1000');
  });
});

describe('R12-r5 只重寫前測或後測', () => {
  it('重寫後測：前測不變，新後測配到同一份前測', () => {
    const workspace = withPair(), project = workspace.projects[0];
    const plan = buildPhasePlan(project, 'post', '選項精簡');
    expect(plan.payload.task).toBe('regenerate-post');
    expect((plan.payload.pairedTest as { phase: string }).phase).toBe('pre');
    const post = structuredClone(project.assessments.find(row => row.id === project.activePostId)!);
    post.capability[0].title = '新版後測題';
    const next = addRegeneratedPhase(workspace, project.id, 'post', { capability: post.capability, application: post.application, reflection: [] });
    const p = next.projects[0];
    expect(p.activePreId).toBe(project.activePreId);
    expect(p.assessments.find(row => row.id === p.activePostId)!.capability[0].title).toBe('新版後測題');
    expect(p.assessments).toHaveLength(project.assessments.length + 1);
  });
  it('重寫前測：後測內容不變，另存一版配到新前測', () => {
    const workspace = withPair(), project = workspace.projects[0];
    expect(buildPhasePlan(project, 'pre').payload.task).toBe('regenerate-pre');
    const pre = structuredClone(project.assessments.find(row => row.id === project.activePreId)!);
    pre.capability[0].title = '新版前測題';
    const next = addRegeneratedPhase(workspace, project.id, 'pre', { capability: pre.capability, application: [], reflection: [] });
    const p = next.projects[0], newPost = p.assessments.find(row => row.id === p.activePostId)!;
    expect(p.assessments.find(row => row.id === p.activePreId)!.capability[0].title).toBe('新版前測題');
    expect(newPost.parentPreId).toBe(p.activePreId);
    expect(newPost.capability).toEqual(project.assessments.find(row => row.id === project.activePostId)!.capability);
    expect(p.assessments).toHaveLength(project.assessments.length + 2);
  });
  it('重寫前測若照抄後測情境，整份退回、不留半套', () => {
    const workspace = withPair(), project = workspace.projects[0];
    const post = project.assessments.find(row => row.id === project.activePostId)!;
    const pre = structuredClone(project.assessments.find(row => row.id === project.activePreId)!);
    pre.capability[0].context = post.capability[0].context;
    expect(() => addRegeneratedPhase(workspace, project.id, 'pre', { capability: pre.capability, application: [], reflection: [] })).toThrow('情境文字');
    expect(workspace.projects[0].assessments).toHaveLength(project.assessments.length);
  });
});

describe('R12-r5 修復請求帶具體原因、白話預覽', () => {
  const settings = { key: 'sk-test-r12r5-0000000000', model: 'gpt-4.1' };
  const api = (text: string) => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }));
  it('JSON 語法錯誤與驗證錯誤都寫進修復請求，修復再失敗回報原因', async () => {
    expect(problemOf(new SyntaxError('Unexpected token'))).toContain('不是合法 JSON');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => api('{"a":1]}')));
    const plan = buildPairPlan(ready().projects[0]);
    let repair: RepairNeeded | null = null;
    try { await runRequest(plan, settings, true, new AbortController().signal, () => {}); } catch (error) { if (error instanceof RepairNeeded) repair = error; else throw error; }
    expect(repair!.reason).toContain('不是合法 JSON');
    expect((repair!.plan.payload.repair as { problem: string }).problem).toContain('不是合法 JSON');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => api('{"ok":1}')));
    await expect(runRequest(repair!.plan, settings, true, new AbortController().signal, () => { throw new Error('後測情境（pre-1 → post-1）：情境相同'); })).rejects.toSatisfy((error: unknown) => error instanceof RepairFailed && error.reason.includes('pre-1 → post-1'));
  });
  it('白話摘要列出送出內容；只有自由文字時才提醒去識別', () => {
    const plan = buildPairPlan(ready().projects[0], '改用校園情境');
    const lines = summarizePayload(plan.payload);
    expect(lines.some(line => line.startsWith('課程：'))).toBe(true);
    expect(lines.some(line => line.includes('前後測配對'))).toBe(true);
    expect(lines).toContain('老師建議：「改用校園情境」');
    expect(hasFreeText(plan.payload)).toBe(true);
    expect(hasFreeText(buildPairPlan(ready().projects[0]).payload)).toBe(false);
  });
});

describe('R12-r5 教師手冊與判讀提示詞不再談可否比較', () => {
  it('單一路徑使用不含比較標籤的判讀提示詞與手冊文字', () => {
    const project = withPair().projects[0];
    // 只檢查提示詞的指示部分；後面附的是題目資料本身。
    const prompt = buildPrompt(project).split('以下是固定版本的設計資料')[0];
    expect(prompt).not.toMatch(/可作有限比較|不宜比較|可比較/);
    expect(prompt).toContain('前後表現對照');
    const manual = buildDocument(project, 'teacher').blocks.map(block => block.text).join('\n');
    expect(manual).not.toMatch(/可比較能力題|比較藍圖|等值化/);
    expect(manual).toContain('出題條件（供教師參考）');
  });
});

describe('R12-r7 等待逾時訊息', () => {
  it('逾時訊息說明等了多久、沒有重複的保存字句', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))));
    const error = await runRequest(buildPairPlan(ready().projects[0]), { key: 'sk-test-r12r7-000000000', model: 'gpt-4.1' }, true, new AbortController().signal, () => {}, 60).then(() => new Error('沒有逾時'), (e: unknown) => e as Error);
    expect(error.message).toContain('逾時（已等 0 秒');
    expect(error.message.match(/保存|保留/g)).toHaveLength(2);
    expect(error.message).not.toMatch(/。$/);
  });
});


describe('R12-r8 題號與對應編號由程式補回', () => {
  it('前後測配對題寫錯對應規準時，依藍圖補回後照樣保存', () => {
    const workspace = ready(), pair = pairFrom(workspace);
    pair.pre.capability.forEach(item => { item.criterionIds = ['c-limit', 'c-compare']; });
    pair.post.capability.forEach(item => { item.criterionIds = ['c-limit', 'c-compare']; });
    const next = addGeneratedPair(workspace, workspace.projects[0].id, pair).projects[0];
    const design = next.designs.find(row => row.id === next.activeDesignId)!;
    const pre = next.assessments.find(row => row.id === next.activePreId)!;
    for (const row of design.blueprint) expect(pre.capability.find(item => item.id === row.preId)!.criterionIds).toEqual(row.criterionIds);
  });
  it('單題重生沒回傳或改了題號與對應編號，程式從原題補回', () => {
    const workspace = withPair(), project = workspace.projects[0];
    const pre = project.assessments.find(row => row.id === project.activePreId)!, original = pre.capability[0];
    const { id: _id, criterionIds: _criteria, ...rest } = structuredClone(original); void _id; void _criteria;
    const fromAi = { ...rest, id: 'q-new', criterionIds: ['c-other'], title: 'AI 重生的新題' };
    const restored = restoreItemIdentity(original, fromAi);
    expect([restored.id, restored.criterionIds]).toEqual([original.id, original.criterionIds]);
    expect(() => reviseAssessmentItem(workspace, project.id, pre.id, original.id, restoreItemIdentity(original, rest))).toThrow('沒有變更');
    expect(() => reviseAssessmentItem(workspace, project.id, pre.id, original.id, restored)).not.toThrow();
  });
  it('題目用途依原題：能力題多帶評分說明、應用題漏回評分說明都不會被退回', () => {
    const workspace = withPair(), project = workspace.projects[0];
    const post = project.assessments.find(row => row.id === project.activePostId)!;
    const capability = post.capability[0], application = post.application[0];
    const asCapability = restoreItemIdentity(capability, { ...structuredClone(capability), title: '能力題新版', applicationCriteria: { academic: '多帶的', capability: '多帶的' } });
    expect(asCapability.applicationCriteria).toBeNull();
    expect(() => reviseAssessmentItem(workspace, project.id, post.id, capability.id, asCapability)).not.toThrow();
    const asApplication = restoreItemIdentity(application, { ...structuredClone(application), title: '應用題新版', applicationCriteria: null });
    expect(asApplication.applicationCriteria).toEqual(application.applicationCriteria);
    expect(asApplication.curriculumIds).toEqual(application.curriculumIds);
    expect(() => reviseAssessmentItem(workspace, project.id, post.id, application.id, asApplication)).not.toThrow();
  });
});

describe('R12-r9 課綱題的課綱編號由程式對應', () => {
  const performancesOf = (workspace: Workspace) => workspace.projects[0].input.curriculumIds.map(id => curriculum.find(row => row.id === id)!).filter(row => row.kind === 'learning_performance');
  it('AI 寫課綱代碼（含半形 V、大小寫不同、編號後段）也能對應成正式編號並保存', () => {
    const workspace = ready(), pair = pairFrom(workspace), [performance] = performancesOf(workspace);
    const plain = performance.code.normalize('NFKC').toUpperCase();
    pair.post.application.forEach(item => { item.curriculumIds = [plain]; });
    const next = addGeneratedPair(workspace, workspace.projects[0].id, pair).projects[0];
    const post = next.assessments.find(row => row.id === next.activePostId)!;
    expect(post.application.every(item => item.curriculumIds!.includes(performance.id))).toBe(true);
    const ids = workspace.projects[0].input.curriculumIds;
    expect(resolveCurriculumId(performance.id.split('-').slice(-4).join('-'), ids)).toBe(performance.id);
    expect(resolveCurriculumId('xx-不存在', ids)).toBe('xx-不存在');
  });
  it('缺課綱題時，錯誤訊息指出缺哪一條', () => {
    const workspace = ready(), pair = pairFrom(workspace), [performance] = performancesOf(workspace);
    pair.post.application.forEach(item => { item.curriculumIds = []; });
    expect(() => addGeneratedPair(workspace, workspace.projects[0].id, pair)).toThrow(`後測課綱題缺少 ${performance.code}`);
  });
  it('提示詞明列每條學習表現代碼，輸出格式接受代碼', () => {
    const workspace = withPair(), project = workspace.projects[0], [performance] = performancesOf(workspace);
    for (const plan of [buildPairPlan(project), buildPhasePlan(project, 'post')]) {
      expect(plan.instructions).toContain(performance.code);
      expect(JSON.stringify(plan.payload.outputSchema)).toContain(`"${performance.code}"`);
    }
  });
  it('只出一題卻標了多條學習表現，仍要求每條各一題', () => {
    const workspace = ready(), pair = pairFrom(workspace), [performance] = performancesOf(workspace);
    pair.post.application = pair.post.application.slice(0, 1);
    expect(() => addGeneratedPair(workspace, workspace.projects[0].id, pair)).not.toThrow();
    const second = curriculum.find(row => row.kind === 'learning_performance' && row.subject === performance.subject && row.id !== performance.id)!;
    const seed = createSeed(), source = seed.projects[0];
    for (const target of [source.input, source.designs[0].inputSnapshot]) target.curriculumIds = [...target.curriculumIds, second.id];
    const two = confirmDesign(confirmRules(reviewIndicators(seed, seed.activeProjectId), seed.activeProjectId), seed.activeProjectId);
    two.projects[0].workflow = 'single-v1'; two.projects[0].assessments[1].reflection = [];
    pair.post.application[0].curriculumIds = performancesOf(two).map(row => row.code);
    expect(() => addGeneratedPair(two, two.projects[0].id, pair)).toThrow('不能用一題同時涵蓋多條');
  });
  it('配對題題號一個都對不上藍圖時，依順序對齊題號與規準', () => {
    const workspace = ready(), pair = pairFrom(workspace);
    pair.pre.capability.forEach((item, index) => { item.id = `q${index + 1}`; item.criterionIds = ['錯的']; });
    const next = addGeneratedPair(workspace, workspace.projects[0].id, pair).projects[0];
    const design = next.designs.find(row => row.id === next.activeDesignId)!, pre = next.assessments.find(row => row.id === next.activePreId)!;
    expect(pre.capability.map(item => [item.id, item.criterionIds])).toEqual(design.blueprint.map(row => [row.preId, row.criterionIds]));
  });
});

