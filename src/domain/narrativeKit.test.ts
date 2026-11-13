import { describe, expect, it } from 'vitest';
import { suggestedEvidence, suggestedMode } from '../data/assessability';
import { reviewAssessment } from './lifecycle';
import { buildNarrativeKitPlan, decodeNarrativeKits, NARRATIVE_FIXED_NOTE, NARRATIVE_UNJUDGABLE_NOTE, type NarrativeKit } from './narrativeKit';
import { addScenarioAssessment, setNarrativeKits } from './scenarioAssessment';
import { scenarioReady } from './scenarioAssessment.test-helper';
import { validateWorkspace } from './validate';
import { parseBackup, serializeWorkspaceBackup } from '../storage/workspace';
import type { DesignVersion } from './types';
import type { ModeChoice } from './thresholdSet';

function fixture(design: DesignVersion, indicatorId: string): NarrativeKit {
  const criteria = design.criteria.filter(row => row.indicatorId === indicatorId);
  const checklist = criteria.map(row => ({ criterionId: row.id, focus: '觀察學生如何引用活動中的資料與他人發言', behaviors: ['只描述一件看到的事', '提到自己做過的步驟', '比較兩種做法的差異', '依情境調整做法並說明依據'] as [string, string, string, string] }));
  const question = (role: NarrativeKit['pre'][number]['role'], index: number) => ({ role, ...(role === 'life-scenario' ? { scenario: '放學後你和同學經過社區公園，看到有人在整理花圃，也有人隨手丟下飲料杯，旁邊的告示牌寫著請保持整潔。' } : {}), prompt: `第 ${index} 題請說明你的想法與做法。`, recall: '想想一個你看過、參與過或可能遇到的情況。', steps: [1, 2, 3].map(n => ({ prompt: `第 ${n} 段請寫出一項具體事情。`, starter: `我想到的是……` })) });
  return { indicatorId, anchors: ['只描述片段，沒有交代依據', '說出一項做法與原因', '比較做法並連結情境條件', '依情境調整做法並說明取捨'] as [string, string, string, string],
    pre: [question('experience', 1), question('life-scenario', 2)], post: [question('participation', 1), question('change', 2)], checklist };
}
function raw(kit: NarrativeKit) {
  const encode = (questions: NarrativeKit['pre']) => questions.map(question => ({ ...question, steps: question.steps.map(step => ({ ...step })) }));
  return { [kit.indicatorId]: { pre: encode(kit.pre), post: encode(kit.post), anchors: { limited: kit.anchors[0], emerging: kit.anchors[1], developing: kit.anchors[2], proficient: kit.anchors[3] }, checklist: kit.checklist.map(row => ({ criterionId: row.criterionId, focus: row.focus, behaviors: { limited: row.behaviors[0], emerging: row.behaviors[1], developing: row.behaviors[2], proficient: row.behaviors[3] } })) } };
}

