import { type AssessmentVersion, type DesignVersion, type Item, type ItemSet, type Project } from '../domain/types';
import { fixedReflectionFor, fixedReflections, NO_EVIDENCE_LABEL, REFLECTION_NOTE, SELF_ASSESSMENT_NOTE } from '../documents/fixedReflection';
import { studentContext, studentSetTitle } from '../documents/paperLayout';
import { narrativeNote } from '../domain/narrativeKit';

// R42：學生前測／後測轉成 Google 表單。內容與學生 PDF／Word 題本相同（不含答案、階段或錨點），
// 只把作答方式換成表單題型；表單不收集 Email，學生只填班級代號與座號。
export type FormPhase = 'pre' | 'post';
// 課堂學習單在單元活動中填寫，不放進前測或後測表單，另建一份。
export type FormKind = FormPhase | 'worksheet';
export type FormEntry =
  | { kind: 'section'; title: string; description?: string }
  | { kind: 'text'; title: string; description?: string }
  | { kind: 'choice'; title: string; description?: string; options: string[]; required?: boolean }
  | { kind: 'paragraph'; title: string; description?: string; required?: boolean }
  | { kind: 'short'; title: string; description?: string; required?: boolean };
export interface FormSpec { title: string; description: string; entries: FormEntry[] }

export const FORM_PRIVACY_NOTE = '這份表單不收集 Email，請勿填寫姓名。';
const LIMIT = 4000;
const oneLine = (text: string) => text.replace(/\s*\n+\s*/g, ' ').replace(/\s+/g, ' ').trim();
const clip = (text: string, max = LIMIT) => text.length > max ? text.slice(0, max - 1) + '…' : text;

export function phaseAssessment(project: Project, phase: FormPhase): AssessmentVersion {
  const id = phase === 'pre' ? project.activePreId : project.activePostId;
  const assessment = project.assessments.find(a => a.id === id);
  if (!assessment) throw new Error(phase === 'pre' ? '尚未產生前測。' : '尚未產生後測。');
  if (!assessment.reviewedAt) throw new Error(phase === 'pre' ? '請先核對前測。' : '請先核對並確認前後測。');
  return assessment;
}

export function hasWorksheet(project: Project): boolean {
  const pre = project.assessments.find(x => x.id === project.activePreId);
  return pre?.format === 'scenario-progression-v1' && (pre.classroomKits ?? []).length > 0;
}

export function buildFormSpec(project: Project, kind: FormKind): FormSpec {
  if (kind === 'worksheet') return buildWorksheetSpec(project);
  const phase = kind;
  const a = phaseAssessment(project, phase);
  const pre = project.assessments.find(x => x.id === project.activePreId);
  const design = project.designs.find(d => d.id === a.designId);
  if (!design) throw new Error('題本引用的設計不存在。');
  const phaseName = phase === 'pre' ? '前測' : '後測';
  const input = design.inputSnapshot;
  const entries: FormEntry[] = [
    { kind: 'short', title: '班級代號', description: '例如 101；不要填學校或姓名。', required: true },
    { kind: 'short', title: '座號', description: '只填數字，不要填姓名或 Email。', required: true },
  ];
  const push = (entry: FormEntry) => entries.push(entry);
  if (a.format) {
    if (a.format === 'scenario-progression-v1') scenarioEntries(a, push);
    const paper = (a.sets ?? []).filter(set => set.mode !== 'E');
    paper.forEach((set, i) => setEntries(set, i + 1, push));
    if (a.selfReport) {
      push({ kind: 'section', title: '情境自陳', description: '選出最接近你會怎麼做的一項（不計分）。' });
      a.selfReport.items.forEach((item, i) => push({ kind: 'choice', title: `${i + 1}. ${item.prompt}`, description: item.scenario, options: item.options.map(o => `${o.label}. ${o.text}`) }));
    }
    if (a.format === 'scenario-progression-v1') narrativeEntries(pre?.narrativeKits ?? [], phase, push);
    const kitted = new Set(a.format === 'scenario-progression-v1' ? [...(pre?.classroomKits ?? []).map(k => k.indicatorId), ...(pre?.narrativeKits ?? []).map(k => k.indicatorId)] : []);
    (a.sets ?? []).filter(set => set.mode === 'E' && !kitted.has(set.indicatorId)).forEach(set => selfAssessment(design, set.indicatorId, push));
  } else legacyEntries(a, design, project.workflow === 'single-v1', push);
  const answerable = entries.slice(2).some(e => e.kind === 'choice' || e.kind === 'paragraph' || e.kind === 'short');
  if (!answerable) throw new Error(`這份${phaseName}沒有可放進表單的學生題目` + (hasWorksheet(project) ? '；課堂學習單請用「課堂學習單」表單。' : '。'));
  return {
    title: clean(`${input.title}｜學生${phaseName}`, 300),
    description: `${input.subject}／${input.grade}。請依題目作答。${FORM_PRIVACY_NOTE}`,
    entries: entries.map(normalize),
  };
}

