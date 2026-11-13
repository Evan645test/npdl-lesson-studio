import { describe, expect, it } from 'vitest';
import { durableDraft, parseRecoveryDraft, serializeDurableDraft } from './draftPersistence';
import { emptySingleDraft } from './singlePath';

describe('獨立版發想草稿的保存與救回', () => {
  it('原文還在頁面時，不會寫入本機或目前編輯的下載；其他編輯仍可帶走', () => {
    const draft = { ...emptySingleDraft(), title: '第二分頁尚未保存的標題', source: { text: '未去識別的原文標記', deidentified: false, summary: '', summaryConfirmed: false } };
    const json = serializeDurableDraft(draft);
    expect(json).not.toContain('未去識別的原文標記');
    expect(JSON.parse(json)).toMatchObject({ title: draft.title, source: null });
    expect(draft.source.text).toBe('未去識別的原文標記');
  });
  it('確認去識別後可保存；救回匯入是新識別碼且保留內容', () => {
    const draft = { ...emptySingleDraft(), title: '已確認', source: { text: '課堂流程', deidentified: true, summary: '依資料討論', summaryConfirmed: true } };
    const restored = parseRecoveryDraft(serializeDurableDraft(draft));
    expect(restored.id).not.toBe(draft.id);
    expect({ ...restored, id: draft.id }).toEqual(durableDraft(draft));
  });
  it('舊備份若仍有未去識別原文，救回只保留其他欄位', () => {
    const old = { ...emptySingleDraft(), title: '舊草稿', source: { text: '舊原文不應再保存', deidentified: false, summary: '', summaryConfirmed: false } };
    expect(parseRecoveryDraft(JSON.stringify(old))).toMatchObject({ title: '舊草稿', source: null });
    expect(() => parseRecoveryDraft('{"invalid":')).toThrow('JSON');
  });
});
