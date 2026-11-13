import indicators from '../data/indicators.json';

// R31（2026-11-09 使用者決定）：本課四階規準由「NPDL 學生版原文逐句 → 本課可觀察表現」組成。
// 原文依換行切句並由程式編號（S{階}-L{句}）；AI 只回傳每個編號的本課表現，不抄原文；
// 每一句都必須有對應（不允許「本課不觀察」），程式依序接成該階規準，對應與規準文字永遠一致。
export type Alignment = string[][];
export interface ProgressionLine { id: string; stage: number; text: string }

export function progressionLines(indicatorId: string): ProgressionLine[][] {
  const entry = indicators.entries.find(row => row.id === indicatorId);
  if (!entry || entry.stages.length !== 4) throw Error('找不到子指標的四階原文：' + indicatorId);
  return entry.stages.map((stage, s) => stage.split('\n').map(text => text.trim()).filter(Boolean)
    .map((text, l) => ({ id: `S${s + 1}-L${l + 1}`, stage: s, text })));
}
export function allLineIds(indicatorIds: string[]): string[] {
  return [...new Set(indicatorIds.flatMap(id => progressionLines(id).flat().map(line => line.id)))];
}
export function assembleStage(lines: string[]): string {
  const parts = lines.map(text => text.trim().replace(/[。；;，,\s]+$/u, '')).filter(Boolean);
  return parts.length ? parts.join('；') + '。' : '';
}
export function checkAlignment(indicatorId: string, alignment: unknown, stages?: readonly string[]): Alignment {
  const lines = progressionLines(indicatorId);
  if (!Array.isArray(alignment) || alignment.length !== 4) throw Error('逐句對應須有四階。');
  alignment.forEach((row, s) => {
    if (!Array.isArray(row) || row.length !== lines[s].length) throw Error(`逐句對應第 ${s + 1} 階應有 ${lines[s].length} 句。`);
    row.forEach((text, l) => { if (typeof text !== 'string' || !text.trim() || text.length > 600) throw Error(`逐句對應 ${lines[s][l].id} 空白或太長。`); });
    if (stages && stages[s] !== assembleStage(row as string[])) throw Error(`第 ${s + 1} 階規準與逐句對應不一致。`);
  });
  return alignment as Alignment;
}

// AI 回傳 lines：[{ id, observable }]；檢查編號齊全、不重複，再依原文順序組成對應與四階規準。
export function alignFromLines(indicatorId: string, raw: unknown): { alignment: Alignment; stages: [string, string, string, string] } {
  const lines = progressionLines(indicatorId);
  if (!Array.isArray(raw)) throw Error('逐句對應 lines 格式不符。');
  const given = new Map<string, string>();
  for (const row of raw) {
    const { id, observable } = (row ?? {}) as { id?: unknown; observable?: unknown };
    if (typeof id !== 'string' || typeof observable !== 'string') throw Error('逐句對應欄位不符。');
    if (given.has(id)) throw Error(`原文句 ${id} 重複對應。`);
    if (!lines.flat().some(line => line.id === id)) throw Error(`原文句 ${id} 不屬於這個子指標。`);
    if (!observable.trim()) throw Error(`原文句 ${id} 的本課表現空白。`);
    given.set(id, observable.trim());
  }
  const missing = lines.flat().filter(line => !given.has(line.id)).map(line => line.id);
  if (missing.length) throw Error(`缺少原文句 ${missing.join('、')} 的本課表現；每一句都要寫出本課可觀察的行為。`);
  const alignment = lines.map(stage => stage.map(line => given.get(line.id)!));
  return { alignment, stages: alignment.map(assembleStage) as [string, string, string, string] };
}
