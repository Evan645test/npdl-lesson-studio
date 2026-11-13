import { describe, expect, it } from 'vitest';
import indicators from './indicators.json';

// R12-r4：子指標名稱與四階依《學生版學習進程》逐字抄錄；這些抽樣句子用來防止日後被改寫或摘要化。
describe('子指標與四階進程資料', () => {
  it('29 項、六大能力、每項固定四階且每階至少一條', () => {
    expect(indicators.entries).toHaveLength(29);
    expect(new Set(indicators.entries.map(row => row.dimension))).toEqual(new Set(['品格', '公民素養', '協作', '溝通', '創造力', '批判思考']));
    for (const row of indicators.entries) { expect(row.stages).toHaveLength(4); for (const stage of row.stages) expect(stage.split('\n').every(item => item.trim().length > 0)).toBe(true); }
  });
  it('名稱與條列沿用參考資料原文', () => {
    const byId = (id: string) => indicators.entries.find(row => row.id === id)!;
    expect(byId('character-learning-to-learn').name).toBe('對於人生和學會如何學習採取積極的態度');
    expect(byId('character-learning-to-learn').stages[0].split('\n')).toEqual(['我不清楚自己要學什麼，也不知道為什麼要學。', '我能完成教師交代的工作，但即使有同儕和老師的回饋，我也不太知道做得好不好。', '我對學習沒有興趣。']);
    expect(byId('critical-evaluate-information').name).toBe('能評估資訊和論點');
    expect(byId('critical-evaluate-information').stages[3]).toContain('我能針對所探討的主題提供支持或反對的論點，且能說出支持正反論點的理由。');
    expect(byId('communication-digital').stages[1]).toContain('我會使用數位工具與陌生的的受眾溝通。');
    expect(indicators.source.attribution).toBe('陳佩英、李哲迪、臺北市 NPDL 校群（2022）');
  });
});
