import { describe, expect, it } from 'vitest';
import { suggestedMode } from '../data/assessability';
import { reviewAssessment } from '../domain/lifecycle';
import { addScenarioAssessment, setClassroomKits } from '../domain/scenarioAssessment';
import { kitFixture, scenarioReady } from '../domain/scenarioAssessment.test-helper';
import type { ModeChoice } from '../domain/thresholdSet';
import { buildDocument, documentMarkdown } from './model';
import { WORKSHEET_RULE } from './setJudgment';

// R45（2026-11-17 使用者決定）：情境進程題題本的課堂學習單不附學生自評，教師手冊不再寫「學生自評核對」。
function worksheetPair() {
  const w = scenarioReady(), p = w.projects[0], ids = p.input.indicatorIds;
  const design = p.designs.find(d => d.id === p.activeDesignId)!;
  const modes: ModeChoice[] = ids.map(indicatorId => ({ indicatorId, suggestedMode: suggestedMode(indicatorId), mode: 'E', evidence: 'worksheet' }));
  const pre = addScenarioAssessment(w, p.id, 'pre', { aspects: [], scenarioSets: [] }, modes);
  const kitted = setClassroomKits(pre, p.id, ids.map(id => kitFixture(design, id)));
  const reviewed = reviewAssessment(kitted, p.id, kitted.projects[0].activePreId!);
  const post = addScenarioAssessment(reviewed, p.id, 'post', { aspects: [], scenarioSets: [] }, modes);
  return reviewAssessment(post, p.id, post.projects[0].activePostId!).projects[0];
}

describe('R45：課堂學習單不附自評的說法', () => {
  it('教師手冊不寫學生自評，改用學習單與勾選表的判讀規則', () => {
    const teacher = documentMarkdown(buildDocument(worksheetPair(), 'teacher'));
    expect(teacher).not.toContain('自評');
    expect(teacher).toContain(WORKSHEET_RULE);
    expect(teacher).toContain('課堂學習單與表現勾選表見前測部分，前後測共用');
  });
  it('學生後測說明學習單沿用前測題本，不說「完成下方學習單」', () => {
    const project = worksheetPair();
    const pre = documentMarkdown(buildDocument(project, 'student', { studentPhase: 'pre' }));
    const post = documentMarkdown(buildDocument(project, 'student', { studentPhase: 'post' }));
    expect(pre).toContain('請在課堂活動中完成下方學習單');
    expect(post).toContain('課堂學習單在前測題本中，前後測共用同一份');
    expect(post).not.toContain('完成下方學習單');
  });
});
