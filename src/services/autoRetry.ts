import type { RequestPlan } from './generation';
import { RepairFailed, RepairNeeded, runRequest, type AiSettings } from './openai';

// R31（2026-11-09 使用者決定）：同一份已同意資料未通過程式檢查時，自動重試最多 2 次、不再詢問。
// 第 1 次沿用既有修復請求（附失敗原因與前次回應前段）；第 2 次重新出題並附上歷次原因。
// 網路、逾時、取消、金鑰外洩或上游已變更不屬於檢查不符，不自動重試。
export const AUTO_RETRY_MAX = 2;
export class AutoRetryFailed extends Error {
  constructor(public readonly problems: string[]) {
    super('自動重試 ' + AUTO_RETRY_MAX + ' 次後仍未通過檢查，已停止；原稿保留。');
  }
}
export type AutoRetryResult = { value: unknown; usage: string; retries: number; problems: string[] };
type Runner = typeof runRequest;

export function freshRetryPlan(plan: RequestPlan, problems: string[],
  instruction = '先前回應未通過程式檢查，problems 依序列出原因。重新完整輸出，先避開這些問題；其餘依原 outputSchema 與資料，不得確認或施測。'): RequestPlan {
  return { ...plan, attempt: 0, payload: { ...plan.payload, retryNotes: {
    instruction,
    problems: problems.map(p => p.slice(0, 600)),
  } } };
}

export async function runWithAutoRetry(plan: RequestPlan, settings: AiSettings, signal: AbortSignal,
  validate: (value: unknown) => void, timeoutMs?: number,
  onRetry?: (retry: number, problem: string) => void, run: Runner = runRequest): Promise<AutoRetryResult> {
  const original = { ...plan, attempt: 0 as const };
  const problems: string[] = [];
  let current: RequestPlan = original;
  for (let retry = 0; ; retry++) {
    try {
      const result = await run(current, settings, true, signal, validate, timeoutMs);
      return { ...result, retries: retry, problems };
    } catch (error) {
      if (!(error instanceof RepairNeeded || error instanceof RepairFailed)) throw error;
      problems.push(error.reason || error.message);
      if (retry >= AUTO_RETRY_MAX || signal.aborted) throw new AutoRetryFailed(problems);
      onRetry?.(retry + 1, problems[problems.length - 1]);
      current = error instanceof RepairNeeded && retry === 0 ? error.plan : freshRetryPlan(original, problems);
    }
  }
}
