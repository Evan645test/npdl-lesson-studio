import type { LegacyImport } from '../domain/types';

type RecordValue = Record<string, unknown>;
const MAX_LEGACY_BYTES = 8 * 1024 * 1024;
const SENSITIVE_FIELD = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|oauth[_-]?token|password|secret|private[_-]?key|authorization|credential)/i;

function record(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}格式不正確。`);
  return value as RecordValue;
}
function nonempty(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}缺少必要文字。`);
  return value;
}
function entries(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label}數量或格式不正確。`);
  return value;
}
function checkSensitiveFields(value: unknown): void {
  const pending: unknown[] = [value];
  let visited = 0;
  while (pending.length) {
    const node = pending.pop();
    if (++visited > 200_000) throw new Error('舊備份巢狀內容過多，未轉入。');
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) { pending.push(...node); continue; }
    for (const [key, child] of Object.entries(node)) {
      if (SENSITIVE_FIELD.test(key)) throw new Error(`舊備份包含可能的憑證欄位「${key}」，請先在原工具另存不含憑證的備份。`);
      pending.push(child);
    }
  }
}

export function inspectLegacy(raw: string): Pick<LegacyImport, 'kind' | 'sourceVersion' | 'title'> {
  if (new TextEncoder().encode(raw).length > MAX_LEGACY_BYTES) throw new Error('舊備份超過 8MB，未轉入。');
  let value: unknown;
  try { value = JSON.parse(raw.replace(/^\uFEFF/, '')); }
  catch { throw new Error('舊備份不是完整 JSON，原工作區保留。'); }
  const root = record(value, '舊備份');
  checkSensitiveFields(root);
  if (root.version === 1) {
    const projects = entries(root.projects, '原評量工作區專案', 20);
    if (!projects.length) throw new Error('原評量工作區沒有專案。');
    const ids = new Set<string>();
    for (const source of projects) {
      const project = record(source, '原評量專案');
      const id = nonempty(project.id, '原評量專案 ID');
      if (ids.has(id)) throw new Error('原評量專案 ID 重複。');
      ids.add(id);
      const input = record(project.input, '原評量課程');
      nonempty(input.title, '原評量課程名稱');
      const versions = entries(project.versions, '原評量版本', 100);
      const versionIds = new Set<string>();
      for (const sourceVersion of versions) {
        const version = record(sourceVersion, '原評量版本');
        const versionId = nonempty(version.id, '原評量版本 ID');
        if (versionIds.has(versionId)) throw new Error('原評量版本 ID 重複。');
        versionIds.add(versionId);
        if (version.phase !== 'pre' && version.phase !== 'post') throw new Error('原評量版本測次不相容。');
        record(version.input, '原評量版本輸入快照');
        record(version.plan, '原評量版本設計快照');
        entries(version.blocks, '原評量題組快照', 2);
        if (typeof version.sourceKey !== 'string') throw new Error('原評量版本來源指紋缺失。');
        if (version.administeredAt !== undefined && version.administeredAt !== null && (typeof version.administeredAt !== 'number' || !Number.isSafeInteger(version.administeredAt) || version.administeredAt < 0)) throw new Error('原評量施測時間不正確。');
      }
      for (const sourceVersion of versions) {
        const version = sourceVersion as RecordValue;
        if (version.phase === 'post' && !versions.some(candidate => {
          const pre = candidate as RecordValue;
          return pre.phase === 'pre' && pre.id === version.preId;
        })) throw new Error('原評量後測缺少配對前測。');
      }
    }
    if (!ids.has(root.activeId as string)) throw new Error('原評量目前專案不存在。');
    const active = projects.find(source => (source as RecordValue).id === root.activeId) as RecordValue;
    return { kind: 'assessment-studio', sourceVersion: 1, title: (active.input as RecordValue).title as string };
  }
  if ([1, 2, 3, 4, 5].includes(root.schemaVersion as number)) {
    const form = record(root.form, '原課程表單');
    nonempty(root.courseId, '原課程 ID');
    nonempty(form.unitName, '原課程名稱');
    record(root.design, '原課程設計');
    record(root.assessment, '原課程評量');
    entries(root.selectedRecordIds, '原課綱選取', 1000);
    const students = entries(root.students, '原學生證據', 1000);
    if (students.length) throw new Error('舊備份含學生證據；請先在原工具建立去識別且沒有學生資料的備份。');
    return { kind: 'course-workspace', sourceVersion: root.schemaVersion as number, title: form.unitName as string };
  }
  throw new Error('不支援的舊備份類型或版本；原工作區保留。');
}

export async function createLegacyImport(raw: string, filename: string): Promise<LegacyImport> {
  const facts = inspectLegacy(raw);
  const bytes = new TextEncoder().encode(raw);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return {
    id: crypto.randomUUID(),
    ...facts,
    filename: filename.slice(0, 200) || '舊備份.json',
    title: facts.title.slice(0, 160),
    importedAt: Date.now(),
    sha256: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''),
    raw,
  };
}
