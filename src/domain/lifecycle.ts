import type { AssessmentVersion, CourseInput, DesignVersion, Workspace } from './types';
import { inputSignature, validateWorkspace } from './validate';

export function projectOf(workspace: Workspace, projectId: string) {
  const project = workspace.projects.find(p => p.id === projectId);
  if (!project) throw new Error('專案不存在。');
  return project;
}
export function reviewIndicators(workspace: Workspace, projectId: string): Workspace {
  const next = validateWorkspace(workspace), project = projectOf(next, projectId);
  if (next.schemaVersion !== 2) throw new Error('請先轉換為 v2 工作區。');
  if (!project.input.topic.trim() || !project.input.curriculumIds.length) throw new Error('請先填學科問題並選擇課綱。');
  project.input.indicatorReview = { signature: inputSignature(project.input), confirmedAt: Date.now() };
  return validateWorkspace(next);
}
export function assertReviewed(input: CourseInput): void {
  if (!input.indicatorReview?.confirmedAt || input.indicatorReview.signature !== inputSignature(input)) throw new Error('請先核對此起點、課綱與子指標；修改後須重新核對。');
}
export function confirmRules(workspace: Workspace, projectId: string): Workspace {
  const next = validateWorkspace(workspace), project = projectOf(next, projectId);
  const design = project.designs.find(d => d.id === project.activeDesignId)!;
  if (project.assessments.some(a => a.designId === design.id && a.administeredAt)) throw new Error('已施測設計的規則不可改寫，請另存設計新版。');
  if (design.integration.some(r => r.status === 'missing' || !r.rule.trim())) throw new Error('整合規則有缺漏，請先補齊新版草稿。');
  design.integration = design.integration.map(r => ({ ...r, status: 'confirmed' }));
  return validateWorkspace(next);
}
export function confirmDesign(workspace: Workspace, projectId: string): Workspace {
  const next = validateWorkspace(workspace), project = projectOf(next, projectId);
  const design = project.designs.find(d => d.id === project.activeDesignId)!;
  if (inputSignature(project.input) !== inputSignature(design.inputSnapshot)) throw new Error('輸入草稿與設計不同，請另生成新版或切回相符設計。');
  assertReviewed(project.input);
  if (design.integration.some(r => r.status !== 'confirmed')) throw new Error('請先在「AI 生成、版本確認與文件」按「確認此設計的整合規則」。');
  if (!design.confirmedAt) design.confirmedAt = Math.max(Date.now(), design.createdAt);
  return validateWorkspace(next);
}
export function reviewAssessment(workspace: Workspace, projectId: string, id: string): Workspace {
  const next = validateWorkspace(workspace), project = projectOf(next, projectId);
  const assessment = project.assessments.find(a => a.id === id);
  if (!assessment) throw new Error('題組不存在。');
  const design = project.designs.find(d => d.id === assessment.designId)!;
  if (!design.confirmedAt) throw new Error('題組引用的設計尚未確認。請展開「AI 生成、版本確認與文件」，依序按「核對此起點、課綱與子指標」、「確認此設計的整合規則」、「確認目前設計」（已完成的步驟不用重按），再確認這份題組。');
  // R41：有課中觀察子指標的情境進程題前測，須先有學習單與課堂表現勾選表。
  if (!assessment.reviewedAt && assessment.format === 'scenario-progression-v1' && assessment.phase === 'pre' && (assessment.sets ?? []).length && !(assessment.classroomKits ?? []).length) throw new Error('請先產生課中學習單與課堂表現勾選表，再確認前測。');
  if (inputSignature(project.input) !== inputSignature(design.inputSnapshot)) throw new Error('課程草稿已變更，請先核對題組來源。');
  if (!assessment.reviewedAt) assessment.reviewedAt = Math.max(Date.now(), assessment.createdAt, design.confirmedAt);
  return validateWorkspace(next);
}
export function markAdministered(workspace: Workspace, projectId: string, id: string): Workspace {
  const next = validateWorkspace(workspace), project = projectOf(next, projectId);
  const assessment = project.assessments.find(a => a.id === id);
  if (!assessment?.reviewedAt) throw new Error('請先確認這份題組；確認不等於施測。');
  const design = project.designs.find(d => d.id === assessment.designId)!;
  if (inputSignature(project.input) !== inputSignature(design.inputSnapshot)) throw new Error('課程草稿已變更，請先核對施測依據。');
  if (assessment.phase === 'post' && !project.assessments.find(a => a.id === assessment.parentPreId)?.administeredAt) throw new Error('請先記錄配對前測的實際施測。');
  if (!assessment.administeredAt) assessment.administeredAt = Math.max(Date.now(), assessment.reviewedAt, project.assessments.find(a => a.id === assessment.parentPreId)?.administeredAt ?? 0);
  return validateWorkspace(next);
}
export function selectAssessmentPair(workspace: Workspace, projectId: string, preId: string, postId: string | null): Workspace {
  const next = validateWorkspace(workspace), project = projectOf(next, projectId);
  const pre = project.assessments.find(a => a.id === preId && a.phase === 'pre');
  if (!pre) throw new Error('前測不存在。');
  if (postId && !project.assessments.some(a => a.id === postId && a.parentPreId === preId)) throw new Error('後測配對不一致。');
  project.activePreId = preId; project.activePostId = postId;
  return validateWorkspace(next);
}
export type DesignContent = Omit<DesignVersion, 'id' | 'createdAt' | 'confirmedAt' | 'origin' | 'inputSnapshot' | 'rubricVersion'>;
export type AssessmentContent = Pick<AssessmentVersion, 'capability' | 'application' | 'reflection'>;
