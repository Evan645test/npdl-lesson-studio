import { useSyncExternalStore } from 'react';
import type { RequestPlan } from './generation';

// 同意只存在本頁記憶體。同一門課的同一種請求、同一供應商與模型同意一次後沿用；
// 換模型、教案原文擷取、附上的教案摘要或舊前測有變（consentScope）、資料量超過上次同意的兩倍、格式修復，一律重新預覽同意。
export interface ConsentRecord { courseId: string; task: string; label: string; provider: string; model: string; bytes: number }
const courses = new Map<string, Map<string, ConsentRecord>>();
// R12-r11（2026-11-06 使用者決定）：備課主流程六個步驟同意一次。同一門課、供應商與模型，沒有附上教案摘要或舊前測時沿用；
// 格式修復、教案原文擷取、換模型仍每次詢問；附上教案摘要或舊前測照 R11（同一份內容同意一次，內容變更才再問）。其他請求（單節重寫、單題重生、欄位協助、重寫前後測）照 R11 規則。
export const FLOW_STEPS: { task: string; label: string; sends: string }[] = [
  { task: 'recommend-curriculum-and-npdl', label: '課程方向與課綱推薦', sends: '年級、學科、主題、單元、關鍵字、已寫的構想與驅動問題；可選課綱條目與子指標名稱' },
  { task: 'outline-goals', label: '學習目標', sends: '你勾選的課綱與子指標（含四階進程原文）' },
  { task: 'outline-evidence', label: '證據與規準', sends: '已確認的目標' },
  { task: 'outline-activities', label: '核心活動', sends: '已確認的目標與規準' },
  { task: 'complete-lesson-design', label: '完整逐節教案', sends: '以上全部已確認內容' },
  { task: 'generate-matched-pre-and-post', label: '前後測題組', sends: '已確認的課程與規準；紙筆題的逐題藍圖另行預覽並同意' },
];
const FLOW_TASKS = new Set(FLOW_STEPS.map(step => step.task));
const FLOW_KEY = 'flow';
export function isFlowPlan(plan: RequestPlan): boolean { return plan.attempt === 0 && !plan.alwaysConsent && !plan.consentScope && FLOW_TASKS.has(requestTask(plan)); }
// R37（2026-11-12 審查與實跑）：情境進程題的面向、前測、後測同一門課同意一次（同供應商與模型）；格式修復與換模型仍每次詢問。
export const SCENARIO_STEPS: { task: string; label: string; sends: string }[] = [
  { task: 'draft-progression-aspects', label: '整理面向（含重新產生）', sends: '課程名稱與主題、子指標四階原文、教師已確認的本課規準' },
  { task: 'scenario-progression-pre', label: '前測情境題', sends: '已確認的面向與規準（生活情境）' },
  { task: 'scenario-progression-post', label: '後測情境題', sends: '已確認的面向與規準、驅動問題、最終作品與各節名稱（不送前測原文）' },
  { task: 'draft-classroom-kit', label: '課中學習單與課堂表現勾選表', sends: '課中觀察子指標的已確認規準與相連活動（名稱、任務、預期作品）' },
];
const SCENARIO_TASKS = new Set(SCENARIO_STEPS.map(step => step.task));
const SCENARIO_KEY = 'scenario-flow';
export function isScenarioFlowPlan(plan: RequestPlan): boolean { return plan.attempt === 0 && !plan.alwaysConsent && !plan.consentScope && SCENARIO_TASKS.has(requestTask(plan)); }
const listeners = new Set<() => void>();
let snapshot: ConsentRecord[] = [];
function emit() { snapshot = [...courses.values()].flatMap(course => [...course.values()]); for (const listener of listeners) listener(); }

export function requestTask(plan: RequestPlan): string { return typeof plan.payload.task === 'string' ? plan.payload.task : plan.kind; }
export function payloadBytes(plan: RequestPlan): number { return new TextEncoder().encode(JSON.stringify(plan.payload)).length; }
const NEVER_REMEMBER = new Set(['extract-lesson-start']);
const keyOf = (plan: RequestPlan, provider: string, model: string) => JSON.stringify([requestTask(plan), provider, model, plan.consentScope ?? '']);

export function consentReason(plan: RequestPlan, provider: string, model: string): string | null {
  if (plan.attempt === 1) return '格式修復每次都要再同意。';
  if (plan.alwaysConsent || NEVER_REMEMBER.has(requestTask(plan))) return plan.alwaysConsent ?? '教案原文擷取每次都要預覽並同意。';
  const course = courses.get(plan.projectId);
  if (isFlowPlan(plan)) {
    const flow = course?.get(FLOW_KEY);
    return flow?.provider === provider && flow.model === model ? null : '這門課還沒同意使用這個 AI：同意後，這門課的六個步驟沿用本次同意；紙筆逐題藍圖仍會另行預覽。';
  }
  if (isScenarioFlowPlan(plan)) {
    const flow = course?.get(SCENARIO_KEY);
    return flow?.provider === provider && flow.model === model ? null : '這門課還沒同意情境進程題使用這個 AI：同意後，面向、前測、後測與課中學習單都沿用本次同意。';
  }
  const record = course?.get(keyOf(plan, provider, model));
  if (!record) return plan.consentScope ? '這門課還沒同意這一種請求，或附上的教案摘要／舊前測已變更。' : '這門課還沒同意這一種請求。';
  if (payloadBytes(plan) > record.bytes * 2) return '這次資料量比上次同意時多一倍以上。';
  return null;
}
export function rememberConsent(plan: RequestPlan, label: string, provider: string, model: string): void {
  if (plan.attempt === 1 || plan.alwaysConsent || NEVER_REMEMBER.has(requestTask(plan))) return;
  const courseId = plan.projectId;
  let course = courses.get(courseId);
  if (!course) { course = new Map(); courses.set(courseId, course); }
  if (isFlowPlan(plan)) course.set(FLOW_KEY, { courseId, task: 'flow', label: '備課流程六個步驟', provider, model, bytes: 0 });
  else if (isScenarioFlowPlan(plan)) course.set(SCENARIO_KEY, { courseId, task: 'scenario-flow', label: '情境進程題（面向、前測、後測）', provider, model, bytes: 0 });
  else course.set(keyOf(plan, provider, model), { courseId, task: requestTask(plan), label, provider, model, bytes: payloadBytes(plan) });
  emit();
}

// 只在同一份草稿已成功另存成新專案後移交；不得拿舊同意覆蓋其他既有課程。
export function transferCourseConsent(fromCourseId: string, toCourseId: string): void {
  const source = courses.get(fromCourseId);
  if (!source || fromCourseId === toCourseId || !toCourseId || courses.has(toCourseId)) return;
  courses.set(toCourseId, new Map([...source].map(([key, record]) => [key, { ...record, courseId: toCourseId }])));
  courses.delete(fromCourseId);
  emit();
}

export function revokeCourseConsent(courseId: string): void { if (courses.delete(courseId)) emit(); }
export function revokeAllConsent(): void { courses.clear(); emit(); }
export function useConsentRecords(): ConsentRecord[] {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => snapshot);
}
