import { describe, expect, it } from 'vitest';
import { suggestedMode } from '../data/assessability';
import { reviewAssessment } from './lifecycle';
import { validateWorkspace } from './validate';
import { parseBackup, serializeWorkspaceBackup } from '../storage/workspace';
import { addScenarioAssessment } from './scenarioAssessment';
import type { ModeChoice } from './thresholdSet';
import { scenarioFixture, scenarioReady } from './scenarioAssessment.test-helper';

describe('R33 情境進程題保存', () => {
  it('前測（含一個方式 E）→ 確認 → 後測沿用面向、換情境；可備份往返', () => {
    const w = scenarioReady(), p = w.projects[0];
    const ids = p.input.indicatorIds;
    const modes: ModeChoice[] = ids.map((indicatorId, i) => ({ indicatorId, suggestedMode: suggestedMode(indicatorId), mode: i === 1 ? 'E' : 'B' }));
    const scenarioIds = modes.filter(m => m.mode !== 'E').map(m => m.indicatorId);
    const pre = scenarioFixture(w, 'pre', scenarioIds);
    const first = addScenarioAssessment(w, p.id, 'pre', pre, modes);
    const saved = first.projects[0].assessments.find(a => a.id === first.projects[0].activePreId)!;
    expect(saved.format).toBe('scenario-progression-v1');
    expect(saved.scenarioSets![0].items).toHaveLength(3);
    expect(saved.sets!.map(s => s.mode)).toEqual(ids.length > 1 ? ['E'] : []);
    expect(() => addScenarioAssessment(first, p.id, 'post', { ...scenarioFixture(first, 'post', scenarioIds), aspects: pre.aspects }, modes)).toThrow('先確認前測');
    const reviewed = reviewAssessment(parseBackup(serializeWorkspaceBackup(first)), p.id, saved.id);
    const post = { ...scenarioFixture(reviewed, 'post', scenarioIds), aspects: pre.aspects };
    const paired = addScenarioAssessment(reviewed, p.id, 'post', post, modes);
    const postSaved = paired.projects[0].assessments.find(a => a.id === paired.projects[0].activePostId)!;
    expect(postSaved.parentPreId).toBe(saved.id);
    expect(() => validateWorkspace(parseBackup(serializeWorkspaceBackup(paired)))).not.toThrow();
    const sameScenario = structuredClone(paired);
    sameScenario.projects[0].assessments.find(a => a.id === postSaved.id)!.scenarioSets![0].items[0].scenario = saved.scenarioSets![0].items[0].scenario;
    expect(() => validateWorkspace(sameScenario)).toThrow('沿用了前測的情境');
    const otherAspects = { ...post, aspects: post.aspects.map(a => ({ ...a, aspects: a.aspects.map(x => ({ ...x, label: x.label + '改' })) })) };
    expect(() => addScenarioAssessment(reviewed, p.id, 'post', otherAspects, modes)).toThrow('沿用前測的面向');
  });
});

describe('R33 情境進程題文件', () => {
  it('學生卷只有情境、做法與理由題，不顯示階段與錨點；教師手冊附階段、錨點、判讀說明與面向彙整表', async () => {
    const { buildDocument } = await import('../documents/model');
    const w = scenarioReady(), p = w.projects[0], ids = p.input.indicatorIds;
    const modes: ModeChoice[] = ids.map(indicatorId => ({ indicatorId, suggestedMode: suggestedMode(indicatorId), mode: 'B' }));
    const first = addScenarioAssessment(w, p.id, 'pre', scenarioFixture(w, 'pre', ids), modes);
    const project = first.projects[0];
    const student = buildDocument(project, 'student', { studentPhase: 'pre' }).blocks.map(b => b.text).join('\n');
    expect(student).toContain('生活情境 A1。');
    expect(student).toContain('你會怎麼做？為什麼？');
    expect(student).not.toMatch(/（(證據有限|萌芽|發展|精熟)）|判讀錨點|錨點我會/);
    const reviewed = reviewAssessment(first, p.id, project.activePreId!).projects[0];
    const teacher = buildDocument(reviewed, 'teacher', { teacherPhase: 'pre' }).blocks.map(b => b.text).join('\n');
    expect(teacher).toContain('（精熟）');
    expect(teacher).toContain('NPDL 原文：');
    expect(teacher).toContain('判讀錨點（依理由判讀；選項只作參考）');
    expect(teacher).toContain('情境進程題不看對錯');
    expect(JSON.stringify(buildDocument(reviewed, 'teacher', { teacherPhase: 'pre' }).blocks)).toContain('整體位置（教師整體判斷）');
  });
});
