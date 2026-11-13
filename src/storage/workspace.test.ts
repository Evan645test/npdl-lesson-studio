import { describe, expect, it, vi } from 'vitest';
import { createSeed } from '../data/seed';
import { importCopies, MAX_BACKUP_BYTES, parseBackup, saveImportedWorkspace, saveWorkspace, serializeWorkspaceBackup, type Store } from './workspace';

const key = 'workspace';
const bytes = (raw: string) => new TextEncoder().encode(raw).length;

function largeBackup(historyCount = 24) {
  const workspace = createSeed();
  const project = workspace.projects[0];
  project.assessments = [];
  project.activePreId = project.activePostId = null;
  const design = project.designs[0];
  const text = '測'.repeat(60_000);
  project.designs = Array.from({ length: historyCount }, (_, i) => {
    const copy = structuredClone(design);
    copy.id = i === 0 ? design.id : `backup-design-${i}`;
    copy.inputSnapshot.originalSource.text = text;
    return copy;
  });
  return workspace;
}

describe('工作區備份大小與救援', () => {
  it('兩份可讀取的大備份不可合併為無法再次轉入的工作區', () => {
    const raw = JSON.stringify(largeBackup());
    expect(bytes(raw)).toBeLessThan(MAX_BACKUP_BYTES);
    const incoming = parseBackup(raw);
    const seed = createSeed();
    let persisted = serializeWorkspaceBackup(seed);
    const setItem = vi.fn((_key: string, value: string) => { persisted = value; });
    const store: Store = { getItem: () => persisted, setItem };
    const first = saveImportedWorkspace(store, key, seed, incoming, persisted);
    expect(first.workspace.projects).toHaveLength(2);
    expect(first.workspace.projects[0]).toEqual(seed.projects[0]);
    expect(first.workspace.projects[1].id).not.toBe(incoming.activeProjectId);

    expect(() => importCopies(first.workspace, incoming)).toThrow('8MB');
    expect(() => saveImportedWorkspace(store, key, first.workspace, incoming, first.raw)).toThrow('8MB');
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(persisted === first.raw).toBe(true);
    expect(first.workspace.projects).toHaveLength(2);
    expect(parseBackup(serializeWorkspaceBackup(first.workspace)).projects).toHaveLength(2);
  });

  it('超過大小限制的編輯不應被標示為可下載救援', () => {
    const workspace = largeBackup();
    workspace.projects.push({ ...structuredClone(workspace.projects[0]), id: 'oversized-project' });
    const previousRaw = JSON.stringify(createSeed());
    const setItem = vi.fn();
    const store: Store = { getItem: () => previousRaw, setItem };

    const result = saveWorkspace(store, key, workspace, previousRaw);
    expect(result.raw === previousRaw).toBe(true);
    expect(result.error).toContain('8MB');
    expect(result.canExportPending).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('瀏覽器額度不足時不轉入副本；可讀取的原工作區與普通編輯仍能備份', () => {
    const current = createSeed();
    const persisted = serializeWorkspaceBackup(current);
    const setItem = vi.fn(() => { throw new DOMException('Synthetic quota error', 'QuotaExceededError'); });
    const store: Store = { getItem: () => persisted, setItem };
    const incoming = createSeed();
    incoming.projects[0].input.title = '轉入測試';

    expect(() => saveImportedWorkspace(store, key, current, incoming, persisted)).toThrow('空間不足');
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(current).toEqual(createSeed());
    expect(store.getItem(key) === persisted).toBe(true);
    const result = saveWorkspace(store, key, incoming, persisted);
    expect(result.error).toContain('空間不足');
    expect(result.canExportPending).toBe(true);
    expect(parseBackup(serializeWorkspaceBackup(incoming))).toEqual(incoming);
  });

  it('另一分頁已保存時不寫入備份副本', () => {
    const current = createSeed();
    const changed = createSeed();
    changed.projects[0].input.title = '另一分頁的課程';
    const persisted = serializeWorkspaceBackup(changed);
    const setItem = vi.fn();
    const store: Store = { getItem: () => persisted, setItem };

    expect(() => saveImportedWorkspace(store, key, current, createSeed(), serializeWorkspaceBackup(current))).toThrow('其他分頁');
    expect(setItem).not.toHaveBeenCalled();
    expect(store.getItem(key) === persisted).toBe(true);
    expect(current).toEqual(createSeed());
  });

  it('接近上限的備份可直接讀取，即使使用縮排後的 JSON 已超出上限', () => {
    const workspace = largeBackup(43);
    expect(bytes(JSON.stringify(workspace, null, 2))).toBeGreaterThan(MAX_BACKUP_BYTES);
    const raw = serializeWorkspaceBackup(workspace);
    expect(bytes(raw)).toBeLessThanOrEqual(MAX_BACKUP_BYTES);
    const recovered = parseBackup(raw);
    expect(recovered.projects[0].designs).toHaveLength(43);
    expect(recovered.projects[0].designs[42].inputSnapshot.originalSource.text).toBe('測'.repeat(60_000));
  });
});
