import type { RequestPlan } from '../services/generation';
import { AUTO_RETRY_MAX } from '../services/autoRetry';
import { RepairFailed, RepairNeeded, type runRequest } from '../services/openai';
import { mergeSection, SectionProblem, sectionRepairPlan, type RepairSection } from './fullDesign';

// R31（2026-11-09 使用者決定）：完整教案某段未通過內容檢查時，只重做那一段（最多 2 次，沿用已同意資料、不再詢問）。
export const SECTION_NAME: Record<RepairSection, string> = { goals: '目標課綱對應', activities: '逐節教案', integration: '整合規則', blueprint: '前後測配對' };
type Run = (plan: RequestPlan, validate: (value: unknown) => void) => ReturnType<typeof runRequest>;

export async function repairSections(current: RequestPlan, base: unknown, first: SectionProblem, run: Run,
  validate: (value: unknown) => void, signal: AbortSignal, onRound?: (round: number, section: RepairSection) => void): Promise<{ value: unknown; usage: string; rounds: number }> {
  let problem = first;
  const history: string[] = [];
  for (let round = 1; ; round++) {
    history.push(`${SECTION_NAME[problem.section]}：${problem.message}`);
    if (round > AUTO_RETRY_MAX) throw new RepairFailed(`只重做未通過段落 ${AUTO_RETRY_MAX} 次仍不符：${history.join('；')}`);
    onRound?.(round, problem.section);
    const section = problem.section, previous = (base as Record<string, unknown>)[section];
    let merged: unknown, inner: unknown;
    try {
      const result = await run(sectionRepairPlan(current, section, problem.message, previous), value => {
        merged = undefined; inner = undefined;
        try { merged = mergeSection(base, section, value); validate(merged); } catch (error) { inner = error; throw error; }
      });
      return { ...result, value: merged, rounds: round };
    } catch (error) {
      if (!(error instanceof RepairNeeded) || signal.aborted) throw error;
      if (merged !== undefined) base = merged;
      if (!(inner instanceof SectionProblem)) throw new RepairFailed(`只重做 ${SECTION_NAME[section]} 後仍不符：${error.reason}`);
      problem = inner;
    }
  }
}
