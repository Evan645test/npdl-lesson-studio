import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { effectiveModes, hasPendingAssessmentModes, ModePicker } from '../next/ModePicker';
import { SetPairView } from '../next/SetPairView';
import { createSeed } from '../data/seed';
import { confirmDesign, confirmRules, reviewAssessment, reviewIndicators } from './lifecycle';
import { inputSignature, validateWorkspace } from './validate';
import { addSeparateSetPhase, buildSeparatePrePlan, buildSeparatePostPlan, addGeneratedSetPair, addRegeneratedSetPhase, buildConfirmedSetPairPlan, buildConfirmedSetPhasePlan, buildSetPairPlan, buildSetPhasePlan, completenessProblem, cueProblem, estimateMinutes, planAssessmentBlueprint, setWarnings } from './thresholdSet';
import { plainProblem } from '../next/uxText';
import { sampleSet } from './thresholdSet.test-helper';
import type { SetMode, Workspace } from './types';
import { suggestedMode, modeNotice } from '../data/assessability';
import type { ModeChoice } from './thresholdSet';
import { buildDocument, documentMarkdown } from '../documents/model';
import { buildPrompt } from '../documents/prompt';
import { buildLessonOverview } from '../documents/lessonOverview';
import { parseBackup, serializeWorkspaceBackup } from '../storage/workspace';
import { strategiesFor } from './assessmentStrategy';
import { newItemBlueprint, validateItemBlueprint } from './itemBlueprint';
import { rememberConsent, consentReason, revokeAllConsent } from '../services/consentMemory';

function ready(): Workspace { const seed = createSeed(); const id = seed.activeProjectId; const next = confirmDesign(confirmRules(reviewIndicators(seed, id), id), id); next.projects[0].workflow = 'single-v1'; next.projects[0].assessments[1].reflection = []; return next; }
function modes(workspace: Workspace, mode: SetMode = 'B'): ModeChoice[] {
  return workspace.projects[0].input.indicatorIds.map(indicatorId => ({ indicatorId, mode, suggestedMode: suggestedMode(indicatorId) }));
}
function setsFor(workspace: Workspace, variant: string, mode: SetMode = 'B') {
  const project = workspace.projects[0], design = project.designs.find(d => d.id === project.activeDesignId)!;
  return { sets: design.inputSnapshot.indicatorIds.map(id => sampleSet(id, design.criteria.filter(c => c.indicatorId === id).map(c => c.id), variant, mode, suggestedMode(id), design.activities.slice(0, 1).map(a => a.id))) };
}
function withPair(mode: SetMode = 'B') { const w = ready(); return addGeneratedSetPair(w, w.projects[0].id, { pre: setsFor(w, '前測', mode), post: setsFor(w, '後測', mode) }, modes(w, mode)); }

describe('門檻題組：保存與驗證', () => {
  it('成對產生後存成新格式前後測，不含舊格式題目、課程應用與自評', () => {
    const next = withPair(), project = next.projects[0];
    const pre = project.assessments.find(a => a.id === project.activePreId)!, post = project.assessments.find(a => a.id === project.activePostId)!;
    expect(pre.format).toBe('threshold-set-v1'); expect(post.parentPreId).toBe(pre.id);
    expect([pre, post].every(a => !a.capability.length && !a.application.length && !a.reflection.length)).toBe(true);
    expect(pre.sets).toHaveLength(project.input.indicatorIds.length);
  });
  it('子指標與規準由程式依設計補回，AI 寫錯編號仍可保存', () => {
    const w = ready(), pre = setsFor(w, '前測'), post = setsFor(w, '後測');
    pre.sets.forEach(s => { s.indicatorId = '亂寫'; s.criterionIds = ['亂寫']; });
    const project = addGeneratedSetPair(w, w.projects[0].id, { pre, post }, modes(w)).projects[0];
    const saved = project.assessments.find(a => a.id === project.activePreId)!;
    expect(saved.sets!.map(s => s.indicatorId)).toEqual(project.input.indicatorIds);
  });
  it('門檻順序不是 2–2–1 時退回', () => {
    const w = ready(), pre = setsFor(w, '前測');
    pre.sets[0].choices[4].threshold = '萌芽→發展';
    expect(() => addGeneratedSetPair(w, w.projects[0].id, { pre, post: setsFor(w, '後測') }, modes(w))).toThrow('發展→精熟');
  });
  it('門檻以上的選項不是恰好一個時退回', () => {
    const w = ready(), pre = setsFor(w, '前測');
    pre.sets[0].choices[0].options[1].above = true;
    expect(() => addGeneratedSetPair(w, w.projects[0].id, { pre, post: setsFor(w, '後測') }, modes(w))).toThrow('恰好 1 個');
  });
  it('前後測情境相同時退回', () => {
    const w = ready(), pre = setsFor(w, '前測'), post = setsFor(w, '前測');
    post.sets.forEach(s => { s.data = s.data + '（後測）'; });
    expect(() => addGeneratedSetPair(w, w.projects[0].id, { pre, post }, modes(w))).toThrow('情境文字完全相同');
  });
  it('題本中途截斷（題數不足）時以白話原因退回', () => {
    const w = ready(), pre = setsFor(w, '前測');
    pre.sets[0].choices = pre.sets[0].choices.slice(0, 3);
    expect(() => addGeneratedSetPair(w, w.projects[0].id, { pre, post: setsFor(w, '後測') }, modes(w))).toThrow('可能在中途被截斷');
    expect(completenessProblem({ sets: [] }, modes(w))).toContain('只收到 0 組');
  });
  it('重寫前測時沿用目前後測另存一版', () => {
    const w = withPair(), id = w.projects[0].id;
    const next = addRegeneratedSetPhase(w, id, 'pre', setsFor(w, '新前測'), modes(w)).projects[0];
    const pre = next.assessments.find(a => a.id === next.activePreId)!, post = next.assessments.find(a => a.id === next.activePostId)!;
    expect(pre.sets![0].context).toContain('新前測'); expect(post.parentPreId).toBe(pre.id); expect(post.sets![0].context).toContain('後測');
  });
  it('舊格式資料照常通過驗證', () => { expect(() => validateWorkspace(createSeed())).not.toThrow(); });
});

