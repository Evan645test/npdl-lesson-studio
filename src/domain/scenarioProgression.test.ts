import { describe, expect, it } from 'vitest';
import { buildAspectPlan, buildScenarioPlan, checkScenarioSets, decodeAspects, decodeScenarioSets, stablePermutation } from './scenarioProgression';

const ID = 'communication-audience-impact';
const aspectsRaw = { [ID]: [{ label: '選擇媒介', description: '從需要示範到能比較媒介優勢。' }, { label: '清楚表達', description: '從難以表達到措辭清楚。' }, { label: '依受眾調整', description: '從不考慮受眾到預測受眾解讀。' }] };
const four = (p: string) => ({ limited: `${p}我會照學長姊去年的做法，省時間也比較保險`, emerging: `${p}我會挑大家常用的方式，家長應該比較熟悉`, developing: `${p}我會比較兩種方式的效果，再選適合的一種`, proficient: `${p}我會先問家長想知道什麼，再決定用哪種方式` });
const EXT = { prompt: '回顧前面三題，挑一題說明你為什麼這樣選、這樣做可能有什麼代價。', anchors: { limited: '只說選了哪一個', emerging: '說出一個理由', developing: '說出理由與一個限制', proficient: '比較不同情境並說明判斷依據' } };
const itemsRaw = (aspectIds: string[]) => ({ [ID]: { extension: EXT, ...Object.fromEntries(aspectIds.map(a => [a, { scenario: `社團要向家長介紹活動成果（${a}）。`, prompt: '你會怎麼準備？', options: four(a), reasonPrompt: '你會怎麼做？為什麼？', anchors: four('錨點') }])) } });

describe('R33 情境進程題', () => {
  it('面向：依請求的 aspectCount 核對（未指定時 1–3 個），程式編號 A1–A3；請求附四階原文', () => {
    const plan = buildAspectPlan('p', [ID], { subject: '化學' }, 'sig');
    expect(JSON.stringify(plan.payload)).toContain('我需要教師或同儕的協助');
    const aspects = decodeAspects(aspectsRaw, [ID]);
    expect(aspects[0].aspects.map(a => a.id)).toEqual(['A1', 'A2', 'A3']);
    expect(() => decodeAspects({ [ID]: aspectsRaw[ID].slice(0, 2) }, [ID], { [ID]: 3 })).toThrow('剛好 3 個面向');
    expect(decodeAspects({ [ID]: aspectsRaw[ID].slice(0, 2) }, [ID])[0].aspects).toHaveLength(2);
    expect(() => decodeAspects({ [ID]: [...aspectsRaw[ID], { label: '第四', description: '多的。' }] }, [ID])).toThrow('1–3 個面向');
  });
  it('題本：每面向一題、選項穩定打亂、階段只在教師資料；前後測情境要求不同', () => {
    const aspects = decodeAspects(aspectsRaw, [ID]);
    expect(buildScenarioPlan('p', aspects, 'pre', {}, 's').instructions).toMatch(/生活情境/);
    expect(buildScenarioPlan('p', aspects, 'post', {}, 's').instructions).toMatch(/不得沿用前測情境/);
    const sets = decodeScenarioSets(itemsRaw(['A1', 'A2', 'A3']), aspects, 'pre1');
    expect(sets[0].items).toHaveLength(3);
    expect(sets[0].items.every(i => [...i.options.map(o => o.stage)].sort().join() === '0,1,2,3')).toBe(true);
    expect(stablePermutation('x')).toEqual(stablePermutation('x'));
    expect(() => checkScenarioSets(sets, aspects)).not.toThrow();
  });
  it('缺面向、選項含階段名稱、最高階明顯較長都拒收', () => {
    const aspects = decodeAspects(aspectsRaw, [ID]);
    expect(() => decodeScenarioSets(itemsRaw(['A1', 'A2']), aspects, 'x')).toThrow('剛好對應');
    const bad = itemsRaw(['A1', 'A2', 'A3']); ((bad[ID] as unknown as Record<string, { options: unknown }>).A1.options as Record<string, string>).proficient = '我已經精熟了，所以我會先問家長想知道什麼';
    expect(() => decodeScenarioSets(bad, aspects, 'x')).toThrow('階段名稱');
    const long = itemsRaw(['A1', 'A2', 'A3']); ((long[ID] as unknown as Record<string, { options: unknown }>).A2.options as Record<string, string>).proficient = '我會先分析對方的背景與需求，再比較各種方式的優缺點，選出最能讓對方理解並產生連結的一種，最後依回饋修改';
    expect(() => decodeScenarioSets(long, aspects, 'x')).toThrow('差距太大');
  });
});
