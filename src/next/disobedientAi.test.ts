import { describe, expect, it, vi } from 'vitest';
import { mergeFullDesign } from './fullDesign';
import { buildSinglePlan, singleToIntake, validateSingleResult } from './singlePath';
import { addIntakeProject } from './intake';
import { runRequest } from '../services/openai';
import { fullFixture } from './fullFixture.test-helper';

// R12-r8：模擬會改字、多回傳已確認欄位的 AI，流程仍要完成，且保存的是教師已確認的版本。
function disobedient() {
  const fixture = fullFixture();
  const { approved, response } = fixture;
  const sloppy = {
    ...structuredClone(response),
    goals: response.goals.map((row, index) => ({ ...row, kind: approved.goals[index].kind, text: `${approved.goals[index].text.replace(/。$/, '')}!`, success: `（潤飾）${approved.goals[index].success}` })),
    criteria: approved.criteria.map(row => ({ ...row, id: 'criterion-1', label: `${row.label} `, stages: row.stages.map(text => text.replace(/，/g, ',')) })),
    activities: response.activities.map(row => ({ ...row, name: `第 ${row.id} 節：改寫過的名稱` })),
    blueprint: Object.fromEntries(Object.entries(response.blueprint).map(([id, rows]) => [id, rows.map(row => ({ ...row, status: '可作有限比較' }))])),
  };
  return { ...fixture, sloppy };
}

describe('R12-r8 不聽話的 AI', () => {
  it('改標點、潤飾已確認目標與規準、改寫活動名稱，仍可保存且保存已確認版本', () => {
    const { seed, approved, sloppy } = disobedient();
    expect(() => validateSingleResult(approved, 'full', sloppy)).not.toThrow();
    const content = mergeFullDesign(approved, sloppy);
    expect(content.goals.map(row => [row.text, row.success])).toEqual(approved.goals.map(row => [row.text, row.success]));
    expect(content.criteria.map(row => [row.label, row.stages])).toEqual(approved.criteria.map(row => [row.label, row.stages]));
    expect(content.blueprint.every(row => row.status === '比較條件待確認')).toBe(true);
    expect(JSON.stringify(content.activities)).not.toContain('coreActivityId');
    expect(() => addIntakeProject(seed, singleToIntake(approved), content)).not.toThrow();
  });
  it('不聽話的回應第一次就通過，不跳出修復視窗', async () => {
    const { approved, sloppy } = disobedient();
    const api = new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(sloppy) }] }] }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(api));
    const result = await runRequest(buildSinglePlan(approved, 'full'), { key: 'sk-test-r12r8-0000000000', model: 'gpt-4.1' }, true, new AbortController().signal, value => validateSingleResult(approved, 'full', value));
    expect(result.value).toBeTruthy();
  });
  it('結構真的錯了仍退回，並說清楚哪裡錯', () => {
    const { approved, response } = fullFixture();
    const uncovered = { ...structuredClone(response), activities: response.activities.map(row => ({ ...row, coreActivityId: 'core-1' })) };
    expect(() => mergeFullDesign(approved, uncovered)).toThrow(/core-2.*沒有對應/);
    const badRef = { ...structuredClone(response), blueprint: { ...response.blueprint, 'c-compare': response.blueprint['criterion-1'] } };
    expect(() => mergeFullDesign(approved, badRef)).toThrow(/規準編號只能使用 criterion-1/);
    const tooFew = { ...structuredClone(response), blueprint: { 'criterion-1': response.blueprint['criterion-1'].slice(0, 1) } };
    expect(() => mergeFullDesign(approved, tooFew)).toThrow(/criterion-1 需有 2–3 組前後測配對，收到 1 組/);
    const empty = { ...structuredClone(response), activities: response.activities.map((row, index) => index ? row : { ...row, goalIds: [] }) };
    expect(() => mergeFullDesign(approved, empty)).toThrow(/第 1 節的 goalIds 至少要有一個/);
    const missing = structuredClone(response) as Partial<typeof response>; delete missing.elements;
    expect(() => mergeFullDesign(approved, missing)).toThrow('缺少 elements');
  });
});

describe('R31 只重做未通過的段落', () => {
  it('內容檢查標出未通過段落；局部修正請求只要那一段、沿用原資料；合併只換那一段', async () => {
    const { SectionProblem, sectionRepairPlan, mergeSection } = await import('./fullDesign');
    const { approved, response } = fullFixture();
    const tooFew = { ...structuredClone(response), blueprint: { 'criterion-1': response.blueprint['criterion-1'].slice(0, 1) } };
    let caught: unknown;
    try { mergeFullDesign(approved, tooFew); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(SectionProblem);
    expect((caught as InstanceType<typeof SectionProblem>).section).toBe('blueprint');
    const badGoal = { ...structuredClone(response), goals: response.goals.map(row => ({ ...row, curriculumIds: ['not-a-code'] })) };
    expect(() => mergeFullDesign(approved, badGoal)).toThrow(SectionProblem);
    try { mergeFullDesign(approved, badGoal); } catch (error) { expect((error as InstanceType<typeof SectionProblem>).section).toBe('goals'); }
    const plan = buildSinglePlan(approved, 'full');
    const repair = sectionRepairPlan(plan, 'blueprint', '規準 criterion-1 需有 2–3 組', tooFew.blueprint);
    expect(Object.keys((repair.payload.outputSchema as { properties: object }).properties)).toEqual(['blueprint']);
    expect(repair.payload.approvedOutline).toEqual(plan.payload.approvedOutline);
    expect(repair.payload.sectionRepair).toMatchObject({ section: 'blueprint' });
    const merged = mergeSection(tooFew, 'blueprint', { blueprint: response.blueprint });
    expect(merged.activities).toEqual(tooFew.activities);
    expect(() => mergeFullDesign(approved, merged)).not.toThrow();
    expect(() => mergeSection(tooFew, 'blueprint', { blueprint: response.blueprint, goals: [] })).toThrow('只能回傳 blueprint');
  });
});
