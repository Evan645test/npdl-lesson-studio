import { describe, expect, it } from 'vitest';
import { RepairFailed, RepairNeeded } from '../services/openai';
import type { RequestPlan } from '../services/generation';
import { mergeFullDesign, SectionProblem } from './fullDesign';
import { buildSinglePlan } from './singlePath';
import { fullFixture } from './fullFixture.test-helper';
import { repairSections } from './sectionRepair';

// 模擬 runRequest：驗證失敗時與真的一樣丟 RepairNeeded。
function scripted(replies: unknown[]) {
  const sent: RequestPlan[] = [];
  const run = async (plan: RequestPlan, validate: (value: unknown) => void) => {
    sent.push(plan);
    const value = replies[sent.length - 1];
    try { validate(value); } catch (error) { throw new RepairNeeded(plan, error instanceof Error ? error.message : String(error)); }
    return { value, usage: '' };
  };
  return { sent, run };
}

describe('R31 完整教案只重做未通過段落', () => {
  const setup = () => {
    const { approved, response } = fullFixture();
    const broken = { ...structuredClone(response), blueprint: { 'criterion-1': response.blueprint['criterion-1'].slice(0, 1) } };
    let first: SectionProblem | undefined;
    try { mergeFullDesign(approved, broken); } catch (error) { first = error as SectionProblem; }
    return { approved, response, broken, first: first!, plan: buildSinglePlan(approved, 'full'), validate: (v: unknown) => { mergeFullDesign(approved, v); } };
  };
  it('第一次局部修正就通過：只送 blueprint 要求，其他段落沿用原回應', async () => {
    const { response, broken, first, plan, validate } = setup();
    const { sent, run } = scripted([{ blueprint: response.blueprint }]);
    const rounds: string[] = [];
    const result = await repairSections(plan, broken, first, run, validate, new AbortController().signal, (n, s) => rounds.push(`${n}:${s}`));
    expect(rounds).toEqual(['1:blueprint']);
    expect(sent).toHaveLength(1);
    expect(Object.keys((sent[0].payload.outputSchema as { properties: object }).properties)).toEqual(['blueprint']);
    expect((result.value as typeof broken).activities).toEqual(broken.activities);
    expect((result.value as typeof broken).blueprint).toEqual(response.blueprint);
  });
  it('配對題號由程式依序指定，AI 重複或亂寫題號也不會造成重複', () => {
    const { approved, response } = setup();
    const dup = { ...structuredClone(response), blueprint: { 'criterion-1': response.blueprint['criterion-1'].map(row => ({ ...row, preId: 'activity-1', postId: 'activity-4' })) } };
    const ids = mergeFullDesign(approved, dup).blueprint.map(row => [row.preId, row.postId]);
    expect(ids).toEqual(ids.map((_, i) => [`pre-${i + 1}`, `post-${i + 1}`]));
  });
  it('第二次仍錯就再重做一次；超過 2 次停止並列出各次原因', async () => {
    const { response, broken, first, plan, validate } = setup();
    const ok = await repairSections(plan, broken, first, scripted([{ blueprint: broken.blueprint }, { blueprint: response.blueprint }]).run, validate, new AbortController().signal);
    expect(ok.rounds).toBe(2);
    await expect(repairSections(plan, broken, first, scripted([{ blueprint: broken.blueprint }, { blueprint: broken.blueprint }]).run, validate, new AbortController().signal))
      .rejects.toSatisfy((e: unknown) => e instanceof RepairFailed && /2 次仍不符.*前後測配對.*前後測配對/.test(e.reason));
  });
  it('局部修正回傳了其他段落就拒收', async () => {
    const { response, broken, first, plan, validate } = setup();
    await expect(repairSections(plan, broken, first, scripted([{ blueprint: response.blueprint, goals: [] }, { blueprint: response.blueprint }]).run, validate, new AbortController().signal))
      .resolves.toMatchObject({ rounds: 2 });
  });
});