describe('門檻題組：請求與提醒', () => {
  it('提示詞寫明 2–2–1、四選一、三段非選題、不限字數且不含課程應用與自評', () => {
    const plan = buildSetPairPlan(ready().projects[0]);
    expect(plan.instructions).toContain('證據有限→萌芽、證據有限→萌芽、萌芽→發展、萌芽→發展、發展→精熟'); expect(plan.instructions).toContain('恰好 4 個選項');
    expect(plan.instructions).toContain('不要自評、課程應用題'); expect(plan.instructions).not.toMatch(/\d+\s*字(內|以內)/);
    expect(JSON.stringify(plan.payload.outputSchema)).toContain('"above"');
  });
  it('選項含評價字眼時提醒，不退回', () => {
    const w = withPair(), project = w.projects[0], pre = project.assessments.find(a => a.id === project.activePreId)!;
    pre.sets![0].choices[0].options[0].text = '最能展現利他精神的做法';
    expect(setWarnings(pre).join()).toContain('最能展現');
  });
  it('門檻以上選項都在同一位置時提醒', () => {
    const w = withPair(), project = w.projects[0], pre = project.assessments.find(a => a.id === project.activePreId)!;
    expect(setWarnings(pre).join()).not.toContain('同一個位置');
    pre.sets![0].choices.forEach(c => c.options.forEach((o, i) => { o.above = i === 0; }));
    expect(setWarnings(pre).join()).toContain('同一個位置');
    expect(buildSetPairPlan(ready().projects[0]).instructions).toContain('代號要在各題間分散');
  });
  it('錯誤選項有絕對字眼、正確選項沒有時提醒；兩邊都有則不提醒', () => {
    const w = withPair(), project = w.projects[0], pre = project.assessments.find(a => a.id === project.activePreId)!;
    const choice = pre.sets![0].choices[0], wrong = choice.options.find(o => !o.above)!, right = choice.options.find(o => o.above)!;
    wrong.text = '來源不明，所以這個論點一定是錯的';
    expect(setWarnings(pre).join()).toContain('絕對字眼（一定）');
    right.text = '這個論點不一定成立，因為樣本只有一間學校';
    expect(setWarnings(pre).join()).not.toContain('絕對字眼');
  });
  it('提示詞要求錯誤選項只差本門檻一步、精熟段依子指標精熟描述寫判讀特徵', () => {
    const text = buildSetPairPlan(ready().projects[0]).instructions;
    expect(text).toContain('錯誤選項的缺點必須屬於本題門檻以下的表現');
    expect(text).toContain('引用了資料但讀錯或用錯');
    expect(text).toContain('依該子指標的精熟描述寫出具體表現');
    expect(text).toContain('並指出在什麼條件下不成立');
  });
  it('題幹「應選擇哪兩列」不算洩漏；「應選 B」才算', async () => {
    const { studentLeakProblem } = await import('./thresholdSet');
    const w = withPair(), project = w.projects[0], pre = project.assessments.find(a => a.id === project.activePreId)!;
    pre.sets![0].choices[0].prompt = '依表中資料，應選擇哪兩列進行比較？';
    expect(studentLeakProblem(pre.sets!)).toBeNull();
    pre.sets![0].choices[0].prompt = '這題應選 B';
    expect(studentLeakProblem(pre.sets!)).toContain('答案或判讀資訊');
  });
  it('正確選項明顯較長或多數題最長時提醒；長度相近不提醒', () => {
    const w = withPair(), project = w.projects[0], pre = project.assessments.find(a => a.id === project.activePreId)!;
    expect(setWarnings(pre).join()).not.toMatch(/長度|最長|明顯比錯誤選項長/);
    const set = pre.sets![0];
    set.choices.forEach(c => c.options.forEach(o => { o.text = o.above ? '在表中三列相同條件下趨勢成立，表外情況尚未說明' : '趨勢成立可以推廣到其他條件吧'; }));
    expect(setWarnings(pre).join()).toContain('明顯比錯誤選項長');
    set.choices.forEach(c => c.options.forEach(o => { o.text = o.above ? '三列條件相同時，趨勢成立。' : '三列條件相同時趨勢不成立'; }));
    expect(setWarnings(pre).join()).toContain('正確選項是最長的');
  });
  it('「都會」「任何」也算絕對字眼', () => {
    const w = withPair(), project = w.projects[0], pre = project.assessments.find(a => a.id === project.activePreId)!;
    pre.sets![0].choices[0].options.find(o => !o.above)!.text = '濃度提高時任何杯子都會變快';
    expect(setWarnings(pre).join()).toContain('絕對字眼（都會、任何）');
  });
  it('提示詞要求錯誤選項同樣謹慎、非選不重問、新資訊不附計算；手冊提醒核對新資訊', () => {
    const text = buildSetPairPlan(ready().projects[0]).instructions;
    expect(text).toContain('保留語氣');
    expect(text).toContain('至少一個錯誤選項的字數要等於或多於正確選項');
    expect(text).toContain('不得重問選擇題已問過的問題');
    expect(text).toContain('不附計算結果、比例或解讀');
    expect(documentMarkdown(buildDocument(withPair().projects[0], 'teacher'))).toContain('施測前請核對非選題最後一段的新資訊');
  });
  it('誘答線索：沒有線索時為 null；有時列出前測或後測、題號與修正方式，教師看到白話說明', () => {
    const w = withPair(), project = w.projects[0];
    const pre = project.assessments.find(a => a.id === project.activePreId)!, post = project.assessments.find(a => a.id === project.activePostId)!;
    expect(cueProblem([pre, post])).toBeNull();
    post.sets![0].choices[1].options.find(o => !o.above)!.text = '只要濃度提高任何杯子都會變快';
    pre.sets![0].choices[3].options.forEach(o => { o.text = o.above ? '在表中三列相同條件下趨勢成立，表外情況尚未說明' : '趨勢成立可以推廣'; });
    const problem = cueProblem([pre, post])!;
    expect(problem).toMatch(/^誘答線索：/);
    expect(problem).toContain('前測第 1 組第 4 題的正確選項明顯比錯誤選項長');
    expect(problem).toContain('後測第 1 組第 2 題的錯誤選項含絕對字眼（都會、任何、只要）');
    expect(problem).toContain('不改題幹、情境、資料、門檻、above 標記');
    expect(plainProblem(problem)).toContain('不讀情境也可能猜到答案');
  });
  it('估時超過 30 分鐘時提醒精簡', () => {
    const w = withPair(), project = w.projects[0], pre = project.assessments.find(a => a.id === project.activePreId)!;
    pre.sets![0].context = '很長的情境。'.repeat(1500);
    expect(estimateMinutes(pre)).toBeGreaterThan(30);
    expect(setWarnings(pre).join()).toContain('超過 30 分鐘');
  });
});

describe('門檻題組：文件', () => {
  it('學生題本只有情境、題目與作答欄，不含門檻、正確選項或參考回答', () => {
    const text = documentMarkdown(buildDocument(withPair().projects[0], 'student'));
    expect(text).toContain('非選題'); expect(text).toContain('所選選項');
    for (const hidden of ['門檻', '✓', '代表的想法', '參考回答', '判讀特徵', '反思', '課程應用']) expect(text).not.toContain(hidden);
  });
  it('教師手冊含門檻標記、判讀規則、精熟判讀表與分兩張卷建議，不含固定反思', () => {
    const text = documentMarkdown(buildDocument(withPair().projects[0], 'teacher'));
    for (const shown of ['門檻題組判讀規則', '【門檻：發展→精熟】', '✓ 門檻以上', '精熟判讀表', '尚無法判讀', '分兩張卷', '情境判斷表現', '估計作答約']) expect(text).toContain(shown);
    expect(text).not.toContain('後測第三部分');
  });
  it('方式 B 手冊先給批閱速查；沒有原建議 E 時不印認知理解警語', () => {
    const text = documentMarkdown(buildDocument(withPair().projects[0], 'teacher'));
    expect(text).toContain('批閱速查');
    expect(text.indexOf('批閱速查')).toBeLessThan(text.indexOf('課程起點'));
    expect(text).not.toContain('認知理解');
    expect(text).not.toContain('完整教師判讀提示詞');
  });
  it('前測選擇與非選、後測各自起頁，選項保持在同一題的區塊', () => {
    const blocks = buildDocument(withPair().projects[0], 'student').blocks;
    expect(blocks.filter(b => 'pageBreakBefore' in b && b.pageBreakBefore).map(b => b.text)).toEqual(expect.arrayContaining([expect.stringContaining('後測'), expect.stringContaining('非選題')]));
    expect(blocks.some(b => 'keepTogether' in b && b.keepTogether && /^［　］ 1\.[\s\S]+A\.[\s\S]+D\./.test(b.text))).toBe(true);
  });
  it('前測、後測各自匯出時不含另一測次的題面', () => {
    const project = withPair().projects[0];
    const pre = documentMarkdown(buildDocument(project, 'student', { studentPhase: 'pre' }));
    const post = documentMarkdown(buildDocument(project, 'student', { studentPhase: 'post' }));
    expect(pre).toContain('前測題本'); expect(pre).not.toContain('後測題本');
    expect(post).toContain('後測題本'); expect(post).not.toContain('前測題本');
  });
  it('方式 C 手冊不印方式 B 專用的第 5 題精熟判讀表', () => {
    const text = documentMarkdown(buildDocument(withPair('C').projects[0], 'teacher'));
    expect(text).toContain('方式 C');
    expect(text).not.toContain('精熟判讀表（第 5 題');
  });
  it('判讀提示詞改用門檻題組規則', () => {
    const prompt = buildPrompt(withPair().projects[0]);
    expect(prompt).toContain('精熟判讀表'); expect(prompt).toContain('不推定低門檻通過'); expect(prompt).not.toContain('五、另行分析課程應用'); expect(prompt).toContain('方式 E 以教師課中觀察為主要證據'); expect(prompt).toContain('不輸出階段、範圍或門檻通過率');
  });
  it('課程一覽以題組配對列出前後測', () => {
    const overview = buildLessonOverview(withPair().projects[0]);
    expect(overview.assessment.preStatus).toContain('組門檻題組'); expect(overview.assessment.pairs[0].post).toContain('後測');
  });
});

