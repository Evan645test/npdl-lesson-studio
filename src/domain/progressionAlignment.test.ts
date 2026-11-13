import { describe, expect, it } from 'vitest';
import { alignFromLines, assembleStage, checkAlignment, progressionLines } from './progressionAlignment';
import { criteriaFromEvidence, emptySingleDraft, validateSingleDraft } from '../next/singlePath';
import { createSeed } from '../data/seed';
import { validateWorkspace } from './validate';
import { buildDocument } from '../documents/model';

const ID = 'communication-audience-impact';
const answer = (skip?: string, extra?: { id: string; observable: string }) => [
  ...progressionLines(ID).flat().filter(line => line.id !== skip).map(line => ({ id: line.id, observable: `本課對應 ${line.id}。` })),
  ...(extra ? [extra] : []),
];

describe('R31 規準與 NPDL 原文逐句對應', () => {
  it('原文依換行切句並由程式編號；AI 只回傳編號對應，程式依原文順序組成四階規準', () => {
    const lines = progressionLines(ID);
    expect(lines).toHaveLength(4);
    expect(lines[1][0]).toMatchObject({ id: 'S2-L1', stage: 1 });
    const { alignment, stages } = alignFromLines(ID, [...answer()].reverse());
    expect(alignment.map(row => row.length)).toEqual(lines.map(row => row.length));
    expect(stages[1]).toBe(assembleStage(lines[1].map(line => `本課對應 ${line.id}。`)));
    expect(stages[1]).toMatch(/^本課對應 S2-L1；本課對應 S2-L2/);
    expect(() => checkAlignment(ID, alignment, stages)).not.toThrow();
    expect(() => checkAlignment(ID, alignment, ['x', ...stages.slice(1)])).toThrow('不一致');
  });
  it('缺句、重複、空白或不屬於本子指標的編號都拒收', () => {
    expect(() => alignFromLines(ID, answer('S3-L2'))).toThrow('缺少原文句 S3-L2');
    expect(() => alignFromLines(ID, answer(undefined, { id: 'S1-L1', observable: '又一次' }))).toThrow('重複');
    expect(() => alignFromLines(ID, answer(undefined, { id: 'S4-L9', observable: '多的' }))).toThrow('不屬於');
    expect(() => alignFromLines(ID, answer().map((row, i) => i === 0 ? { ...row, observable: ' ' } : row))).toThrow('空白');
  });
  it('單一路徑回應轉成含 alignment 的規準並通過草稿驗證；舊草稿無 alignment 仍可讀', () => {
    const draft = { ...emptySingleDraft(), indicatorIds: [ID] };
    const criteria = criteriaFromEvidence(draft, { criteria: [{ indicatorId: ID, label: '受眾', observable: '觀', scope: '範', unobserved: '無', lines: answer() }] });
    expect(criteria[0].alignment).toBeDefined();
    expect(() => validateSingleDraft({ ...draft, criteria })).not.toThrow();
    const { alignment: _a, ...legacy } = criteria[0]; void _a;
    expect(() => validateSingleDraft({ ...draft, criteria: [legacy] })).not.toThrow();
    const tampered = { ...criteria[0], stages: ['改過', ...criteria[0].stages.slice(1)] as typeof criteria[0]['stages'] };
    expect(() => validateSingleDraft({ ...draft, criteria: [tampered] })).toThrow('不一致');
    expect(() => criteriaFromEvidence(draft, { criteria: [{ indicatorId: ID, label: 'l', observable: 'o', scope: 's', unobserved: 'u', stages: ['a', 'b', 'c', 'd'] }] })).toThrow('欄位不符');
  });
  it('正式設計保存逐句對應，工作區驗證核對一致性，教師手冊附原文與本課表現', () => {
    const w = createSeed(), d = w.projects[0].designs[0], c = d.criteria[0];
    const { alignment, stages } = alignFromLines(c.indicatorId, progressionLines(c.indicatorId).flat().map(line => ({ id: line.id, observable: `種子對應 ${line.id}` })));
    Object.assign(c, { alignment, stages });
    expect(() => validateWorkspace(w)).not.toThrow();
    const text = buildDocument(w.projects[0], 'teacher').blocks.map(b => b.text).join('\n');
    expect(text).toContain('逐句對應（NPDL 學生版原文 → 本課可觀察表現）');
    expect(text).toContain('本課：種子對應 S1-L1');
    expect(text).toContain('原文：' + progressionLines(c.indicatorId)[0][0].text);
    const broken = structuredClone(w);
    broken.projects[0].designs[0].criteria[0].alignment![0][0] = '偷改';
    expect(() => validateWorkspace(broken)).toThrow('不一致');
  });
});