describe('R43 方式 F 經驗敘述＋參與紀錄', () => {
  it('合格回應可解析；計畫傳送規準、活動與四階原文，固定文字由程式提供', () => {
    const workspace = scenarioReady(), project = workspace.projects[0], design = project.designs.find(row => row.id === project.activeDesignId)!;
    const id = project.input.indicatorIds[0], kit = fixture(design, id);
    const plan = buildNarrativeKitPlan(project.id, design, [id], { subject: '化學' }, 'signature');
    expect(plan.payload.task).toBe('draft-narrative-kit');
    expect(JSON.stringify(plan.payload)).toContain('progression');
    expect(decodeNarrativeKits(raw(kit), design, [id])[0].pre).toHaveLength(2);
    expect(NARRATIVE_FIXED_NOTE).toBe('沒有相關經驗也可以，寫你看過別人怎麼做，或你會怎麼想。');
    expect(NARRATIVE_UNJUDGABLE_NOTE).toContain('只寫沒有經驗');
  });
  it('一次列出所有缺漏與違規：recall、steps、starter、學生階段詞、態度詞與分數錨點', () => {
    const workspace = scenarioReady(), project = workspace.projects[0], design = project.designs.find(row => row.id === project.activeDesignId)!;
    const kit = fixture(design, project.input.indicatorIds[0]), value = raw(kit), row = value[kit.indicatorId];
    delete (row.pre[0] as Partial<(typeof row.pre)[number]>).recall;
    row.pre[0].steps = row.pre[0].steps.slice(0, 2);
    delete (row.post[0].steps[0] as Partial<(typeof row.post)[number]['steps'][number]>).starter;
    row.post[1].prompt = '請說明你已達到精熟的原因。';
    row.checklist[0].behaviors.limited = '對討論明顯冷漠，不參與';
    row.anchors.limited = '低於 60 分的敘述';
    let message = ''; try { decodeNarrativeKits(value, design, [kit.indicatorId]); } catch (error) { message = (error as Error).message; }
    expect(message).toMatch(/^經驗敘述：/);
    for (const marker of ['回想提示', '3–4 個分段小問題', '句子開頭', '階段名稱', '冷漠', '分數、加總或平均']) expect(message).toContain(marker);
  });
  it('前測確認後後測沿用 F；備份往返和無 narrativeKits 的舊工作區都可驗證', () => {
    const workspace = scenarioReady(), project = workspace.projects[0], design = project.designs.find(row => row.id === project.activeDesignId)!;
    const id = project.input.indicatorIds[0];
    const modes: ModeChoice[] = project.input.indicatorIds.map(indicatorId => ({ indicatorId, suggestedMode: suggestedMode(indicatorId), mode: 'E', evidence: indicatorId === id ? 'narrative' : 'worksheet' }));
    const pre = setNarrativeKits(addScenarioAssessment(workspace, project.id, 'pre', { aspects: [], scenarioSets: [] }, modes), project.id, [fixture(design, id)]);
    const reviewed = reviewAssessment(pre, project.id, pre.projects[0].activePreId!);
    const post = addScenarioAssessment(reviewed, project.id, 'post', { aspects: [], scenarioSets: [] }, modes);
    expect(post.projects[0].assessments.find(row => row.id === post.projects[0].activePostId)?.narrativeKits).toBeUndefined();
    expect(() => validateWorkspace(parseBackup(serializeWorkspaceBackup(post)))).not.toThrow();
    const legacy = structuredClone(workspace); expect(() => validateWorkspace(legacy)).not.toThrow();
  });
  it('六項建議 F、四項建議 E，協作其餘三項仍為情境題', () => {
    const f = ['character-learning-to-learn', 'character-empathy-integrity', 'citizenship-diversity-equity', 'citizenship-sustainability', 'communication-reflection', 'communication-identity-humanity'];
    const e = ['character-grit-resilience', 'collaboration-social-emotional', 'creativity-leadership', 'critical-real-world-action'];
    f.forEach(id => { expect(suggestedMode(id)).toBe('E'); expect(suggestedEvidence(id)).toBe('narrative'); });
    e.forEach(id => { expect(suggestedMode(id)).toBe('E'); expect(suggestedEvidence(id)).toBe('worksheet'); });
    ['collaboration-interdependence', 'collaboration-interpersonal', 'collaboration-team-dynamics'].forEach(id => expect(suggestedMode(id)).not.toBe('E'));
  });
});

