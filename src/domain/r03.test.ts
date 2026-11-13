import { describe, expect, it, vi, afterEach } from 'vitest';
import { createSeed } from '../data/seed';
import { inputSignature, validateWorkspace } from './validate';
import { addGeneratedAssessment, addGeneratedDesign } from './generated';
import { confirmDesign, confirmRules, markAdministered, reviewAssessment, reviewIndicators } from './lifecycle';
import { reviseActivity } from './revisions';
import { migrateWorkspace, parseBackup, saveWorkspace } from '../storage/workspace';
import { buildRequestPlan, RequestExpired, sourceSignature, validateRecommendations } from '../services/generation';
import { RepairNeeded, runRequest } from '../services/openai';
import { buildDocument, documentMarkdown } from '../documents/model';
import { wordBlob } from '../documents/export';

function ready() { const s = createSeed(); return confirmDesign(confirmRules(reviewIndicators(s, s.activeProjectId), s.activeProjectId), s.activeProjectId); }
function content() { const { id, createdAt, confirmedAt, origin, inputSnapshot, rubricVersion, ...rest } = createSeed().projects[0].designs[0]; void id; void createdAt; void confirmedAt; void origin; void inputSnapshot; void rubricVersion; return rest; }
function questions(phase: 'pre' | 'post') { const a = createSeed().projects[0].assessments[phase === 'pre' ? 0 : 1]; return { capability: a.capability, application: a.application, reflection: a.reflection }; }
const settings = { key: 'sk-isolated-unit-test-key', model: 'gpt-4.1' };
const signal = () => new AbortController().signal;
function api(value: unknown, status = 200) { return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }], usage: { total_tokens: 200 } }), { status }); }
function geminiApi(value: unknown, finishReason = 'STOP') { return new Response(JSON.stringify({ candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(value) }] } }], usageMetadata: { totalTokenCount: 123 } })); }
afterEach(() => vi.unstubAllGlobals());

