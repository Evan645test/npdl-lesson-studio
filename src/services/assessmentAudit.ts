import { buildAuditPlan, validateAuditResult, type AuditSource, type AuditStage, type AuditStageResult } from '../domain/assessmentAudit';
import { buildClaimAuditPlan, claimChecks, validateClaimAudit } from '../domain/assessmentClaimAudit';
import { meanClaimIssues } from '../domain/assessmentMeanAudit';
import { RepairFailed, RepairNeeded, runRequest, type AiSettings } from './openai';
import type { RequestPlan } from './generation';

export type AuditStep = AuditStage | 'claims';
interface AuditRequest {
  stage: AuditStep;
  plan: RequestPlan;
  validate: (value: unknown) => AuditStageResult;
}

export function assessmentAuditRequests(projectId: string, source: AuditSource): AuditRequest[] {
  const base = (stage: AuditStage, scoped = source): AuditRequest => ({
    stage, plan: buildAuditPlan(projectId, scoped, stage),
    validate: value => validateAuditResult(scoped, stage, value),
  });
  const requests = [base('solve')];
  for (const part of ['choice','open'] as const) {
    const targets = source.targets.filter(target => target.part === part);
    if (new Set(targets.map(target => target.item)).size < 2) continue;
    requests.push(base('masked', { ...source, targets, student:source.student.filter(block => block.part === part), teacher:[] }));
  }
  // Keep the general criteria/distractor review alongside the evidence-specific pass.
  requests.push(base('rubric'));
  const inconsistent = new Set(meanClaimIssues(source).map(issue => issue.target));
  for (const check of claimChecks({ ...source, targets:source.targets.filter(target => !inconsistent.has(target.ref)) })) {
    requests.push({ stage:'claims', plan:buildClaimAuditPlan(projectId,check), validate:value => validateClaimAudit(check,value) });
  }
  return requests;
}

export async function runAssessmentAudit({
  projectId, source, settings, consent, signal, onStart, onResult, onSkip, request = runRequest,
}: {
  projectId: string;
  source: AuditSource;
  settings: AiSettings;
  consent: boolean;
  signal: AbortSignal;
  onStart: (stage: AuditStep, index: number, total: number) => void;
  onResult: (result: AuditStageResult) => void;
  onSkip?: (stage: AuditStep) => void;
  request?: typeof runRequest;
}): Promise<void> {
  if (!consent) throw new Error('尚未同意，未送出驗題資料。');
  const entries = assessmentAuditRequests(projectId, source);
  for (const [index, {stage,plan,validate}] of entries.entries()) {
    signal.throwIfAborted();
    onStart(stage,index+1,entries.length);
    let result: AuditStageResult | undefined;
    try {
      await request(plan,settings,consent,signal,value => { result=validate(value); });
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof RepairNeeded || error instanceof RepairFailed) || !onSkip) throw error;
      onSkip(stage);
      continue;
    }
    signal.throwIfAborted();
    if (!result) throw new Error('沒有可採用的驗題結果。');
    onResult(result);
  }
}
