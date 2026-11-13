import { describe, expect, it } from 'vitest';
import { createSeed } from '../data/seed';
import { strategiesFor } from './assessmentStrategy';
import { newItemBlueprint, validateItemBlueprint } from './itemBlueprint';
import { applyBlueprintDraft, buildBlueprintDraftPlan } from './itemBlueprintAi';

const design = createSeed().projects[0].designs[0];
const modes = design.inputSnapshot.indicatorIds.map(indicatorId => ({ indicatorId, mode: 'B' as const }));
const strategy = strategiesFor(design.inputSnapshot.subject)[0];
const load = { evidenceUnits: 2, operations: 2, support: 'none' };
const answer = (keys: string[]) => Object.fromEntries(keys.map(key => [key, { judgment: `判斷 ${key}`, evidence: `證據 ${key}`, pre: load, post: load, balanceNote: '' }]));

describe('R31 逐題藍圖 AI 先擬、教師核對', () => {
  it('只請 AI 擬空白題位；套用後已填題位不變，整份可通過確認', () => {
    const blueprint = newItemBlueprint(modes);
    blueprint.slots[0] = { ...blueprint.slots[0], judgment: '教師自己寫的判斷', evidence: '教師自己寫的證據' };
    const plan = buildBlueprintDraftPlan('p1', design, blueprint, strategy, 'scope');
    const keys = (plan.payload.slots as { key: string }[]).map(row => row.key);
    expect(keys).not.toContain('slot-1');
    expect(keys).toHaveLength(blueprint.slots.length - 1);
    expect(Object.keys((plan.payload.outputSchema as { properties: object }).properties)).toEqual(keys);
    expect(JSON.stringify(plan.payload)).not.toMatch(/teacherNotes|originalSource/);
    const next = applyBlueprintDraft(blueprint, plan, answer(keys));
    expect(next.slots[0].judgment).toBe('教師自己寫的判斷');
    expect(next.slots[1].judgment).toBe('判斷 slot-2');
    expect(() => validateItemBlueprint(next, modes)).not.toThrow();
  });
  it('題位不符、選擇題用句架、前後負擔不同卻沒寫理由，都拒收', () => {
    const blueprint = newItemBlueprint(modes);
    const plan = buildBlueprintDraftPlan('p1', design, blueprint, strategy, 'scope');
    const keys = (plan.payload.slots as { key: string }[]).map(row => row.key);
    expect(() => applyBlueprintDraft(blueprint, plan, answer(keys.slice(1)))).toThrow('題位與請求不符');
    const starter = answer(keys); starter['slot-1'] = { ...starter['slot-1'], pre: { ...load, support: 'starter' } };
    expect(() => applyBlueprintDraft(blueprint, plan, starter)).toThrow('前測作答負擔不符');
    const differ = answer(keys); differ['slot-1'] = { ...differ['slot-1'], post: { ...load, operations: 3 } };
    expect(() => applyBlueprintDraft(blueprint, plan, differ)).toThrow('負擔差異理由');
  });
  it('全部填好時不送出', () => {
    const blueprint = newItemBlueprint(modes);
    blueprint.slots = blueprint.slots.map(slot => ({ ...slot, judgment: 'x', evidence: 'y' }));
    expect(() => buildBlueprintDraftPlan('p1', design, blueprint, strategy, 'scope')).toThrow('所有題位都已填寫');
  });
});
