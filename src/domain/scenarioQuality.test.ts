import { afterEach, describe, expect, it, vi } from 'vitest';
import { NEW_ASPECTS, pickBalanced, buildAspectPlan, buildScenarioPlan, checkScenarioSets, decodeAspects, decodeScenarioSets, keepPassingItems } from './scenarioProgression';
import { plainProblem } from '../next/uxText';
import { runRequest } from '../services/openai';
import type { RequestPlan } from '../services/generation';

// R36（2026-11-12）：依 R13-r35 真實模型實跑（GPT-4.1，前測兩次因精熟選項過長退件）修正題目品質。
const CRIT = 'critical-evaluate-information'; // NPDL 原文每階 3 句
const COMM = 'communication-audience-impact'; // NPDL 原文每階 2 句
const criteria = (id: string, n: number) => Array.from({ length: n }, (_, i) => ({ indicatorId: id, label: `規準${i + 1}`, stages: ['一', '二', '三', '四'] }));
const anchors = { limited: '理由只說看結果', emerging: '理由提到條件不同', developing: '理由說要同條件重測', proficient: '理由說明哪些資料能區分解釋' };
const aspectsRaw = (id: string, n: number) => ({ [id]: Array.from({ length: n }, (_, i) => ({ label: `面向${i + 1}`, description: `面向${i + 1}的差異。`, anchors })) });
const good = (p: string) => ({ limited: `${p}我會看哪一組的時間比較短，直接用來下結論`, emerging: `${p}我會先把天氣不同的那一筆拿掉，再比較剩下的`, developing: `${p}我會約好同樣天氣和計時的人，兩人各跑一次`, proficient: `${p}我會先想哪些差異會影響秒數，再決定要重測哪一項` });
const EXT = { prompt: '回顧前面三題，挑一題說明你為什麼這樣選、這樣做可能有什麼代價。', anchors: { limited: '只說選了哪一個', emerging: '說出一個理由', developing: '說出理由與一個限制', proficient: '比較不同情境並說明判斷依據' } };
const item = (options: Record<string, string | string[]>) => ({ scenario: '你和朋友在不同天氣下各跑了一次一百公尺，大家都說朋友比較快。', prompt: '你會怎麼判斷誰比較快？', options, reasonPrompt: '你為什麼這樣做？這樣做可能有什麼代價？' });

describe('R41 每個子指標 3 個面向，可請 AI 重新產生', () => {
  it('新請求每個子指標剛好 3 個面向；回應數量不符即拒收；舊資料 1–2 個面向仍可讀', () => {
    expect(NEW_ASPECTS).toBe(3);
    const plan = buildAspectPlan('p', [CRIT, COMM], {}, 's', criteria(CRIT, 2));
    expect((plan.payload.indicators as { aspectCount: number }[]).map(row => row.aspectCount)).toEqual([3, 3]);
    expect(JSON.stringify(plan.payload.outputSchema)).toContain('"minItems":3,"maxItems":3');
    expect(plan.instructions).toMatch(/剛好 3 個「面向」/);
    expect(decodeAspects(aspectsRaw(CRIT, 3), [CRIT], { [CRIT]: 3 })[0].aspects.map(a => a.id)).toEqual(['A1', 'A2', 'A3']);
    expect(() => decodeAspects(aspectsRaw(CRIT, 2), [CRIT], { [CRIT]: 3 })).toThrow('剛好 3 個面向');
    expect(decodeAspects(aspectsRaw(CRIT, 1), [CRIT])[0].aspects).toHaveLength(1);
  });
  it('重新產生單一子指標：只送該子指標，附原本面向請 AI 換角度', () => {
    const plan = buildAspectPlan('p', [CRIT], {}, 's', criteria(CRIT, 2), { [CRIT]: [{ label: '比較資料是否公平', description: '舊說明' }] });
    const row = (plan.payload.indicators as { indicatorId: string; avoid?: { label: string }[] }[]);
    expect(row.map(r => r.indicatorId)).toEqual([CRIT]);
    expect(row[0].avoid?.[0].label).toBe('比較資料是否公平');
    expect(plan.instructions).toMatch(/avoid/);
  });
  it('1 個面向的題本可產生並通過保存前核對', () => {
    const one = decodeAspects(aspectsRaw(CRIT, 1), [CRIT], { [CRIT]: 1 });
    const sets = decodeScenarioSets({ [CRIT]: { extension: EXT, A1: item(good('')) } }, one, 'pre1');
    expect(sets[0].items).toHaveLength(1);
    expect(() => checkScenarioSets(sets, one)).not.toThrow();
  });
});

