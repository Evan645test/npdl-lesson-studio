import { describe, expect, it } from 'vitest';
import { suggestedMode } from '../data/assessability';
import { reviewAssessment } from './lifecycle';
import { validateWorkspace } from './validate';
import { addScenarioAssessment, setClassroomKits } from './scenarioAssessment';
import { buildClassroomKitPlan, decodeClassroomKits } from './classroomKit';
import { buildScenarioPlan, decodeAspects, decodeScenarioSets, keepPassingItems } from './scenarioProgression';
import { kitFixture, scenarioFixture, scenarioReady } from './scenarioAssessment.test-helper';
import type { ModeChoice } from './thresholdSet';

// R41（2026-11-12 使用者決定）：情境題 3 題選擇＋1 題延伸；方式 E 改為 AI 產生學習單與課堂表現勾選表。
const setup = () => {
  const w = scenarioReady(), p = w.projects[0], ids = p.input.indicatorIds;
  const design = p.designs.find(d => d.id === p.activeDesignId)!;
  const modes: ModeChoice[] = ids.map(indicatorId => ({ indicatorId, suggestedMode: suggestedMode(indicatorId), mode: 'E' }));
  return { w, p, ids, design, modes };
};
const kitRaw = (kits: ReturnType<typeof kitFixture>[]) => Object.fromEntries(kits.map(k => [k.indicatorId, { worksheet: { title: k.worksheet.title, intro: k.worksheet.intro, questions: k.worksheet.questions.map(q => ({ activityId: q.activityId, prompt: q.prompt })) },
  checklist: k.checklist.map(r => ({ criterionId: r.criterionId, focus: r.focus, behaviors: { limited: r.behaviors[0], emerging: r.behaviors[1], developing: r.behaviors[2], proficient: r.behaviors[3] } })) }]));

describe('R41 課中學習單與課堂表現勾選表', () => {
  it('請求只送規準與相連活動，活動與規準以 enum 限定；合格回應可解析', () => {
    const { p, ids, design } = setup();
    const plan = buildClassroomKitPlan(p.id, design, ids, { subject: '化學' }, 's');
    expect(plan.payload.task).toBe('draft-classroom-kit');
    expect(JSON.stringify(plan.payload.outputSchema)).toContain('"enum"');
    expect(JSON.stringify(plan.payload)).not.toMatch(/student|學生作答/);
    const kits = decodeClassroomKits(kitRaw(ids.map(id => kitFixture(design, id))), design, ids);
    expect(kits[0].worksheet.questions.every(q => q.lines === 4)).toBe(true);
  });
  it('一次列出所有問題：題數不足、活動不符、階段名稱、缺規準列', () => {
    const { ids, design } = setup();
    const raw = kitRaw(ids.map(id => kitFixture(design, id))) as Record<string, { worksheet: { questions: { activityId: string; prompt: string }[]; title: string }; checklist: unknown[] }>;
    const id = ids[0];
    raw[id].worksheet.questions = raw[id].worksheet.questions.slice(0, 2);
    raw[id].checklist = [];
    let message = '';
    try { decodeClassroomKits(raw, design, ids); } catch (error) { message = (error as Error).message; }
    expect(message).toMatch(/^學習單：2 處要修正。/);
    expect(message).toContain('3–5 題');
    expect(message).toContain('每組規準剛好一列');
    const bad = kitRaw(ids.map(i => kitFixture(design, i))) as Record<string, { worksheet: { questions: { activityId: string; prompt: string }[] } }>;
    bad[id].worksheet.questions[0].activityId = 'not-an-activity';
    bad[id].worksheet.questions[1].prompt = '寫出你達到精熟的做法';
    expect(() => decodeClassroomKits(bad, design, ids)).toThrow('活動不在本課相連活動中');
  });
  it('沒有學習單不能確認前測；保存後可確認；確認後鎖定；只能存在前測', () => {
    const { w, p, ids, design, modes } = setup();
    const pre = addScenarioAssessment(w, p.id, 'pre', { aspects: [], scenarioSets: [] }, modes);
    const preId = pre.projects[0].activePreId!;
    expect(() => reviewAssessment(pre, p.id, preId)).toThrow('學習單');
    const kitted = setClassroomKits(pre, p.id, ids.map(id => kitFixture(design, id)));
    const reviewed = reviewAssessment(kitted, p.id, preId);
    expect(() => setClassroomKits(reviewed, p.id, ids.map(id => kitFixture(design, id)))).toThrow('已鎖定');
    const post = addScenarioAssessment(reviewed, p.id, 'post', { aspects: [], scenarioSets: [] }, modes);
    const bad = structuredClone(post); bad.projects[0].assessments.find(a => a.id === bad.projects[0].activePostId)!.classroomKits = ids.map(id => kitFixture(design, id));
    expect(() => validateWorkspace(bad)).toThrow('只存在前測');
  });
  it('重新產生前測（同設計、同課中觀察子指標）沿用上一份學習單', () => {
    const { w, p, ids, design, modes } = setup();
    const first = addScenarioAssessment(w, p.id, 'pre', { aspects: [], scenarioSets: [] }, modes);
    const kitted = setClassroomKits(first, p.id, ids.map(id => kitFixture(design, id)));
    const again = addScenarioAssessment(kitted, p.id, 'pre', { aspects: [], scenarioSets: [] }, modes);
    const pre = again.projects[0].assessments.find(a => a.id === again.projects[0].activePreId)!;
    expect(pre.id).not.toBe(first.projects[0].activePreId);
    expect(pre.classroomKits?.map(k => k.indicatorId)).toEqual(ids);
  });
  it('文件：學生卷有學習單與作答線、不顯示階段；教師手冊有勾選表與四階行為；後測不重複學習單', async () => {
    const { buildDocument } = await import('../documents/model');
    const { w, p, ids, design, modes } = setup();
    const pre = setClassroomKits(addScenarioAssessment(w, p.id, 'pre', { aspects: [], scenarioSets: [] }, modes), p.id, ids.map(id => kitFixture(design, id)));
    const student = buildDocument(pre.projects[0], 'student', { studentPhase: 'pre' }).blocks;
    const studentText = student.map(b => b.text).join('\n');
    expect(studentText).toContain('課堂學習單：課堂學習單');
    expect(student.some(b => (b as { answerLines?: number }).answerLines === 4)).toBe(true);
    expect(studentText).not.toMatch(/證據有限|萌芽|精熟/);
    const reviewed = reviewAssessment(pre, p.id, pre.projects[0].activePreId!);
    const teacher = JSON.stringify(buildDocument(reviewed.projects[0], 'teacher', { teacherPhase: 'pre' }).blocks);
    expect(teacher).toContain('課堂表現勾選表');
    expect(teacher).toContain('檢查變因並提出追加資料');
  });
});

