import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearFailures, diagnosticsText, FAILURE_LOG_MAX, previewFailureOutput, readFailures, recordFailure } from './aiFailureLog';
import { RepairNeeded, runRequest } from './openai';
import type { RequestPlan } from './generation';

const memory = new Map<string, string>();
const settings = { key: 'sk-test-failure-log-000000', model: 'gpt-4.1' };
const alpha = 'course-alpha';
const beta = 'course-beta';
const legacyKey = 'npdl-studio-next:ai-failures:v1';
const prefix = '/R13-r12/';
const plan = (projectId: string, kind: RequestPlan['kind'] = 'design'): RequestPlan => ({
  kind, projectId, sourceSignature: 's', attempt: 0,
  payload: { task: 'untrusted diagnostic task', teacherText: '送出的資料不應被記錄' },
  instructions: '只回傳 JSON。',
});
const api = (body: object) => new Response(JSON.stringify(body));
const envelope = (output: string) => ({
  status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text: output }] }],
});
async function rejectDesign(courseId: string, marker: string, kind?: RequestPlan['kind']) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(api(envelope(JSON.stringify({ teacherText: marker })))));
  await expect(runRequest(plan(courseId, kind), settings, true, new AbortController().signal, () => {
    throw new Error('供應商或檢查器可能回顯資料：' + marker);
  })).rejects.toBeInstanceOf(RepairNeeded);
}

beforeEach(() => {
  memory.clear();
  vi.stubGlobal('location', { pathname: prefix });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => { memory.set(k, v); },
    removeItem: (k: string) => { memory.delete(k); },
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('AI 回應失敗診斷', () => {
  it('只複製當前課程的安全摘要；儲存空間不寫入新回應原文或錯誤原因，亦不讀取舊原文', async () => {
    await rejectDesign(alpha, 'ALPHA-TEACHER-ECHO');
    await rejectDesign(beta, 'BETA-TEACHER-ECHO', 'field');
    memory.set(legacyKey, '[{"output":"HISTORICAL-TEACHER-ECHO"}]');
    const text = diagnosticsText(beta);
    expect(text).not.toMatch(/ALPHA|BETA|HISTORICAL|untrusted diagnostic task|回顯資料|course-beta|送出的資料不應被記錄/);
    expect(JSON.parse(text).failures).toEqual([{
      at: expect.any(String), task: 'field', batch: null, attempt: 0,
      provider: 'openai', kind: 'validation', outputChars: expect.any(Number),
    }]);
    for (const [key, value] of memory) {
      if (key !== legacyKey) expect(value).not.toMatch(/ALPHA|BETA|回顯資料/);
    }
  });

  it('預覽版本互相隔離；清除當前課程不清除其他課程或 R11 原有紀錄', async () => {
    memory.set(legacyKey, '[{"output":"KEEP-OLD"}]');
    await rejectDesign(alpha, 'A');
    await rejectDesign(beta, 'B');
    vi.stubGlobal('location', { pathname: '/R13-r11/' });
    expect(readFailures(alpha)).toHaveLength(0);
    vi.stubGlobal('location', { pathname: prefix });
    clearFailures(alpha);
    expect(readFailures(alpha)).toHaveLength(0);
    expect(readFailures(beta)).toHaveLength(1);
    expect(memory.get(legacyKey)).toBe('[{"output":"KEEP-OLD"}]');
  });

  it('單筆原文僅限同版本、同課程的當前分頁；未完成回應的跳脫金鑰與其他常見金鑰會遮蔽', async () => {
    const otherKey = 'AIza00000000000000000000000000000000000';
    const partial = '教師回顯 \\u0073' + settings.key.slice(1) + ' ' + otherKey;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(api({
      ...envelope(partial), status: 'incomplete', incomplete_details: { reason: 'PROVIDER-PRIVATE-TEXT' },
    })));
    await expect(runRequest(plan(alpha), settings, true, new AbortController().signal, () => {})).rejects.toThrow('尚未完整完成');
    const [row] = readFailures(alpha);
    expect(row).toMatchObject({ kind: 'incomplete', outputChars: partial.length });
    const text = diagnosticsText(alpha);
    expect(text).not.toMatch(/教師回顯|PROVIDER-PRIVATE-TEXT|AIza|sk-test|0073/);
    expect(previewFailureOutput(beta, row.id)).toBeNull();
    vi.stubGlobal('location', { pathname: '/R13-r11/' });
    expect(previewFailureOutput(alpha, row.id)).toBeNull();
    vi.stubGlobal('location', { pathname: prefix });
    expect(previewFailureOutput(alpha, row.id)).toEqual({ text: '教師回顯 ［已遮蔽］ ［已遮蔽］', truncated: false });
    clearFailures(alpha);
    expect(previewFailureOutput(alpha, row.id)).toBeNull();
  });

  it('損壞 JSON 與缺少課程範圍的欄位請求，分別記錄固定分類與略過紀錄', async () => {
    const incompleteJson = '{"invalid":"fragment';
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(api(envelope(incompleteJson)))));
    await expect(runRequest(plan(alpha), settings, true, new AbortController().signal, () => {})).rejects.toBeInstanceOf(RepairNeeded);
    await expect(runRequest(plan('', 'field'), settings, true, new AbortController().signal, () => {})).rejects.toBeInstanceOf(RepairNeeded);
    expect(readFailures(alpha)).toEqual([expect.objectContaining({ kind: 'invalid-json', outputChars: incompleteJson.length })]);
    expect(readFailures('')).toHaveLength(0);
    expect(memory.size).toBe(1);
  });

  it('每課程只保留最近 5 筆安全摘要，修改儲存資料也不會引入自由文字', () => {
    for (let i = 0; i < FAILURE_LOG_MAX + 2; i++) recordFailure({
      courseId: alpha, task: 'pre', provider: 'gemini', batch: i, attempt: 1, kind: 'validation', output: String(i), key: settings.key,
    });
    const rows = readFailures(alpha);
    expect(rows.map(row => row.batch)).toEqual([6, 5, 4, 3, 2]);
    const [scope] = memory.keys();
    memory.set(scope, JSON.stringify([{ ...rows[0], output: 'PRIVATE-TEXT', model: 'PRIVATE-TEXT', problem: 'PRIVATE-TEXT' }, { ...rows[1], task: 'PRIVATE-TEXT' }]));
    const exported = diagnosticsText(alpha);
    expect(exported).not.toContain('PRIVATE-TEXT');
    expect(JSON.parse(exported).failures).toHaveLength(1);
  });

  it('儲存受限時仍可在本分頁複製安全摘要與清除', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    });
    await rejectDesign('blocked-course', 'BLOCKED-ECHO');
    expect(readFailures('blocked-course')).toHaveLength(1);
    expect(diagnosticsText('blocked-course')).not.toContain('BLOCKED-ECHO');
    clearFailures('blocked-course');
    expect(readFailures('blocked-course')).toHaveLength(0);
  });
});