describe('R36 選項不可一眼猜出高階', () => {
  const aspects = decodeAspects(aspectsRaw(CRIT, 2), [CRIT], { [CRIT]: 2 });
  it('提示詞要求有好處的做法、差異不在步驟多寡、字數區間，理由題問代價', () => {
    const text = buildScenarioPlan('p', aspects, 'pre', {}, 's').instructions;
    expect(text).toMatch(/每一階給兩種寫法/);
    expect(text).toMatch(/不是把低階做法再加上更多步驟/);
    expect(text).toMatch(/精熟的兩種寫法都不可以比其他階明顯長/);
    expect(text).toMatch(/自貶語氣/);
    expect(text).toMatch(/可能遇到的問題或代價/);
  });
  it('合格選項通過；已保存的舊題本（短選項）載入不受新規則影響', () => {
    const sets = decodeScenarioSets({ [CRIT]: { extension: EXT, A1: item(good('')), A2: item(good('也')) } }, aspects, 'pre1');
    expect(sets[0].items).toHaveLength(2);
    const old = structuredClone(sets);
    old[0].items[0].options.forEach((o, i) => { o.text = `舊選項${i}`; });
    expect(() => checkScenarioSets(old, aspects)).not.toThrow();
  });
  it('R35 實跑被退件的選項：一次列出所有不合格題目與字數', () => {
    const real = { limited: '我看大家的結果，直接覺得朋友A比較快，因為他的成績比我好。', emerging: '我會想到天氣跟計時的人不一樣，可能需要條件一樣才算，但我不太確定要怎麼證明。', developing: '我會建議再找跟之前條件一樣（天氣、場地、計時方式）的情況，讓我們再各自跑一次，看看結果是否仍然一樣，再來比較。', proficient: '我會同時檢查天氣、場地和計時員有沒有影響，建議多跑幾次、互換計時員，並觀察是否有其他影響因素，討論是否還需要哪些重複或補充資料。' };
    const doubt = { ...good(''), emerging: '我不太確定怎麼比，就先照大家說的結果決定' };
    let message = '';
    try { decodeScenarioSets({ [CRIT]: { extension: EXT, A1: item(real), A2: item(doubt) } }, aspects, 'x'); } catch (error) { message = (error as Error).message; }
    expect(message).toMatch(/^情境題：2 題要修正。/);
    expect(message).toContain('「面向1」四個選項字數 29／38／55／64');
    expect(message).toContain('「面向2」有選項帶自貶語氣（「不太確定」）');
    expect(plainProblem(message)).toContain('AI 出的情境題2 題要修正');
  });
  it('評價字詞只擋發展、精熟選項；低階描述「賣得最好」不算', () => {
    const low = { ...good(''), limited: '我會看剩最少的那家，因為數量最少代表賣得最好' };
    expect(() => decodeScenarioSets({ [CRIT]: { extension: EXT, A1: item(low), A2: item(good('也')) } }, aspects, 'x')).not.toThrow();
    const praise = { ...good(''), proficient: '我會用最完整的方法，把影響秒數的差異一一排除再比' };
    expect(() => decodeScenarioSets({ [CRIT]: { extension: EXT, A1: item(praise), A2: item(good('也')) } }, aspects, 'x')).toThrow('評價字詞（「最完整」）');
  });
});

