import { describe, expect, it } from 'vitest';
import { consentReason, rememberConsent } from '../services/consentMemory';
import type { RequestPlan } from '../services/generation';
import { draftFromRaw, loadAspectDraft, saveAspectDraft } from './aspectDraft';
import { TYPICAL_LABEL, TYPICAL_SECONDS } from './uxText';

// R37（2026-11-12）：第三批「好不好用」。
const plan = (task: string, projectId = 'course-r37', attempt: 0 | 1 = 0): RequestPlan => ({ kind: 'field', projectId, sourceSignature: 's', payload: { task }, instructions: 'i', attempt });

describe('R37 情境題同一門課同意一次', () => {
  it('面向同意後，前測、後測不再詢問；換模型、格式修復、其他課程仍詢問', () => {
    expect(consentReason(plan('draft-progression-aspects'), 'openai', 'gpt-4.1')).toMatch(/面向、前測、後測與課中學習單都沿用/);
    rememberConsent(plan('draft-progression-aspects'), '情境題面向整理', 'openai', 'gpt-4.1');
    expect(consentReason(plan('scenario-progression-pre'), 'openai', 'gpt-4.1')).toBeNull();
    expect(consentReason(plan('scenario-progression-post'), 'openai', 'gpt-4.1')).toBeNull();
    expect(consentReason(plan('scenario-progression-pre'), 'openai', 'gpt-5')).not.toBeNull();
    expect(consentReason(plan('scenario-progression-pre', 'course-r37', 1), 'openai', 'gpt-4.1')).toMatch(/格式修復/);
    expect(consentReason(plan('scenario-progression-pre', 'other-course'), 'openai', 'gpt-4.1')).not.toBeNull();
  });
});

describe('R37／R39 尚未產生前測的面向在重新整理後保留，依 scope 分開', () => {
  const memory = () => { const map = new Map<string, string>(); return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); }, map }; };
  const plans = [{ indicatorId: 'critical-evaluate-information', aspects: [{ id: 'A1', label: '比較資料是否公平', description: '從單筆印象到檢查變因。', anchors: ['一', '二', '三', '四'] as [string, string, string, string] }] }];
  const A = { scope: 'course-A', confirmed: true, plans }, B = { scope: 'course-B', confirmed: false, plans };
  it('兩門課各自保存不互相覆蓋；刪除只刪該 scope；內容不合格或讀取失敗當作沒有', () => {
    const store = memory();
    saveAspectDraft('ws', A.scope, A, store); saveAspectDraft('ws', B.scope, B, store);
    expect(loadAspectDraft('ws', 'course-A', store)).toEqual(A);
    expect(loadAspectDraft('ws', 'course-B', store)).toEqual(B);
    saveAspectDraft('ws', 'course-B', null, store);
    expect(loadAspectDraft('ws', 'course-B', store)).toBeNull();
    expect(loadAspectDraft('ws', 'course-A', store)).toEqual(A);
    saveAspectDraft('ws', 'course-A', null, store);
    expect(store.map.size).toBe(0);
    store.setItem('ws:aspect-drafts:v2', JSON.stringify({ 'course-A': { ...A, plans: [{ ...plans[0], aspects: [] }] } }));
    expect(loadAspectDraft('ws', 'course-A', store)).toBeNull();
    store.setItem('ws:aspect-drafts:v2', '{壞掉');
    expect(loadAspectDraft('ws', 'course-A', store)).toBeNull();
    expect(loadAspectDraft('ws', 'course-A', { getItem: () => { throw new Error('blocked'); } })).toBeNull();
  });
  it('另一分頁寫入的值可依 scope 取出；超過 20 個 scope 時刪最舊', () => {
    expect(draftFromRaw(JSON.stringify({ 'course-A': A }), 'course-A')).toEqual(A);
    expect(draftFromRaw(JSON.stringify({ 'course-A': A }), 'course-B')).toBeNull();
    const store = memory();
    for (let i = 0; i < 22; i++) saveAspectDraft('ws', `s${i}`, { ...A, scope: `s${i}` }, store);
    expect(loadAspectDraft('ws', 's0', store)).toBeNull();
    expect(loadAspectDraft('ws', 's21', store)?.scope).toBe('s21');
  });
});

describe('R37 情境題等待預估', () => {
  it('面向、前測、後測、逐題藍圖都有預估時間', () => {
    for (const job of ['aspects', 'scenarioPre', 'scenarioPost', 'blueprint']) { expect(TYPICAL_SECONDS[job]).toBeGreaterThan(0); expect(TYPICAL_LABEL[job]).toMatch(/秒/); }
  });
});
