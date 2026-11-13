import { describe, expect, it } from 'vitest';
import { curriculum, indicators } from '../components/labels';
import { buildExtractPlan, buildSinglePlan, emptySingleDraft, singleToIntake, validateExtractResult, validateSingleDraft, type SingleDraft } from './singlePath';
import { intakeToInput } from './intake';
import { consentReason, rememberConsent, revokeAllConsent } from '../services/consentMemory';
import { lessonTextFromFile, lessonTextFromPaste, LESSON_TEXT_MAX_CHARS } from '../services/lessonFile';

const performance = curriculum.find(row => row.subject === '化學' && row.kind === 'learning_performance') ?? curriculum.find(row => row.subject === '自然科學' && row.kind === 'learning_performance')!;
const indicator = indicators.entries[0];
const lesson = '單元：反應速率。第一節觀察碘鐘反應，第二節小組設計變因實驗，第三節以海報說明證據。評量：實驗紀錄單與口頭報告。';
function selected(source: SingleDraft['source'] = null): SingleDraft {
  return { ...emptySingleDraft(), grade: '高二', subject: performance.subject, topic: '如何判斷反應快慢？', title: '反應速率', keywords: '反應速率、變因、證據', periods: '3', curriculumIds: [performance.id], indicatorIds: [indicator.id], source };
}
const confirmed = { text: lesson, deidentified: true, summary: '- 目標：辨認影響反應速率的變因\n- 活動：碘鐘反應、變因實驗、海報', summaryConfirmed: true };
const extraction = { grade: '高二', subject: performance.subject, title: '反應速率', topic: '如何判斷反應快慢？', keywords: ['反應速率', '變因', '證據'], periods: 3, summary: '- 目標：辨認變因', gaps: ['學生起點'] };

describe('R11 草稿相容與教案欄位', () => {
  it('R10 以前沒有 source 的草稿仍可載入，補為 null', () => {
    const { source: _source, ...old } = emptySingleDraft(); void _source;
    expect(validateSingleDraft(old).source).toBeNull();
  });
  it('未去識別或摘要空白時，不能標為已確認摘要', () => {
    expect(() => validateSingleDraft({ ...emptySingleDraft(), source: { ...confirmed, deidentified: false } })).toThrow('匯入教案');
    expect(() => validateSingleDraft({ ...emptySingleDraft(), source: { ...confirmed, summary: ' ' } })).toThrow('匯入教案');
    expect(() => validateSingleDraft({ ...emptySingleDraft(), source: { ...confirmed, extra: 1 } })).toThrow('匯入教案');
  });
  it('去識別後的教案文字存成專案原文；沒有匯入時維持教師構想', () => {
    expect(intakeToInput(singleToIntake(selected(confirmed))).originalSource.text).toBe(lesson);
    expect(intakeToInput(singleToIntake(selected({ ...confirmed, deidentified: false, summaryConfirmed: false }))).originalSource.text).toContain('教師課程構想');
  });
});

describe('R11 教案擷取', () => {
  it('未勾選去識別不能送出；擷取請求每次都要同意', () => {
    expect(() => buildExtractPlan(selected({ ...confirmed, deidentified: false, summaryConfirmed: false }))).toThrow('去識別');
    const plan = buildExtractPlan(selected(confirmed));
    expect(plan.payload.sourceText).toBe(lesson);
    expect(plan.alwaysConsent).toBeTruthy();
    rememberConsent(plan, '教案擷取', 'openai', 'gpt-4.1');
    expect(consentReason(plan, 'openai', 'gpt-4.1')).toBeTruthy();
    const { alwaysConsent: _flag, ...unflagged } = plan; void _flag;
    rememberConsent(unflagged, '教案擷取', 'openai', 'gpt-4.1');
    expect(consentReason(unflagged, 'openai', 'gpt-4.1')).toContain('每次');
  });
  it('擷取結果限定年級、固定學科與欄位', () => {
    expect(validateExtractResult(extraction).keywords).toHaveLength(3);
    expect(() => validateExtractResult({ ...extraction, grade: '國三' })).toThrow('年級');
    expect(() => validateExtractResult({ ...extraction, subject: '魔法' })).toThrow('學科');
    expect(() => validateExtractResult({ ...extraction, teacher: '王老師' })).toThrow('欄位');
    expect(() => validateExtractResult({ ...extraction, keywords: ['a', 'b', 'c', 'd', 'e', 'f'] })).toThrow('關鍵字');
  });
});

