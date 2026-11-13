import { progressionLines } from '../domain/progressionAlignment';
import { describePaperAssessment } from '../domain/paperAssessmentSummary';
import { MODE_PLAN, STAGES, THRESHOLDS, type AssessmentVersion, type Item, type ItemSet, type Project } from '../domain/types';
import { ADMINISTRATION_NOTE, COGNITIVE_NOTE, judgmentLines, OBSERVATION_NOTE, SET_READING_NOTE } from './setJudgment';
import { isCognitiveOnly } from '../data/assessability';
import { estimateAssessmentDuration } from '../domain/thresholdSet';
import { buildPrompt } from './prompt';
import type { ClassroomKit } from '../domain/classroomKit';
import { NARRATIVE_COMPARISON_NOTE, NARRATIVE_UNJUDGABLE_NOTE, checklistHeading, narrativeNote, type NarrativeKit } from '../domain/narrativeKit';
import { fixedReflectionFor, fixedReflections, NO_EVIDENCE_LABEL, REFLECTION_NOTE, SELF_ASSESSMENT_NOTE } from './fixedReflection';
import curriculum from '../data/curriculum.json';
import indicators from '../data/indicators.json';
import { buildLessonOverview } from './lessonOverview';
import { dataTable, studentContext, studentSetTitle } from './paperLayout';