describe('R36 OpenAI 拒絕金鑰時不再說「核對網路」', () => {
  afterEach(() => vi.unstubAllGlobals());
  const plan: RequestPlan = { kind: 'field', projectId: 'p', sourceSignature: 's', payload: { task: 't' }, instructions: 'i', attempt: 0 };
  const settings = { provider: 'openai' as const, key: 'k-test', model: 'gpt-4.1' };
  it('帶金鑰的請求被擋、不帶金鑰的探測得到 401：判定多半是金鑰問題，探測不帶金鑰', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(runRequest(plan, settings, true, new AbortController().signal, () => {})).rejects.toThrow('OpenAI 金鑰無法使用的可能性最高');
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.openai.com/v1/models');
    expect(JSON.stringify(fetchMock.mock.calls[1][1] ?? {})).not.toContain('k-test');
  });
  it('R39：探測回 503 等非 401 狀態，不判定為金鑰問題', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(new Response('{}', { status: 503 })));
    await expect(runRequest(plan, settings, true, new AbortController().signal, () => {})).rejects.toThrow('AI 連線失敗');
  });
  it('R39：探測期間按停止，回報已取消而不是金鑰或網路問題', async () => {
    const stop = new AbortController();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_, reject) => { init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); setTimeout(() => stop.abort(), 5); })));
    await expect(runRequest(plan, settings, true, stop.signal, () => {})).rejects.toThrow('已取消');
  });
  it('探測也連不上：維持連線失敗訊息', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(runRequest(plan, settings, true, new AbortController().signal, () => {})).rejects.toThrow('AI 連線失敗');
  });
});

describe('R36 修復只採用原本不合格題目的新版本', () => {
  const aspects = decodeAspects(aspectsRaw(CRIT, 2), [CRIT], { [CRIT]: 2 });
  const long = { ...good(''), proficient: '我會根據新資料調整結論，指出在曾測過的條件下趨勢成立，但其他部分需要再實驗確認，也提出可能的影響解釋' };
  it('實跑情境：第一次 A1 不合格、A2 合格；修復後 A1 合格但 A2 被改壞 → 合併後通過，A2 保留第一次版本', () => {
    const first = { [CRIT]: { extension: EXT, A1: item(long), A2: item(good('原')) } };
    const repaired = { [CRIT]: { extension: EXT, A1: item(good('修')), A2: item(long) } };
    expect(() => decodeScenarioSets(repaired, aspects, 'x')).toThrow('1 題要修正');
    const sets = decodeScenarioSets(keepPassingItems(repaired, aspects, JSON.stringify(first)), aspects, 'x');
    expect(sets[0].items[0].options.some(o => o.text.startsWith('修'))).toBe(true);
    expect(sets[0].items[1].options.some(o => o.text.startsWith('原'))).toBe(true);
  });
  it('沒有上一次回應或無法解析時不合併', () => {
    const raw = { [CRIT]: { extension: EXT, A1: item(good('')), A2: item(good('也')) } };
    expect(keepPassingItems(raw, aspects, undefined)).toBe(raw);
    expect(keepPassingItems(raw, aspects, '{"截斷')).toBe(raw);
  });
});

