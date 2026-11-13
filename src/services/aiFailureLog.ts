import { storageKey } from '../storage/workspace';
import type { GenerationKind } from './generation';

export const FAILURE_LOG_MAX = 5;
const OUTPUT_MAX = 50000;
const MEMORY_SCOPE_MAX = 10;
const LOG_SUFFIX = ':ai-failures:v2:';
const tasks = ['recommend', 'design', 'pre', 'post', 'intake', 'field', 'item'] as const;
const kinds = ['invalid-json', 'validation', 'incomplete'] as const;
type FailureKind = typeof kinds[number];
type FailureProvider = 'openai' | 'gemini';
export interface AiFailure {
  id: string;
  at: string;
  task: GenerationKind;
  batch: number | null;
  attempt: 0 | 1;
  provider: FailureProvider;
  kind: FailureKind;
  outputChars: number;
}
interface FailureEntry extends Pick<AiFailure, 'task' | 'attempt' | 'provider' | 'kind'> {
  courseId: string;
  batch?: number | null;
  output: string;
  key: string;
}
interface FailureOutput { text: string; truncated: boolean }
const rawOutputs = new Map<string, { scope: string; output: FailureOutput }>();
const unavailableStorage = new Map<string, AiFailure[]>();
const listeners = new Set<() => void>();
let revision = 0;

function workspaceKey(): string {
  return storageKey(typeof location === 'undefined' ? '' : location.pathname);
}
function scopedKey(courseId: string): string | null {
  return courseId.trim() ? workspaceKey() + LOG_SUFFIX + courseId : null;
}
function validCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 2 * 1024 * 1024;
}
// Whitelist values and rebuild each row so storage can never add free-text fields to the export.
function summaryOf(value: unknown): AiFailure | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<AiFailure>;
  if (typeof row.id !== 'string' || !/^[0-9a-f-]{36}$/.test(row.id)
    || typeof row.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.at)
    || !row.task || !tasks.includes(row.task) || !row.kind || !kinds.includes(row.kind)
    || (row.provider !== 'openai' && row.provider !== 'gemini') || (row.attempt !== 0 && row.attempt !== 1)
    || (row.batch !== null && !validCount(row.batch)) || !validCount(row.outputChars)) return null;
  return { id: row.id, at: row.at, task: row.task, batch: row.batch, attempt: row.attempt, provider: row.provider, kind: row.kind, outputChars: row.outputChars };
}
function readRows(scope: string): AiFailure[] {
  const fallback = unavailableStorage.get(scope);
  if (fallback) return fallback.slice();
  try {
    const raw = localStorage.getItem(scope);
    const rows: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(rows) ? rows.slice(0, FAILURE_LOG_MAX).flatMap(row => {
      const summary = summaryOf(row);
      return summary ? [summary] : [];
    }) : [];
  } catch { return []; }
}
function saveRows(scope: string, rows: AiFailure[]): void {
  try {
    if (rows.length) localStorage.setItem(scope, JSON.stringify(rows));
    else localStorage.removeItem(scope);
    unavailableStorage.delete(scope);
  } catch {
    unavailableStorage.delete(scope);
    unavailableStorage.set(scope, rows);
    const oldest = unavailableStorage.keys().next().value;
    if (unavailableStorage.size > MEMORY_SCOPE_MAX && oldest !== undefined) unavailableStorage.delete(oldest);
  }
}
function maskCredentials(output: string, key: string): string {
  const secret = key.trim();
  const placeholder = '［已遮蔽］';
  const exactMasked = secret ? output.split(secret).join(placeholder) : output;
  const decoded = exactMasked.replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  const decodedMasked = secret ? decoded.split(secret).join(placeholder) : decoded;
  const masked = decodedMasked.replace(/sk-[a-z0-9_-]{12,}|AIza[a-z0-9_-]{25,}/gi, placeholder);
  return masked === decoded ? exactMasked : masked;
}
function notify(): void {
  revision++;
  for (const listener of listeners) listener();
}
export function failuresRevision(): number { return revision; }
export function subscribeFailures(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(workspaceKey() + LOG_SUFFIX)) {
      revision++;
      listener();
    }
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}
export function readFailures(courseId: string): AiFailure[] {
  const scope = scopedKey(courseId);
  return scope ? readRows(scope) : [];
}
export function recordFailure(entry: FailureEntry): void {
  const scope = scopedKey(entry.courseId);
  const id = globalThis.crypto?.randomUUID?.();
  if (!scope || !id) return;
  const row = summaryOf({
    id, at: new Date().toISOString(), task: entry.task,
    batch: validCount(entry.batch) ? entry.batch : null, attempt: entry.attempt,
    provider: entry.provider, kind: entry.kind, outputChars: entry.output.length,
  });
  if (!row) return;
  const rows = [row, ...readRows(scope)].slice(0, FAILURE_LOG_MAX);
  saveRows(scope, rows);
  if (entry.output) {
    const masked = maskCredentials(entry.output, entry.key);
    rawOutputs.set(row.id, { scope, output: { text: masked.slice(0, OUTPUT_MAX), truncated: masked.length > OUTPUT_MAX } });
    const oldest = rawOutputs.keys().next().value;
    if (rawOutputs.size > FAILURE_LOG_MAX && oldest !== undefined) rawOutputs.delete(oldest);
  }
  notify();
}
export function canPreviewFailure(courseId: string, id: string): boolean {
  const raw = rawOutputs.get(id);
  return raw !== undefined && raw.scope === scopedKey(courseId) && readFailures(courseId).some(row => row.id === id);
}
export function previewFailureOutput(courseId: string, id: string): FailureOutput | null {
  return canPreviewFailure(courseId, id) ? { ...rawOutputs.get(id)!.output } : null;
}
export function clearFailures(courseId: string): void {
  const scope = scopedKey(courseId);
  if (!scope) return;
  saveRows(scope, []);
  for (const [id, raw] of rawOutputs) if (raw.scope === scope) rawOutputs.delete(id);
  notify();
}
export function diagnosticsText(courseId: string): string {
  const failures = readFailures(courseId).map(({ id: _id, ...row }) => row);
  const preview = workspaceKey().split(':')[2] ?? null;
  return JSON.stringify({ note: 'NPDL 備課工具新版：目前課程的 AI 失敗診斷摘要', preview, copiedAt: new Date().toISOString(), failures }, null, 2);
}
export class IncompleteResponse extends Error {
  constructor(message: string, public readonly partial: string, public readonly detail: string) { super(message); }
}
