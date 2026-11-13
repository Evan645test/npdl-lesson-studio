import { describe, expect, it } from 'vitest';
import curriculum from '../data/curriculum.json';
import { createSeed } from '../data/seed';
import { recommendStrategy, strategiesFor } from './assessmentStrategy';

function designFor(subject: string, title: string, topic = title) {
  const design = structuredClone(createSeed().projects[0].designs[0]);
  design.inputSnapshot = { ...design.inputSnapshot, subject, title, topic, drivingQuestion: undefined, finalProduct: undefined };
  design.goals = [];
  design.criteria = [];
  design.activities = [];
  return design;
}

describe('分科出題策略', () => {
  it('每個內建學科都能提出可區分的材料、證據與誤判指引', () => {
    const subjects = [...new Set(curriculum.map(row => row.subject))];
    const ids = new Set<string>();
    for (const subject of subjects) {
      const options = strategiesFor(subject);
      expect(options.length, subject).toBeGreaterThanOrEqual(2);
      expect(new Set(options.map(item => item.evidence)).size, subject).toBe(options.length);
      for (const option of options) {
        expect(option.id).not.toMatch(/^general-/);
        expect(ids.has(option.id), option.id).toBe(false);
        ids.add(option.id);
        expect([option.label, option.material, option.evidence, option.pitfall].every(value => value.trim())).toBe(true);
      }
    }
  });

  it.each([
    ['國語文', '校刊評論的觀點與論據', '同一件校園事件，兩篇校刊評論的立場與論據有什麼不同？', 'chinese-argument-check'],
    ['數學', '平均數與資料分布', '兩組資料的平均數相同，為什麼分布還可能不同？', 'math-distribution'],
    ['生物', '校園生物多樣性', '校園不同棲地的物種多樣性有哪些差異？', 'biology-field-comparison'],
  ])('依 %s 的單元內容推薦適合的策略', (subject, title, topic, expected) => {
    const design = designFor(subject, title, topic);
    expect(recommendStrategy(design).id).toBe(expected);
    expect(recommendStrategy(structuredClone(design)).id).toBe(expected);
  });

  it('同一科的生態調查、實驗對照、構造功能會採不同策略', () => {
    const scenarios = [
      ['校園鳥類調查', '棲地不同，樣區與調查時段如何比較？', 'biology-field-comparison'],
      ['唾液澱粉酶活性', '比較不同酸鹼條件的酵素活性，怎麼設對照組？', 'biology-experimental-control'],
      ['葉片構造與氣孔', '用氣孔與葉脈的結構特徵說明功能', 'biology-structure-function'],
    ] as const;
    expect(scenarios.map(([title, topic]) => recommendStrategy(designFor('生物', title, topic)).id)).toEqual(scenarios.map(row => row[2]));
  });

  it('單元名稱模糊時會參考已確認目標；名稱明確時不讓其他活動搶走主題', () => {
    const vague = designFor('數學', '比較兩個方案', '選哪一種比較合適？');
    vague.goals = [{ id: 'g', kind: 'academic', text: '能比較起始費用及每分鐘單價', success: '將單價換成相同時間的費用，指出交點前後的選擇', curriculumIds: [] }];
    expect(recommendStrategy(vague).id).toBe('math-relationship');
    const distribution = { ...vague, inputSnapshot: { ...vague.inputSnapshot, title: '平均數與資料分布', topic: '分布與全距' } };
    expect(recommendStrategy(distribution).id).toBe('math-distribution');
  });

  it('舊科目別名可沿用；未知科目使用穩定且安全的通用選項', () => {
    expect(recommendStrategy(designFor('　國文　', '論點和論據')).id).toBe('chinese-argument-check');
    for (const subject of ['跨領域課程', 'constructor', '__proto__']) {
      expect(strategiesFor(subject).length).toBeGreaterThanOrEqual(2);
      expect(strategiesFor(subject)).toContainEqual(recommendStrategy(designFor(subject, '進行一項比較')));
    }
  });
});