describe('門檻題組：Codex 複審修正', () => {
  it('v1 備份夾帶門檻題組欄位時整份拒絕', () => {
    const w = withPair(); const v1 = structuredClone(w) as any; v1.schemaVersion = 1; delete v1.legacyImports;
    for (const p of v1.projects) { delete p.input.teacherNotes; delete p.input.indicatorReview; for (const d of p.designs) { delete d.inputSnapshot.teacherNotes; delete d.inputSnapshot.indicatorReview; d.origin = 'manual-example'; } delete p.workflow; delete p.referencePretest; }
    expect(() => validateWorkspace(v1)).toThrow();
  });
  it('題組的規準必須是該子指標的全部規準', () => {
    const w = withPair(), project = w.projects[0], pre = project.assessments.find(a => a.id === project.activePreId)!;
    const design = project.designs.find(d => d.id === pre.designId)!;
    design.criteria.push({ ...design.criteria[0], id: 'c-extra' });
    expect(() => validateWorkspace(w)).toThrow('全部規準');
  });
  it('子指標標示缺漏或重複時依順序對齊；完整排列時採用 AI 的標示', () => {
    const w = ready(), pre = setsFor(w, '前測'), post = setsFor(w, '後測');
    pre.sets[0].indicatorId = '';
    const project = addGeneratedSetPair(w, w.projects[0].id, { pre, post }, modes(w)).projects[0];
    expect(project.assessments.find(a => a.id === project.activePreId)!.sets!.map(s => s.indicatorId)).toEqual(project.input.indicatorIds);
  });
  it('設計已另存新版時，不能只重寫一份前後測', () => {
    const w = withPair(), project = w.projects[0];
    const design = project.designs.find(d => d.id === project.activeDesignId)!;
    project.designs.push({ ...structuredClone(design), id: 'design-b', rubricVersion: 'npdl-four-v2:design-b' }); project.activeDesignId = 'design-b';
    expect(() => buildSetPhasePlan(project, 'post')).toThrow('課程設計已更新');
  });
  it('學生會看到的文字夾帶答案或門檻時退回', () => {
    const w = ready(), pre = setsFor(w, '前測');
    pre.sets[0].opens[0].steps[0].sentenceStarter = '正確答案是 A，因為……';
    expect(() => addGeneratedSetPair(w, w.projects[0].id, { pre, post: setsFor(w, '後測') }, modes(w))).toThrow('答案或判讀資訊');
  });
  it('教師手冊含作答資料處理規則與空白班級彙整表', () => {
    const text = documentMarkdown(buildDocument(withPair().projects[0], 'teacher'));
    expect(text).toContain('不能自動歸為證據有限'); expect(text).toContain('班級彙整表'); expect(text).toContain('分母');
    expect(text).toContain('不判精熟');
  });
  it('前後測題組高度相似時提醒', () => {
    const w = ready(), pre = setsFor(w, '前測'), post = setsFor(w, '前測');
    post.sets.forEach(s => { s.context = s.context.replace('社區', '社區裡'); s.data = s.data.replace('120', '121'); });
    const project = addGeneratedSetPair(w, w.projects[0].id, { pre, post }, modes(w)).projects[0];
    const [a, b] = [project.activePreId, project.activePostId].map(id => project.assessments.find(x => x.id === id)!);
    expect(setWarnings(b, a).join()).toContain('高度相似');
  });
});

