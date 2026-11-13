import { describe, expect, it } from 'vitest';
import { ACTIVITY_DATA_RULE, ITEM_DATA_RULE, OBSERVABLE_RULE, UNOBSERVED_RULE, attitudeWord } from './contentRules';
import { decodeClassroomKits } from './classroomKit';
import { kitFixture, scenarioReady } from './scenarioAssessment.test-helper';

// R43（2026-11-14 使用者決定）：模擬資料只限教師提供的資料；規準不得評價人格態度；unobserved 寫證據的限制。
describe('R43 內容規則', () => {
  it('活動：教師提供的資料才寫模擬；學生實地蒐集的資料是真實資料。題目仍一律模擬', () => {
    expect(ACTIVITY_DATA_RULE).toMatch(/教師準備、提供給學生/);
    expect(ACTIVITY_DATA_RULE).toMatch(/學生在活動中自己實地觀察.*是真實資料/);
    expect(ACTIVITY_DATA_RULE).toMatch(/不要改成模擬實作/);
    expect(ITEM_DATA_RULE).toMatch(/一律是模擬資料/);
  });
  it('態度評價字詞：規則寫明禁止，檢查抓得到；一般行為描述不誤判', () => {
    expect(OBSERVABLE_RULE).toMatch(/冷漠/);
    expect(attitudeWord('學生對環境議題討論明顯冷漠')).toBe('冷漠');
    expect(attitudeWord('態度消極，作品敷衍')).toBe('態度消極');
    expect(attitudeWord('只列出物種清單，沒有說明棲地差異的原因')).toBeNull();
    expect(UNOBSERVED_RULE).toMatch(/無法證明什麼/);
  });
  it('勾選表四階行為含態度字詞即退件', () => {
    const w = scenarioReady(), p = w.projects[0], ids = p.input.indicatorIds, design = p.designs.find(d => d.id === p.activeDesignId)!;
    const raw = Object.fromEntries(ids.map(id => { const k = kitFixture(design, id); return [id, { worksheet: { title: k.worksheet.title, intro: k.worksheet.intro, questions: k.worksheet.questions.map(q => ({ activityId: q.activityId, prompt: q.prompt })) },
      checklist: k.checklist.map(r => ({ criterionId: r.criterionId, focus: r.focus, behaviors: { limited: '對討論明顯冷漠，不參與', emerging: r.behaviors[1], developing: r.behaviors[2], proficient: r.behaviors[3] } })) }]; }));
    expect(() => decodeClassroomKits(raw, design, ids)).toThrow('評價人格或態度的字詞「冷漠」');
  });
});
