import { STAGES, type AssessmentVersion, type DesignVersion, type Project } from '../domain/types';
import curriculum from '../data/curriculum.json';
import indicators from '../data/indicators.json';

// R12-r10：完整課程 PDF 的「課程一覽」資料。只整理已保存的設計與題組，不新增判讀。
export interface OverviewPeriod { label: string; name: string; task: string; evidence: string; formative: string; knowledgeUse: string; criteria: string[]; scaffolds: { stage: string; support: string; fading: string }[] }
export interface OverviewGroup { label: string; name: string; evidence: string }
export interface OverviewPair { pre: string; post: string; criteria: string }
export interface LessonOverview {
  title: string;
  meta: string;
  status: string;
  drivingQuestion: string;
  finalProduct: string;
  goals: { kind: '學科' | 'NPDL'; text: string; success: string }[];
  curriculum: { code: string; kind: string; text: string }[];
  focus: { dimension: string; name: string; criterion: string }[];
  elements: { name: string; practice: string; limitation: string }[];
  periods: OverviewPeriod[];
  groups: OverviewGroup[];
  assessment: { preStatus: string; postStatus: string; pairs: OverviewPair[]; extras: string };
  criteria: { label: string; dimension: string; observable: string; scope: string; unobserved: string; stages: { stage: string; text: string }[] }[];
  integration: string[];
  note: string;
}

const periodLabel = (start: number, count: number) => count > 1 ? `第 ${start}–${start + count - 1} 節` : `第 ${start} 節`;
const assessmentStatus = (a: AssessmentVersion | undefined, name: string) => !a ? `${name}尚未生成` : `${name} ${a.format ? `${a.sets?.length ?? 0} 組門檻題組` : `${a.capability.length + a.application.length} 題`}・${a.reviewedAt ? '教師已確認' : '待教師確認'}・${a.administeredAt ? '已記錄施測' : '尚未施測'}`;

export function activeLessonDesign(project: Project): DesignVersion {
  const design = project.designs.find(row => row.id === project.activeDesignId);
  if (!design) throw new Error('目前課程設計不存在。');
  return design;
}

export function buildLessonOverview(project: Project): LessonOverview {
  const design = activeLessonDesign(project), input = design.inputSnapshot;
  const pre = project.assessments.find(a => a.id === project.activePreId && a.designId === design.id);
  const post = project.assessments.find(a => a.id === project.activePostId && a.designId === design.id);
  const criterionLabel = new Map(design.criteria.map(c => [c.id, c.label]));
  const indicatorOf = (id: string) => indicators.entries.find(entry => entry.id === id);
  let start = 1;
  const periods = design.activities.map(activity => {
    const count = Math.max(1, activity.periods || 1), label = periodLabel(start, count); start += count;
    // AI 常在活動名稱前加「第1節：」，節次已另外標示，避免重複。
    return { label, name: activity.name.replace(/^第\s*[\d一二三四五六七八九十]+\s*(?:[–\-~至]\s*[\d一二三四五六七八九十]+\s*)?節\s*[：:｜|]\s*/, '') || activity.name, task: activity.task, evidence: activity.evidence, formative: activity.formative, knowledgeUse: activity.knowledgeUse, criteria: activity.criterionIds.map(id => criterionLabel.get(id) ?? id), scaffolds: activity.scaffolds.map(s => ({ stage: s.stage, support: s.support, fading: s.fading })) };
  });
  let groupStart = 1;
  const grouped: Array<{ start: number; count: number; name: string; evidence: string }> = [];
  periods.forEach((period, index) => {
    const count = Math.max(1, design.activities[index].periods || 1);
    const last = grouped.at(-1);
    if (last?.name === period.name) last.count += count;
    else grouped.push({ start: groupStart, count, name: period.name, evidence: period.evidence });
    groupStart += count;
  });
  const groups = grouped.map(g => ({ label: periodLabel(g.start, g.count), name: g.name, evidence: g.evidence }));
  // 不把內部題號印給教師：題組缺少或找不到題目時明示。
  const itemTitle = (a: AssessmentVersion | undefined, id: string) => !a ? '（題組尚未生成）' : a.capability.find(q => q.id === id)?.title || '（找不到對應題目）';
  // 門檻題組依子指標配對前後測題組。
  const pairs = pre?.format ? (pre.sets ?? []).map(set => ({ pre: set.title, post: post?.sets?.find(row => row.indicatorId === set.indicatorId)?.title ?? '（後測題組尚未生成）', criteria: set.criterionIds.map(id => criterionLabel.get(id) ?? id).join('、') }))
    : design.blueprint.map(b => ({ pre: itemTitle(pre, b.preId), post: itemTitle(post, b.postId), criteria: b.criterionIds.map(id => criterionLabel.get(id) ?? id).join('、') }));
  const extras = pre?.format ? '各子指標的測驗方式：' + (pre.sets ?? []).map(set => (indicatorOf(set.indicatorId)?.name ?? set.indicatorId) + ' 採 ' + set.mode).join('、') + '。' + ((pre.sets ?? []).some(set => set.mode === 'E') ? '方式 E 為課中觀察與自評，結果與紙筆題組分開。' : '') : post ? '後測的課程應用與自評和能力題分開判讀。' : '後測尚未生成。';
  return {
    title: input.title,
    meta: `${input.subject}・${input.grade}・${input.periods} 節`,
    status: `${design.confirmedAt ? '教師已確認設計' : '設計待教師核對'}・課程規劃尚未實施`,
    // 有教師選定的驅動問題時用它；舊專案沿用教學主題。
    drivingQuestion: input.drivingQuestion?.trim() || input.topic,
    finalProduct: input.finalProduct?.trim() ?? '',
    goals: design.goals.map(g => ({ kind: g.kind === 'academic' ? '學科' as const : 'NPDL' as const, text: g.text, success: g.success })),
    curriculum: input.curriculumIds.map(id => curriculum.find(row => row.id === id)).filter(row => !!row).map(row => ({ code: row!.code, kind: row!.kind === 'learning_performance' ? '學習表現' : '學習內容', text: row!.text })),
    focus: input.indicatorIds.map(id => ({ dimension: indicatorOf(id)?.dimension ?? '', name: indicatorOf(id)?.name ?? id, criterion: design.criteria.filter(c => c.indicatorId === id).map(c => c.label).join('、') })),
    elements: design.elements.map(e => ({ name: e.name, practice: e.practice, limitation: e.limitation })),
    periods,
    groups,
    assessment: { preStatus: assessmentStatus(pre, '前測'), postStatus: assessmentStatus(post, '後測'), pairs, extras },
    criteria: design.criteria.map(c => ({ label: c.label, dimension: `${indicatorOf(c.indicatorId)?.dimension ?? ''}／${indicatorOf(c.indicatorId)?.name ?? c.indicatorId}`, observable: c.observable, scope: c.scope, unobserved: c.unobserved, stages: c.stages.map((text, i) => ({ stage: STAGES[i], text })) })),
    integration: design.integration.map(r => `${indicatorOf(r.indicatorId)?.name ?? r.indicatorId}（${r.status === 'confirmed' ? '教師已確認' : r.status === 'missing' ? '缺少規則' : '待教師確認'}）：${r.rule || '尚無法整合，只列分項。'}`),
    note: '本文件是課程規劃，不代表已實施或學習成效；前後測未以真實學生作答校準。請使用班級代號及去識別代稱，不填姓名。',
  };
}