describe('R43 F 文件與 Google 表單', () => {
  it('學生卷與前後測表單有三層引導、不洩漏錨點；教師手冊有錨點、勾選表與比較條件', async () => {
    const { buildDocument } = await import('../documents/model');
    const { buildFormSpec } = await import('../google/formSpec');
    const workspace = scenarioReady(), project = workspace.projects[0], design = project.designs.find(row => row.id === project.activeDesignId)!;
    const ids = project.input.indicatorIds;
    const modes: ModeChoice[] = ids.map(indicatorId => ({ indicatorId, suggestedMode: suggestedMode(indicatorId), mode: 'E', evidence: 'narrative' }));
    let pre = addScenarioAssessment(workspace, project.id, 'pre', { aspects: [], scenarioSets: [] }, modes);
    pre = setNarrativeKits(pre, project.id, ids.map(indicatorId => fixture(design, indicatorId)));
    const reviewedPre = reviewAssessment(pre, project.id, pre.projects[0].activePreId!);
    const withPost = addScenarioAssessment(reviewedPre, project.id, 'post', { aspects: [], scenarioSets: [] }, modes);
    const paired = reviewAssessment(withPost, project.id, withPost.projects[0].activePostId!);
    const active = paired.projects[0];
    const student = buildDocument(active, 'student', { studentPhase: 'pre' }).blocks.map(block => block.text).join('\n');
    expect(student).toContain('回想提示：'); expect(student).toContain('句子開頭：'); expect(student).toContain(NARRATIVE_FIXED_NOTE);
    expect(student).not.toContain('判讀錨點'); expect(student).not.toContain('課堂表現勾選表');
    const teacher = buildDocument(active, 'teacher').blocks.map(block => block.text).join('\n');
    expect(teacher).toContain('判讀錨點（前後測共用；依學生敘述判讀）');
    expect(teacher).toContain('課堂表現勾選表'); expect(teacher).toContain('比較條件待確認');
    const preForm = buildFormSpec(active, 'pre'), postForm = buildFormSpec(active, 'post');
    for (const spec of [preForm, postForm]) {
      const text = JSON.stringify(spec);
      expect(text).toContain('我想到的是');
      expect(text).not.toContain('判讀錨點'); expect(text).not.toContain('課堂表現勾選表');
      expect(spec.entries.filter(entry => entry.kind === 'section').length).toBeGreaterThanOrEqual(2);
    }
    // R43 實跑：固定句只在前測經驗題；F 題號與情境題 1-1 區隔。
    expect(JSON.stringify(preForm)).toContain(NARRATIVE_FIXED_NOTE);
    expect(JSON.stringify(postForm)).not.toContain(NARRATIVE_FIXED_NOTE);
    expect(preForm.entries.some(entry => entry.kind === 'section' && /^敘述 /.test(entry.title))).toBe(true);
    expect(postForm.entries.some(entry => entry.kind === 'section' && /^參與 /.test(entry.title))).toBe(true);
  });
});

describe('R43 Codex 複審修正', () => {
  const setup = () => {
    const workspace = scenarioReady(), project = workspace.projects[0], design = project.designs.find(row => row.id === project.activeDesignId)!;
    const id = project.input.indicatorIds[0];
    return { workspace, project, design, id };
  };
  it('第 3 項：錨點夾帶計點、累計、級距或量表即退件', () => {
    const { design, id } = setup();
    for (const rule of ['每提到一項線索記 1 點', '用 0–3 級累計判斷', '依量表給等第', '提到兩個以上線索給 2 點']) {
      const kit = fixture(design, id); kit.anchors = [rule, kit.anchors[1], kit.anchors[2], kit.anchors[3]];
      expect(() => decodeNarrativeKits(raw(kit), design, [id]), rule).toThrow('不得寫成分數、加總或平均');
    }
  });
  it('第 4 項：生活情境題必須有 40–300 字情境；有數字要標模擬資料；其他題不保存 scenario', () => {
    const { design, id } = setup();
    const missing = fixture(design, id); delete missing.pre[1].scenario;
    expect(() => decodeNarrativeKits(raw(missing), design, [id])).toThrow('生活情境要');
    const numbers = fixture(design, id); numbers.pre[1].scenario = '班上統計發現 12 位同學每天自備水壺，另外 20 位同學常買瓶裝水，老師請大家想想原因與可以怎麼做。';
    expect(() => decodeNarrativeKits(raw(numbers), design, [id])).toThrow('（模擬資料）');
    numbers.pre[1].scenario += '（模擬資料）';
    const ok = decodeNarrativeKits(raw(numbers), design, [id])[0];
    expect(ok.pre[1].scenario).toContain('（模擬資料）');
    expect(ok.pre[0].scenario).toBeUndefined();
  });
  it('第 2 項：重新產生前測時，F 改成 E 的子指標不沿用經驗敘述', () => {
    const { workspace, project, design, id } = setup();
    const asF: ModeChoice[] = [{ indicatorId: id, suggestedMode: suggestedMode(id), mode: 'E', evidence: 'narrative' }];
    const first = setNarrativeKits(addScenarioAssessment(workspace, project.id, 'pre', { aspects: [], scenarioSets: [] }, asF), project.id, [fixture(design, id)]);
    const sameF = addScenarioAssessment(first, project.id, 'pre', { aspects: [], scenarioSets: [] }, asF).projects[0];
    expect(sameF.assessments.find(a => a.id === sameF.activePreId)!.narrativeKits).toHaveLength(1);
    const asE: ModeChoice[] = [{ ...asF[0], evidence: 'worksheet' }];
    const switched = addScenarioAssessment(first, project.id, 'pre', { aspects: [], scenarioSets: [] }, asE).projects[0];
    expect(switched.assessments.find(a => a.id === switched.activePreId)!.narrativeKits).toBeUndefined();
  });
});
