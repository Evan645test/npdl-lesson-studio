import { describe, expect, it } from 'vitest';
import type { RequestPlan } from './generation';
import { RepairFailed, RepairNeeded } from './openai';
import { AUTO_RETRY_MAX, AutoRetryFailed, runWithAutoRetry } from './autoRetry';

const plan: RequestPlan = { kind: 'pre', projectId: 'p', sourceSignature: 's', payload: { task: 't' }, instructions: '', attempt: 0 };
const settings = { key: 'k', model: 'gpt-4.1', provider: 'openai' as const };
function scripted(steps: ((p: RequestPlan) => unknown)[]) {
  const seen: RequestPlan[] = [];
  const run = (async (p: RequestPlan) => { seen.push(p); const out = steps[seen.length - 1](p); return { value: out, usage: '' }; }) as never;
  return { seen, run };
}
const repairNeeded = (p: RequestPlan, reason: string) => { throw new RepairNeeded({ ...p, attempt: 1, payload: { ...p.payload, repair: { problem: reason } } }, reason); };

describe('R31 自動重試', () => {
  it('第一次通過就不重試', async () => {
    const { seen, run } = scripted([() => 'ok']);
    const r = await runWithAutoRetry(plan, settings, new AbortController().signal, () => {}, undefined, undefined, run);
    expect(r).toMatchObject({ value: 'ok', retries: 0, problems: [] });
    expect(seen).toHaveLength(1);
  });
  it('第 1 次重試沿用修復請求，第 2 次重新出題並附上歷次原因', async () => {
    const { seen, run } = scripted([
      p => repairNeeded(p, '漏引第 2 列'),
      () => { throw new RepairFailed('仍漏引第 2 列'); },
      () => 'ok',
    ]);
    const retries: number[] = [];
    const r = await runWithAutoRetry(plan, settings, new AbortController().signal, () => {}, undefined, n => retries.push(n), run);
    expect(r).toMatchObject({ value: 'ok', retries: 2, problems: ['漏引第 2 列', '仍漏引第 2 列'] });
    expect(retries).toEqual([1, 2]);
    expect(seen[1].attempt).toBe(1);
    expect(seen[1].payload).toHaveProperty('repair');
    expect(seen[2].attempt).toBe(0);
    expect(seen[2].payload).not.toHaveProperty('repair');
    expect((seen[2].payload.retryNotes as { problems: string[] }).problems).toEqual(['漏引第 2 列', '仍漏引第 2 列']);
  });
  it('最多重試 2 次，第 3 次失敗就停止並列出三次原因', async () => {
    const { seen, run } = scripted([p => repairNeeded(p, 'a'), () => { throw new RepairFailed('b'); }, p => repairNeeded(p, 'c'), () => 'never']);
    await expect(runWithAutoRetry(plan, settings, new AbortController().signal, () => {}, undefined, undefined, run))
      .rejects.toSatisfy((e: unknown) => e instanceof AutoRetryFailed && e.problems.join() === 'a,b,c');
    expect(seen).toHaveLength(1 + AUTO_RETRY_MAX);
  });
  it('連線或其他錯誤不自動重試', async () => {
    const { seen, run } = scripted([() => { throw new Error('AI 連線失敗'); }]);
    await expect(runWithAutoRetry(plan, settings, new AbortController().signal, () => {}, undefined, undefined, run)).rejects.toThrow('AI 連線失敗');
    expect(seen).toHaveLength(1);
  });
  it('已取消就不再重試', async () => {
    const c = new AbortController();
    const { seen, run } = scripted([p => { c.abort(); return repairNeeded(p, 'x'); }]);
    await expect(runWithAutoRetry(plan, settings, c.signal, () => {}, undefined, undefined, run)).rejects.toBeInstanceOf(AutoRetryFailed);
    expect(seen).toHaveLength(1);
  });
});
