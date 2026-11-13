import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteAspectDraftIfUsed, loadAspectDraft, saveAspectDraft } from './aspectDraft';
import { probeStatus } from '../services/openai';

// R40（2026-11-12，Codex 第二輪複審收尾）。
const memory = () => { const map = new Map<string, string>(); return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); }, map }; };
const plans = (label: string) => [{ indicatorId: 'critical-evaluate-information', aspects: [{ id: 'A1', label, description: '從單筆印象到檢查變因。', anchors: ['一', '二', '三', '四'] as [string, string, string, string] }] }];

describe('R40 面向草稿收尾', () => {
  it('讀得到 R37／R38 的 v1 草稿（同 scope）；寫入 v2 後清掉 v1', () => {
    const store = memory();
    store.setItem('ws:aspect-draft:v1', JSON.stringify({ scope: 'S', confirmed: true, plans: plans('舊版') }));
    expect(loadAspectDraft('ws', 'S', store)?.plans[0].aspects[0].label).toBe('舊版');
    expect(loadAspectDraft('ws', 'other', store)).toBeNull();
    saveAspectDraft('ws', 'S', { scope: 'S', confirmed: false, plans: plans('新版') }, store);
    expect(store.map.has('ws:aspect-draft:v1')).toBe(false);
    expect(loadAspectDraft('ws', 'S', store)?.plans[0].aspects[0].label).toBe('新版');
  });
  it('前測採用後只刪實際用來出題的那一版；請求期間被改過的新草稿保留', () => {
    const store = memory();
    saveAspectDraft('ws', 'S', { scope: 'S', confirmed: true, plans: plans('用來出題') }, store);
    expect(deleteAspectDraftIfUsed('ws', 'S', plans('用來出題'), store)).toBe(true);
    expect(loadAspectDraft('ws', 'S', store)).toBeNull();
    saveAspectDraft('ws', 'S', { scope: 'S', confirmed: true, plans: plans('另一分頁改過') }, store);
    expect(deleteAspectDraftIfUsed('ws', 'S', plans('用來出題'), store)).toBe(false);
    expect(loadAspectDraft('ws', 'S', store)?.plans[0].aspects[0].label).toBe('另一分頁改過');
  });
});

describe('R40 舊瀏覽器沒有 AbortSignal.any 時探測仍可用', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('改用只有逾時的訊號，仍回傳狀態碼', async () => {
    const original = AbortSignal.any;
    (AbortSignal as unknown as { any?: unknown }).any = undefined;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    try { expect(await probeStatus('https://api.openai.com/v1/models', new AbortController().signal)).toBe(401); }
    finally { (AbortSignal as unknown as { any?: unknown }).any = original; }
  });
});