function buildWorksheetSpec(project: Project): FormSpec {
  const pre = phaseAssessment(project, 'pre');
  const kits = pre.format === 'scenario-progression-v1' ? pre.classroomKits ?? [] : [];
  if (!kits.length) throw new Error('這門課沒有課堂學習單。');
  const design = project.designs.find(d => d.id === pre.designId);
  if (!design) throw new Error('題本引用的設計不存在。');
  const entries: FormEntry[] = [
    { kind: 'short', title: '班級代號', description: '例如 101；不要填學校或姓名。', required: true },
    { kind: 'short', title: '座號', description: '只填數字，不要填姓名或 Email。', required: true },
  ];
  kits.forEach(kit => {
    entries.push({ kind: 'section', title: `課堂學習單：${kit.worksheet.title}`, description: kit.worksheet.intro });
    kit.worksheet.questions.forEach((q, i) => {
      const activity = design.activities.find(x => x.id === q.activityId)?.name ?? q.activityId;
      entries.push({ kind: 'paragraph', title: `${i + 1}.【${activity}】${q.prompt}` });
    });
  });
  return {
    title: clean(`${design.inputSnapshot.title}｜課堂學習單`, 300),
    description: `${design.inputSnapshot.subject}／${design.inputSnapshot.grade}。在課堂活動進行時填寫，可隨活動逐題完成。${FORM_PRIVACY_NOTE}`,
    entries: entries.map(normalize),
  };
}

function scenarioEntries(a: AssessmentVersion, push: (e: FormEntry) => void) {
  (a.scenarioSets ?? []).forEach((set, g) => {
    push({ kind: 'section', title: `第 ${g + 1} 部分`, description: '請想像自己在情境中，選出最接近你會怎麼做的一項，並寫下理由。' });
    set.items.forEach((item, i) => {
      push({ kind: 'choice', title: `${g + 1}-${i + 1}. ${item.prompt}`, description: item.scenario, options: item.options.map(o => `${o.label}. ${o.text}`) });
      push({ kind: 'paragraph', title: `${g + 1}-${i + 1} 理由：${item.reasonPrompt}` });
    });
    if (set.extension) push({ kind: 'paragraph', title: `${g + 1}-${set.items.length + 1}.（延伸題）${set.extension.prompt}` });
  });
}

function narrativeEntries(kits: NonNullable<AssessmentVersion['narrativeKits']>, phase: FormPhase, push: (e: FormEntry) => void) {
  kits.forEach((kit, group) => kit[phase].forEach((question, index) => {
    // R43 實跑：與情境題的 1-1 編號區隔。
    const number = `${phase === 'pre' ? '敘述' : '參與'} ${kits.length > 1 ? `${group + 1}-` : ''}${index + 1}`;
    const note = narrativeNote(question);
    push({ kind: 'section', title: `${number}. ${question.prompt}`, description: `${question.scenario ? '情境：' + question.scenario + '\n' : ''}${question.recall}${note ? '\n' + note : ''}` });
    question.steps.forEach((step, stepIndex) => push({ kind: 'paragraph', title: `${number}-${stepIndex + 1}. ${step.prompt}`, description: step.starter }));
  }));
}

function setEntries(set: ItemSet, number: number, push: (e: FormEntry) => void) {
  const data = set.data.trim() ? '\n\n資料：\n' + set.data.trim() : '';
  push({ kind: 'section', title: studentSetTitle(set.title, number), description: '情境：' + studentContext(set.context) + data });
  set.choices.forEach((choice, i) => push({ kind: 'choice', title: `${number}-${i + 1}. ${choice.prompt}`, options: choice.options.map(o => `${o.id}. ${o.text}`) }));
  set.opens.forEach((open, k) => {
    const label = '非選題' + (set.opens.length > 1 ? ' ' + (k + 1) : '');
    push({ kind: 'text', title: `${label}：${open.prompt}` });
    open.steps.forEach((step, i) => push({ kind: 'paragraph', title: `${label}（${i + 1}）${step.guide}`, description: step.sentenceStarter || undefined }));
  });
}