describe('門檻題組：測驗方式 A～E', () => {
  it('A、C、D 依各自的題數與門檻保存', () => {
    for (const [mode, choices, opens] of [['A', 6, 0], ['C', 3, 2], ['D', 0, 2]] as const) {
      const project = withPair(mode).projects[0], pre = project.assessments.find(a => a.id === project.activePreId)!;
      expect(pre.sets![0].mode).toBe(mode); expect(pre.sets![0].choices).toHaveLength(choices); expect(pre.sets![0].opens).toHaveLength(opens);
    }
  });
  it('混合 B／E 成對生成與重寫，依完整子指標編號對齊，不依回應位置猜題型', () => {
    const workspace = ready(), project = workspace.projects[0], design = project.designs.find(d => d.id === project.activeDesignId)!;
    const observedId = 'collaboration-social-emotional';
    for (const input of [project.input, design.inputSnapshot]) {
      input.indicatorIds = [...input.indicatorIds, observedId];
      if (input.indicatorReview?.confirmedAt) input.indicatorReview.signature = inputSignature(input);
    }
    const observedCriterion = 'observed-collaboration';
    design.criteria.push({ ...design.criteria[0], id: observedCriterion, indicatorId: observedId });
    design.integration.push({ ...design.integration[0], indicatorId: observedId, criterionIds: [observedCriterion] });
    const chosen = modes(workspace).map(choice => choice.indicatorId === observedId ? { ...choice, mode: 'E' as const } : choice);
    const response = (variant: string) => {
      const paper = setsFor(workspace, variant, 'B').sets[0];
      const observation = sampleSet(observedId, [observedCriterion], variant, 'E', suggestedMode(observedId), [design.activities[0].id]);
      return { sets: [observation, paper] };
    };
    const paired = addGeneratedSetPair(workspace, project.id, { pre: response('前測生活'), post: response('後測課程') }, chosen);
    const saved = paired.projects[0];
    const pre = saved.assessments.find(a => a.id === saved.activePreId)!;
    const post = saved.assessments.find(a => a.id === saved.activePostId)!;
    const assertMixed = (assessment: typeof pre) => {
      expect(assessment.sets?.map(set => [set.indicatorId, set.mode, set.choices.length, Boolean(set.observation)])).toEqual([
        [chosen[0].indicatorId, 'B', 5, false], [observedId, 'E', 0, true],
      ]);
    };
    assertMixed(pre); assertMixed(post);
    const full = documentMarkdown(buildDocument(saved, 'student', { studentPhase: 'post' }));
    const choiceSheet = documentMarkdown(buildDocument(saved, 'student', { studentPhase: 'post', studentPart: 'choices' }));
    const openSheet = documentMarkdown(buildDocument(saved, 'student', { studentPhase: 'post', studentPart: 'opens' }));
    expect(full).toContain('自評：');
    expect(choiceSheet).toContain('後測課程第1題選項A');
    expect(openSheet).toContain('引導問題');
    for (const split of [choiceSheet, openSheet]) expect(split).not.toContain('自評：');
    const plan = buildSetPhasePlan(saved, 'post');
    const rewritten = addRegeneratedSetPhase(paired, project.id, 'post', response('重寫後測'), plan.payload.modes as ModeChoice[]).projects[0];
    expect(rewritten.activePreId).toBe(pre.id);
    const rewrittenPost = rewritten.assessments.find(a => a.id === rewritten.activePostId)!;
    assertMixed(rewrittenPost);
    expect(rewrittenPost.sets?.[0].context).toContain('重寫後測');
  });
  it('方式與題數不符時退回', () => {
    const w = ready(), pre = setsFor(w, '前測', 'B'), post = setsFor(w, '後測', 'B');
    expect(() => addGeneratedSetPair(w, w.projects[0].id, { pre, post }, modes(w, 'C'))).toThrow();
  });
  it('方式 E 課中評量＋自評：學生題本只有自評，教師手冊有觀察表與核對說明', () => {
    const project = withPair('E').projects[0];
    const student = documentMarkdown(buildDocument(project, 'student')), teacher = documentMarkdown(buildDocument(project, 'teacher'));
    expect(student).toContain('本次沒有紙筆題'); expect(student).toContain('自評'); expect(student).toContain('目前沒有足夠證據'); expect(student).not.toContain('觀察焦點'); expect(student).toContain('班級代號：'); expect(student).not.toContain('看到的事實：');
    expect(teacher).toContain('課中評量＋自評'); expect(teacher).toContain('主要證據'); expect(teacher).toContain('座號'); expect(teacher).toContain('不平均');
  });
  it('原建議為課中觀察卻改用紙筆題時，標為認知理解並記錄原建議', () => {
    const w = ready(), id = w.projects[0].input.indicatorIds[0];
    const choice: ModeChoice[] = [{ indicatorId: id, mode: 'B', suggestedMode: 'E' }];
    const pre = setsFor(w, '前測'), post = setsFor(w, '後測');
    // 測試用：把原建議寫成 E（模擬不適合紙筆的子指標）。
    expect(() => buildSetPairPlan(w.projects[0], '', choice)).toThrow('測驗方式與子指標不符');
    expect(modeNotice('E', 'B')).toContain('認知理解');
    const project = addGeneratedSetPair(w, w.projects[0].id, { pre, post }, modes(w)).projects[0];
    const teacher = documentMarkdown(buildDocument(project, 'teacher'));
    expect(teacher).toContain(`本子指標採方式 B`); expect(teacher).toContain(`原建議為 ${suggestedMode(id)}`);
  });
  it('後測不能單獨改測驗方式', () => {
    const w = withPair('B'), project = w.projects[0], post = project.assessments.find(a => a.id === project.activePostId)!;
    // 結構仍是方式 B，只把方式標記改成與前測不同。
    post.sets![0].suggestedMode = post.sets![0].suggestedMode === 'A' ? 'C' : 'A';
    expect(() => validateWorkspace(w)).toThrow('同一種測驗方式');
  });
  it('重寫單份時沿用目前的方式', () => {
    const w = withPair('C'), plan = buildSetPhasePlan(w.projects[0], 'post');
    expect((plan.payload.modes as ModeChoice[])[0].mode).toBe('C');
  });
  it('原建議 E 改用 B 時，教師手冊標「認知理解」', () => {
    const w = withPair('B'), project = w.projects[0];
    for (const a of project.assessments.filter(x => x.format)) a.sets!.forEach(set => { set.suggestedMode = 'E'; });
    const teacher = documentMarkdown(buildDocument(validateWorkspace(w).projects[0], 'teacher'));
    expect(teacher).toContain('認知理解'); expect(teacher).toContain('原建議為 E');
  });
  it('改選時只提醒不阻擋', () => {
    expect(modeNotice('B', 'A')).toContain('尚無法判讀'); expect(modeNotice('C', 'B')).toContain('自己產出'); expect(modeNotice('B', 'B')).toBeNull();
  });
});

describe('門檻題組：改選方式與估時呈現', () => {
  it('R34：舊門檻題本為唯讀歷史，改選方式不再標記待套用（不擋確認與下載）', () => {
    const w = withPair('B'), project = w.projects[0], chosen = modes(w, 'E');
    expect(hasPendingAssessmentModes(project, null)).toBe(false);
    expect(hasPendingAssessmentModes(project, chosen)).toBe(false);
    for (const legacy of ['A', 'C', 'D'] as const) expect(hasPendingAssessmentModes(withPair(legacy).projects[0], modes(w, 'B'))).toBe(false);
    expect(hasPendingAssessmentModes(project, [{ ...chosen[0], indicatorId: 'different' }])).toBe(false);
    expect(project.assessments.find(a => a.id === project.activePreId)?.sets?.[0].mode).toBe('B');
    expect(effectiveModes(project, null)[0].mode).toBe('B');
    expect(hasPendingAssessmentModes(withPair('E').projects[0], chosen)).toBe(false);
  });
  it('待套用的方式必須與現行設計、目前配對前後測相符', () => {
    const w = withPair('E'), project = w.projects[0], chosen = modes(w, 'B');
    const oldDesign = project.designs.find(d => d.id === project.activeDesignId)!;
    project.designs.push({ ...structuredClone(oldDesign), id: 'new-design', rubricVersion: 'npdl-four-v2:new-design' });
    project.activeDesignId = 'new-design';
    expect(hasPendingAssessmentModes(project, chosen)).toBe(false);
    expect(effectiveModes(project, null)).toEqual(chosen);
    expect(hasPendingAssessmentModes(ready().projects[0], chosen)).toBe(false);
    project.activeDesignId = oldDesign.id;
    const post = project.assessments.find(a => a.id === project.activePostId)!;
    post.parentPreId = 'another-pre';
    expect(hasPendingAssessmentModes(project, chosen)).toBe(false);
  });
  it('純方式 E 的選擇畫面與產出估時計入自評，不顯示紙筆題或紙筆判讀名稱', () => {
    const w = withPair('E'), project = w.projects[0];
    const [pre, post] = [project.activePreId, project.activePostId].map(id => project.assessments.find(a => a.id === id)!);
    const generated = renderToStaticMarkup(createElement(SetPairView, { pre, post }));
    expect(generated).toContain('前測學生自評估計約 5 分鐘');
    expect(generated).not.toContain('紙筆題估計');
    expect(generated).not.toContain('情境判斷表現');
    const picker = renderToStaticMarkup(createElement(ModePicker, { project, value: null, onChange: () => {} }));
    expect(picker).toContain('學生自評粗估約 5 分鐘');
    expect(picker).not.toContain('紙筆題粗估');
    const teacher = documentMarkdown(buildDocument(project, 'teacher'));
    expect(teacher).toContain('學生自評估計約 5 分鐘');
    expect(teacher).not.toContain('情境判斷表現');
  });
  it('混合題組另列紙筆作答與自評時間；觀察時間另依活動安排', () => {
    const paper = withPair('B').projects[0], observe = withPair('E').projects[0];
    const [pre, post] = [paper.activePreId, paper.activePostId].map(id => paper.assessments.find(a => a.id === id)!);
    const [preE, postE] = [observe.activePreId, observe.activePostId].map(id => observe.assessments.find(a => a.id === id)!);
    const paperMinutes = estimateMinutes(pre);
    const mix = (a: typeof pre, b: typeof preE) => ({ ...a, sets: [...a.sets!, { ...b.sets![0], indicatorId: 'creativity-leadership' }] });
    const markup = renderToStaticMarkup(createElement(SetPairView, { pre: mix(pre, preE), post: mix(post, postE) }));
    expect(markup).toContain('前測紙筆題估計約 ' + paperMinutes + ' 分鐘');
    expect(markup).toContain('前測學生自評估計約 5 分鐘');
    expect(markup).toContain('課中觀察時間依活動安排');
    expect(markup).toContain('紙筆題：結果稱為「情境判斷表現」');
  });
});

