import { afterEach, describe, expect, it, vi } from 'vitest';
import { estimateProgress, failureKind, formatElapsed, plainProblem, repairMessage } from './uxText';
import { consentReason, FLOW_STEPS, isFlowPlan, rememberConsent, revokeAllConsent } from '../services/consentMemory';
import { summarizePayload } from './requestSummary';
import { runRequest } from '../services/openai';
import type { RequestPlan } from '../services/generation';

const plan = (task: string, extra: Partial<RequestPlan> = {}): RequestPlan => ({ kind: 'field', projectId: 'p', sourceSignature: 's', attempt: 0, instructions: '', payload: { task }, ...extra });
const signal = () => new AbortController().signal;
afterEach(() => { revokeAllConsent(); vi.unstubAllGlobals(); });

describe('R12-r11 白話錯誤訊息', () => {
  it('技術原因換成老師看得懂的句子，不出現 JSON 位置', () => {
    expect(plainProblem('回傳內容不是合法 JSON（Expected \',\' at position 973）')).toContain('中途斷掉');
    expect(plainProblem('題目用途：能力比較與學科應用不可混用')).toBe('AI 把能力題寫成了應用題的格式。');
    expect(plainProblem('設計階段回應欄位不符。')).toBe('AI 回傳的欄位和要求的不一樣。');
    expect(plainProblem('後測課綱題缺少 pe-Ⅴa-1：能…')).toContain('pe-Ⅴa-1');
    expect(repairMessage('position 562')).not.toMatch(/position|JSON/);
    expect(repairMessage('x')).toContain('請 AI 修正一次');
  });
  it('同意視窗的修復說明也用白話', () => {
    const lines = summarizePayload({ task: 'outline-goals', repair: { problem: '回傳內容不是合法 JSON（position 9）' } });
    expect(lines.join('')).not.toContain('position');
  });
  it('依錯誤文字判斷下一步按鈕', () => {
    expect(failureKind('Gemini 帳戶的額度或付費設定不足，請到 Google AI Studio')).toBe('billing');
    expect(failureKind('OpenAI 金鑰無法使用：可能貼錯')).toBe('key');
    expect(failureKind('Gemini 頻率限制或額度用完')).toBe('rate');
    expect(failureKind('AI 連線失敗')).toBe('other');
  });
  it('HTTP 402 說明額度或付費設定，不顯示供應商原文', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret-body', { status: 402 })));
    await expect(runRequest(plan('outline-goals'), { provider: 'openai', key: 'k-test', model: 'gpt-5.6-terra' }, true, signal(), () => {})).rejects.toThrow('額度或付費設定不足');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret-body', { status: 402 })));
    await expect(runRequest(plan('outline-goals'), { provider: 'gemini', key: 'k-test', model: 'gemini-3.8-flash' }, true, signal(), () => {})).rejects.toThrow('Google AI Studio');
  });
});

