import { describe, expect, it } from 'vitest';
import { createSeed } from '../data/seed';
import { addAssumption, addCurriculumId, addIndicatorId, courseDraftGap, removeIndicatorId, reviseDesignContent } from './courseDraft';

describe('輸入草稿與設計快照', () => {
  it('相同內容不產生差異；改草稿不會改快照', () => {
    const seed = createSeed();
    const project = seed.projects[0];
    expect(courseDraftGap(project.input, project.designs[0].inputSnapshot)).toEqual([]);
    project.input.subject = '物理';
    project.input.indicatorIds = ['critical-evaluate-information', 'character-learning-to-learn'];
    expect(courseDraftGap(project.input, project.designs[0].inputSnapshot)).toEqual(['學科', '子指標']);
    expect(project.designs[0].inputSnapshot.subject).toBe('化學');
    expect(project.designs[0].inputSnapshot.indicatorIds).toEqual(['critical-evaluate-information']);
  });

  it('課綱與子指標數量沿用契約上限', () => {
    expect(addCurriculumId(['a'], 'b')).toEqual(['a', 'b']);
    expect(() => addCurriculumId(['a'], 'a')).toThrow('已在輸入草稿');
    expect(() => addCurriculumId(Array.from({ length: 12 }, (_, index) => String(index)), 'x')).toThrow('最多 12');
    expect(addIndicatorId(['critical-evaluate-information'], 'character-learning-to-learn')).toHaveLength(2);
    expect(() => addIndicatorId(['a', 'b'], 'c')).toThrow('最多 2');
    expect(() => removeIndicatorId(['only'], 'only')).toThrow('至少保留 1');
    expect(addAssumption(['已有'], '新的起點假設')).toEqual(['已有', '新的起點假設']);
    expect(() => addAssumption(['已有'], '  ')).toThrow('不可空白');
    expect(() => addAssumption(Array.from({ length: 20 }, () => '假設'), '再一則')).toThrow('最多 20');
  });
});

describe('目標與鷹架另存草稿', () => {
  it('新設計不套用未核對輸入，也不改原題組與舊版', () => {
    const original = createSeed();
    original.projects[0].input.subject = '物理';
    original.projects[0].input.topic = '草稿裡的新問題';
    const next = reviseDesignContent(original, original.activeProjectId, design => {
      design.goals[0].success = '隔離驗證的成功表現，只寫進新草稿。';
      design.inputSnapshot.subject = '不該寫入';
    }, '教師修訂成功表現草稿。');
    const project = next.projects[0];
    expect(original.projects[0].designs).toHaveLength(1);
    expect(project.designs).toHaveLength(2);
    expect(project.designs[0]).toEqual(createSeed().projects[0].designs[0]);
    expect(project.designs[1].origin).toBe('teacher');
    expect(project.designs[1].confirmedAt).toBeNull();
    expect(project.designs[1].inputSnapshot.subject).toBe('化學');
    expect(project.designs[1].inputSnapshot.topic).not.toBe('草稿裡的新問題');
    expect(project.input.subject).toBe('物理');
    expect(project.assessments.map(item => item.designId)).toEqual(original.projects[0].assessments.map(item => item.designId));
    expect(project.activePreId).toBe(original.projects[0].activePreId);
    expect(project.activePostId).toBe(original.projects[0].activePostId);
    expect(project.input.originalSource).toEqual(original.projects[0].input.originalSource);
  });

  it('鷹架修訂保留活動任務與四階順序', () => {
    const original = createSeed();
    const task = original.projects[0].designs[0].activities[0].task;
    const next = reviseDesignContent(original, original.activeProjectId, design => {
      design.activities[0].scaffolds[0].fading = '隔離驗證才撤去提示。';
    }, '教師修訂四階鷹架草稿。');
    const activity = next.projects[0].designs[1].activities[0];
    expect(activity.task).toBe(task);
    expect(activity.scaffolds.map(item => item.stage)).toEqual(['證據有限', '萌芽', '發展', '精熟']);
    expect(activity.scaffolds[0].fading).toBe('隔離驗證才撤去提示。');
    expect(next.projects[0].assessments[1].capability[0].options[0].supports.length).toBeGreaterThan(0);
    expect(next.projects[0].assessments[1].application.length).toBeGreaterThan(0);
    expect(next.projects[0].assessments[1].reflection.length).toBe(1);
  });

  it('沒有變更、空白摘要與空成功表現都不另存', () => {
    const seed = createSeed();
    expect(() => reviseDesignContent(seed, seed.activeProjectId, () => undefined, '摘要')).toThrow('沒有變更');
    expect(() => reviseDesignContent(seed, seed.activeProjectId, design => { design.goals[0].success = '有改'; }, ' ')).toThrow('不可空白');
    expect(() => reviseDesignContent(seed, seed.activeProjectId, design => { design.goals[0].success = ' '; }, '摘要')).toThrow('文字長度');
  });
});
