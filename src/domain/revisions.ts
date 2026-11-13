import type { DesignVersion, Workspace } from './types';
import { validateWorkspace } from './validate';

export function reviseDesignContent(workspace: Workspace, projectId: string, mutate: (design: DesignVersion) => void, summary: string): Workspace {
  const next = structuredClone(workspace), project = next.projects.find(p => p.id === projectId);
  if (!project) throw new Error('專案不存在。');
  const previous = project.designs.find(d => d.id === project.activeDesignId);
  if (!previous) throw new Error('設計不存在。');
  if (!summary.trim()) throw new Error('設計摘要不可空白。');
  const design = structuredClone(previous);
  mutate(design);
  design.inputSnapshot = structuredClone(previous.inputSnapshot);
  if (JSON.stringify(design) === JSON.stringify(previous)) throw new Error('設計內容沒有變更。');
  design.id = crypto.randomUUID(); design.createdAt = Math.max(Date.now(), previous.createdAt); design.confirmedAt = null; design.origin = 'teacher'; design.summary = design.summary.trim();
  design.integration = design.integration.map(rule => ({ ...rule, status: rule.status === 'missing' ? 'missing' : 'draft' }));
  project.designs.push(design); project.activeDesignId = design.id;
  if (project.workflow === 'single-v1') { project.activePreId = null; project.activePostId = null; }
  return validateWorkspace(next);
}
export function reviseActivity(workspace: Workspace, projectId: string, activityId: string, task: string): Workspace {
  if (!task.trim()) throw new Error('活動內容不可空白。');
  return reviseDesignContent(workspace, projectId, design => {
    const activity = design.activities.find(a => a.id === activityId);
    if (!activity) throw new Error('活動不存在。');
    activity.task = task;
  }, '教師修訂活動草稿；尚待重新核對目標、規準、藍圖與課程起點。');
}
