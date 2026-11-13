import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { suggestedEvidence, suggestedMode } from '../data/assessability';
import { scenarioReady } from '../domain/scenarioAssessment.test-helper';
import { defaultModes } from '../domain/thresholdSet';
import { ModePicker, modePickerValue, modeChoiceFromPickerValue } from './ModePicker';
import { classroomKitButtonLabel } from './ScenarioPanel';

describe('ModePicker R43', () => {
  it('預設依建議帶出情境題、學習單或經驗敘述', () => {
    ([['character-learning-to-learn', 'narrative'], ['character-grit-resilience', 'worksheet'], ['citizenship-global-perspective', 'scenario']] as const).forEach(([id, kind]) => {
        const suggested = suggestedMode(id);
        const row = { indicatorId: id, suggestedMode: suggested, mode: suggested === 'E' ? 'E' as const : 'B' as const, ...(suggested === 'E' ? { evidence: suggestedEvidence(id) } : {}) };
        expect(modePickerValue(row)).toBe(kind);
      });
  });

  it('畫面列出三種測驗方式並標示建議', () => {
    const project = scenarioReady().projects[0];
    const ids = ['character-empathy-integrity', 'character-grit-resilience', 'critical-evaluate-information'];
    project.input.indicatorIds = ids;
    const design = project.designs.find(row => row.id === project.activeDesignId)!;
    design.inputSnapshot = { ...design.inputSnapshot, indicatorIds: ids };
    const markup = renderToStaticMarkup(createElement(ModePicker, { project, value: null, onChange: () => {} }));
    expect(markup).toContain('情境進程題（3 題選擇附理由＋1 題延伸）');
    expect(markup).toContain('課堂學習單＋表現勾選表（不出情境題）');
    expect(markup).toContain('經驗敘述＋參與紀錄（不出情境題）');
    expect(markup).toContain('aria-label="表現同理、惻隱之心和正直的行為的測驗方式"');
    expect(markup).toContain('經驗敘述');
    expect(markup).toContain('課中觀察');
  });

  it('改選經驗敘述時保留 evidence', () => {
    const base = defaultModes(scenarioReady().projects[0])[0];
    const next = modeChoiceFromPickerValue(base, 'narrative');
    expect(next.mode).toBe('E');
    expect(next.evidence).toBe('narrative');
    expect(suggestedMode(base.indicatorId)).toBe(suggestedMode(next.indicatorId));
    expect(suggestedEvidence(base.indicatorId)).toBeDefined();
  });

  it('課中材料按鈕文字依 E／F 組合', () => {
    const mk = (id: string) => {
      const suggested = suggestedMode(id);
      return { indicatorId: id, suggestedMode: suggested, mode: 'E' as const, evidence: suggestedEvidence(id) };
    };
    expect(classroomKitButtonLabel([mk('character-grit-resilience')])).toContain('學習單');
    expect(classroomKitButtonLabel([modeChoiceFromPickerValue(mk('character-learning-to-learn'), 'narrative')])).toContain('經驗敘述');
    expect(classroomKitButtonLabel([
      modeChoiceFromPickerValue(mk('character-grit-resilience'), 'worksheet'),
      modeChoiceFromPickerValue(mk('character-learning-to-learn'), 'narrative'),
    ])).toBe('請 AI 產生課中評量材料');
  });
});