describe('適合度：較寬的判定', () => {
  it('R43 指定十項預設課中評量，並保留其餘適合度', async () => {
    const { assessabilityOf } = await import('../data/assessability');
    const data = (await import('../data/indicators.json')).default;
    const unsuitable = data.entries.filter(row => assessabilityOf(row.id) === 'unsuitable').map(row => row.id).sort();
    expect(unsuitable).toEqual(['character-empathy-integrity', 'character-grit-resilience', 'character-learning-to-learn', 'citizenship-diversity-equity', 'citizenship-sustainability', 'collaboration-social-emotional', 'communication-identity-humanity', 'communication-reflection', 'creativity-leadership', 'critical-real-world-action']);
    expect(data.entries.filter(row => assessabilityOf(row.id) === 'suitable')).toHaveLength(12);
    expect(suggestedMode('creativity-leadership')).toBe('E'); expect(suggestedMode('citizenship-sustainability')).toBe('E');
  });
});

describe('門檻題組：分科策略與後測情境綁定', () => {
  function withDirection(): Workspace {
    const w = ready(), project = w.projects[0], design = project.designs.find(d => d.id === project.activeDesignId)!;
    for (const input of [project.input, design.inputSnapshot]) {
      input.drivingQuestion = '同樣條件下，哪一筆新紀錄足以支持比較？';
      input.finalProduct = '附上資料與限制的決策備忘錄';
      input.originalSource = { kind: 'teacher', text: '僅本機保留的原教案' };
      input.teacherNotes = '僅本機保留的備課筆記';
      if (input.indicatorReview) input.indicatorReview.signature = inputSignature(input);
    }
    return w;
  }
  it('紙筆題預設傳送已確認的驅動問題與成果，不傳原教案或教師筆記', () => {
    const w = withDirection(), plan = buildSetPairPlan(w.projects[0]);
    expect(plan.payload.assessmentBlueprint).toMatchObject({
      strategy: { id: expect.any(String), evidence: expect.any(String) },
      postAnchor: { kind: 'course', activityId: null, drivingQuestion: '同樣條件下，哪一筆新紀錄足以支持比較？', finalProduct: '附上資料與限制的決策備忘錄' },
    });
    expect(JSON.stringify(plan.payload)).not.toContain('僅本機保留');
  });
  it('教師指定的活動隨成對生成保存；重寫任一份均保留原策略與情境', () => {
    const w = ready(), project = w.projects[0], design = project.designs.find(d => d.id === project.activeDesignId)!;
    const recommended = buildSetPairPlan(project).payload.assessmentBlueprint as { strategyId: string };
    const chosenStrategy = strategiesFor(design.inputSnapshot.subject).find(row => row.id !== recommended.strategyId)!;
    const selection = { strategyId: chosenStrategy.id, postActivityId: design.activities[1].id };
    const plan = buildSetPairPlan(project, '', modes(w), selection);
    expect(plan.payload.assessmentBlueprint).toMatchObject({ ...selection, strategy: { label: chosenStrategy.label, material: chosenStrategy.material }, postAnchor: { kind: 'activity', activityId: selection.postActivityId, label: design.activities[1].name } });
    const saved = addGeneratedSetPair(w, project.id, { pre: setsFor(w, '原前測'), post: setsFor(w, '原後測') }, modes(w), selection);
    const restored = parseBackup(serializeWorkspaceBackup(saved));
    const teacher = documentMarkdown(buildDocument(restored.projects[0], 'teacher'));
    const student = documentMarkdown(buildDocument(restored.projects[0], 'student'));
    expect(teacher).toContain(chosenStrategy.label);
    expect(teacher).toContain('後測情境：第 2 節');
    expect(student).not.toContain(chosenStrategy.label);
    expect(student).not.toContain('後測情境：第 2 節');
    for (const phase of ['pre', 'post'] as const) {
      const rewrite = buildSetPhasePlan(restored.projects[0], phase);
      expect(rewrite.payload.assessmentBlueprint).toEqual(plan.payload.assessmentBlueprint);
      const next = addRegeneratedSetPhase(restored, project.id, phase, setsFor(w, '重寫題目'), modes(w)).projects[0];
      expect(next.assessments.find(a => a.id === next.activePreId)?.assessmentBlueprint).toEqual(selection);
      expect(next.assessments.find(a => a.id === next.activePostId)?.assessmentBlueprint).toEqual(selection);
      const paired = phase === 'pre' ? next.activePostId : next.activePreId;
      expect(next.assessments.find(a => a.id === paired)?.sets?.[0].context).toContain(phase === 'pre' ? '原後測' : '原前測');
    }
  });
  it('拒絕工作區中被替換的情境或不屬於此科的策略', () => {
    const saved = withPair(), project = saved.projects[0];
    const post = project.assessments.find(a => a.id === project.activePostId)!;
    const otherValidActivity = project.designs.find(d => d.id === project.activeDesignId)!.activities[1].id;
    const selection = post.assessmentBlueprint!;
    post.assessmentBlueprint = { ...selection, postActivityId: otherValidActivity };
    expect(() => validateWorkspace(saved)).toThrow('前後測的出題策略與後測情境須一致');
    post.assessmentBlueprint = { ...selection, postActivityId: '已刪除活動' };
    expect(() => validateWorkspace(saved)).toThrow('後測情境活動');
    post.assessmentBlueprint = { ...selection, strategyId: '不相干策略' };
    expect(() => validateWorkspace(saved)).toThrow('評量出題策略');
  });
  it('舊門檻題組單份重寫不補上未確認的情境；方式 E 不送也不存紙筆設定', () => {
    const older = withPair(), p = older.projects[0];
    for (const assessment of p.assessments) delete assessment.assessmentBlueprint;
    const legacy = buildSetPhasePlan(p, 'pre');
    expect(legacy.payload.assessmentBlueprint).toBeUndefined();
    const next = addRegeneratedSetPhase(older, p.id, 'pre', setsFor(older, '舊題組重寫'), modes(older));
    expect(next.projects[0].assessments.every(a => !a.assessmentBlueprint)).toBe(true);
    const observation = withPair('E');
    expect(buildSetPairPlan(observation.projects[0], '', modes(observation, 'E')).payload.assessmentBlueprint).toBeUndefined();
    expect(buildSetPhasePlan(observation.projects[0], 'post').payload.assessmentBlueprint).toBeUndefined();
    expect(observation.projects[0].assessments.every(a => !a.assessmentBlueprint)).toBe(true);
  });
});

