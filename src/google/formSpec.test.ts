import { describe, expect, it } from 'vitest';
import { suggestedMode } from '../data/assessability';
import { reviewAssessment } from '../domain/lifecycle';
import { addScenarioAssessment, setClassroomKits } from '../domain/scenarioAssessment';
import { kitFixture, scenarioFixture, scenarioReady } from '../domain/scenarioAssessment.test-helper';
import type { ModeChoice } from '../domain/thresholdSet';
import { buildFormSpec, FORM_PRIVACY_NOTE, hasWorksheet } from './formSpec';
import { formRequests, googleProblem, isValidClientId, projectNumber } from './googleApi';

function reviewedPre(modeE = false) {
  const w = scenarioReady(), p = w.projects[0], ids = p.input.indicatorIds;
  const modes: ModeChoice[] = ids.map((indicatorId, i) => ({ indicatorId, suggestedMode: suggestedMode(indicatorId), mode: modeE && i === 0 ? 'E' : 'B' }));
  const scenarioIds = modes.filter(m => m.mode !== 'E').map(m => m.indicatorId);
  let first = addScenarioAssessment(w, p.id, 'pre', scenarioFixture(w, 'pre', scenarioIds), modes);
  if (modeE) { const design = first.projects[0].designs.find(d => d.id === first.projects[0].activeDesignId)!; first = setClassroomKits(first, p.id, [kitFixture(design, ids[0])]); }
  return { unreviewed: first.projects[0], reviewed: reviewAssessment(first, p.id, first.projects[0].activePreId!).projects[0] };
}

describe('R42 學生題本轉 Google 表單', () => {
  it('未核對的前測不能建表單；尚未產生的後測說明原因', () => {
    const { unreviewed, reviewed } = reviewedPre();
    expect(() => buildFormSpec(unreviewed, 'pre')).toThrow('請先核對前測');
    expect(() => buildFormSpec(reviewed, 'post')).toThrow('尚未產生後測');
  });

  it('情境進程題：班級代號與座號必填，每題一個單選＋一個理由段落；不洩漏階段與錨點', () => {
    const { reviewed } = reviewedPre();
    const spec = buildFormSpec(reviewed, 'pre');
    expect(spec.title).toContain('學生前測');
    expect(spec.description).toContain(FORM_PRIVACY_NOTE);
    expect(spec.entries.slice(0, 2).map(e => [e.title, 'required' in e && e.required])).toEqual([['班級代號', true], ['座號', true]]);
    const choices = spec.entries.filter(e => e.kind === 'choice');
    const items = reviewed.assessments.find(a => a.id === reviewed.activePreId)!.scenarioSets!.flatMap(s => s.items);
    expect(choices).toHaveLength(items.length);
    expect(spec.entries.filter(e => e.kind === 'paragraph').length).toBeGreaterThanOrEqual(items.length);
    const text = JSON.stringify(spec);
    expect(text).toContain('生活情境 A1。');
    expect(text).not.toMatch(/（(證據有限|萌芽|發展|精熟)）|判讀錨點|錨點我會/);
    for (const entry of spec.entries) {
      expect(entry.title).not.toMatch(/\n/);
      if (entry.kind === 'choice') {
        expect(new Set(entry.options).size).toBe(entry.options.length);
        entry.options.forEach(o => expect(o).not.toMatch(/\n/));
      }
    }
  });

  it('方式 E（課堂學習單）：前測表單不放學習單，學習單另建一份表單，不含表現勾選表', () => {
    const { reviewed } = reviewedPre(true);
    // 這門測試課全部採課堂學習單：前測沒有紙筆題，不建前測表單。
    expect(() => buildFormSpec(reviewed, 'pre')).toThrow('沒有可放進表單的學生題目');
    expect(hasWorksheet(reviewed)).toBe(true);
    const sheet = buildFormSpec(reviewed, 'worksheet');
    expect(sheet.title).toContain('課堂學習單');
    expect(sheet.entries.slice(0, 2).map(e => e.title)).toEqual(['班級代號', '座號']);
    expect(sheet.entries.filter(e => e.kind === 'paragraph' && e.title.includes('寫出你在這個活動中怎麼做'))).toHaveLength(3);
    expect(JSON.stringify(sheet)).not.toMatch(/勾選表|四階/);
  });

  it('沒有學習單的課程不能建學習單表單', () => {
    const { reviewed } = reviewedPre();
    expect(hasWorksheet(reviewed)).toBe(false);
    expect(() => buildFormSpec(reviewed, 'worksheet')).toThrow('沒有課堂學習單');
  });

  it('轉成 Forms API 請求：標題說明、分頁、單選、段落與簡答，位置依序', () => {
    const { reviewed } = reviewedPre();
    const spec = buildFormSpec(reviewed, 'pre');
    const requests = formRequests(spec) as Record<string, any>[];
    expect(requests[0].updateFormInfo.updateMask).toBe('description');
    expect(requests).toHaveLength(spec.entries.length + 1);
    requests.slice(1).forEach((r, i) => expect(r.createItem.location.index).toBe(i));
    const first = requests[1].createItem.item;
    expect(first.questionItem.question).toEqual({ required: true, textQuestion: { paragraph: false } });
    const radio = requests.find(r => r.createItem?.item.questionItem?.question.choiceQuestion)!.createItem.item.questionItem.question;
    expect(radio.choiceQuestion.type).toBe('RADIO');
    expect(radio.required).toBe(false);
    expect(requests.some(r => r.createItem?.item.pageBreakItem)).toBe(true);
    expect(JSON.stringify(requests)).not.toMatch(/grading|isQuiz|correctAnswers/);
  });
});

describe('R42 Google 設定與錯誤訊息', () => {
  it('用戶端 ID 格式與專案編號', () => {
    expect(isValidClientId('123456789012-abc123def.apps.googleusercontent.com')).toBe(true);
    expect(isValidClientId('AIzaSyFakeKey')).toBe(false);
    expect(projectNumber('123456789012-abc.apps.googleusercontent.com')).toBe('123456789012');
  });
  it('常見錯誤給白話說明', () => {
    expect(googleProblem(401, '')).toContain('重新連結');
    expect(googleProblem(403, 'Google Forms API has not been used in project')).toContain('尚未啟用');
    expect(googleProblem(404, '')).toContain('重新選擇資料夾');
  });
});