describe('R11 重點摘要附在後續請求', () => {
  it('確認後的摘要附在目標與完整教案請求，原文全文不送', () => {
    const goals = buildSinglePlan(selected(confirmed), 'goals');
    expect(goals.payload.lessonSummary).toBe(confirmed.summary);
    expect(goals.consentScope).toMatch(/^lesson:/);
    expect(JSON.stringify(goals.payload)).not.toContain('碘鐘反應，第二節');
    const draft = selected(confirmed);
    draft.goals = [{ kind: 'academic', indicatorId: '', text: '辨認變因', success: '說出兩個變因' }, { kind: 'npdl', indicatorId: indicator.id, text: '提出證據', success: '引用紀錄' }];
    draft.criteria = [{ indicatorId: indicator.id, label: '證據', observable: '引用', scope: '題組', unobserved: '實作', stages: ['a', 'b', 'c', 'd'] }];
    draft.activities = [{ name: '變因實驗', periods: 3, task: '設計實驗', evidence: '紀錄單' }];
    const full = buildSinglePlan(draft, 'full');
    expect(full.payload.lessonSummary).toBe(confirmed.summary);
    expect(full.payload).not.toHaveProperty('sourceExcerpt');
  });
  it('未確認摘要時不附，也不帶 consentScope', () => {
    const plan = buildSinglePlan(selected({ ...confirmed, summaryConfirmed: false }), 'goals');
    expect(plan.payload).not.toHaveProperty('lessonSummary');
    expect(plan.consentScope).toBeUndefined();
  });
});

describe('R11 同意記憶', () => {
  it('同意一次後同類請求沿用；換模型、摘要變更、資料量倍增、格式修復要再問；撤回後重問', () => {
    revokeAllConsent();
    const plan = buildSinglePlan(selected(confirmed), 'goals');
    expect(consentReason(plan, 'openai', 'gpt-4.1')).toBeTruthy();
    rememberConsent(plan, '學習目標', 'openai', 'gpt-4.1');
    expect(consentReason(plan, 'openai', 'gpt-4.1')).toBeNull();
    expect(consentReason(plan, 'openai', 'gpt-4.1-mini')).toBeTruthy();
    expect(consentReason(buildSinglePlan(selected({ ...confirmed, summary: confirmed.summary + '\n- 評量：海報' }), 'goals'), 'openai', 'gpt-4.1')).toBeTruthy();
    expect(consentReason({ ...plan, payload: { ...plan.payload, padding: 'x'.repeat(JSON.stringify(plan.payload).length * 2) } }, 'openai', 'gpt-4.1')).toContain('多一倍');
    expect(consentReason({ ...plan, attempt: 1 }, 'openai', 'gpt-4.1')).toContain('格式修復');
    revokeAllConsent();
    expect(consentReason(plan, 'openai', 'gpt-4.1')).toBeTruthy();
  });
});

describe('R11 教案檔讀取', () => {
  it('貼上文字會整理空白；太短拒收；超過上限截斷並標示', () => {
    expect(lessonTextFromPaste('  第一行  \r\n\r\n\r\n\r\n\r\n第二行內容足夠長的教案文字片段\n').text).toBe('第一行\n\n\n第二行內容足夠長的教案文字片段');
    expect(() => lessonTextFromPaste('太短')).toThrow('幾乎沒有');
    const long = lessonTextFromPaste('教'.repeat(LESSON_TEXT_MAX_CHARS + 10));
    expect(long.truncated).toBe(true);
    expect(long.text).toHaveLength(LESSON_TEXT_MAX_CHARS);
  });
  it('TXT 以 UTF-8 讀取；舊版 .doc、未知格式、空檔、超過 10MB 拒收', async () => {
    expect((await lessonTextFromFile(new File([lesson], '教案.txt', { type: 'text/plain' }))).format).toBe('txt');
    await expect(lessonTextFromFile(new File([lesson], 'a.doc'))).rejects.toThrow('.doc');
    await expect(lessonTextFromFile(new File([lesson], 'a.pages'))).rejects.toThrow('只接受');
    await expect(lessonTextFromFile(new File([], 'a.txt'))).rejects.toThrow('空白');
    await expect(lessonTextFromFile(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'a.txt'))).rejects.toThrow('10 MB');
    await expect(lessonTextFromFile(new File([new Uint8Array([0xff, 0xfe, 0xfd, 0x80, 0x81])], 'a.txt'))).rejects.toThrow('UTF-8');
  });
});
