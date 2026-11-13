import type { Item, Workspace } from './types';
import { validateWorkspace } from './validate';

export function reviseAssessmentItem(workspace: Workspace, projectId: string, assessmentId: string, itemId: string, replacement: Item): Workspace {
  const next = structuredClone(workspace);
  const project = next.projects.find(row => row.id === projectId);
  const old = project?.assessments.find(row => row.id === assessmentId);
  if (!project || !old) throw new Error('題組版本不存在。');
  if (old.administeredAt) throw new Error('已施測的歷史題組不能在此修改。');
  if (old.phase === 'pre' && project.activePreId !== assessmentId || old.phase === 'post' && project.activePostId !== assessmentId) throw new Error('先切換到要修改的現用題組。');
  const existing = [...old.capability, ...old.application].find(row => row.id === itemId);
  if (!existing) throw new Error('指定題目不存在。');
  if (replacement.id !== existing.id || JSON.stringify(replacement.criterionIds) !== JSON.stringify(existing.criterionIds) || JSON.stringify(replacement.curriculumIds ?? []) !== JSON.stringify(existing.curriculumIds ?? []) || !!replacement.applicationCriteria !== !!existing.applicationCriteria || project.workflow === 'single-v1' && (!replacement.shortResponse?.prompt.trim() || !replacement.shortResponse.example.trim() || !replacement.shortResponse.evidence.trim())) throw new Error('題號、規準、課綱與題目用途不得變更；簡短說明不可缺漏。');
  if (JSON.stringify(replacement) === JSON.stringify(existing)) throw new Error('題目內容沒有變更。');
  const version = structuredClone(old);
  version.id = crypto.randomUUID(); version.createdAt = Math.max(Date.now(), old.createdAt);
  version.reviewedAt = null; version.administeredAt = null;
  version.capability = version.capability.map(row => row.id === itemId ? structuredClone(replacement) : row);
  version.application = version.application.map(row => row.id === itemId ? structuredClone(replacement) : row);
  project.assessments.push(version);
  if (version.phase === 'pre') {
    const paired = project.workflow === 'single-v1' ? project.assessments.find(row => row.id === project.activePostId && row.parentPreId === old.id) : undefined;
    project.activePreId = version.id;
    project.activePostId = null;
    if (paired) {
      const copiedPost = structuredClone(paired);
      copiedPost.id = crypto.randomUUID();
      copiedPost.parentPreId = version.id;
      copiedPost.createdAt = Math.max(Date.now(), version.createdAt, paired.createdAt);
      copiedPost.reviewedAt = null;
      copiedPost.administeredAt = null;
      project.assessments.push(copiedPost);
      project.activePostId = copiedPost.id;
    }
  }
  else project.activePostId = version.id;
  return validateWorkspace(next);
}

// R12-r8：單題重生時，題號、對應規準、課綱與題目用途由程式從原題補回；AI 只寫題目內容。
export const ITEM_IDENTITY = ['id', 'criterionIds', 'curriculumIds'] as const;
export function restoreItemIdentity(original: Item, value: unknown): Item {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('單題回應格式不符。');
  const { id: _id, criterionIds: _criteria, curriculumIds: _curriculum, ...content } = value as Item; void _id; void _criteria; void _curriculum;
  // 題目用途依原題：能力題一律 null；應用題的評分說明可由 AI 改寫，漏回時沿用原題。
  const applicationCriteria = original.applicationCriteria ? content.applicationCriteria ?? structuredClone(original.applicationCriteria) : null;
  const merged: Record<string, unknown> = { ...content, applicationCriteria, id: original.id, criterionIds: [...original.criterionIds], ...(original.curriculumIds ? { curriculumIds: [...original.curriculumIds] } : {}) };
  // 欄位順序依原題，未改內容時才會被判定為「沒有變更」。
  const keys = [...Object.keys(original).filter(key => key in merged), ...Object.keys(merged).filter(key => !(key in original))];
  return Object.fromEntries(keys.map(key => [key, merged[key]])) as unknown as Item;
}
