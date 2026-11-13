import { describe, expect, it } from 'vitest';
import { buildAspectPlan, buildScenarioPlan, checkScenarioSets, decodeAspects, decodeScenarioSets } from './scenarioProgression';

// R35：面向層級的四階錨點由前後測共用；題本請求附上教師已確認的本課規準。
const ID = 'communication-audience-impact';
const anchors = (p: string) => ({ limited: `${p}：理由只說照別人做`, emerging: `${p}：理由提到常用方式`, developing: `${p}：理由比較兩種方式`, proficient: `${p}：理由說明對方需要與依據` });
const aspectsRaw = { [ID]: ['選擇媒介', '清楚表達', '依受眾調整'].map(label => ({ label, description: `${label}從低到高的差異。`, anchors: anchors(label) })) };
const four = (p: string) => ({ limited: `${p}我會照學長姊去年的做法，省時間也比較保險`, emerging: `${p}我會挑大家常用的方式，家長應該比較熟悉`, developing: `${p}我會比較兩種方式的效果，再選適合的一種`, proficient: `${p}我會先問家長想知道什麼，再決定用哪種方式` });
const itemsRaw = { [ID]: { extension: { prompt: '回顧前面三題，挑一題說明你為什麼這樣選、這樣做可能有什麼代價。', anchors: { limited: '只說選了哪一個', emerging: '說出一個理由', developing: '說出理由與一個限制', proficient: '比較不同情境並說明判斷依據' } }, ...Object.fromEntries(['A1', 'A2', 'A3'].map(a => [a, { scenario: `社團要向家長介紹活動成果（${a}）。`, prompt: '你會怎麼準備？', options: four(a), reasonPrompt: '你先考慮了什麼？為什麼？' }])) } };
const criteria = [{ indicatorId: ID, label: 'criterion-1', stages: ['本課規準一', '本課規準二', '本課規準三', '本課規準四'] }];

describe('R35 共用錨點與本課規準', () => {
  it('面向請求要求錨點並附本課規準', () => {
    const plan = buildAspectPlan('p', [ID], {}, 's', criteria);
    expect(JSON.stringify(plan.payload)).toContain('本課規準三');
    expect(JSON.stringify(plan.payload.outputSchema)).toContain('anchors');
  });
  it('面向已有錨點時，題本不再要求錨點，前後測沿用同一組', () => {
    const aspects = decodeAspects(aspectsRaw, [ID]);
    expect(aspects[0].aspects[0].anchors).toHaveLength(4);
    const pre = buildScenarioPlan('p', aspects, 'pre', {}, 's', undefined, criteria);
    // R41：延伸題有自己的錨點；每題（A1–A3）不再要求錨點。
    const items = (pre.payload.outputSchema as { properties: Record<string, { properties: Record<string, unknown> }> }).properties[ID].properties;
    expect(JSON.stringify([items.A1, items.A2, items.A3])).not.toContain('anchors');
    expect(JSON.stringify(pre.payload)).toContain('本課規準一');
    const preSets = decodeScenarioSets(itemsRaw, aspects, 'pre1'), postSets = decodeScenarioSets(itemsRaw, aspects, 'post1');
    expect(preSets[0].items[0].anchors[3]).toBe('選擇媒介：理由說明對方需要與依據');
    expect(postSets[0].items.map(i => i.anchors)).toEqual(preSets[0].items.map(i => i.anchors));
    expect(() => checkScenarioSets(preSets, aspects)).not.toThrow();
  });
  it('舊面向沒有錨點時，題本仍各自產生錨點', () => {
    const old = decodeAspects({ [ID]: aspectsRaw[ID].map(({ label, description }) => ({ label, description })) }, [ID]);
    expect(old[0].aspects[0].anchors).toBeUndefined();
    expect(JSON.stringify(buildScenarioPlan('p', old, 'pre', {}, 's').payload.outputSchema)).toContain('anchors');
  });
  it('錨點空白會被擋下', () => {
    expect(() => decodeAspects({ [ID]: aspectsRaw[ID].map((row, n) => n ? row : { ...row, anchors: { ...row.anchors, developing: ' ' } }) }, [ID])).toThrow('判讀錨點');
  });
});