describe('數學與生物前後測：同樣推理，不照搬設問', () => {
  function subjectWorkspace(subject: string): Workspace {
    const w = ready(), project = w.projects[0];
    const design = project.designs.find(row => row.id === project.activeDesignId)!;
    for (const input of [project.input, design.inputSnapshot]) {
      input.subject = subject;
      input.drivingQuestion = '哪些新資料足以支持這次課程的建議？';
      if (input.indicatorReview) input.indicatorReview.signature = inputSignature(input);
    }
    return w;
  }
  it.each([
    ['數學', /對調分母或比例/, 'math-'],
    ['生物', /觀察努力量/, 'biology-'],
  ] as const)('給 %s 紙筆題分科變化指引，單份重寫仍沿用設定', (subject, instruction, strategyPrefix) => {
    const w = subjectWorkspace(subject), project = w.projects[0];
    const plan = buildSetPairPlan(project, '', modes(w));
    expect(plan.instructions).toMatch(instruction);
    expect(plan.instructions).toMatch(/至少兩個對應題位/);
    const originalContext = /優先直接沿用課堂原情境/;
    expect(plan.instructions).toMatch(originalContext);
    expect(plan.instructions).toMatch(/新材料、補充證據、會改變判斷的新條件或新任務/);
    expect(plan.payload.assessmentBlueprint).toMatchObject({
      strategyId: expect.stringMatching(new RegExp('^' + strategyPrefix)),
      postAnchor: { kind: 'course', drivingQuestion: '哪些新資料足以支持這次課程的建議？' },
    });
    const saved = addGeneratedSetPair(w, project.id, { pre: setsFor(w, '前測'), post: setsFor(w, '後測') }, modes(w));
    const rewrite = buildSetPhasePlan(saved.projects[0], 'post');
    expect(rewrite.instructions).toMatch(instruction);
    expect(rewrite.instructions).toMatch(/用 pairedTest 檢查/);
    expect(rewrite.instructions).toMatch(originalContext);
    expect(buildSetPhasePlan(saved.projects[0], 'pre').instructions).not.toMatch(originalContext);
    expect(rewrite.payload.assessmentBlueprint).toEqual(plan.payload.assessmentBlueprint);
  });

  it('其他學科及純課中觀察不套用數學和生物的紙筆變化指引', () => {
    const chinese = subjectWorkspace('國語文');
    expect(buildSetPairPlan(chinese.projects[0]).instructions).not.toMatch(/至少兩個對應題位|對調分母或比例|觀察努力量/);
    for (const subject of ['數學', '生物']) {
      const w = subjectWorkspace(subject);
      const pureObservation = buildSetPairPlan(w.projects[0], '', modes(w, 'E'));
      expect(pureObservation.instructions).not.toMatch(/至少兩個對應題位|對調分母或比例|觀察努力量/);
      expect(pureObservation.payload.assessmentBlueprint).toBeUndefined();
    }
  });
});

describe('R13-r20 通科整卷核對與學生分卷', () => {
  it.each(['國語文', '英語文', '數學', '物理', '化學', '生物', '地球科學', '自然科學', '地理', '歷史', '公民與社會', '資訊科技'])('%s 的紙筆成對及單份重寫共用題間提示與判讀檢查', subject => {
    const w = ready(), project = w.projects[0];
    for (const input of [project.input, project.designs[0].inputSnapshot]) {
      input.subject = subject;
      if (input.indicatorReview) input.indicatorReview.signature = inputSignature(input);
    }
    const saved = addGeneratedSetPair(w, project.id, { pre: setsFor(w, '前測'), post: setsFor(w, '後測') }, modes(w));
    for (const plan of [buildSetPairPlan(project, '', modes(w)), buildSetPhasePlan(saved.projects[0], 'post')]) {
      expect(plan.instructions).toContain('保留同卷所有題幹、選項與句型開頭');
      expect(plan.instructions).toContain('最短合題答案');
    }
    expect(buildSetPairPlan(project, '', modes(w, 'E')).instructions).not.toContain('最短合題答案');
  });

  it('明顯逐字重複的正答只提醒其出現位置；短詞不當成洩題', () => {
    const w = withPair(), a = w.projects[0].assessments.find(a => a.id === w.projects[0].activePostId)!;
    const [first, second] = a.sets![0].choices;
    first.options.find(o => o.above)!.text = '本週早上回收量比晚上多四十件';
    second.prompt = '公告直接寫著：本週早上回收量比晚上多四十件。公告要發給誰？';
    expect(setWarnings(a)).toContainEqual(expect.stringMatching(/第 1 組第 1 題.*第 1 組第 2 題.*題間提示/));
    first.options.find(o => o.above)!.text = '早上';
    expect(setWarnings(a)).not.toContainEqual(expect.stringMatching(/題間提示/));
  });

  it.each(['B', 'C'] as const)('方式 %s 可獨立印發前測選擇及非選，兩份都有題內資料', mode => {
    const p = withPair(mode).projects[0];
    const exportPart = (studentPart: 'choices' | 'opens') => buildDocument(p, 'student', { studentPhase: 'pre', studentPart });
    const choice = documentMarkdown(exportPart('choices')), open = documentMarkdown(exportPart('opens'));
    expect(choice).toContain('前測選擇卷');
    expect(choice).toContain('前測第1題選項A');
    expect(choice).not.toContain('引導問題');
    expect(open).toContain('前測非選卷');
    expect(open).toContain('引導問題');
    expect(open).not.toContain('選項A');
    for (const text of [choice, open]) {
      expect(text).toContain('前測資料');
      expect(text).toContain('座號');
      expect(text).not.toMatch(/後測題組|門檻以上參考回答/);
    }
  });

  it('純方式 E 的完整題本仍含自評，不能匯出空的紙筆分卷', () => {
    const p = withPair('E').projects[0];
    expect(documentMarkdown(buildDocument(p, 'student', { studentPhase: 'post' }))).toContain('請完成下方自評');
    expect(() => buildDocument(p, 'student', { studentPhase: 'post', studentPart: 'choices' })).toThrow('沒有選擇題');
  });
});

