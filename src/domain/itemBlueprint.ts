import { BLUEPRINT_SUPPORT, MODE_PLAN, THRESHOLDS, type BlueprintPosition, type BlueprintSupport, type ItemBlueprint, type ItemSet, type ItemWorkload, type SetMode } from './types';

type Mode = { indicatorId: string; mode: SetMode };
export const BLUEPRINT_LIMITS = { slots: 16, judgment: 300, evidence: 400, balanceNote: 240, evidenceUnits: 12, operations: 8 } as const;
export const SUPPORT_LABEL: Record<BlueprintSupport, string> = { none: '無額外提示', focus: '指定關注範圍', starter: '句架（只給結構）' };

export function blueprintPositions(modes: readonly Mode[]): BlueprintPosition[] {
  return modes.flatMap(({ indicatorId, mode }) => {
    const { choices, opens } = MODE_PLAN[mode];
    return [
      ...choices.map((threshold, index) => ({ indicatorId, kind: 'choice' as const, question: index + 1, step: null, threshold })),
      ...opens.flatMap((steps, question) => steps.map((threshold, step) => ({ indicatorId, kind: 'open' as const, question: question + 1, step: step + 1, threshold }))),
    ];
  });
}

export function slotLabel(slot: BlueprintPosition): string {
  return slot.kind === 'choice' ? `選擇第 ${slot.question} 題` : `非選第 ${slot.question} 題・第 ${slot.step} 段`;
}

export function newItemBlueprint(modes: readonly Mode[]): ItemBlueprint {
  return { version: 1, slots: blueprintPositions(modes).map(position => {
    const level = THRESHOLDS.indexOf(position.threshold);
    const workload: ItemWorkload = { evidenceUnits: level === 0 ? 1 : 2, operations: level + 1, support: position.kind === 'choice' ? 'none' : 'starter' };
    return { ...position, judgment: '', evidence: '', pre: { ...workload }, post: { ...workload }, balanceNote: '' };
  }) };
}

export function workloadDiffers(pre: ItemWorkload, post: ItemWorkload): boolean {
  return pre.evidenceUnits !== post.evidenceUnits || pre.operations !== post.operations || pre.support !== post.support;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const exact = (row: Record<string, unknown>, fields: readonly string[]) =>
  Object.keys(row).length === fields.length && fields.every(key => Object.hasOwn(row, key));

export function validateItemBlueprint(value: unknown, modes: readonly Mode[]): ItemBlueprint {
  const root = record(value), expected = blueprintPositions(modes);
  if (!root || !exact(root, ['version', 'slots']) || root.version !== 1 || !Array.isArray(root.slots) ||
      !expected.length || root.slots.length !== expected.length || expected.length > BLUEPRINT_LIMITS.slots) {
    throw new Error('逐題藍圖的題位與測驗方式不符。請逐題核對後重新確認。');
  }
  const slots: unknown[] = root.slots;
  return { version: 1, slots: expected.map((position, index) => {
    const row = record(slots[index]);
    if (!row || !exact(row, ['indicatorId', 'kind', 'question', 'step', 'threshold', 'judgment', 'evidence', 'pre', 'post', 'balanceNote']) ||
        Object.entries(position).some(([key, expectedValue]) => row[key] !== expectedValue)) {
      throw new Error(`逐題藍圖第 ${index + 1} 個題位或門檻不符。`);
    }
    const error = (message: string): never => { throw new Error(`逐題藍圖第 ${index + 1} 個題位（${slotLabel(position)}）：${message}`); };
    const readText = (value: unknown, max: number, label: string, required: boolean): string => {
      if (typeof value !== 'string' || value.length > max || (required && !value.trim())) return error(`請填寫${label}（${max} 字內）。`);
      return value.trim();
    };
    const readLoad = (value: unknown, phase: string): ItemWorkload => {
      const load = record(value);
      if (!load || !exact(load, ['evidenceUnits', 'operations', 'support'])) return error(`${phase}缺少作答負擔。`);
      const count = (value: unknown, max: number, label: string) => {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) return error(`${phase}${label}須為 1 至 ${max} 的整數。`);
        return value;
      };
      const support = BLUEPRINT_SUPPORT.find(option => option === load.support);
      if (!support || (position.kind === 'choice' && support === 'starter')) return error(`${phase}的提示方式不適用於這個題位。`);
      return { evidenceUnits: count(load.evidenceUnits, BLUEPRINT_LIMITS.evidenceUnits, '證據量'), operations: count(load.operations, BLUEPRINT_LIMITS.operations, '推理步數'), support };
    };
    const judgment = readText(row.judgment, BLUEPRINT_LIMITS.judgment, '要測的判斷', true);
    const evidence = readText(row.evidence, BLUEPRINT_LIMITS.evidence, '必要證據', true);
    const pre = readLoad(row.pre, '前測'), post = readLoad(row.post, '後測');
    const balanceNote = readText(row.balanceNote, BLUEPRINT_LIMITS.balanceNote, '負擔不同的理由及如何維持可比較性', workloadDiffers(pre, post));
    return { ...position, judgment, evidence, pre, post, balanceNote };
  }) };
}

