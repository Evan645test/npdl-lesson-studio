import { afterEach, describe, expect, it } from 'vitest';
import { consentReason, FLOW_STEPS, rememberConsent, revokeAllConsent, revokeCourseConsent, transferCourseConsent } from './consentMemory';
import type { RequestPlan } from './generation';

const provider = 'openai';
const model = 'gpt-4.1';
const plan = (projectId: string, task: string, extra: Partial<RequestPlan> = {}): RequestPlan => ({
  kind: 'field', projectId, sourceSignature: 'test-course', instructions: '', payload: { task }, attempt: 0, ...extra,
});
const request = (p: RequestPlan) => consentReason(p, provider, model);
const approve = (p: RequestPlan) => rememberConsent(p, '試用', provider, model);

afterEach(revokeAllConsent);

describe('AI 同意以課程為界', () => {
  it('同一課程的主流程與重試沿用同意，新建課程不沿用', () => {
    const firstTask = FLOW_STEPS[0].task;
    const first = plan('draft-a', firstTask);
    expect(request(first)).toContain('六個步驟');
    approve(first);
    expect(request(first)).toBeNull();
    for (const step of FLOW_STEPS) expect(request(plan('draft-a', step.task))).toBeNull();
    expect(request(plan('draft-b', firstTask))).toContain('六個步驟');
    expect(request(plan('draft-b', 'generate-matched-pre-and-post'))).toContain('六個步驟');
  });

  it('同一附加內容識別不讓不同課程跳過同意', () => {
    const scoped = plan('project-a', 'generate-matched-pre-and-post', { consentScope: 'pretest:test' });
    approve(scoped);
    expect(request(scoped)).toBeNull();
    expect(request({ ...scoped, projectId: 'project-b' })).toBeTruthy();
  });

  it('正式專案只承接同一份已採用草稿的同意，並移除舊草稿的紀錄', () => {
    const draft = 'draft-a', createdProject = 'project-new';
    const scoped = plan(draft, 'outline-evidence', { consentScope: 'lesson:confirmed' });
    approve(plan(draft, 'outline-goals'));
    approve(scoped);
    transferCourseConsent(draft, createdProject);

    expect(request(plan(createdProject, 'generate-matched-pre-and-post'))).toBeNull();
    expect(request({ ...scoped, projectId: createdProject })).toBeNull();
    expect(request(plan(createdProject, 'outline-evidence', { consentScope: 'lesson:changed' }))).toBeTruthy();
    expect(request(plan(draft, 'outline-goals'))).toBeTruthy();
    expect(request(plan('other-project', 'generate-matched-pre-and-post'))).toBeTruthy();
  });

  it('不覆寫已有同意的專案；撤回一門課不影響另一門課', () => {
    const draft = 'draft-a', existingProject = 'project-existing';
    approve(plan(draft, 'outline-goals'));
    rememberConsent(plan(existingProject, 'outline-goals'), '試用', 'gemini', 'gemini-test');
    transferCourseConsent(draft, existingProject);

    expect(request(plan(existingProject, 'outline-goals'))).toBeTruthy();
    expect(consentReason(plan(existingProject, 'outline-goals'), 'gemini', 'gemini-test')).toBeNull();
    expect(request(plan(draft, 'outline-goals'))).toBeNull();
    revokeCourseConsent(draft);
    expect(request(plan(draft, 'outline-goals'))).toBeTruthy();
    expect(consentReason(plan(existingProject, 'outline-goals'), 'gemini', 'gemini-test')).toBeNull();
  });
});
