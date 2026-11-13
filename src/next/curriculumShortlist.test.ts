// 課綱候選清單：程式依主題與關鍵字篩選並給短編號，AI 回傳短編號由程式對應回正式編號。
import { describe, expect, it } from 'vitest';
import { curriculumShortlist, resolveHandle, SHORTLIST_LIMIT, shortlistHandles, subjectRows } from './curriculumShortlist';
import { emptySingleDraft, suggestedDirections } from './singlePath';

const draft = { ...emptySingleDraft(), grade: '高二', subject: '化學', topic: '如何用實驗證據判斷化學反應的快慢？', title: '反應速率', keywords: '反應速率、碰撞學說、濃度' };

describe('課綱候選清單', () => {
  it('依類型篩選、各有上限與短編號；關鍵字出現在條文中的條目排在前面', () => {
    const list = curriculumShortlist(draft);
    expect(list.performances).toHaveLength(SHORTLIST_LIMIT.performance); expect(list.contents).toHaveLength(SHORTLIST_LIMIT.content);
    expect(list.performances.map(row => row.no).slice(0, 3)).toEqual(['P1', 'P2', 'P3']); expect(list.contents[0].no).toBe('C1');
    const rows = subjectRows('化學');
    expect(list.performances.every(row => rows.find(entry => entry.id === row.id)?.kind === 'learning_performance')).toBe(true);
    expect(list.contents.every(row => rows.find(entry => entry.id === row.id)?.kind !== 'learning_performance')).toBe(true);
    const related = rows.filter(row => row.kind !== 'learning_performance' && /反應速率|碰撞/.test(row.text));
    expect(related.length).toBeGreaterThan(0);
    expect(related.some(row => row.id === list.contents[0].id)).toBe(true);
  });
  it('同一份草稿每次得到相同清單；條目不足上限時全部列出', () => {
    expect(curriculumShortlist(draft)).toEqual(curriculumShortlist(draft));
    const small = curriculumShortlist({ ...draft, subject: '國語文' });
    expect(small.performances.length).toBeLessThanOrEqual(SHORTLIST_LIMIT.performance);
  });
  it('AI 回傳短編號（含大小寫、附代碼）都對應回正式編號；代碼或正式編號仍可用', () => {
    const handles = shortlistHandles(draft), list = curriculumShortlist(draft);
    expect(resolveHandle('P2', handles)).toBe(list.performances[1].id);
    expect(resolveHandle('c1', handles)).toBe(list.contents[0].id);
    expect(resolveHandle(`C3. ${list.contents[2].code}`, handles)).toBe(list.contents[2].id);
    expect(resolveHandle('pa-Ⅴa-2', handles)).toBe('pa-Ⅴa-2');
    const [direction] = suggestedDirections({ directions: [{ title: '方向', drivingQuestion: '問題？', finalProduct: '作品', periods: 3, performanceIds: ['P1'], contentIds: ['C1', list.contents[1].code], indicatorIds: ['critical-evaluate-information'], reason: '理由' }] }, '化學', handles);
    expect(direction.curriculumIds).toEqual([list.performances[0].id, list.contents[0].id, list.contents[1].id]);
    expect(() => suggestedDirections({ directions: [{ title: '方向', drivingQuestion: '問題？', finalProduct: '作品', periods: 3, performanceIds: ['P99'], contentIds: ['C1'], indicatorIds: ['critical-evaluate-information'], reason: '理由' }] }, '化學', handles)).toThrow('缺學習表現');
  });
});
