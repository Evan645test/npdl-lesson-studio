import { describe, expect, it } from 'vitest';
import { suggestedMode } from '../data/assessability';
import { reviewAssessment } from './lifecycle';
import { validateWorkspace } from './validate';
import { setClassroomKits, addScenarioAssessment, aspectsMatch, reusableAspects } from './scenarioAssessment';
import { scenarioFixture, scenarioReady } from './scenarioAssessment.test-helper';
import { kitFixture } from './scenarioAssessment.test-helper';
import { createKeyVault, createVaultQueue, type VaultStore } from '../services/keyVault';
import type { ModeChoice } from './thresholdSet';

const modesOf = (ids: string[], e: string[] = []): ModeChoice[] => ids.map(indicatorId => ({ indicatorId, suggestedMode: suggestedMode(indicatorId), mode: e.includes(indicatorId) ? 'E' : 'B' }));

describe('R34 Codex 複審修正', () => {
  it('第 1 項：全部方式 E 時，前後測不需面向與情境題即可保存並確認', () => {
    const w = scenarioReady(), p = w.projects[0], ids = p.input.indicatorIds, modes = modesOf(ids, ids);
    const pre = addScenarioAssessment(w, p.id, 'pre', { aspects: [], scenarioSets: [] }, modes);
    const preId = pre.projects[0].activePreId!;
    // R41：有課中觀察子指標時須先有學習單與勾選表才能確認前測。
    expect(() => reviewAssessment(pre, p.id, preId)).toThrow('學習單');
    const design = pre.projects[0].designs.find(d => d.id === pre.projects[0].activeDesignId)!;
    const kitted = setClassroomKits(pre, p.id, ids.map(id => kitFixture(design, id)));
    const post = addScenarioAssessment(reviewAssessment(kitted, p.id, preId), p.id, 'post', { aspects: [], scenarioSets: [] }, modes);
    const saved = post.projects[0].assessments.find(a => a.id === post.projects[0].activePostId)!;
    expect(saved.sets!.every(s => s.mode === 'E')).toBe(true);
    expect(() => validateWorkspace(post)).not.toThrow();
  });
  it('第 2 項：備份中的情境題含階段名稱、重複或最高階過長選項時，載入即拒絕', () => {
    const w = scenarioReady(), p = w.projects[0], ids = p.input.indicatorIds;
    const saved = addScenarioAssessment(w, p.id, 'pre', scenarioFixture(w, 'pre', ids), modesOf(ids));
    const item = () => { const c = structuredClone(saved); return { c, item: c.projects[0].assessments.find(a => a.id === c.projects[0].activePreId)!.scenarioSets![0].items[0] }; };
    let t = item(); t.item.options[0].text = '我是精熟的人，會先想清楚'; expect(() => validateWorkspace(t.c)).toThrow('階段名稱');
    t = item(); t.item.options[1].text = t.item.options[0].text; expect(() => validateWorkspace(t.c)).toThrow('重複選項');
    t = item(); t.item.options.find(o => o.stage === 3)!.text = '我會先分析對方的背景與需求，再比較各種方式的優缺點，選出最能讓對方理解並產生連結的一種，最後依回饋修改'; expect(() => validateWorkspace(t.c)).toThrow('明顯較長');
  });
  it('第 3 項：取消記住排在進行中的保存之後，最後不殘留密文', async () => {
    const rows = new Map<string, unknown>();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const store: VaultStore = { get: async id => rows.get(id), put: async (id, v) => { if (id === 'openai') await gate; rows.set(id, v); }, delete: async id => { rows.delete(id); } };
    const queue = createVaultQueue(createKeyVault(store));
    const saving = queue.remember('openai', 'sk-test-race');
    const dropping = queue.forget('openai');
    release();
    await Promise.all([saving, dropping]);
    expect(rows.has('openai')).toBe(false);
    expect(rows.has('aes-gcm-key')).toBe(false);
  });
  it('第 4 項：改了情境題／方式 E 配置後，前測面向不再沿用', () => {
    const w = scenarioReady(), p = w.projects[0], ids = p.input.indicatorIds;
    const first = addScenarioAssessment(w, p.id, 'pre', scenarioFixture(w, 'pre', ids), modesOf(ids));
    const pre = first.projects[0].assessments.find(a => a.id === first.projects[0].activePreId);
    expect(reusableAspects(pre, modesOf(ids))?.length).toBe(ids.length);
    expect(reusableAspects(pre, modesOf(ids, [ids[0]]))).toBeNull();
    expect(aspectsMatch(pre!.aspects!, modesOf(ids, [ids[0]]))).toBe(false);
    expect(aspectsMatch(pre!.aspects!, modesOf(ids))).toBe(true);
  });
  it('第 5 項：方式 E 觀察表的規準或活動被改成別的內容時拒絕', () => {
    const w = scenarioReady(), p = w.projects[0], ids = p.input.indicatorIds, modes = modesOf(ids, ids);
    const saved = addScenarioAssessment(w, p.id, 'pre', { aspects: [], scenarioSets: [] }, modes);
    const broken = structuredClone(saved);
    const set = broken.projects[0].assessments.find(a => a.id === broken.projects[0].activePreId)!.sets![0];
    set.observation!.focus = '被改過的觀察焦點';
    expect(() => validateWorkspace(broken)).toThrow('觀察表須由該子指標的規準');
  });
});
