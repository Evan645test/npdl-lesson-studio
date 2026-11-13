import { describe, expect, it } from 'vitest';
import { createSeed } from '../data/seed';
import { confirmDesign, confirmRules, reviewIndicators } from './lifecycle';
import { buildPairPlan, confirmedReference, setReferencePretest } from './singlePair';
import { referenceOverlaps } from './pairSimilarity';
import { validateWorkspace } from './validate';
import { sourceSignature } from '../services/generation';
import { consentReason, rememberConsent, revokeAllConsent } from '../services/consentMemory';

const old = '1. 小明在便利商店整理一週發票，想知道哪些支出可以減少。請問哪一項最值得先調整？\n\n2. 班級要規劃畢業旅行，比較兩家遊覽車公司的報價與退費規定，哪個方案較合適？';
function ready() { const seed = createSeed(); return confirmDesign(confirmRules(reviewIndicators(seed, seed.activeProjectId), seed.activeProjectId), seed.activeProjectId); }

describe('R12 參考舊前測', () => {
  it('沒有參考時，成對請求與 R11 相同，不帶 consentScope', () => {
    const workspace = ready();
    const plan = buildPairPlan(workspace.projects[0]);
    expect(plan.payload).not.toHaveProperty('referencePretest');
    expect(plan.consentScope).toBeUndefined();
  });
  it('確認去識別後才附上，並註明只當題型與難度參考', () => {
    const workspace = ready(), id = workspace.projects[0].id;
    const unconfirmed = setReferencePretest(workspace, id, old, false);
    expect(confirmedReference(unconfirmed.projects[0])).toBe('');
    expect(buildPairPlan(unconfirmed.projects[0]).payload).not.toHaveProperty('referencePretest');
    const confirmed = setReferencePretest(workspace, id, old, true);
    const plan = buildPairPlan(confirmed.projects[0]);
    expect(plan.payload.referencePretest).toBe(old);
    expect(plan.consentScope).toMatch(/^pretest:/);
    expect(plan.instructions).toContain('不得沿用');
    expect(workspace.projects[0].referencePretest).toBeUndefined();
  });
  it('舊前測換內容要重新同意，也會讓進行中的請求失效', () => {
    revokeAllConsent();
    const workspace = ready(), id = workspace.projects[0].id;
    const first = setReferencePretest(workspace, id, old, true), second = setReferencePretest(workspace, id, old + '\n\n3. 另一題情境內容足夠長的題目文字', true);
    const plan = buildPairPlan(first.projects[0]);
    rememberConsent(plan, '前後測題組', 'openai', 'gpt-4.1');
    expect(consentReason(plan, 'openai', 'gpt-4.1')).toBeNull();
    expect(consentReason(buildPairPlan(second.projects[0]), 'openai', 'gpt-4.1')).toBeTruthy();
    expect(sourceSignature(first.projects[0])).not.toBe(sourceSignature(second.projects[0]));
  });
  it('太短、過長拒收；空白即移除；未知欄位整份拒絕', () => {
    const workspace = ready(), id = workspace.projects[0].id;
    expect(() => setReferencePretest(workspace, id, '太短', true)).toThrow('太短');
    expect(() => setReferencePretest(workspace, id, '題'.repeat(60001), true)).toThrow('60,000');
    const saved = setReferencePretest(workspace, id, old, true);
    expect(setReferencePretest(saved, id, '  ', true).projects[0].referencePretest).toBeUndefined();
    const broken = structuredClone(saved); (broken.projects[0].referencePretest as Record<string, unknown>).school = '某校';
    expect(() => validateWorkspace(broken)).toThrow('未知欄位');
  });
  it('生成題目若幾乎照抄舊題會被標出，新情境不會', () => {
    const copied = { id: 'pre-1', context: '小明在便利商店整理一週發票，想知道哪些支出可以減少。', data: '', prompt: '請問哪一項最值得先調整？' };
    const fresh = { id: 'pre-2', context: '社團要決定校慶攤位販售的飲品，比較三種杯子的成本與回收方式。', data: '紙杯 2 元、塑膠杯 1 元、自備杯折 5 元', prompt: '哪個做法最符合社團目標？' };
    expect(referenceOverlaps([copied, fresh], old).map(row => row.id)).toEqual(['pre-1']);
  });
  it('整份題本沒有空行或題號時，照抄其中一題仍會被標出', () => {
    const copied = { id: 'pre-1', context: '小明在便利商店整理一週發票，想知道哪些支出可以減少。', data: '', prompt: '請問哪一項最值得先調整？' };
    const long = '這是一份很長的舊題本，前面有許多其他題目的敘述與資料。'.repeat(80) + copied.context + copied.prompt + '後面還有其他題目與表格資料。'.repeat(80);
    expect(referenceOverlaps([copied], long).map(row => row.id)).toEqual(['pre-1']);
    expect(referenceOverlaps([copied], 'Q1 ' + copied.context + copied.prompt + '\nQ2 另一題完全不同的情境，討論校園用電與節能措施的取捨。').map(row => row.id)).toEqual(['pre-1']);
  });
});