describe('R03 契約、遷移與歷史', () => {
  it('v1 僅補安全預設，原題組與歷史內容保留且可往返', () => {
    const legacy = structuredClone(createSeed()) as unknown as Record<string, any>; legacy.schemaVersion = 1;
    for (const p of legacy.projects) for (const input of [p.input, ...p.designs.map((d: any) => d.inputSnapshot)]) { delete input.teacherNotes; delete input.indicatorReview; }
    const before = structuredClone(legacy), migrated = migrateWorkspace(validateWorkspace(legacy));
    expect(migrated.schemaVersion).toBe(2); expect(legacy).toEqual(before);
    expect(migrated.projects[0].assessments).toEqual(before.projects[0].assessments);
    expect(migrated.projects[0].designs[0].inputSnapshot.originalSource).toEqual(before.projects[0].designs[0].inputSnapshot.originalSource);
    expect(parseBackup(JSON.stringify(migrated))).toEqual(migrated);
  });
  it('舊備份未知欄位與新備份未知欄位皆整份拒絕', () => { expect(() => parseBackup(JSON.stringify({ ...createSeed(), hiddenKey: settings.key }))).toThrow('未知欄位'); });
  it('核對綁定完整輸入，修改教師註記不會沿用核對', () => { const s = reviewIndicators(createSeed(), 'manual-chemistry'); s.projects[0].input.teacherNotes = '新來源'; expect(() => validateWorkspace(s)).toThrow('已過期'); });
  it('只核對起點不改內容簽名，也不要求另生成設計', () => { const s = createSeed(), project = s.projects[0], before = inputSignature(project.input); const reviewed = reviewIndicators(s, s.activeProjectId); expect(inputSignature(reviewed.projects[0].input)).toBe(before); expect(inputSignature(reviewed.projects[0].input)).toBe(inputSignature(reviewed.projects[0].designs[0].inputSnapshot)); });
  it('題組確認錯誤指向實際按鈕，完成順序後可確認', () => { const s = createSeed(), preId = s.projects[0].activePreId!; expect(() => reviewAssessment(s, s.activeProjectId, preId)).toThrow('確認此設計的整合規則'); const indicators = reviewIndicators(s, s.activeProjectId); expect(() => confirmDesign(indicators, s.activeProjectId)).toThrow('確認此設計的整合規則'); const reviewed = reviewAssessment(confirmDesign(confirmRules(indicators, s.activeProjectId), s.activeProjectId), s.activeProjectId, preId); expect(reviewed.projects[0].assessments[0].reviewedAt).not.toBeNull(); });
  it('長目標與長鷹架符合 v2 2000 字上限', () => { const s = createSeed(); s.projects[0].designs[0].goals[0].success = '目'.repeat(800); s.projects[0].designs[0].activities[0].scaffolds[0].support = '支'.repeat(800); expect(validateWorkspace(s)).toEqual(s); s.projects[0].designs[0].goals[0].success = '目'.repeat(2001); expect(() => validateWorkspace(s)).toThrow('長度'); });
  it('生成設計保存已核對輸入，不改原題組並清確認', () => { const s = reviewIndicators(createSeed(), 'manual-chemistry'), original = structuredClone(s); const next = addGeneratedDesign(s, s.activeProjectId, content()); expect(s).toEqual(original); expect(next.projects[0].designs).toHaveLength(2); expect(next.projects[0].assessments).toEqual(s.projects[0].assessments); expect(next.projects[0].designs[1].inputSnapshot).toEqual(s.projects[0].input); expect(next.projects[0].designs[1].confirmedAt).toBeNull(); expect(next.projects[0].designs[1].rubricVersion).not.toBe(s.projects[0].designs[0].rubricVersion); });
  it('AI 不能造教師確認，空白引用不能入庫', () => { const s = reviewIndicators(createSeed(), 'manual-chemistry'), c = content(); c.integration[0].status = 'confirmed'; expect(() => addGeneratedDesign(s, s.activeProjectId, c)).toThrow('AI'); c.integration[0].status = 'draft'; c.activities[0].goalIds = ['fake']; expect(() => addGeneratedDesign(s, s.activeProjectId, c)).toThrow('參照'); });
  it('新子指標沒有規準不可借用舊題組', () => { const s = reviewIndicators(createSeed(), 'manual-chemistry'); s.projects[0].input.indicatorIds.push('character-learning-to-learn'); s.projects[0].input.indicatorReview = { signature: inputSignature(s.projects[0].input), confirmedAt: Date.now() }; expect(() => addGeneratedDesign(s, s.activeProjectId, content())).toThrow('每個子指標'); });
  it('完整前測立即可保存重載，失敗後測不影響前測與舊題組', () => { const s = ready(), next = addGeneratedAssessment(s, s.activeProjectId, 'pre', questions('pre')); const reloaded = parseBackup(JSON.stringify(next)); expect(reloaded.projects[0].activePostId).toBeNull(); expect(reloaded.projects[0].assessments).toHaveLength(3); expect(() => addGeneratedAssessment(reloaded, s.activeProjectId, 'post', { ...questions('post'), reflection: [] })).toThrow('三部分'); expect(reloaded).toEqual(next); const completed = addGeneratedAssessment(reloaded, s.activeProjectId, 'post', questions('post')); expect(completed.projects[0].assessments[3].parentPreId).toBe(next.projects[0].activePreId); expect(completed.projects[0].assessments[2]).toEqual(next.projects[0].assessments[2]); });
  it('未確認設計與過期輸入不可生成題組', () => { const s = createSeed(); expect(() => addGeneratedAssessment(s, s.activeProjectId, 'pre', questions('pre'))).toThrow('先確認'); const r = ready(); r.projects[0].input.indicatorReview = { signature: '', confirmedAt: null }; r.projects[0].input.topic = '新問題'; expect(() => addGeneratedAssessment(r, r.activeProjectId, 'pre', questions('pre'))).toThrow('草稿已變更'); });
  it('確認與施測獨立，已施測内容不准原地改規則', () => { const s = ready(), preId = s.projects[0].activePreId!; const reviewed = reviewAssessment(s, s.activeProjectId, preId); expect(reviewed.projects[0].assessments[0].administeredAt).toBeNull(); const tested = markAdministered(reviewed, s.activeProjectId, preId); expect(tested.projects[0].assessments[0].administeredAt).not.toBeNull(); expect(() => confirmRules(tested, s.activeProjectId)).toThrow('不可改寫'); const revised = reviseActivity(tested, s.activeProjectId, 'act-1', '另一個完整任務'); expect(revised.projects[0].assessments).toEqual(tested.projects[0].assessments); expect(revised.projects[0].designs[1].integration[0].status).toBe('draft'); });
  it('保存失敗不丟記憶體前測且不稱成功', () => { const s = addGeneratedAssessment(ready(), 'manual-chemistry', 'pre', questions('pre')); const result = saveWorkspace({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, 'test', s, null); expect(result.error).toContain('尚未保存'); expect(s.projects[0].assessments).toHaveLength(3); });
});

describe('R03 必要資料、同意、修復與取消', () => {
  it('所有請求不自動附原文、註記、無關專案或形成性紀錄', () => { const s = ready(); const p = s.projects[0]; p.input.originalSource.text = '不可自動傳的原文'; p.input.teacherNotes = '不可自動傳的註記'; for (const kind of ['recommend', 'design'] as const) { p.input.indicatorReview = { signature: inputSignature(p.input), confirmedAt: Date.now() }; const text = JSON.stringify(buildRequestPlan(p, kind).payload); expect(text).not.toContain('不可自動傳'); const request = buildRequestPlan(p, kind).payload; expect(request).not.toHaveProperty('activityContext'); expect(request).not.toHaveProperty('design'); } const q = ready().projects[0]; for (const kind of ['pre', 'post'] as const) { const text = JSON.stringify(buildRequestPlan(q, kind).payload); expect(text).not.toContain('originalSource'); expect(text).not.toContain('teacherNotes'); expect(text).not.toContain('formative'); } });
  it('推薦只接受固定來源 1–2 項且不自造 ID', () => { expect(() => validateRecommendations({ recommendations: [{ indicatorId: 'fake', reason: '理由', assumptions: [] }] })).toThrow('不存在'); });
  it('來源簽章隨活動新版改變', () => { const s = createSeed(), n = reviseActivity(s, s.activeProjectId, 'act-1', '新任務'); expect(sourceSignature(n.projects[0])).not.toBe(sourceSignature(s.projects[0])); });
  it('不同意與預先取消均零請求', async () => { const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); const plan = buildRequestPlan(createSeed().projects[0], 'recommend'); await expect(runRequest(plan, settings, false, signal(), () => {})).rejects.toThrow('未送出'); const abort = new AbortController(); abort.abort(); await expect(runRequest(plan, settings, true, abort.signal, () => {})).rejects.toThrow('取消'); expect(fetchMock).not.toHaveBeenCalled(); });
  it('金鑰只在授權標頭，Responses不保存且無自動工具', async () => { const fetchMock = vi.fn().mockResolvedValue(api({ ok: true })); vi.stubGlobal('fetch', fetchMock); await runRequest(buildRequestPlan(createSeed().projects[0], 'recommend'), settings, true, signal(), () => {}); const body = JSON.parse(fetchMock.mock.calls[0][1].body); expect(body.store).toBe(false); expect(JSON.stringify(body)).not.toContain(settings.key); expect(body).not.toHaveProperty('tools'); expect(fetchMock.mock.calls[0][1].headers.Authorization).toContain(settings.key); });
  it('一次修復計畫要求再次同意，不自動送出，第二次失敗停止', async () => { const fetchMock = vi.fn().mockImplementation(async () => api({ wrong: 1 })); vi.stubGlobal('fetch', fetchMock); const plan = buildRequestPlan(createSeed().projects[0], 'recommend'); let repair: RepairNeeded | null = null; try { await runRequest(plan, settings, true, signal(), validateRecommendations); } catch (e) { if (e instanceof RepairNeeded) repair = e; else throw e; } expect(repair).not.toBeNull(); expect(fetchMock).toHaveBeenCalledTimes(1); await expect(runRequest(repair!.plan, settings, false, signal(), validateRecommendations)).rejects.toThrow('未送出'); await expect(runRequest(repair!.plan, settings, true, signal(), validateRecommendations)).rejects.toThrow('一次修復後'); expect(fetchMock).toHaveBeenCalledTimes(2); });
  it('過期回應不套用、不誤當格式錯誤修復', async () => { const mock = vi.fn().mockResolvedValue(api({ ok: true })); vi.stubGlobal('fetch', mock); await expect(runRequest(buildRequestPlan(createSeed().projects[0], 'recommend'), settings, true, signal(), () => { throw new RequestExpired(); })).rejects.toBeInstanceOf(RequestExpired); expect(mock).toHaveBeenCalledTimes(1); });
  it('回應若含授權金鑰，拒絕保存與修復', async () => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(api({ note: settings.key }))); await expect(runRequest(buildRequestPlan(createSeed().projects[0], 'recommend'), settings, true, signal(), () => {})).rejects.toThrow('授權秘密'); });
  it('截斷回應不是完整生成，不部分採用', async () => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'incomplete', output: [] })))); await expect(runRequest(buildRequestPlan(createSeed().projects[0], 'recommend'), settings, true, signal(), () => {})).rejects.toThrow('尚未完整'); });
  it('HTTP 401/429失敗不自動重試也不顯示供應商原文', async () => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(settings.key, { status: 401 }))); await expect(runRequest(buildRequestPlan(createSeed().projects[0], 'recommend'), settings, true, signal(), () => {})).rejects.toThrow('金鑰無法使用'); });
  it('逾時會終止請求，保留原稿', async () => { vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))))); await expect(runRequest(buildRequestPlan(createSeed().projects[0], 'recommend'), settings, true, signal(), () => {}, 5)).rejects.toThrow('逾時'); });
});