export function sameItemBlueprint(before: ItemBlueprint | undefined, after: ItemBlueprint | undefined, modes: readonly Mode[]): boolean {
  if (!before || !after) return before === after;
  return JSON.stringify(validateItemBlueprint(before, modes)) === JSON.stringify(validateItemBlueprint(after, modes));
}

export function carryItemBlueprint(draft: ItemBlueprint | undefined, modes: readonly Mode[]): ItemBlueprint {
  const next = newItemBlueprint(modes);
  return { ...next, slots: next.slots.map(position =>
    draft?.slots.find(slot => slot.indicatorId === position.indicatorId && slot.kind === position.kind &&
      slot.question === position.question && slot.step === position.step && slot.threshold === position.threshold) ?? position) };
}

// 草稿可含空文字與尚未輸完的數字；產生前仍須通過完整驗證。
export function readItemBlueprintDraft(value: unknown, modes: readonly Mode[]): ItemBlueprint | undefined {
  const root = record(value), expected = newItemBlueprint(modes);
  if (!root || root.version !== 1 || !Array.isArray(root.slots) || root.slots.length !== expected.slots.length) return undefined;
  const rows: unknown[] = root.slots;
  const text = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : '';
  const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : NaN;
  return { version: 1, slots: expected.slots.map((position, index) => {
    const row = record(rows[index]);
    if (!row || (['indicatorId', 'kind', 'question', 'step', 'threshold'] as const).some(key => row[key] !== position[key])) return position;
    const load = (value: unknown, fallback: ItemWorkload): ItemWorkload => {
      const input = record(value);
      if (!input) return fallback;
      const support = BLUEPRINT_SUPPORT.find(option => option === input.support && (position.kind === 'open' || option !== 'starter'));
      return { evidenceUnits: count(input.evidenceUnits), operations: count(input.operations), support: support ?? fallback.support };
    };
    return { ...position, judgment: text(row.judgment, BLUEPRINT_LIMITS.judgment), evidence: text(row.evidence, BLUEPRINT_LIMITS.evidence),
      balanceNote: text(row.balanceNote, BLUEPRINT_LIMITS.balanceNote), pre: load(row.pre, position.pre), post: load(row.post, position.post) };
  }) };
}

export function checkBlueprintSupport(sets: readonly ItemSet[], phase: 'pre' | 'post', blueprint: ItemBlueprint | undefined): void {
  for (const slot of blueprint?.slots ?? []) {
    if (slot.kind !== 'open' || slot.step === null || slot[phase].support === 'starter') continue;
    const set = sets.find(row => row.indicatorId === slot.indicatorId);
    const step = set?.opens[slot.question - 1]?.steps[slot.step - 1];
    if (step?.sentenceStarter.trim() !== '請作答。') {
      throw new Error(`${phase === 'pre' ? '前測' : '後測'}子指標 ${slot.indicatorId} 的非選第 ${slot.question} 題第 ${slot.step} 段不符合逐題藍圖：不得附加句架；sentenceStarter 請填「請作答。」。`);
    }
  }
}
