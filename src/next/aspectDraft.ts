import { checkAspects, type AspectPlan } from '../domain/scenarioProgression';

// R37（2026-11-12 實跑）：尚未產生前測的面向（含已確認）原本只在記憶體，重新整理頁面就遺失、要再花一次 AI 請求。
// 存在本瀏覽器的工作區旁；只含面向文字與確認狀態，不含金鑰或學生資料。讀不到或內容不合格時當作沒有。
// R39（Codex 複審）：改為依 scope（專案、設計、測驗方式）分開保存，切換課程不互相覆蓋；只在該 scope 的前測採用後才刪除。
export interface AspectDraft { scope: string; plans: AspectPlan[]; confirmed: boolean }
export const ASPECT_DRAFT_SUFFIX = ':aspect-drafts:v2';
// R40（Codex 第二輪）：R37／R38 的單份草稿 key，讀不到 v2 時沿用；同 scope 寫入 v2 後刪除。
export const LEGACY_ASPECT_DRAFT_SUFFIX = ':aspect-draft:v1';
const MAX_SCOPES = 20;

function valid(value: unknown, scope: string): AspectDraft | null {
  const row = value as AspectDraft | undefined;
  if (!row || row.scope !== scope || typeof row.confirmed !== 'boolean' || !Array.isArray(row.plans)) return null;
  try { checkAspects(row.plans, row.plans.map(plan => plan.indicatorId)); } catch { return null; }
  return { scope: row.scope, plans: row.plans, confirmed: row.confirmed };
}
function readAll(workspaceKey: string, storage: Pick<Storage, 'getItem'> | undefined): Record<string, unknown> {
  try {
    const raw = storage?.getItem(workspaceKey + ASPECT_DRAFT_SUFFIX);
    const value = raw ? JSON.parse(raw) as unknown : null;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

export function loadAspectDraft(workspaceKey: string, scope: string, storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): AspectDraft | null {
  const current = valid(readAll(workspaceKey, storage)[scope], scope);
  if (current || !workspaceKey) return current;
  try { const raw = storage?.getItem(workspaceKey + LEGACY_ASPECT_DRAFT_SUFFIX); return raw ? valid(JSON.parse(raw), scope) : null; } catch { return null; }
}
// 從 storage 事件的新值取出同一 scope 的草稿（另一個分頁寫入時）。
export function draftFromRaw(raw: string | null, scope: string): AspectDraft | null {
  return loadAspectDraft('', scope, { getItem: () => raw });
}

// draft 為 null 時刪除該 scope；最多保留最近 20 個 scope。
export function saveAspectDraft(workspaceKey: string, scope: string, draft: AspectDraft | null, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined = globalThis.localStorage): void {
  try {
    const all = readAll(workspaceKey, storage);
    delete all[scope];
    if (draft) all[scope] = { scope, plans: draft.plans, confirmed: draft.confirmed };
    const keys = Object.keys(all);
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_SCOPES))) delete all[key];
    if (Object.keys(all).length) storage?.setItem(workspaceKey + ASPECT_DRAFT_SUFFIX, JSON.stringify(all));
    else storage?.removeItem(workspaceKey + ASPECT_DRAFT_SUFFIX);
    const legacy = storage?.getItem(workspaceKey + LEGACY_ASPECT_DRAFT_SUFFIX);
    if (legacy && (JSON.parse(legacy) as { scope?: unknown })?.scope === scope) storage?.removeItem(workspaceKey + LEGACY_ASPECT_DRAFT_SUFFIX);
  } catch { /* 無法保存時維持記憶體狀態 */ }
}

// R40（Codex 第二輪）：前測採用後，只刪除「實際用來出題的那一版」；請求期間被另一分頁改過的新草稿保留。
export function samePlans(a: AspectPlan[], b: AspectPlan[]): boolean { return JSON.stringify(a) === JSON.stringify(b); }
export function deleteAspectDraftIfUsed(workspaceKey: string, scope: string, used: AspectPlan[], storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined = globalThis.localStorage): boolean {
  const stored = loadAspectDraft(workspaceKey, scope, storage);
  if (stored && !samePlans(stored.plans, used)) return false;
  saveAspectDraft(workspaceKey, scope, null, storage);
  return true;
}