describe('R08-r2 Gemini 供應商隔離與失敗保稿', () => {
  const geminiSettings = { provider: 'gemini' as const, key: 'isolated-gemini-test-key', model: 'gemini-3.8-flash' };
  const plan = () => buildRequestPlan(createSeed().projects[0], 'recommend');
  it('未同意不送出；模型與供應商不符也不送出', async () => {
    const mock = vi.fn(); vi.stubGlobal('fetch', mock);
    await expect(runRequest(plan(), geminiSettings, false, signal(), () => {})).rejects.toThrow('未送出');
    await expect(runRequest(plan(), { ...geminiSettings, model: 'gpt-4.1' }, true, signal(), () => {})).rejects.toThrow('模型 ID');
    await expect(runRequest(plan(), { ...settings, model: 'gemini-3.8-flash' }, true, signal(), () => {})).rejects.toThrow('模型 ID');
    expect(mock).not.toHaveBeenCalled();
  });
  it('Gemini 只用 Google 授權標頭且回應經相同驗證', async () => {
    const mock = vi.fn().mockResolvedValue(geminiApi({ ok: true })); vi.stubGlobal('fetch', mock);
    const result = await runRequest(plan(), geminiSettings, true, signal(), value => { expect(value).toEqual({ ok: true }); });
    expect(result.usage).toContain('123'); expect(mock).toHaveBeenCalledTimes(1);
    const [url, options] = mock.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    expect(options.headers['x-goog-api-key']).toBe(geminiSettings.key);
    expect(options.headers.Authorization).toBeUndefined();
    expect(JSON.stringify(JSON.parse(options.body))).not.toContain(geminiSettings.key);
    expect(JSON.parse(options.body).generationConfig.responseMimeType).toBe('application/json');
  });
  it('Gemini 封鎖、截斷與金鑰外洩均不採用或自動重試', async () => {
    const mock = vi.fn().mockResolvedValueOnce(geminiApi({ ok: true }, 'MAX_TOKENS')).mockResolvedValueOnce(new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }))).mockResolvedValueOnce(geminiApi({ note: geminiSettings.key }));
    vi.stubGlobal('fetch', mock);
    await expect(runRequest(plan(), geminiSettings, true, signal(), () => {})).rejects.toThrow('未完整');
    await expect(runRequest(plan(), geminiSettings, true, signal(), () => {})).rejects.toThrow('未接受');
    await expect(runRequest(plan(), geminiSettings, true, signal(), () => {})).rejects.toThrow('授權秘密');
    expect(mock).toHaveBeenCalledTimes(3);
  });
  it('Gemini 格式錯誤只提供一次需重新同意的修復', async () => {
    const mock = vi.fn().mockImplementation(async () => geminiApi({ wrong: true })); vi.stubGlobal('fetch', mock);
    let repair: RepairNeeded | null = null;
    try { await runRequest(plan(), geminiSettings, true, signal(), () => { throw new Error('契約不符'); }); } catch (error) { if (error instanceof RepairNeeded) repair = error; else throw error; }
    expect(repair).not.toBeNull(); expect(mock).toHaveBeenCalledTimes(1);
    await expect(runRequest(repair!.plan, geminiSettings, false, signal(), () => {})).rejects.toThrow('未送出');
    await expect(runRequest(repair!.plan, geminiSettings, true, signal(), () => { throw new Error('契約不符'); })).rejects.toThrow('一次修復後');
    expect(mock).toHaveBeenCalledTimes(2);
  });
});

