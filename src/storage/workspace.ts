import { createSeed } from '../data/seed';
import type { Workspace } from '../domain/types';
import { validateWorkspace } from '../domain/validate';

export const MAX_BACKUP_BYTES = 8 * 1024 * 1024;
export interface Store { getItem(key: string): string | null; setItem(key: string, value: string): void }
const utf8 = new TextEncoder();

export function storageKey(pathname: string): string {
  const round = pathname.match(/^\/(R\d{2}(?:-[a-z0-9]+)?)\//)?.[1];
  return 'npdl_next_workspace_v1' + (round ? `:preview:${round}` : '');
}
export function parseBackup(raw: string): Workspace {
  if (utf8.encode(raw).length > MAX_BACKUP_BYTES) throw new Error('備份超過8MB，未載入。');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('備份不是完整JSON，原資料保留。'); }
  return migrateWorkspace(validateWorkspace(parsed));
}
export function loadWorkspace(store: Store, key: string): { workspace: Workspace; raw: string | null; error: string | null } {
  let raw: string | null = null;
  try { raw = store.getItem(key); return { workspace: raw === null ? validateWorkspace(createSeed()) : parseBackup(raw), raw, error: null }; }
  catch (error) { return { workspace: validateWorkspace(createSeed()), raw, error: `工作區未能載入：${String(error)}。原儲存內容未變更。` }; }
}
function serializeCheckedWorkspace(workspace: Workspace, sizeError: string): string {
  const raw = JSON.stringify(workspace);
  if (utf8.encode(raw).length > MAX_BACKUP_BYTES) throw new Error(sizeError);
  return raw;
}

export function serializeWorkspaceBackup(workspace: Workspace): string {
  return serializeCheckedWorkspace(validateWorkspace(workspace), '工作區超過8MB，無法下載成可再次轉入的備份');
}

function writeWorkspace(store: Store, key: string, raw: string, expectedRaw: string | null): void {
  let previous: string | null;
  try { previous = store.getItem(key); }
  catch { throw new Error('瀏覽器儲存目前無法使用'); }
  if (previous !== expectedRaw) throw new Error('其他分頁已變更工作區');
  try { store.setItem(key, raw); }
  catch (error) {
    if (error instanceof Error && error.name === 'QuotaExceededError') throw new Error('瀏覽器儲存空間不足');
    throw new Error('瀏覽器目前無法保存工作區');
  }
}

export function saveWorkspace(store: Store, key: string, workspace: Workspace, expectedRaw: string | null): { raw: string | null; error: string | null; canExportPending: boolean } {
  let raw: string;
  try {
    raw = serializeCheckedWorkspace(validateWorkspace(workspace), '這次修改會使工作區超過8MB，請縮小內容後再試');
  } catch (error) {
    return { raw: expectedRaw, error: `尚未保存：${error instanceof Error ? error.message : String(error)}。原工作區保留。`, canExportPending: false };
  }
  try {
    writeWorkspace(store, key, raw, expectedRaw);
    return { raw, error: null, canExportPending: false };
  } catch (error) {
    return { raw: expectedRaw, error: `尚未保存：${error instanceof Error ? error.message : String(error)}。本頁編輯仍保留，可下載備份。`, canExportPending: true };
  }
}

function prepareImportedWorkspace(current: Workspace, incoming: Workspace): { workspace: Workspace; raw: string } {
  const source = migrateWorkspace(incoming);
  const copies = source.projects.map(p => ({ ...p, id: crypto.randomUUID() }));
  const legacyCopies = (source.legacyImports ?? []).map(item => ({ ...item, id: crypto.randomUUID() }));
  const workspace = validateWorkspace({ ...current, projects: [...current.projects, ...copies], legacyImports: [...(current.legacyImports ?? []), ...legacyCopies], activeProjectId: copies[0].id });
  return { workspace, raw: serializeCheckedWorkspace(workspace, '合併後工作區超過8MB，請改用較小的備份或轉入其他工作區') };
}

export function importCopies(current: Workspace, incoming: Workspace): Workspace {
  return prepareImportedWorkspace(current, incoming).workspace;
}

export function saveImportedWorkspace(store: Store, key: string, current: Workspace, incoming: Workspace, expectedRaw: string | null): { workspace: Workspace; raw: string } {
  const candidate = prepareImportedWorkspace(current, incoming);
  // Adopt the candidate only after the browser has accepted the whole import.
  writeWorkspace(store, key, candidate.raw, expectedRaw);
  return candidate;
}

export function migrateWorkspace(workspace: Workspace): Workspace {
  const next = validateWorkspace(workspace);
  if (next.schemaVersion === 2) return next;
  const extend = (input: import('../domain/types').CourseInput) => ({ ...input, teacherNotes: '', indicatorReview: { signature: '', confirmedAt: null } });
  next.schemaVersion = 2;
  for (const project of next.projects) { project.input = extend(project.input); for (const design of project.designs) design.inputSnapshot = extend(design.inputSnapshot); }
  return validateWorkspace(next);
}
