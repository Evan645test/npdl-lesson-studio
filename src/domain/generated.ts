import type { Workspace } from './types';
import { inputSignature, validateAssessmentContent, validateDesignContent, validateWorkspace } from './validate';
import { assertReviewed, projectOf, type AssessmentContent, type DesignContent } from './lifecycle';

export function addGeneratedDesign(workspace: Workspace, projectId: string, content: unknown): Workspace {
  validateDesignContent(content);
  const next = validateWorkspace(workspace), project = projectOf(next, projectId);
  assertReviewed(project.input);
  const designContent = content as DesignContent;
  if (designContent.integration.some(r => r.status !== 'draft' && r.status !== 'missing')) throw new Error('AI 不能替教師確認整合規則。');
  const id = crypto.randomUUID();
  project.designs.push({ ...structuredClone(designContent), id, rubricVersion: `npdl-four-v2:${id}`, createdAt: Date.now(), confirmedAt: null, origin: 'ai', inputSnapshot: structuredClone(project.input) });
  project.activeDesignId = id;
  return validateWorkspace(next);
}
export function addGeneratedAssessment(workspace: Workspace, projectId: string, kind: 'pre' | 'post', content: unknown): Workspace {
  validateAssessmentContent(content);
  const next = validateWorkspace(workspace), project = projectOf(next, projectId);
  const pre = kind === 'post' ? project.assessments.find(a => a.id === project.activePreId) : undefined;
  if (kind === 'post' && !pre) throw new Error('請先保存完整前測。');
  const design = project.designs.find(d => d.id === (pre?.designId ?? project.activeDesignId))!;
  if (!design.confirmedAt) throw new Error('先確認設計，才可生成題組。');
  if (inputSignature(project.input) !== inputSignature(design.inputSnapshot)) throw new Error('課程草稿已變更，請重新核對設計來源。');
  const data = structuredClone(content as AssessmentContent);
  const id = crypto.randomUUID();
  project.assessments.push({ ...data, id, phase: kind, parentPreId: pre?.id ?? null, designId: design.id, rubricVersion: design.rubricVersion, createdAt: Math.max(Date.now(), design.createdAt, pre?.createdAt ?? 0), reviewedAt: null, administeredAt: null });
  if (kind === 'pre') { project.activePreId = id; project.activePostId = null; }
  else project.activePostId = id;
  return validateWorkspace(next);
}
