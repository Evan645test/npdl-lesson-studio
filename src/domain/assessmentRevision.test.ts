import { describe, expect, it } from 'vitest';
import { createSeed } from '../data/seed';
import { reviseAssessmentItem } from './assessmentRevision';

describe('R07 單題另存版本', () => {
  it('前測改一題保留舊題組，解除現用後測配對', () => {
    const seed = createSeed(), project = seed.projects[0], pre = project.assessments.find(row => row.phase === 'pre')!;
    const oldPostId = project.activePostId, oldPreId = project.activePreId;
    const replacement = { ...pre.capability[0], prompt: `${pre.capability[0].prompt} 請先確認資料是否足夠。` };
    const next = reviseAssessmentItem(seed, project.id, pre.id, replacement.id, replacement).projects[0];
    expect(next.activePreId).not.toBe(oldPreId); expect(next.activePostId).toBeNull();
    expect(next.assessments.find(row => row.id === pre.id)).toEqual(pre);
    expect(next.assessments.find(row => row.id === oldPostId)?.parentPreId).toBe(oldPreId);
    expect(next.assessments.find(row => row.id === next.activePreId)?.capability[0].prompt).toContain('請先確認');
    expect(next.assessments.find(row => row.id === next.activePreId)?.reviewedAt).toBeNull();
  });
  it('不得修訂歷史已施測題組或暗改題號與規準', () => {
    const seed = createSeed(), project = seed.projects[0], pre = project.assessments.find(row => row.phase === 'pre')!, item = pre.capability[0];
    expect(() => reviseAssessmentItem(seed, project.id, pre.id, item.id, { ...item, id: 'new-id' })).toThrow('題號');
    pre.administeredAt = Date.now();
    expect(() => reviseAssessmentItem(seed, project.id, pre.id, item.id, { ...item, prompt: '改題' })).toThrow('已施測');
  });
});