function selfAssessment(design: DesignVersion, indicatorId: string, push: (e: FormEntry) => void) {
  const reflection = fixedReflectionFor(design, indicatorId);
  if (!reflection) return;
  push({ kind: 'section', title: `自評：${reflection.dimension}／${reflection.name}`, description: SELF_ASSESSMENT_NOTE + (reflection.activities.length ? `\n可以回想的活動：${reflection.activities.join('、')}。` : '') });
  push({ kind: 'choice', title: '最接近我目前表現的一段', options: [...reflection.stages.map(row => row.text), NO_EVIDENCE_LABEL] });
  reflection.questions.forEach((q, i) => push({ kind: 'paragraph', title: `${i + 1}. ${q}` }));
}

function itemEntries(q: Item, number: number, purpose: string, push: (e: FormEntry) => void) {
  const data = q.data.trim() ? '\n\n資料：\n' + q.data.trim() : '';
  push({ kind: 'choice', title: `${purpose}第 ${number} 題：${q.prompt}`, description: `${q.title}\n情境：${q.context}${data}`, options: q.options.map(o => `${o.id}. ${o.text}`) });
  if (q.shortResponse) push({ kind: 'paragraph', title: `${purpose}第 ${number} 題 簡短說明：${q.shortResponse.prompt}`, description: '寫下你的理由與資料依據。' });
}

function legacyEntries(a: AssessmentVersion, design: DesignVersion, single: boolean, push: (e: FormEntry) => void) {
  push({ kind: 'section', title: a.phase === 'pre' ? '前測：生活情境能力題' : single ? '後測第一部分：能力題' : '後測第一部分：可比較能力題' });
  a.capability.forEach((q, i) => itemEntries(q, i + 1, '能力', push));
  if (a.phase !== 'post') return;
  push({ kind: 'section', title: '後測第二部分：學科與能力的課程應用', description: '此部分需要課程學科知識。' });
  a.application.forEach((q, i) => itemEntries(q, i + 1, '應用', push));
  if (a.reflection.length) {
    push({ kind: 'section', title: '後測第三部分：自評與一項課程證據', description: '只作反思與核對。' });
    a.reflection.forEach((r, i) => {
      push({ kind: 'choice', title: `自評 ${i + 1}：最接近我目前表現的一段`, options: [...r.descriptions, r.noEvidenceLabel] });
      push({ kind: 'paragraph', title: `自評 ${i + 1}：${r.evidencePrompt}`, description: '所述活動或作品、我的具體內容與支持理由、下一步。' });
    });
  } else if (single) {
    push({ kind: 'section', title: '後測第三部分：反思', description: REFLECTION_NOTE });
    fixedReflections(design).forEach(r => {
      push({ kind: 'choice', title: `${r.dimension}／${r.name}：最接近我目前表現的一段`, options: [...r.stages.map(s => s.text), NO_EVIDENCE_LABEL] });
      r.questions.forEach((q, i) => push({ kind: 'paragraph', title: `${r.name} ${i + 1}. ${q}` }));
    });
  }
}

// Google 表單的標題與選項不接受換行；選項不得重複或空白。
function clean(text: string, max = LIMIT) { return clip(oneLine(text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')), max); }
function normalize(entry: FormEntry): FormEntry {
  const description = entry.description?.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\r\n?/g, '\n').trim();
  const base = { ...entry, title: clean(entry.title, 1000) || '（未命名）', ...(description ? { description: clip(description) } : { description: undefined }) };
  if (entry.kind !== 'choice') return base;
  const seen = new Map<string, number>();
  const options = entry.options.map(raw => {
    const value = clean(raw, 1000) || '（空白選項）';
    const count = (seen.get(value) ?? 0) + 1;
    seen.set(value, count);
    return count > 1 ? `${value}（${count}）` : value;
  });
  if (options.length < 2) throw new Error(`「${base.title}」的選項不足兩個，無法建立表單。`);
  return { ...base, kind: 'choice', options };
}