describe('R03 文件與證據界線', () => {
  it('學生題本完整三部分且沒有選項支持或教師提示詞', () => { const text = documentMarkdown(buildDocument(createSeed().projects[0], 'student')); expect(text).toContain('後測第一部分'); expect(text).toContain('後測第二部分'); expect(text).toContain('後測第三部分'); expect(text).not.toContain('可支持：'); expect(text).not.toContain('完整教師判讀提示詞'); expect(text).toContain('不因此降級'); });
  it('教師手冊完整規準、支持限制、配對及判讀指引', () => { const text = documentMarkdown(buildDocument(createSeed().projects[0], 'teacher')); for (const marker of ['證據有限', '萌芽', '發展', '精熟', '可支持：', '不支持／限制：', '多題整合規則', '完整教師判讀提示詞', '尚無法判讀', '分母']) expect(text).toContain(marker); });
  it('人工整合規則的繁體用字沿用到手冊與提示詞', () => { const project = createSeed().projects[0], text = documentMarkdown(buildDocument(project, 'teacher')); expect(project.designs[0].integration[0].rule).not.toContain('選项'); expect(text).toContain('各題選項支持與限制'); expect(text).not.toContain('選项'); });
  it('文件跟随原題組而不是新活動草稿', () => { const s = createSeed(), next = reviseActivity(s, s.activeProjectId, 'act-1', '新的尚未採用任務'); expect(buildDocument(next.projects[0], 'teacher')).toEqual(buildDocument(s.projects[0], 'teacher')); });
  it('Word是真正OOXML ZIP，非改副檔名HTML', async () => { const blob = await wordBlob(buildDocument(createSeed().projects[0], 'teacher')); const bytes = new Uint8Array(await blob.arrayBuffer()); expect(Array.from(bytes.slice(0, 4))).toEqual([80, 75, 3, 4]); expect(blob.size).toBeGreaterThan(10000); });
});