export interface DocumentTable { headers: string[]; rows: string[][]; widths?: number[] }
export interface DocumentBlock {
  kind: 'title' | 'heading' | 'paragraph';
  text: string;
  pageBreakBefore?: boolean;
  keepTogether?: boolean;
  table?: DocumentTable;
  answerLines?: number;
  continuation?: string;
}
export type StudentPart = 'choices' | 'opens';
export interface DocumentOptions { studentPhase?: 'pre' | 'post'; studentPart?: StudentPart; teacherPhase?: 'pre' }
export interface TeachingDocument { title: string; blocks: DocumentBlock[]; audience?: Audience }
export type Audience = 'student' | 'teacher';
const clean = (text: string) => text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\r\n?/g, '\n');
export function buildLessonDocument(project: Project): TeachingDocument {
  const o = buildLessonOverview(project);
  const title = o.title + '・完整課程教案';
  const blocks: DocumentBlock[] = [];
  const add = (kind: DocumentBlock['kind'], text: string, layout: Partial<Omit<DocumentBlock, 'kind' | 'text'>> = {}) =>
    blocks.push({ kind, text: clean(text), ...layout });
  add('title', title);
  add('paragraph', o.meta + '。' + o.status);
  add('heading', '單元地圖');
  add('paragraph', '驅動問題：' + o.drivingQuestion, { keepTogether: true });
  if (o.finalProduct) add('paragraph', '最終作品：' + o.finalProduct, { keepTogether: true });
  for (const g of o.goals) add('paragraph', g.kind + '目標：' + g.text + '\n成功表現：' + g.success, { keepTogether: true });
  if (o.groups.length) add('paragraph', '', { table: { headers: ['節次', '活動主題', '學習證據（摘錄）'], rows: o.groups.map(g => [g.label, g.name, g.evidence]), widths: [1, 2, 3.5] } });
  add('heading', '前後測與規準對照');
  add('paragraph', o.assessment.preStatus + '；' + o.assessment.postStatus);
  if (o.assessment.pairs.length) add('paragraph', '', { table: { headers: ['前測', '後測', '對應規準'], rows: o.assessment.pairs.map(q => [q.pre, q.post, q.criteria]) } });
  add('paragraph', o.assessment.extras);
  add('heading', '逐節教學細節', { pageBreakBefore: true });
  for (const period of o.periods) {
    add('heading', period.label + '｜' + period.name, { continuation: period.label });
    add('paragraph', '學生做什麼：' + period.task + '\n教師看什麼：' + period.evidence + '\n怎麼回饋：' + period.formative + '\n學科用途：' + period.knowledgeUse, { keepTogether: true, continuation: period.label });
    if (period.scaffolds.length) add('paragraph', '', { table: { headers: ['四階鷹架', '提供什麼支持', '何時撤去'], rows: period.scaffolds.map(row => [row.stage, row.support, row.fading]), widths: [1, 2.8, 2.8] }, continuation: period.label });
  }
  add('heading', '共同判讀規準（工具四階）');
  add('paragraph', '空白或證據不足記「尚無法判讀」，不是最低階。');
  for (const c of o.criteria) {
    add('heading', c.label);
    add('paragraph', c.dimension + '｜觀察：' + c.observable + '\n範圍：' + c.scope + '\n未觀察到：' + c.unobserved);
    add('paragraph', '', { table: { headers: ['階段', '可觀察表現'], rows: c.stages.map(st => [st.stage, st.text]), widths: [1, 5] } });
  }
  add('heading', '四要素做法與限制');
  for (const e of o.elements) add('paragraph', e.name + '：' + e.practice + '\n限制：' + e.limitation);
  if (o.integration.length) { add('heading', '多題整合規則'); o.integration.forEach(line => add('paragraph', line)); }
  add('heading', '課綱條目');
  o.curriculum.forEach(row => add('paragraph', row.kind + ' ' + row.code + '：' + row.text));
  add('paragraph', o.note);
  return { title, blocks };
}
// R33：情境進程題判讀說明。
const SCENARIO_READING_NOTE = '情境進程題不看對錯：每題以學生寫的理由對照四階判讀錨點判斷位置，選項只作參考；選項與理由不一致時以理由為準。理由空白或離題列「尚無法判讀」，不當最低階。每題對應一個面向；同一子指標有多題時，整體位置由教師綜合判斷，不平均、不加總，工具不自動判級。';
export function buildDocument(project: Project, audience: Audience, options: DocumentOptions = {}): TeachingDocument {
  const pre = project.assessments.find(a => a.id === project.activePreId);
  const teacherPre = audience === 'teacher' && options.teacherPhase === 'pre';
  if (teacherPre && !pre?.reviewedAt) throw new Error('請先核對前測。');
  const post = teacherPre ? undefined : project.assessments.find(a => a.id === project.activePostId);
  const matchedDesign = project.designs.find(d => d.id === (pre?.designId ?? post?.designId ?? project.activeDesignId));
  if (!matchedDesign) throw new Error('文件引用的設計不存在。');
  const design = matchedDesign;
  const phaseOnly = audience === 'student' ? options.studentPhase : teacherPre ? 'pre' : undefined;
  const part = audience === 'student' ? options.studentPart : undefined;
  const phaseName = phaseOnly === 'pre' ? '前測' : '後測';
  const partLabel = part === 'choices' ? '選擇卷' : part === 'opens' ? '非選卷' : '';
  const selected = phaseOnly === 'pre' ? pre : post;
  if (part && (!phaseOnly || !selected?.format || !(selected.sets ?? []).some(set => set[part].length))) {
    throw new Error(part === 'choices' ? '該測次沒有選擇題可分卷。' : '該測次沒有非選題可分卷。');
  }
  const sets = !!(pre?.format || post?.format);
  // R33：情境進程題（引出學生在四階進程的位置，不看對錯）。
  const scenarioPhases = [pre, post].filter((a): a is AssessmentVersion => a?.format === 'scenario-progression-v1');
  const scenarioIds = [...new Set(scenarioPhases.flatMap(a => (a.scenarioSets ?? []).map(s => s.indicatorId)))];
  const title = design.inputSnapshot.title + '・' + (audience === 'student' ? (phaseOnly ? '學生' + phaseName + (partLabel || '題本') : '學生前後測題本') : teacherPre ? '教師前測手冊' : sets ? '教師答案與判讀手冊' : '教師手冊與判讀提示詞');
  const blocks: DocumentBlock[] = [];
  let continuation: string | undefined;
  const add = (kind: DocumentBlock['kind'], text: string, layout: Partial<Omit<DocumentBlock, 'kind' | 'text'>> = {}) =>
    blocks.push({ kind, text: clean(text), ...(continuation ? { continuation } : {}), ...layout });
  const table = (headers: string[], rows: string[][], widths?: number[]) =>
    add('paragraph', '', { table: { headers: headers.map(clean), rows: rows.map(r => r.map(clean)), ...(widths ? { widths } : {}) } });
  const addData = (text: string) => {
    const parsed = dataTable(clean(text));
    if (parsed) {
      add('heading', '情境資料');
      add('paragraph', '', { table: parsed });
    } else add('paragraph', '資料：' + text, { keepTogether: true });
  };
  const single = project.workflow === 'single-v1';
  const allSets = [...(pre?.sets ?? []), ...(post?.sets ?? [])];
  const phaseJudgmentIds = new Set([...allSets.filter(set => set.mode !== 'E' && !isCognitiveOnly(set)).map(set => set.indicatorId), ...scenarioIds]);
  const phaseMeta = (a: AssessmentVersion) => '題組版本 ' + a.id + '／設計 ' + a.designId + '／規準 ' + a.rubricVersion + '／配對前測 ' + (a.parentPreId ?? '無') + '。' + (a.reviewedAt ? '教師已確認題組' : '題組待確認') + '；' + (a.administeredAt ? '已記錄實際施測（' + new Date(a.administeredAt).toISOString() + '）' : '尚未記錄施測') + '。';
  if (audience === 'teacher') {
    add('title', title);
    add('paragraph', design.inputSnapshot.subject + '／' + design.inputSnapshot.grade + '／' + design.inputSnapshot.periods + ' 節。');
    if (sets) {
      add('heading', '批閱速查');
      const estimate = (a: AssessmentVersion | undefined) => {
        if (!a) return '尚未生成';
        const { paperMinutes, selfAssessmentMinutes } = estimateAssessmentDuration(a);
        return [
          ...(paperMinutes !== null ? [`紙筆題估計作答約 ${Math.round(paperMinutes)} 分鐘`] : []),
          ...(selfAssessmentMinutes !== null ? [`學生自評估計約 ${Math.round(selfAssessmentMinutes)} 分鐘（課中觀察時間依活動安排）`] : []),
        ].join('；') || '未提供估時';
      };
      if (scenarioPhases.length) {
        add('paragraph', SCENARIO_READING_NOTE);
        for (const plan of scenarioPhases[0].aspects ?? []) add('paragraph', (indicators.entries.find(i => i.id === plan.indicatorId)?.name ?? plan.indicatorId) + '｜面向：' + plan.aspects.map(a => `${a.label}（${a.description}）`).join('；'));
      } else add('paragraph', '前測：' + estimate(pre) + (teacherPre ? '' : '｜後測：' + estimate(post)));
      if (!teacherPre && pre?.assessmentBlueprint) add('paragraph', describePaperAssessment(design, pre.assessmentBlueprint));
      add('paragraph', '先核對測次與題組。' + (phaseJudgmentIds.size ? '紙筆題依各方式的門檻批閱，再填班級彙整。空白或無效作答列「尚無法判讀」，不以答對總數判階。' : '') + (allSets.some(set => set.mode === 'E') ? '方式 E 依教師觀察紀錄與學生自評核對，另列課中表現。' : '') + (allSets.some(isCognitiveOnly) ? '原建議 E 但改用紙筆題者只列認知理解證據，不判階。' : ''), { keepTogether: true });
      const named = new Map(allSets.map(set => [set.indicatorId, indicators.entries.find(i => i.id === set.indicatorId)?.name ?? set.indicatorId]));
      for (const [id, name] of named) {
        const before = pre?.sets?.find(set => set.indicatorId === id);
        const after = post?.sets?.find(set => set.indicatorId === id);
        const sample = before ?? after!;
        add('heading', name + '｜方式 ' + sample.mode);
        add('paragraph', '前測：' + (before?.title ?? '尚未生成') + (teacherPre ? '' : '；後測：' + (after?.title ?? '尚未生成')));
        if (sample.mode === 'E') { add('paragraph', '請查閱各測次的課中觀察表與學生自評說明。'); continue; }
        if (isCognitiveOnly(sample)) add('paragraph', COGNITIVE_NOTE);
        const answer = (set: ItemSet | undefined, i: number) => set?.choices[i]?.options.filter(o => o.above).map(o => o.id).join('、') || '—';
        if (sample.choices.length) table(
          ['題號', '門檻', '前測門檻以上選項', ...(teacherPre ? [] : ['後測門檻以上選項'])],
          sample.choices.map((q, i) => [String(i + 1), q.threshold, answer(before, i), ...(teacherPre ? [] : [answer(after, i)])]),
          teacherPre ? [0.65, 1.5, 1.65] : [0.65, 1.5, 1.65, 1.65]);
        if (sample.opens.length) add('paragraph', '非選題請按各測次的判讀特徵與參考回答核對。' + (sample.mode === 'B' && !isCognitiveOnly(sample) ? '判為精熟須核對第 5 題、非選第 3 段及前兩道門檻。' : ''));
      }
    } else add('paragraph', single ? '前後測能力題與後測課綱題分開判讀；本文件不是已實施或成效證據。請使用班級代號及去識別代稱，不填姓名。' : '前後進程題與後測課綱題分開判讀。相同題數或題型不代表等值化；本文件不是已實施或成效證據。請使用班級代號及去識別代稱，不填姓名。');
  }
  function teacherAppendix() {
    if (sets) {
      add('heading', '附錄｜使用須知與判讀規準', { pageBreakBefore: true });
      if (scenarioIds.length) add('paragraph', '情境進程題：' + SCENARIO_READING_NOTE);
      if (allSets.some(set => set.mode !== 'E')) add('paragraph', (allSets.some(set => set.mode === 'E') ? '紙筆題：' : '') + SET_READING_NOTE);
      if (allSets.some(set => set.mode === 'E')) add('paragraph', '方式 E 的課中觀察與自評另列；課中表現與紙筆情境判斷分開呈現。');
      add('paragraph', '本文件不是已實施或成效證據。請使用班級代號及去識別代稱，不填姓名。');
    }
    add('paragraph', '設計 ' + design.id + '；規準 ' + design.rubricVersion + '。設計來源：' + (design.origin === 'ai' ? 'AI 建議草稿' : design.origin === 'teacher' ? '教師修訂草稿' : '人工設計範例') + '。設計' + (design.confirmedAt ? '已由教師確認' : '尚未確認') + '；未以真實學生作答校準。');
    if (sets) for (const a of [pre, post]) if (a) add('paragraph', (a.phase === 'pre' ? '前測：' : '後測：') + phaseMeta(a));
    // R12-r12：原本每條課綱、每節活動都重複的固定說明，合併成一段使用須知。
    const sources = [...new Set(design.inputSnapshot.curriculumIds.map(id => curriculum.find(c => c.id === id)).filter(c => !!c).map(c => `${c!.sourceDocumentTitle}／${c!.sourceVersion}`))];
    add('heading', '使用須知');
    add('paragraph', `課綱條文為工具內的固定摘錄${sources.length ? `（來源：${sources.join('；')}）` : ''}，未重新逐字校對，也沒有官方一對一的 NPDL 對應，使用前請對照正式課綱。各節的形成性回饋只用於課堂調整，不納入情境能力的階段判讀。活動與題目中的數據為模擬資料，法規與程序請教師核對。`);
    add('heading', '課程起點、課綱與成功表現');
    add('paragraph', `學生起點：${design.inputSnapshot.startingPoint.status === 'unknown' ? '未知，不代表最低階。' : design.inputSnapshot.startingPoint.text}`);
    design.inputSnapshot.startingPoint.assumptions.forEach(a => add('paragraph', `待核對假設：${a}`));
    add('paragraph', `原始來源（保留原文）：${design.inputSnapshot.originalSource.text}`);
    add('paragraph', `教師註記：${design.inputSnapshot.teacherNotes || '未提供。'}`);
    if (design.inputSnapshot.drivingQuestion) add('paragraph', `驅動問題：${design.inputSnapshot.drivingQuestion}`);
    if (design.inputSnapshot.finalProduct) add('paragraph', `最終作品：${design.inputSnapshot.finalProduct}`);
    design.inputSnapshot.curriculumIds.forEach(id => { const c = curriculum.find(c => c.id === id)!; add('paragraph', `課綱 ${c.code}：${c.text}`); });
    design.goals.forEach(g => add('paragraph', `${g.kind === 'academic' ? '學科' : 'NPDL'}目標 ${g.id}：${g.text}\n成功表現：${g.success}`));
    add('heading', '工具四階完整規準');
    add('paragraph', `來源與版本：${design.rubricSource}／${design.rubricVersion}。四階不可直接映射書中學生五階或設計品質四階。`);
    design.criteria.forEach(c => { add('heading', `${c.label}（${c.id}／${c.indicatorId}）`); add('paragraph', `觀察特徵：${c.observable}\n範圍：${c.scope}\n未觀察：${c.unobserved}`); c.stages.forEach((s, i) => add('paragraph', `${STAGES[i]}：${s}`)); if (c.alignment) alignmentNote(c.indicatorId, c.alignment); });
    if (sets) {
      const applicable = judgmentLines(allSets.filter(set => !isCognitiveOnly(set)).map(set => set.mode));
      if (applicable.length) {
        add('heading', phaseJudgmentIds.size ? '門檻題組判讀規則（教師使用，工具不自動判級）' : '課中評量判讀規則（教師使用，工具不自動判級）');
        applicable.forEach(line => add('paragraph', line));
      }
    }
    const rules = sets ? design.integration.filter(rule => phaseJudgmentIds.has(rule.indicatorId)) : design.integration;
    if (!sets || rules.length) add('heading', sets ? '多題整合規則' : single ? '多題整合規則與前後測配對' : '多題整合規則與比較藍圖');
    rules.forEach(r => add('paragraph', `${r.indicatorId}／${r.status === 'confirmed' ? '教師已確認' : r.status === 'missing' ? '缺少規則' : '待教師確認'}／規準 ${r.criterionIds.join('、')}：${r.rule || '尚無法整合，只列分項。'}`));
    if (!sets) design.blueprint.forEach(b => add('paragraph', single ? `${b.preId} → ${b.postId}／規準 ${b.criterionIds.join('、')}` : `${b.preId} → ${b.postId}／規準 ${b.criterionIds.join('、')}／${b.status}：${b.reason}`));
    if (sets) { add('paragraph', '逐節活動與四階鷹架請查閱同一設計的《完整課程教案》。'); return; }
    add('heading', '活動與四階鷹架（規劃，未證明實施）');
    design.activities.forEach(a => { add('heading', `${a.name}（${a.id}／${a.periods}節）`); add('paragraph', `目標 ${a.goalIds.join('、')}；規準 ${a.criterionIds.join('、')}\n任務：${a.task}\n學科用途：${a.knowledgeUse}\n預期作品：${a.evidence}\n形成性回饋：${a.formative}`); a.scaffolds.forEach(s => add('paragraph', `${s.stage}支援：${s.support}\n撤去條件：${s.fading}`)); });
    design.elements.forEach(e => add('paragraph', `${e.name}：${e.practice}\n尚未涵蓋：${e.limitation}`));
  }
  function question(q: Item, number: number, purpose: string) {
    if (audience === 'student') {
      const header = purpose + '第 ' + number + ' 題：' + q.title;
      add('heading', header);
      add('paragraph', '情境：' + q.context);
      addData(q.data);
      add('paragraph', ['問題：' + q.prompt, '作答方式：單選一項。', ...q.options.map(o => o.id + '. ' + o.text), '所選選項：＿＿＿＿'].join('\n'), { keepTogether: true, continuation: (continuation ?? '') + '｜' + header });
      if (q.shortResponse) add('paragraph', '簡短說明：' + q.shortResponse.prompt + '\n我的理由與資料依據：', { keepTogether: true, answerLines: 3 });
      return;
    }
    add('heading', `${purpose}第${number}題：${q.title}（${q.id}）`);
    add('paragraph', `情境：${q.context}\n資料：${q.data}\n問題：${q.prompt}\n作答方式：單選一項，保留題號與選項代號。`);
    q.options.forEach(o => { add('paragraph', `${o.id}. ${o.text}`); add('paragraph', `可支持：${o.supports.join('；')}\n不支持／限制：${o.limitations.join('；')}`); });
    add('paragraph', '所選選項：＿＿＿＿');
    if (q.shortResponse) { add('paragraph', `簡短說明：${q.shortResponse.prompt}\n我的理由與資料依據：＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿`); add('paragraph', `說明題參考表現：${q.shortResponse.example}\n可支持的證據：${q.shortResponse.evidence}`); }
    if (q.curriculumIds?.length) add('paragraph', `對應課綱：${q.curriculumIds.join('、')}`);
    add('paragraph', `規準 ${q.criterionIds.join('、')}\n出題條件（供教師參考）\n必要知識：${q.conditions.knowledge}\n閱讀量：${q.conditions.reading}\n資訊複雜度：${q.conditions.complexity}\n推理要求：${q.conditions.reasoning}\n提示條件：${q.conditions.prompts}`);
    if (q.applicationCriteria) add('paragraph', `學科應用判準：${q.applicationCriteria.academic}\n能力應用判準：${q.applicationCriteria.capability}\n應用結果獨立，不加入進程變化。`);
  }
  function itemSet(set: ItemSet, number: number) {
    const indicator = indicators.entries.find(i => i.id === set.indicatorId);
    // 方式 E（課中評量＋自評）：學生題本只放自評；觀察表只在教師手冊。
    if (set.mode === 'E') {
      const reflection = fixedReflectionFor(design!, set.indicatorId);
      if (audience === 'student') {
        if (!reflection) return;
        add('heading', `自評：${reflection.dimension}／${reflection.name}`);
        add('paragraph', SELF_ASSESSMENT_NOTE);
        reflection.stages.forEach(row => add('paragraph', `□ ${row.text}`)); add('paragraph', `□ ${NO_EVIDENCE_LABEL}`);
        if (reflection.activities.length) add('paragraph', `可以回想的活動：${reflection.activities.join('、')}。`);
        reflection.questions.forEach((q, i) => add('paragraph', `${i + 1}. ${q}\n＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿`));
        return;
      }
      const o = set.observation!;
      add('heading', `課中評量＋自評：${set.title}（${indicator?.dimension ?? ''}／${indicator?.name ?? set.indicatorId}）`);
      add('paragraph', `方式 E${set.mode !== set.suggestedMode ? `，原建議為 ${set.suggestedMode}` : '（原建議）'}。${OBSERVATION_NOTE}`);
      add('paragraph', `觀察活動：${o.activityIds.map(id => design.activities.find(a => a.id === id)?.name ?? id).join('、')}\n觀察焦點：${o.focus}`);
      add('paragraph', [...o.behaviors.map((text, i) => `${STAGES[i]}：${text}\n　座號：＿＿＿＿　看到的事實：＿＿＿＿＿＿＿＿`), '尚無法判讀：沒有觀察到足以判斷的行為\n　座號：＿＿＿＿'].join('\n'));
      add('paragraph', '學生題本附這個子指標的自評（四段學生版進程描述、「目前沒有足夠證據」與三個反思問題）。自評與觀察不一致時，請和學生核對，不平均、不取較高者。');
      return;
    }
    const paperTitle = studentSetTitle(set.title, number);
    const startsSheet = audience === 'student' && number > 1 && !part && set.mode === 'B';
    const setCaption = (continuation ?? '') + '｜題組 ' + number;
    add('heading', audience === 'teacher' ? '題組 ' + number + '：' + set.title + '（' + (indicator?.dimension ?? '') + '／' + (indicator?.name ?? set.indicatorId) + '）' : startsSheet ? continuation + '｜' + paperTitle : paperTitle, { pageBreakBefore: startsSheet });
    if (startsSheet) add('paragraph', '班級代號：＿＿＿＿　座號：＿＿＿＿', { keepTogether: true });
    if (audience === 'teacher') add('paragraph', '本子指標採方式 ' + set.mode + '（' + MODE_PLAN[set.mode].label + '），原建議為 ' + set.suggestedMode + '。' + (isCognitiveOnly(set) ? COGNITIVE_NOTE : ''));
    add('paragraph', '情境：' + (audience === 'student' ? studentContext(set.context) : set.context));
    addData(set.data);
    if (part !== 'opens' && set.choices.length && audience === 'student') add('heading', '選擇題｜每題選一項，把所選選項代號填在題號前');
    if (part !== 'opens') set.choices.forEach((choice, i) => {
      const stem = (audience === 'student' ? '［　］ ' : '') + (i + 1) + '. ' + choice.prompt;
      const opts = choice.options.map(o => audience === 'teacher' ? o.id + '. ' + o.text + (o.above ? '　✓ 門檻以上' : '') + '\n　代表的想法：' + o.thinking : o.id + '. ' + o.text);
      add('paragraph', [stem, ...(audience === 'teacher' ? ['【門檻：' + choice.threshold + '】'] : []), ...opts].join('\n'), { keepTogether: true, continuation: setCaption + '｜第 ' + (i + 1) + ' 題' });
    });
    if (!part && set.opens.length && audience === 'student' && set.mode === 'B') {
      add('heading', continuation + '｜非選題｜' + paperTitle, { pageBreakBefore: true });
      add('paragraph', '班級代號：＿＿＿＿　座號：＿＿＿＿', { keepTogether: true });
      add('paragraph', '情境：' + studentContext(set.context));
      addData(set.data);
    }
    if (set.opens.length && audience === 'teacher') {
      add('heading', '非選題判讀');
      add('paragraph', '施測前核對：請將下方參考回答與本題組的資料、新資訊逐項對照，確認組別、變因、數值與單位一致。');
      addData(set.data);
    }
    if (part !== 'choices') set.opens.forEach((open, k) => {
      const label = '非選題' + (set.opens.length > 1 ? ' ' + (k + 1) : '');
      add('heading', label + '：' + open.prompt);
      open.steps.forEach((step, i) => {
        const guide = '(' + (i + 1) + ') ' + step.guide;
        const text = audience === 'student' ? guide + (step.sentenceStarter ? '\n' + step.sentenceStarter : '')
          : [guide, '【門檻：' + step.threshold + '】', '門檻以上的判讀特徵：' + step.aboveFeatures, '門檻以上參考回答：' + step.aboveExample, '門檻以下參考回答：' + step.belowExample].join('\n');
        add('paragraph', text, { keepTogether: true, ...(audience === 'student' ? { answerLines: 3 } : {}), continuation: setCaption + '｜' + label + '第 ' + (i + 1) + ' 段' });
      });
    });
    if (audience === 'teacher') add('paragraph', `規準 ${set.criterionIds.join('、')}\n出題條件（供教師參考）\n必要知識：${set.conditions.knowledge}\n閱讀量：${set.conditions.reading}\n資訊複雜度：${set.conditions.complexity}\n推理要求：${set.conditions.reasoning}\n提示條件：${set.conditions.prompts}`);
  }
  // R31：四階規準與 NPDL 學生版原文的逐句對應，供教師核對改寫是否保留原文要點。
  function alignmentNote(indicatorId: string, alignment: string[][]) {
    let lines: ReturnType<typeof progressionLines>;
    try { lines = progressionLines(indicatorId); } catch { return; }
    add('paragraph', '逐句對應（NPDL 學生版原文 → 本課可觀察表現）：');
    alignment.forEach((row, s) => add('paragraph', [STAGES[s], ...row.map((text, l) => `　原文：${lines[s][l]?.text ?? ''}\n　本課：${text}`)].join('\n'), { keepTogether: true }));
  }
  // R33：情境進程題。學生版：情境、題幹、打亂的做法 A–D、理由題與作答線；教師版另附各選項對應階段與四階判讀錨點。
  function scenarioSection(a: AssessmentVersion) {
    (a.scenarioSets ?? []).forEach((set, g) => {
      const name = indicators.entries.find(i => i.id === set.indicatorId)?.name ?? set.indicatorId;
      const plan = a.aspects?.find(p => p.indicatorId === set.indicatorId);
      add('heading', audience === 'student' ? `第 ${g + 1} 部分｜請想像自己在情境中，選出最接近你會怎麼做的一項，並寫下理由` : `情境進程題：${name}`);
      set.items.forEach((item, i) => {
        const aspect = plan?.aspects.find(x => x.id === item.aspectId);
        const head = (audience === 'student' ? '［　］ ' : '') + `${i + 1}. ${item.scenario}\n${item.prompt}`;
        const opts = item.options.map(o => `${o.label}. ${o.text}` + (audience === 'teacher' ? `　（${STAGES[o.stage]}）\nNPDL 原文：${progressionLines(set.indicatorId)[o.stage].map(line => line.text).join('；')}` : ''));
        if (audience === 'student') {
          add('paragraph', [head, ...opts].join('\n'), { keepTogether: true, continuation: (continuation ?? '') + `｜情境題 ${g + 1}-${i + 1}` });
          add('paragraph', item.reasonPrompt, { keepTogether: true, answerLines: 4, continuation: (continuation ?? '') + `｜情境題 ${g + 1}-${i + 1} 理由` });
          return;
        }
        add('paragraph', [head, `【面向：${aspect?.label ?? item.aspectId}】`, ...opts, `理由題：${item.reasonPrompt}`].join('\n'), { keepTogether: true, continuation: (continuation ?? '') + `｜${name} 第 ${i + 1} 題` });
        add('paragraph', ['判讀錨點（依理由判讀；選項只作參考）', ...item.anchors.map((t, s) => `${STAGES[s]}：${t}`), '尚無法判讀：理由空白、離題或無法對應任一階。'].join('\n'), { keepTogether: true });
      });
      // R41：第 4 題延伸題（回顧前 3 題說明選擇理由與代價）。
      if (set.extension) {
        const n = set.items.length + 1;
        if (audience === 'student') add('paragraph', `${n}.（延伸題）${set.extension.prompt}`, { keepTogether: true, answerLines: 5, continuation: (continuation ?? '') + `｜情境題 ${g + 1}-${n}` });
        else add('paragraph', [`第 ${n} 題（延伸題）：${set.extension.prompt}`, '判讀錨點：', ...set.extension.anchors.map((t, s) => `${STAGES[s]}：${t}`), '尚無法判讀：空白、離題或只重抄選項。'].join('\n'), { keepTogether: true });
      }
    });
  }
  // R41：方式 E 的學習單（學生）與課堂表現勾選表（教師），只在前測部分輸出一次。
  function kitSection(kit: ClassroomKit) {
    const indicator = indicators.entries.find(i => i.id === kit.indicatorId);
    const activityName = (id: string) => design.activities.find(a => a.id === id)?.name ?? id;
    if (audience === 'student') {
      add('heading', `課堂學習單：${kit.worksheet.title}`, { pageBreakBefore: true });
      add('paragraph', '班級代號：＿＿＿＿　座號：＿＿＿＿', { keepTogether: true });
      add('paragraph', kit.worksheet.intro);
      kit.worksheet.questions.forEach((q, i) => add('paragraph', `${i + 1}.【${activityName(q.activityId)}】${q.prompt}`, { keepTogether: true, answerLines: q.lines }));
      return;
    }
    add('heading', `課中評量：${kit.worksheet.title}（${indicator?.dimension ?? ''}／${indicator?.name ?? kit.indicatorId}）`);
    add('paragraph', `學習單題目（學生在課堂活動中填寫）：\n${kit.worksheet.questions.map((q, i) => `${i + 1}.【${activityName(q.activityId)}】${q.prompt}`).join('\n')}`);
    kit.checklist.forEach(row => {
      const criterion = design.criteria.find(c => c.id === row.criterionId);
      add('paragraph', `課堂表現勾選表｜${checklistHeading(criterion?.label ?? row.criterionId, row.focus)}`, { keepTogether: true });
      table(['四階', '看得見的行為'], row.behaviors.map((text, s) => [STAGES[s], text]), [1, 5]);
      table(['座號', ...STAGES, '尚無法判讀', '看到的事實'], Array.from({ length: 8 }, () => ['', '□', '□', '□', '□', '□', '']), [1, 1, 1, 1, 1, 1.2, 3]);
    });
    add('paragraph', '依課堂觀察與學習單內容勾選最接近的一階；沒有觀察到足以判斷的行為勾「尚無法判讀」，不當最低階。表格列數不足時請依班級人數影印。');
  }
  // R43：方式 F 的前後兩題、共用錨點與教師課堂參與勾選表。
  function narrativeSection(kit: NarrativeKit, phase: 'pre' | 'post') {
    const indicator = indicators.entries.find(row => row.id === kit.indicatorId);
    const questions = kit[phase];
    const title = phase === 'pre' ? '經驗敘述前測' : '課程參與敘述後測';
    add('heading', `${title}：${indicator?.name ?? kit.indicatorId}`, { pageBreakBefore: audience === 'student' });
    questions.forEach((question, index) => {
      if (audience === 'student') {
        add('paragraph', `${index + 1}. ${question.scenario ? '情境：' + question.scenario + '\n' : ''}${question.prompt}\n回想提示：${question.recall}${narrativeNote(question) ? '\n' + narrativeNote(question) : ''}`, { keepTogether: true });
        question.steps.forEach((step, stepIndex) => add('paragraph', `${index + 1}-${stepIndex + 1}. ${step.prompt}\n句子開頭：${step.starter}`, { keepTogether: true, answerLines: 3 }));
      } else {
        add('paragraph', `${index + 1}. ${question.scenario ? '情境：' + question.scenario + '\n' : ''}${question.prompt}\n回想提示：${question.recall}${narrativeNote(question) ? '\n' + narrativeNote(question) : ''}\n${question.steps.map((step, stepIndex) => `${stepIndex + 1}. ${step.prompt}（句子開頭：${step.starter}）`).join('\n')}`, { keepTogether: true });
      }
    });
    if (audience === 'teacher') {
      add('paragraph', ['判讀錨點（前後測共用；依學生敘述判讀）', ...kit.anchors.map((anchor, index) => `${STAGES[index]}：${anchor}`), NARRATIVE_UNJUDGABLE_NOTE, NARRATIVE_COMPARISON_NOTE].join('\n'), { keepTogether: true });
      kit.checklist.forEach(row => {
        const criterion = design.criteria.find(c => c.id === row.criterionId);
        add('paragraph', `課堂表現勾選表｜${checklistHeading(criterion?.label ?? row.criterionId, row.focus)}`, { keepTogether: true });
        table(['四階', '看得見的行為'], row.behaviors.map((behavior, index) => [STAGES[index], behavior]), [1, 5]);
        table(['座號', ...STAGES, '尚無法判讀', '看到的事實'], Array.from({ length: 8 }, () => ['', '□', '□', '□', '□', '□', '']), [1, 1, 1, 1, 1.2, 1.4, 3]);
      });
    }
  }
  // R31：情境自陳題。學生版選項已打亂、不顯示階段；教師版附階段對照與配對說明。
  function selfReportSection(value: NonNullable<AssessmentVersion['selfReport']>) {
    add('heading', audience === 'student' ? '情境自陳｜選出最接近你會怎麼做的一項（不計分）' : '情境自陳題（教師對照）');
    if (audience === 'teacher') add('paragraph', '只取得學生自陳，不計分、不改變能力階段，也不與紙筆門檻合併。學生版選項已打亂，階段對照只在本手冊。' + (value.phase === 'post' ? '後測第 1、2 題若標「配對」可與前測同序題比較自陳變化；第 3 題為後測新增。' : ''));
    value.items.forEach((item, i) => {
      const indicator = indicators.entries.find(row => row.id === item.indicatorId);
      const head = (audience === 'student' ? '［　］ ' : '') + (i + 1) + '. ' + item.scenario + '\n' + item.prompt;
      const opts = item.options.map(o => o.label + '. ' + o.text + (audience === 'teacher' ? '　（' + STAGES[o.stage] + '）' : ''));
      const note = audience === 'teacher' ? ['【' + (indicator?.name ?? item.indicatorId) + '｜' + (item.postOnly ? '後測新增，不與前測比較' : item.pairedWith ? '與前測第 ' + item.pairedWith + ' 題配對' : '自陳題') + '】'] : [];
      add('paragraph', [head, ...note, ...opts].join('\n'), { keepTogether: true, continuation: (continuation ?? '') + '｜情境自陳第 ' + (i + 1) + ' 題' });
    });
  }
  function assessment(a: AssessmentVersion | undefined, phase: string) {
    continuation = phase;
    if (audience === 'student') {
      add('title', design.inputSnapshot.title + '｜' + phase, { pageBreakBefore: blocks.length > 0 });
      add('paragraph', design.inputSnapshot.subject + '／' + design.inputSnapshot.grade + '。請依題目作答，不寫姓名。');
      if (a) add('paragraph', '班級代號：＿＿＿＿　座號：＿＿＿＿', { keepTogether: true });
    } else add('heading', sets ? phase.replace('題本', '判讀') : phase, { pageBreakBefore: sets });
    if (!a) { add('paragraph', '本版本尚未生成完整題組。若前測已保存，可只補後測；不能補造題目或作答。'); return; }
    if (a.format) {
      if (a.format === 'scenario-progression-v1') scenarioSection(a);
      if (audience === 'teacher' && (a.sets ?? []).some(set => set.opens.length && set.choices.length)) add('paragraph', ADMINISTRATION_NOTE);
      const paper = (a.sets ?? []).filter(set => set.mode !== 'E');
      paper.forEach((set, i) => { if (!part || set[part].length) itemSet(set, i + 1); });
      if (a.selfReport && part !== 'opens') selfReportSection(a.selfReport);
      if (part) return;
      const kitOf = (id: string) => a.format === 'scenario-progression-v1' ? (pre?.classroomKits ?? []).find(k => k.indicatorId === id) : undefined;
      const narrativeOf = (id: string) => a.format === 'scenario-progression-v1' ? (pre?.narrativeKits ?? []).find(k => k.indicatorId === id) : undefined;
      const eSets = (a.sets ?? []).filter(set => set.mode === 'E'), kitted = eSets.filter(set => kitOf(set.indicatorId) || narrativeOf(set.indicatorId));
      if (!paper.length && !(a.scenarioSets ?? []).length) add('paragraph', kitted.length ? (audience === 'student' ? '本次沒有紙筆題；請在課堂活動中完成下方學習單。' : '本次沒有紙筆題；以下為課堂學習單與表現勾選表。') : (audience === 'student' ? '本次沒有紙筆題；所有子指標都採課中評量，請完成下方自評。' : '本次沒有紙筆題；以下為課中評量的觀察表。'));
      eSets.forEach((set, i) => { const kit = kitOf(set.indicatorId), narrative = narrativeOf(set.indicatorId); if (!kit && !narrative) itemSet(set, i + 1); else if (kit && a.phase === 'pre') kitSection(kit); else if (narrative) narrativeSection(narrative, a.phase); else if (audience === 'teacher') add('paragraph', `${indicators.entries.find(x => x.id === set.indicatorId)?.name ?? set.indicatorId}：課中學習單與課堂表現勾選表見前測部分，前後測共用。`); });
      return;
    }
    if (audience === 'teacher') add('paragraph', `題組版本 ${a.id}／設計 ${a.designId}／規準 ${a.rubricVersion}／配對前測 ${a.parentPreId ?? '無'}。${a.reviewedAt ? '教師已確認題組' : '題組待確認'}；${a.administeredAt ? `已記錄實際施測（${new Date(a.administeredAt).toISOString()}）` : '尚未記錄施測'}。`);
    add('heading', a.phase === 'pre' ? '前測：生活情境能力題' : single ? '後測第一部分：能力題' : '後測第一部分：可比較能力題');
    a.capability.forEach((q, i) => question(q, i + 1, '能力'));
    if (a.phase === 'post') {
      add('heading', '後測第二部分：學科與能力的課程應用');
      add('paragraph', single ? '此部分需要課程學科知識，與能力題分開分析。' : '此部分需要課程學科知識，獨立分析，不加入前後能力變化。');
      a.application.forEach((q, i) => question(q, i + 1, '應用'));
      if (a.reflection.length) {
        add('heading', '後測第三部分：自評與一項課程證據');
        add('paragraph', '只作反思與核對。自評、所述課程證據、形成性與觀察不改變情境能力結果。');
        a.reflection.forEach(r => { const indicator = indicators.entries.find(i => i.id === r.indicatorId)!; add('heading', `${indicator.dimension}／${indicator.name}`); r.descriptions.forEach((text, i) => add('paragraph', `□ ${STAGES[i]}：${text}`)); add('paragraph', `□ ${r.noEvidenceLabel}\n活動回想線索：${r.activityIds.map(id => design.activities.find(a => a.id === id)!.name).join('、')}。不代表每位學生已完成。\n${r.evidencePrompt}\n所述活動或作品：＿＿＿＿\n我的具體內容與支持理由：＿＿＿＿\n下一步：＿＿＿＿`); });
      } else if (single) {
        // R12-r12：單一路徑不由 AI 產生自評，改放固定反思題。
        add('heading', '後測第三部分：反思');
        add('paragraph', REFLECTION_NOTE);
        fixedReflections(design!).forEach(r => { add('heading', `${r.dimension}／${r.name}`); add('paragraph', '請勾選最接近你目前表現的一段：'); r.stages.forEach(s => add('paragraph', `□ ${s.stage}：${s.text}`)); add('paragraph', `□ ${NO_EVIDENCE_LABEL}`); if (r.activities.length) add('paragraph', `可以回想的活動：${r.activities.join('、')}。不代表每位學生都已完成。`); r.questions.forEach((q, i) => add('paragraph', `${i + 1}. ${q}\n＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿`)); });
      }
    }
  }
  if (audience === 'teacher' && !sets) teacherAppendix();
  if (phaseOnly !== 'post') assessment(pre, '前測' + (partLabel || '題本'));
  if (phaseOnly !== 'pre') assessment(post, '後測' + (partLabel || '題本'));
  continuation = undefined;
  if (audience === 'teacher' && sets) {
    // R43：方式 F 只並列兩次判讀與證據，教師自行核對比較條件，工具不計算變化。
    for (const kit of pre?.narrativeKits ?? []) {
      const name = indicators.entries.find(row => row.id === kit.indicatorId)?.name ?? kit.indicatorId;
      add('heading', `經驗敘述前後判讀紀錄｜${name}`, { pageBreakBefore: true });
      table(['座號', '前測判讀', '後測判讀', '前測敘述依據', '後測參與／改變依據'], Array.from({ length: 8 }, () => ['', '', '', '', '']), [1, 1.2, 1.2, 3, 3]);
      add('paragraph', NARRATIVE_COMPARISON_NOTE);
    }
    const paperPhases = [pre, post].filter(a => (a?.sets ?? []).some(set => set.mode !== 'E'));
    if (paperPhases.length || scenarioPhases.length) add('heading', '班級彙整表（空白，請依測次填寫）', { pageBreakBefore: true });
    for (const a of scenarioPhases) for (const plan of a.aspects ?? []) {
      add('heading', (a.phase === 'pre' ? '前測' : '後測') + '／' + (indicators.entries.find(i => i.id === plan.indicatorId)?.name ?? plan.indicatorId));
      table(['面向', ...STAGES, '尚無法判讀', '分母'], [...plan.aspects.map(x => [x.label, '＿＿', '＿＿', '＿＿', '＿＿', '＿＿', '＿＿']), ...((a.scenarioSets ?? []).find(s => s.indicatorId === plan.indicatorId)?.extension ? [['延伸題', '＿＿', '＿＿', '＿＿', '＿＿', '＿＿', '＿＿']] : []), ...(plan.aspects.length > 1 ? [['整體位置（教師整體判斷）', '＿＿', '＿＿', '＿＿', '＿＿', '＿＿', '＿＿']] : [])], [2, 1, 1, 1, 1, 1.4, 1]);
      add('paragraph', '每格填人數。各題依判讀錨點、以理由為準判讀' + (plan.aspects.length > 1 ? '；整體位置由教師綜合各題判斷，不平均、不加總。' : '。'));
    }
    if (paperPhases.length) {
      for (const a of paperPhases) for (const set of (a?.sets ?? []).filter(set => set.mode !== 'E')) {
        add('heading', (a?.phase === 'pre' ? '前測' : '後測') + '／' + (indicators.entries.find(i => i.id === set.indicatorId)?.name ?? set.indicatorId));
        if (isCognitiveOnly(set)) {
          add('paragraph', '僅彙整各題作答或認知理解證據，不判定階段。');
          continue;
        }
        table(['門檻', '通過', '邊界', '未通過', '尚無法判讀', '分母'], THRESHOLDS.map(t => [t, '＿＿', '＿＿', '＿＿', '＿＿', '＿＿']), [2, 1, 1, 1, 1.6, 1]);
        add('paragraph', '分母為本次提供的學生人數。題號不連貫比例偏高的題目：＿＿＿＿　可能原因：＿＿＿＿');
      }
    }
    teacherAppendix();
  }
  if (audience === 'teacher' && !sets) { add('heading', '完整教師判讀提示詞'); buildPrompt(project).split('\n').forEach(line => add('paragraph', line)); }
  if (blocks.length > 20000 || blocks.reduce((n, b) => n + b.text.length + (b.table ? [b.table.headers, ...b.table.rows].reduce((sum, r) => sum + r.reduce((size, cell) => size + cell.length + 1, 0), 0) : 0), 0) > 1000000) throw new Error('文件內容超過匯出上限，原資料保留。');
  return { title, blocks, audience };
}
export function documentMarkdown(document: TeachingDocument): string {
  const escape = (line: string) => line.replace(/([\\`*_{}\[\]<>#|])/g, '\\$1');
  return document.blocks.map(b => {
    if (b.table) {
      const row = (cells: string[]) => '| ' + cells.map(cell => escape(cell.replace(/\n/g, ' '))).join(' | ') + ' |';
      return [row(b.table.headers), row(b.table.headers.map(() => '---')), ...b.table.rows.map(row)].join('\n');
    }
    if (b.kind === 'title' || b.kind === 'heading') return (b.kind === 'title' ? '# ' : '## ') + b.text.replace(/\n/g, ' ');
    return [...b.text.split('\n').map(escape), ...Array.from({ length: b.answerLines ?? 0 }, () => '＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿')].join('  \n');
  }).join('\n\n') + '\n';
}