describe('R12-r11 複審後補強', () => {
  it('其他 HTTP 錯誤不顯示代碼或供應商原文', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('raw-provider-text', { status: 503 })));
    const error = await runRequest(plan('outline-goals'), { provider: 'openai', key: 'k-test-long', model: 'gpt-5.6-terra' }, true, signal(), () => {}).catch(e => e) as Error;
    expect(error.message).not.toMatch(/HTTP|503|raw-provider-text/);
  });
  it('回應用跳脫字元藏住金鑰也會拒絕，不進入修復', async () => {
    const key = 'sk-escape-check-000000';
    const escaped = JSON.stringify({ goals: [key] }).replace('sk-', '\\u0073k-');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: escaped }] }] }), { status: 200 })));
    await expect(runRequest(plan('outline-goals'), { provider: 'openai', key, model: 'gpt-5.6-terra' }, true, signal(), () => {})).rejects.toThrow('授權秘密');
  });
  it('格式修復只附前次回應的前段，修復請求不會超過送出上限', async () => {
    const huge = '甲'.repeat(400000);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: huge }] }] }), { status: 200 })));
    const error = await runRequest(plan('outline-goals'), { provider: 'openai', key: 'k-test-long', model: 'gpt-5.6-terra' }, true, signal(), () => {}).catch(e => e);
    const repair = (error as { plan: RequestPlan }).plan;
    expect(new TextEncoder().encode(JSON.stringify(repair.payload)).length).toBeLessThan(512 * 1024);
  });
  it('格式壞掉的回應裡藏著跳脫的金鑰：拒絕，不帶進修復請求', async () => {
    const key = 'sk-escape-check-111111';
    const broken = '{"goals": ["\\u0073k-escape-check-111111"';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: broken }] }] }), { status: 200 })));
    await expect(runRequest(plan('outline-goals'), { provider: 'openai', key, model: 'gpt-5.6-terra' }, true, signal(), () => {})).rejects.toThrow('授權秘密');
  });
  it('原資料已接近上限時不提供修復，直接說明', async () => {
    const big = plan('outline-goals', { payload: { task: 'outline-goals', padding: '乙'.repeat(168000) } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"broken"' }] }] }), { status: 200 })));
    const error = await runRequest(big, { provider: 'openai', key: 'k-test-long', model: 'gpt-5.6-terra' }, true, signal(), () => {}).catch(e => e) as { reason?: string };
    expect(error.reason).toContain('資料量太大');
    expect(plainProblem(error.reason ?? '')).toContain('內容太長');
  });
  it('附上教案摘要或舊前測：同一份內容同意一次，內容變更才再問', () => {
    rememberConsent(plan('outline-goals', { consentScope: 'lesson:aaa' }), '學習目標', 'openai', 'gpt-5.6-terra');
    expect(consentReason(plan('outline-goals', { consentScope: 'lesson:aaa' }), 'openai', 'gpt-5.6-terra')).toBeNull();
    expect(consentReason(plan('outline-goals', { consentScope: 'lesson:bbb' }), 'openai', 'gpt-5.6-terra')).toBeTruthy();
    expect(consentReason(plan('outline-goals'), 'openai', 'gpt-5.6-terra')).toBeTruthy();
  });
});

describe('R12-r11 預估進度', () => {
  it('到常見上限前依時間前進，之後停在 90% 並標示比平常久', () => {
    expect(estimateProgress(0, 180)).toEqual({ percent: 0, overdue: false });
    expect(estimateProgress(90, 180)).toEqual({ percent: 45, overdue: false });
    expect(estimateProgress(200, 180)).toEqual({ percent: 90, overdue: true });
    expect(formatElapsed(84)).toBe('1 分 24 秒');
    expect(formatElapsed(7)).toBe('7 秒');
  });
});

describe('R12-r11 整個流程同意一次', () => {
  it('同意第一步後，六個步驟同供應商同模型都不再詢問', () => {
    const first = plan(FLOW_STEPS[0].task);
    expect(isFlowPlan(first)).toBe(true);
    expect(consentReason(first, 'openai', 'gpt-5.6-terra')).toContain('六個步驟');
    rememberConsent(first, '課綱與子指標推薦', 'openai', 'gpt-5.6-terra');
    for (const step of FLOW_STEPS) expect(consentReason(plan(step.task), 'openai', 'gpt-5.6-terra')).toBeNull();
  });
  it('換模型、格式修復、附上教案或舊前測、擷取教案仍會詢問', () => {
    rememberConsent(plan('outline-goals'), '學習目標', 'openai', 'gpt-5.6-terra');
    expect(consentReason(plan('outline-goals'), 'openai', 'gpt-6-luna')).toBeTruthy();
    expect(consentReason(plan('outline-goals'), 'gemini', 'gemini-3.8-flash')).toBeTruthy();
    expect(consentReason(plan('outline-goals', { attempt: 1 }), 'openai', 'gpt-5.6-terra')).toContain('格式修復');
    expect(consentReason(plan('outline-goals', { consentScope: 'lesson:abc' }), 'openai', 'gpt-5.6-terra')).toBeTruthy();
    expect(consentReason(plan('extract-lesson-start', { alwaysConsent: '教案原文擷取每次都要預覽並同意。' }), 'openai', 'gpt-5.6-terra')).toContain('每次');
  });
  it('主流程以外的請求照原本規則逐種同意；全部撤回後重新詢問', () => {
    rememberConsent(plan('outline-goals'), '學習目標', 'openai', 'gpt-5.6-terra');
    expect(consentReason(plan('regenerate-one-item'), 'openai', 'gpt-5.6-terra')).toBeTruthy();
    revokeAllConsent();
    expect(consentReason(plan('outline-goals'), 'openai', 'gpt-5.6-terra')).toBeTruthy();
  });
});
