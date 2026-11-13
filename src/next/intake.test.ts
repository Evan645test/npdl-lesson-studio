import { describe, expect, it } from 'vitest';
import { createSeed } from '../data/seed';
import { addIntakeProject, changeIntake, clearIntake, emptyIntake, intakeStorageKey, intakeToInput, loadIntake, reviewIntake, saveIntake } from './intake';
import { intakeFromExample } from './examples';
import { applyExtraction, validateIntakeSuggestions } from './intakeAi';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, clear: () => values.clear(), getItem: key => values.get(key) ?? null, key: index => [...values.keys()][index] ?? null, removeItem: key => { values.delete(key); }, setItem: (key, value) => { values.set(key, value); } };
}
describe('R07 發想與專案邊界', () => {
  it('四組範例都只建立未核對發想，不觸發正式設計', () => {
    for (const id of ['existing-chemistry-rate', 'existing-geography-shade', 'new-chemistry-claims', 'new-english-audience']) {
      const draft = intakeFromExample(id);
      expect(draft.reviewedAt).toBeNull(); expect(draft.curriculumIds).toHaveLength(0);
      expect(() => intakeToInput(draft)).toThrow('核對');
    }
  });
  it('解構只填入有明確來源的欄位，仍需核對', () => {
    const draft = changeIntake(emptyIntake('existing'), { subject: '化學', sourceText: '三節課探討反應速率。' });
    const applied = applyExtraction(draft, { title: '', subject: '', grade: '', periods: 3, topic: '比較實驗資料', activityIdea: '比較三組紀錄', expectedPerformance: '', background: '', foundation: '', startingPoint: '', gaps: ['學生起點'] });
    expect(applied.draft.subject).toBe('化學'); expect(applied.draft.periods).toBe('3'); expect(applied.draft.startingPoint).toBe(''); expect(applied.draft.reviewedAt).toBeNull();
    expect(applied.draft.activityIdea).toBe('比較三組紀錄');
  });
  it('已保存的早期發想草稿補空欄載入，舊核對因欄位變更失效', () => {
    const store = memoryStorage(), key = intakeStorageKey('workspace:r07');
    const old = emptyIntake('new') as unknown as Record<string, unknown>;
    for (const name of ['activityIdea', 'expectedPerformance', 'background', 'foundation']) delete old[name];
    store.setItem(key, JSON.stringify(old));
    const loaded = loadIntake(store, key).draft!;
    expect(loaded.activityIdea).toBe(''); expect(loaded.foundation).toBe('');
    expect(loaded.reviewedAt).toBeNull();
  });
  it('候選必須使用固定學科課綱與子指標', () => {
    const chemistry = createSeed().projects[0].input.curriculumIds[0];
    const valid = { title: '資料探究', periods: 3, curriculumIds: [chemistry], indicatorIds: ['critical-evaluate-information'], reason: '對應證據判讀' };
    expect(validateIntakeSuggestions(valid, '化學').title).toBe('資料探究');
    expect(() => validateIntakeSuggestions({ ...valid, curriculumIds: ['invented'] }, '化學')).toThrow('課綱');
  });
  it('建立正式專案只在核對且完整設計時成功，原專案保留', () => {
    const seed = createSeed(), source = seed.projects[0], { id: _id, createdAt: _createdAt, confirmedAt: _confirmedAt, origin: _origin, inputSnapshot: _inputSnapshot, rubricVersion: _rubricVersion, ...content } = source.designs[0];
    void _id; void _createdAt; void _confirmedAt; void _origin; void _inputSnapshot; void _rubricVersion;
    const draft = reviewIntake(changeIntake(intakeFromExample('existing-chemistry-rate'), { curriculumIds: [...source.input.curriculumIds] }));
    const next = addIntakeProject(seed, draft, content);
    expect(next.projects).toHaveLength(2); expect(next.projects[0]).toEqual(source);
    expect(next.projects[1].assessments).toHaveLength(0); expect(next.projects[1].designs[0].confirmedAt).toBeNull();
    expect(() => addIntakeProject(seed, draft, { ...content, activities: [] })).toThrow();
    expect(seed.projects).toHaveLength(1);
  });
  it('清空只清本輪草稿，並防止跨分頁覆蓋', () => {
    const store = memoryStorage(), key = intakeStorageKey('workspace:r07');
    const draft = emptyIntake('new'); const raw = saveIntake(store, key, draft, null);
    expect(loadIntake(store, key).draft?.id).toBe(draft.id);
    expect(() => clearIntake(store, key, null)).toThrow('其他分頁');
    clearIntake(store, key, raw); expect(store.getItem(key)).toBeNull();
    expect(store.getItem('workspace:r07')).toBeNull();
  });
});