describe('逐題藍圖進入生成與版本', () => {
  it('只為紙筆題建題位，前後負擔不同需解釋，結構和門檻不可改', () => {
    const selected = [{ indicatorId: 'paper', mode: 'C' as const }, { indicatorId: 'observe', mode: 'E' as const }];
    const draft = newItemBlueprint(selected);
    expect(draft.slots.map(slot => [slot.indicatorId, slot.kind, slot.question, slot.step])).toEqual([
      ['paper', 'choice', 1, null], ['paper', 'choice', 2, null], ['paper', 'choice', 3, null],
      ['paper', 'open', 1, 1], ['paper', 'open', 1, 2], ['paper', 'open', 2, 1],
    ]);
    expect(() => validateItemBlueprint(draft, selected)).toThrow('要測的判斷');
    draft.slots.forEach(slot => { slot.judgment = '辨認符合條件的來源'; slot.evidence = '公告內日期與受眾'; });
    draft.slots[0].post.evidenceUnits = 2;
    expect(() => validateItemBlueprint(draft, selected)).toThrow('負擔不同的理由');
    draft.slots[0].balanceNote = '後測增加一小句來源標示，但兩邊都只做一次日期核對。';
    expect(validateItemBlueprint(draft, selected)).toEqual(draft);
    const wrong = structuredClone(draft);
    wrong.slots[0].threshold = wrong.slots[1].threshold;
    expect(() => validateItemBlueprint(wrong, selected)).toThrow('題位或門檻不符');
    expect(() => validateItemBlueprint(draft, selected.slice(1))).toThrow('題位與測驗方式不符');
  });

  it('紙筆缺藍圖不能生成或重寫；方式 E 不附藍圖', () => {
    const w = withPair(), p = w.projects[0];
    expect(() => buildConfirmedSetPairPlan(p, '', modes(w))).toThrow('確認全部紙筆題位');
    expect(() => buildConfirmedSetPhasePlan(p, 'post', '')).toThrow('目前題本仍可檢視');
    expect(buildConfirmedSetPairPlan(p, '', modes(w, 'E')).payload.assessmentBlueprint).toBeUndefined();
  });

  it('成對、單份重寫和備份匯入都拒絕不符藍圖的非選句架', () => {
    const w = ready(), p = w.projects[0], selected = modes(w, 'D');
    const base = planAssessmentBlueprint(buildSetPairPlan(p, '', selected))!;
    const itemBlueprint = newItemBlueprint(selected);
    itemBlueprint.slots.forEach(slot => { slot.judgment = '核對兩筆測量'; slot.evidence = '反應時間及量測單位'; });
    itemBlueprint.slots[0].post.support = 'none';
    itemBlueprint.slots[0].balanceNote = '後測不給句架，兩側引用同樣類型的量測資料。';
    const selection = { ...base, itemBlueprint };
    const pre = setsFor(w, '前測', 'D'), post = setsFor(w, '後測', 'D');
    expect(() => addGeneratedSetPair(w, p.id, { pre, post }, selected, selection)).toThrow('不得附加句架');
    post.sets[0].opens[0].steps[0].sentenceStarter = '請作答。';
    const saved = addGeneratedSetPair(w, p.id, { pre, post }, selected, selection);
    expect(() => addRegeneratedSetPhase(saved, p.id, 'post', setsFor(w, '重寫', 'D'), selected)).toThrow('不得附加句架');
    const tampered = structuredClone(saved);
    tampered.projects[0].assessments.at(-1)!.sets![0].opens[0].steps[0].sentenceStarter = '先直接套算式。';
    expect(() => parseBackup(JSON.stringify(tampered))).toThrow('不得附加句架');
  });

  it('送出教師的逐題設定，保存兩份同一快照，單份重寫繼續沿用', () => {
    const w = ready(), p = w.projects[0], selected = modes(w, 'D');
    const base = buildSetPairPlan(p, '', selected).payload.assessmentBlueprint as { strategyId: string; postActivityId: null };
    const load = { evidenceUnits: 2, operations: 2, support: 'starter' as const };
    const itemBlueprint = { version: 1 as const, slots: selected.flatMap(({ indicatorId }) => ([
      { question: 1, step: 1, threshold: '證據有限→萌芽' as const },
      { question: 1, step: 2, threshold: '萌芽→發展' as const },
      { question: 2, step: 1, threshold: '發展→精熟' as const },
    ]).map(slot => ({ ...slot, indicatorId, kind: 'open' as const, judgment: '判斷紀錄是否足以支持主張', evidence: '兩筆同時段的觀察紀錄', pre: load, post: load, balanceNote: '' }))) };
    const plan = buildSetPairPlan(p, '', selected, { ...base, itemBlueprint });
    expect(plan.payload.assessmentBlueprint).toMatchObject({ itemBlueprint });
    try {
      rememberConsent(buildSetPairPlan(p, '', selected), '無藍圖流程', 'openai', 'gpt-4.1');
      expect(consentReason(plan, 'openai', 'gpt-4.1')).toContain('已確認的逐題藍圖');
    } finally { revokeAllConsent(); }
    const saved = addGeneratedSetPair(w, p.id, { pre: setsFor(w, '前測', 'D'), post: setsFor(w, '後測', 'D') }, selected, planAssessmentBlueprint(plan));
    const pair = saved.projects[0].assessments.slice(-2);
    expect(pair.map(a => a.assessmentBlueprint)).toEqual([{ strategyId: base.strategyId, postActivityId: null, itemBlueprint }, { strategyId: base.strategyId, postActivityId: null, itemBlueprint }]);
    expect(buildSetPhasePlan(saved.projects[0], 'post').payload.assessmentBlueprint).toMatchObject({ itemBlueprint });
    const broken = structuredClone(saved);
    (broken.projects[0].assessments.at(-1)!.assessmentBlueprint as { itemBlueprint: typeof itemBlueprint }).itemBlueprint.slots[0].judgment += '（後測另測）';
    expect(() => validateWorkspace(broken)).toThrow('逐題藍圖須一致');
  });
});

describe('前後測分開生成', () => {
  it('前測獨立保存，重新載入後先核對，再用精簡摘要出後測', () => {
    const w = ready(), p = w.projects[0], selected = modes(w, 'D');
    const base = planAssessmentBlueprint(buildSetPairPlan(p, '', selected))!;
    const itemBlueprint = newItemBlueprint(selected);
    itemBlueprint.slots.forEach(slot => { slot.judgment = '判斷反應快慢'; slot.evidence = '可比的反應時間紀錄'; });
    const prePlan = buildSeparatePrePlan(p, '', selected, { ...base, itemBlueprint });
    expect(prePlan.payload).not.toHaveProperty('design');
    expect(prePlan.payload).not.toHaveProperty('curriculum');
    expect(prePlan.payload.assessmentBlueprint).not.toHaveProperty('postAnchor');
    const first = addSeparateSetPhase(w, p.id, prePlan, setsFor(w, '前測專屬材料不可送給後測', 'D'));
    const pending = parseBackup(serializeWorkspaceBackup(first));
    expect(pending.projects[0].activePostId).toBeNull();
    expect(() => buildSeparatePostPlan(pending.projects[0])).toThrow('先核對前測');
    const confirmed = reviewAssessment(pending, p.id, pending.projects[0].activePreId!);
    const postPlan = buildSeparatePostPlan(confirmed.projects[0]);
    const sent = JSON.stringify(postPlan.payload);
    expect(sent).not.toContain('前測專屬材料不可送給後測');
    expect(postPlan.payload).not.toHaveProperty('pairedTest');
    expect(postPlan.payload).not.toHaveProperty('currentVersion');
    expect(postPlan.payload).toHaveProperty('preWorkloadSummary');
    const paired = addSeparateSetPhase(confirmed, p.id, postPlan, setsFor(w, '後測', 'D')).projects[0];
    expect(paired.activePreId).toBe(confirmed.projects[0].activePreId);
    expect(paired.assessments.find(a => a.id === paired.activePostId)?.parentPreId).toBe(paired.activePreId);
    expect(paired.assessments.find(a => a.id === paired.activePreId)?.assessmentBlueprint?.itemBlueprint).toEqual(itemBlueprint);
  });
});

