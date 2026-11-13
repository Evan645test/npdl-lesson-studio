import type { RequestPlan } from '../services/generation';
import { freshRetryPlan } from '../services/autoRetry';
import { activeRevision, appendGeneratedPaperRevision, buildPaperStagePlan, type PaperDraft } from './stagedPaper';
import type { AuditFinding, StudentAuditReport } from './stagedStudentAudit';

// R31（2026-11-09 使用者決定）：學生卷獨立驗題找到明確問題（issue）時，自動重出學生卷並再驗，最多 2 輪。
// 重出的學生卷只是候選：不改目前學生卷，教師採用才成為目前版本。
const KIND_NAME = { material: '缺料', hint: '題間提示', workload: '作答負擔' } as const;
const RETRY_INSTRUCTION = '上一版學生卷經獨立驗題發現 problems 所列問題。依原 outputSchema、材料與逐題藍圖重新完整輸出學生卷，修正這些問題，不得新增材料以外的紀錄，也不得加入答案或教師判讀用語。';

export function blockingFindings(report: StudentAuditReport): AuditFinding[] {
  return report.findings.filter(f => f.status === 'issue');
}
// 後測不送前測原文（R23 規則）：作答負擔問題只說明題位與要依藍圖，不帶驗題理由或前測片段。
export function studentRetryNotes(findings: AuditFinding[], phase: 'pre' | 'post'): string[] {
  return findings.map(f => {
    const head = f.target.label + '｜' + KIND_NAME[f.kind] + '：';
    if (f.kind === 'workload' && phase === 'post') return head + '與前測的取證量、推理步數或提示不一致，請依逐題藍圖的作答負擔重新安排本題位。';
    const quote = f.current ? '（目前題面「' + f.current.text.slice(0, 200) + '」）' : '';
    const other = f.kind === 'hint' && f.other ? '（提示來源「' + f.other.text.slice(0, 200) + '」）' : '';
    return head + f.reason.slice(0, 400) + quote + other;
  });
}
export function studentRetryPlan(base: RequestPlan, draft: PaperDraft, notes: string[]): RequestPlan {
  return freshRetryPlan(buildPaperStagePlan(base, draft, 'student'), notes, RETRY_INSTRUCTION);
}
// 新增候選版本但保持目前學生卷不變。
export function appendStudentCandidate(base: RequestPlan, draft: PaperDraft, raw: unknown): { draft: PaperDraft; id: string } {
  const appended = appendGeneratedPaperRevision(base, draft, 'student', raw);
  const id = appended.active.student!;
  return { draft: { ...appended, active: { ...draft.active } }, id };
}
function candidate(draft: PaperDraft, id: string) {
  const row = draft.revisions.find(r => r.id === id && r.stage === 'student');
  const materials = activeRevision(draft, 'materials');
  if (!row || !materials?.confirmed || row.parent !== materials.id || draft.active.student === id) throw Error('候選學生卷已失效或已採用。');
  return row;
}
// 只在記憶體中把候選當成已確認學生卷，供驗題使用；不保存。
export function candidateAuditDraft(draft: PaperDraft, id: string): PaperDraft {
  candidate(draft, id);
  return { ...draft, revisions: draft.revisions.map(r => r.id === id ? { ...r, confirmed: true } : r), active: { ...draft.active, student: id } };
}
export function adoptStudentCandidate(draft: PaperDraft, id: string): PaperDraft {
  return candidateAuditDraft(draft, id);
}
