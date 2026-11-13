import { validateSingleDraft, type SingleDraft } from './singlePath';

export const MAX_SINGLE_DRAFT_BYTES = 512000;

// 匯入原文在教師確認去識別前只留在分頁。此邊界同時供本機保存與備份使用。
export function durableDraft(value: unknown): SingleDraft {
  const draft = validateSingleDraft(value);
  return draft.source && !draft.source.deidentified ? { ...draft, source: null } : draft;
}

export function serializeDurableDraft(value: unknown): string {
  const raw = JSON.stringify(durableDraft(value));
  if (new TextEncoder().encode(raw).length > MAX_SINGLE_DRAFT_BYTES) throw new Error('發想草稿超過 512KB，請先縮短長文字。');
  return raw;
}

export function parseRecoveryDraft(raw: string): SingleDraft {
  if (new TextEncoder().encode(raw).length > MAX_SINGLE_DRAFT_BYTES) throw new Error('草稿檔超過 512KB。');
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new Error('草稿不是完整的 JSON。'); }
  // 明確匯入的是一份副本；不沿用先前的 AI 同意或課程識別。
  return { ...durableDraft(value), id: crypto.randomUUID() };
}