describe('分開出題的失敗與非紙筆邊界', () => {
  it('句架由前測各題設定控制，舊卷不改，失敗後測不寫入；來源一變不得採用晚回應', () => {
    const w = withPair('D'), p = w.projects[0], selected = modes(w, 'D');
    const base = planAssessmentBlueprint(buildSetPairPlan(p, '', selected))!;
    const blueprint = newItemBlueprint(selected);
    blueprint.slots.forEach(slot => { slot.judgment = '判斷反應快慢'; slot.evidence = '可比的反應時間紀錄'; });
    blueprint.slots[0].pre.support = 'none';
    blueprint.slots[0].balanceNote = '後測以相同取證量改用句型結構，不提示內容。';
    const prePlan = buildSeparatePrePlan(p, '', selected, { ...base, itemBlueprint: blueprint });
    expect(JSON.stringify(prePlan.payload)).not.toContain('後測以相同取證量');
    const raw = setsFor(w, '分開的前測', 'D');
    const extraStarter = raw.sets[0].opens[0].steps[0].sentenceStarter;
    const first = addSeparateSetPhase(w, p.id, prePlan, raw);
    expect(raw.sets[0].opens[0].steps[0].sentenceStarter).toBe(extraStarter);
    expect(first.projects[0].assessments.at(-1)?.sets?.[0].opens[0].steps[0].sentenceStarter).toBe('請作答。');
    expect(first.projects[0].assessments.slice(0, p.assessments.length)).toEqual(p.assessments);
    const confirmed = reviewAssessment(first, p.id, first.projects[0].activePreId!);
    const post = buildSeparatePostPlan(confirmed.projects[0]);
    const firstSnapshot = structuredClone(confirmed);
    expect(() => addSeparateSetPhase(confirmed, p.id, post, { sets: [] })).toThrow('題本不完整');
    expect(confirmed).toEqual(firstSnapshot);
    const replaced = addSeparateSetPhase(confirmed, p.id, buildSeparatePrePlan(confirmed.projects[0], '', selected, { ...base, itemBlueprint: blueprint }), setsFor(w, '更新的前測', 'D'));
    expect(() => addSeparateSetPhase(replaced, p.id, post, setsFor(w, '較晚回來的後測', 'D'))).toThrow('來源已變更');
    const complete = addSeparateSetPhase(confirmed, p.id, post, setsFor(w, '分開的後測', 'D'));
    const altered = structuredClone(complete);
    altered.projects[0].assessments.find(a => a.id === altered.projects[0].activePreId)!.reviewedAt = null;
    expect(() => validateWorkspace(altered)).toThrow('後測必須在配對前測核對完成後產生');
  });

  it('純方式 E 分開保存，兩階段只傳相關觀察活動，不要求紙筆摘要', () => {
    const w = ready(), p = w.projects[0], selected = modes(w, 'E');
    const prePlan = buildSeparatePrePlan(p, '', selected);
    expect(prePlan.payload).not.toHaveProperty('assessmentBlueprint');
    expect(prePlan.payload).toHaveProperty('observationActivities');
    const first = addSeparateSetPhase(w, p.id, prePlan, setsFor(w, '課中前', 'E'));
    const confirmed = reviewAssessment(first, p.id, first.projects[0].activePreId!);
    const postPlan = buildSeparatePostPlan(confirmed.projects[0]);
    expect(postPlan.payload).not.toHaveProperty('preWorkloadSummary');
    expect(postPlan.payload).not.toHaveProperty('assessmentBlueprint');
    expect(addSeparateSetPhase(confirmed, p.id, postPlan, setsFor(w, '課中後', 'E')).projects[0].activePostId).toBeTruthy();
  });
});

describe('R31 情境自陳題', () => {
  const opts = (n: number) => ({ limited: `我先照著別人的做法完成${n}`, emerging: `我請同學提醒後再試著做${n}`, developing: `我自己訂出步驟並檢查結果${n}`, proficient: `我比較不同做法再選一個試${n}` });
  const raw = (count: number) => ({ items: Array.from({ length: count }, (_, i) => ({ slot: i + 1, scenario: `社團準備成果展，情境${i}。`, prompt: '在這個情境中，你最可能怎麼做？', options: opts(i) })) });
  it('前測 2 題、後測 3 題：選項穩定打亂、階段只存教師對照，後測前兩題配對、第 3 題後測新增；隨題組保存並通過工作區驗證', async () => {
    const { decodeSelfReport, stablePermutation, buildSelfReportPlan } = await import('./selfReport');
    expect(stablePermutation('x')).toEqual(stablePermutation('x'));
    const w = ready(), p = w.projects[0], selected = modes(w, 'D');
    const ids = p.designs.find(d => d.id === p.activeDesignId)!.inputSnapshot.indicatorIds;
    const base = planAssessmentBlueprint(buildSetPairPlan(p, '', selected))!;
    const itemBlueprint = newItemBlueprint(selected);
    itemBlueprint.slots.forEach(slot => { slot.judgment = '判斷反應快慢'; slot.evidence = '可比的反應時間紀錄'; });
    const prePlan = buildSeparatePrePlan(p, '', selected, { ...base, itemBlueprint });
    const plan = buildSelfReportPlan(prePlan, ids, 'pre', false);
    expect(plan.payload).toMatchObject({ task: 'self-report-items', phase: 'pre' });
    const pre = decodeSelfReport(raw(2), ids, 'pre', false, 'p1');
    expect(pre.items).toHaveLength(2);
    expect(pre.items.every(i => i.options.map(o => o.label).join('') === 'ABCD' && [...i.options.map(o => o.stage)].sort().join() === '0,1,2,3')).toBe(true);
    expect(pre.items.some(i => i.options.map(o => o.stage).join() !== '0,1,2,3')).toBe(true);
    const first = addSeparateSetPhase(w, p.id, prePlan, { ...setsFor(w, '前測', 'D'), selfReport: pre });
    const saved = parseBackup(serializeWorkspaceBackup(first));
    expect(saved.projects[0].assessments.find(a => a.id === saved.projects[0].activePreId)?.selfReport).toEqual(pre);
    const confirmed = reviewAssessment(saved, p.id, saved.projects[0].activePreId!);
    const post = decodeSelfReport(raw(3), ids, 'post', true, 'q1');
    expect(post.items.map(i => [i.pairedWith, i.postOnly])).toEqual([[1, false], [2, false], [null, true]]);
    const paired = addSeparateSetPhase(confirmed, p.id, buildSeparatePostPlan(confirmed.projects[0]), { ...setsFor(w, '後測', 'D'), selfReport: post });
    expect(paired.projects[0].assessments.find(a => a.id === paired.projects[0].activePostId)?.selfReport?.items).toHaveLength(3);
    const { buildDocument } = await import('../documents/model');
    const studentText = buildDocument(paired.projects[0], 'student', { studentPhase: 'post' }).blocks.map(b => b.text).join('\n');
    expect(studentText).toContain('情境自陳｜選出最接近你會怎麼做的一項（不計分）');
    expect(studentText).toContain('社團準備成果展，情境2。');
    expect(studentText).not.toMatch(/（(證據有限|萌芽|發展|精熟)）|後測新增|配對/);
    expect(buildDocument(paired.projects[0], 'student', { studentPhase: 'post', studentPart: 'opens' }).blocks.map(b => b.text).join('\n')).not.toContain('情境自陳');
    const teacherText = buildDocument(paired.projects[0], 'teacher').blocks.map(b => b.text).join('\n');
    expect(teacherText).toContain('（精熟）');
    expect(teacherText).toContain('後測新增，不與前測比較');
    expect(teacherText).toContain('與前測第 1 題配對');
    const broken = structuredClone(paired);
    broken.projects[0].assessments.find(a => a.id === broken.projects[0].activePostId)!.selfReport!.items[0].options[0].stage = broken.projects[0].assessments.find(a => a.id === broken.projects[0].activePostId)!.selfReport!.items[0].options[1].stage;
    expect(() => validateWorkspace(broken)).toThrow('各對應一個階段');
  });
  it('學生可見文字含階段名稱、重複選項或最高階明顯較長時拒收', async () => {
    const { decodeSelfReport } = await import('./selfReport');
    const bad = raw(2); bad.items[0].options.proficient = '我已達精熟，會比較不同做法';
    expect(() => decodeSelfReport(bad, ['x'], 'pre', false, 'a')).toThrow('階段名稱');
    const dup = raw(2); dup.items[1].options.emerging = dup.items[1].options.limited;
    expect(() => decodeSelfReport(dup, ['x'], 'pre', false, 'a')).toThrow('重複選項');
    const long = raw(2); long.items[0].options.proficient = '我會先比較三種不同做法的優缺點，再參考同學與老師的回饋，選出最適合的一種並記錄理由後執行';
    expect(() => decodeSelfReport(long, ['x'], 'pre', false, 'a')).toThrow('明顯較長');
    expect(() => decodeSelfReport(raw(3), ['x'], 'pre', false, 'a')).toThrow('題數');
  });
});
