import { describe, expect, it } from 'vitest';
import { createSeed } from '../data/seed';
import { buildLessonOverview } from './lessonOverview';
import { clampLines, wrapText } from './lessonPdf';

const measure = (text: string) => text.length * 10;

describe('R12-r10 課程一覽', () => {
  it('從已保存的設計與題組整理一覽，不新增判讀', () => {
    const project = createSeed().projects[0];
    const design = project.designs[0];
    const o = buildLessonOverview(project);
    expect(o.title).toBe(design.inputSnapshot.title);
    expect(o.drivingQuestion).toBe(design.inputSnapshot.topic);
    expect(o.goals).toHaveLength(design.goals.length);
    expect(o.periods).toHaveLength(design.activities.length);
    expect(o.periods[0].label).toBe('第 1 節');
    expect(o.focus.map(f => f.dimension).every(Boolean)).toBe(true);
    expect(o.assessment.pairs).toHaveLength(design.blueprint.length);
    expect(o.criteria[0].stages.map(s => s.stage)).toEqual(['證據有限', '萌芽', '發展', '精熟']);
    expect(o.status).toContain('尚未實施');
  });

  it('多節活動標示節次範圍', () => {
    const project = createSeed().projects[0];
    project.designs[0].activities[0].periods = 2;
    const o = buildLessonOverview(project);
    expect(o.periods[0].label).toBe('第 1–2 節');
    expect(o.periods[1].label).toBe('第 3 節');
  });

  it('題組屬於其他設計時，不把題目標題配到這份課程', () => {
    const project = createSeed().projects[0];
    project.assessments.forEach(a => { a.designId = 'other-design'; });
    const o = buildLessonOverview(project);
    expect(o.assessment.preStatus).toBe('前測尚未生成');
    expect(o.assessment.extras).toBe('後測尚未生成。');
    expect(o.assessment.pairs.every(p => p.pre === '（題組尚未生成）' && p.post === '（題組尚未生成）')).toBe(true);
  });

  it('藍圖題號找不到題目時不印內部編號', () => {
    const project = createSeed().projects[0];
    const id = project.designs[0].blueprint[0].preId;
    const pre = project.assessments.find(a => a.id === project.activePreId)!;
    pre.capability = pre.capability.filter(q => q.id !== id);
    const o = buildLessonOverview(project);
    expect(o.assessment.pairs[0].pre).toBe('（找不到對應題目）');
    expect(JSON.stringify(o.assessment.pairs)).not.toContain(id);
  });

  it('活動名稱前的「第N節：」會移除，避免與節次重複', () => {
    const project = createSeed().projects[0];
    project.designs[0].activities[0].name = '第1節：由證據解釋';
    project.designs[0].activities[1].name = '第 2–3 節｜比較方案';
    const o = buildLessonOverview(project);
    expect(o.periods[0].name).toBe('由證據解釋');
    expect(o.periods[1].name).toBe('比較方案');
  });

  it('換行與省略不遺失首段文字', () => {
    const lines = wrapText(measure, '一二三四五六七八九十', 40);
    expect(lines).toEqual(['一二三四', '五六七八', '九十']);
    const clamped = clampLines(lines, 2, measure, 40);
    expect(clamped).toHaveLength(2);
    expect(clamped[1].endsWith('…')).toBe(true);
    expect(clamped[0]).toBe('一二三四');
  });
});