describe('R44 精熟選項不可明顯最長；每階兩種寫法由程式挑選', () => {
  const aspects = decodeAspects(aspectsRaw(CRIT, 2), [CRIT], { [CRIT]: 2 });
  const sized = (n: number[]) => Object.fromEntries(['limited', 'emerging', 'developing', 'proficient'].map((k, i) => [k, `${'甲乙丙丁'[i]}`.padEnd(n[i], '試')]));
  const pad = (c: string, n: number) => c.padEnd(n, '試');
  it('精熟比其他三個中最長者多 4 字內可通過；R43 實跑 30/29/30/48、49/46/43/55 改為拒收；1.8 倍與 60 字上限仍在', () => {
    expect(() => decodeScenarioSets({ [CRIT]: { extension: EXT, A1: item(sized([33, 34, 39, 43])), A2: item(good('也')) } }, aspects, 'x')).not.toThrow();
    for (const bad of [[30, 29, 30, 48], [49, 46, 43, 55]]) expect(() => decodeScenarioSets({ [CRIT]: { extension: EXT, A1: item(sized(bad)), A2: item(good('也')) } }, aspects, 'x'), bad.join('/')).toThrow('精熟選項比其他選項長');
    expect(() => decodeScenarioSets({ [CRIT]: { extension: EXT, A1: item(sized([29, 38, 55, 40])), A2: item(good('也')) } }, aspects, 'x')).toThrow('差距太大');
    expect(() => decodeScenarioSets({ [CRIT]: { extension: EXT, A1: item(sized([58, 58, 58, 61])), A2: item(good('也')) } }, aspects, 'x')).toThrow('上限 60 字');
  });
  it('程式從兩種寫法中挑出精熟不領先、長度最接近的組合（R43 後測實跑：精熟約 60 字、證據有限約 30 字）', () => {
    const picked = pickBalanced([[pad('甲', 30), pad('甲', 36)], [pad('乙', 28), pad('乙', 35)], [pad('丙', 32), pad('丙', 40)], [pad('丁', 60), pad('丁', 38)]]);
    expect(picked.map(t => t.length)).toEqual([36, 35, 40, 38]);
    const options = { limited: [pad('甲', 30), pad('甲', 36)], emerging: [pad('乙', 28), pad('乙', 35)], developing: [pad('丙', 32), pad('丙', 40)], proficient: [pad('丁', 60), pad('丁', 38)] };
    const sets = decodeScenarioSets({ [CRIT]: { extension: EXT, A1: item(options), A2: item(good('也')) } }, aspects, 'x');
    expect(sets[0].items[0].options.map(o => o.text.length).sort()).toEqual([35, 36, 38, 40]);
  });
  it('兩種寫法都太長時仍退件，訊息請 AI 縮短精熟', () => {
    const options = { limited: [pad('甲', 28), pad('甲', 30)], emerging: [pad('乙', 28), pad('乙', 30)], developing: [pad('丙', 30), pad('丙', 32)], proficient: [pad('丁', 45), pad('丁', 50)] };
    expect(() => decodeScenarioSets({ [CRIT]: { extension: EXT, A1: item(options), A2: item(good('也')) } }, aspects, 'x')).toThrow('請把精熟兩種寫法都縮短');
  });
  it('兩種寫法中有一種帶自貶語氣時，程式改挑另一種', () => {
    const picked = pickBalanced([[pad('我不太確定怎麼做', 30), pad('甲', 31)], [pad('乙', 30)], [pad('丙', 31)], [pad('丁', 30)]]);
    expect(picked[0].startsWith('甲')).toBe(true);
  });
  it('R44 實跑漏網：「不太能確定」「無法判斷」也算自貶語氣', () => {
    for (const phrase of ['我會先試著不同媒介各做一小部分，但不太能確定哪個方式最適合', '我想圖畫和條列都可以試試，但我無法判斷哪一種更適合']) {
      expect(() => decodeScenarioSets({ [CRIT]: { extension: EXT, A1: item({ ...good(''), emerging: phrase }), A2: item(good('也')) } }, aspects, 'x'), phrase).toThrow('自貶語氣');
    }
  });
  it('新請求要求每階剛好兩種寫法', () => {
    expect(JSON.stringify(buildScenarioPlan('p', aspects, 'post', {}, 's').payload.outputSchema)).toContain('"minItems":2,"maxItems":2');
  });
});

describe('R43 前測避開本單元專有名詞', () => {
  const aspects = decodeAspects(aspectsRaw(CRIT, 2), [CRIT], { [CRIT]: 2 });
  it('前測請求附 avoidTerms（取自課程名稱與學習內容）；後測不附', () => {
    const pre = buildScenarioPlan('p', aspects, 'pre', { title: '校園生物多樣性', contentTexts: ['生物多樣性包含遺傳多樣性、物種多樣性及生態系多樣性三個面向。'] }, 's');
    expect(pre.payload.avoidTerms).toEqual(expect.arrayContaining(['校園生物多樣性', '遺傳多樣性', '物種多樣性']));
    expect(JSON.stringify(pre.payload.course)).not.toContain('contentTexts');
    expect(pre.instructions).toMatch(/avoidTerms/);
    expect(buildScenarioPlan('p', aspects, 'post', { title: '校園生物多樣性' }, 's').payload.avoidTerms).toBeUndefined();
  });
  it('選項用了專有名詞即退件；情境本身已出現的詞不算', () => {
    const jargon = { ...good(''), developing: '我會比較兩邊的物種多樣性，再決定先看哪一組' };
    expect(() => decodeScenarioSets({ [CRIT]: { extension: EXT, A1: item(jargon), A2: item(good('也')) } }, aspects, 'x', ['物種多樣性'])).toThrow('本單元專有名詞「物種多樣性」');
    expect(() => decodeScenarioSets({ [CRIT]: { extension: EXT, A1: item(good('')), A2: item(good('也')) } }, aspects, 'x', ['物種多樣性'])).not.toThrow();
  });
});