describe('R41 情境題 3 題＋延伸題', () => {
  it('請求要求每個子指標 3 題與 extension；缺延伸題即拒收；延伸題含階段名稱拒收', () => {
    const { w, ids } = setup();
    const fixture = scenarioFixture(w, 'pre', ids);
    expect(fixture.scenarioSets[0].items).toHaveLength(3);
    expect(fixture.scenarioSets[0].extension?.prompt).toContain('回顧前面三題');
    const plan = buildScenarioPlan('p', fixture.aspects, 'pre', {}, 's');
    expect(JSON.stringify(plan.payload.outputSchema)).toContain('"extension"');
    expect(plan.instructions).toMatch(/延伸題/);
    const aspects = decodeAspects({ [ids[0]]: [1, 2, 3].map(n => ({ label: `面向${n}`, description: '說明。' })) }, [ids[0]]);
    const raw = { [ids[0]]: Object.fromEntries(fixture.scenarioSets[0].items.map((item, i) => [`A${i + 1}`, { scenario: item.scenario, prompt: item.prompt, reasonPrompt: item.reasonPrompt, anchors: { limited: '一', emerging: '二', developing: '三', proficient: '四' },
      options: Object.fromEntries(['limited', 'emerging', 'developing', 'proficient'].map((k, s) => [k, item.options.find(o => o.stage === s)!.text])) }])) };
    expect(() => decodeScenarioSets(raw, aspects, 'x')).toThrow('延伸題');
    const withExt = { [ids[0]]: { ...raw[ids[0]], extension: { prompt: '說明你為什麼選精熟的做法', anchors: { limited: '一', emerging: '二', developing: '三', proficient: '四' } } } };
    expect(() => decodeScenarioSets(withExt, aspects, 'x')).toThrow('階段名稱');
    const good = { [ids[0]]: { ...raw[ids[0]], extension: { prompt: '回顧前三題，挑一題說明為什麼這樣選。', anchors: { limited: '一', emerging: '二', developing: '三', proficient: '四' } } } };
    expect(decodeScenarioSets(keepPassingItems(withExt, aspects, JSON.stringify(good)), aspects, 'x')[0].extension?.prompt).toContain('回顧前三題');
  });
});
