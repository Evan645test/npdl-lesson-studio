import type { CourseInput, DesignVersion, Project, Workspace } from '../domain/types';
import { inputSignature, validateDesignContent, validateWorkspace } from '../domain/validate';
import type { DesignContent } from '../domain/lifecycle';
import { curriculum, indicators } from '../components/labels';

export interface IntakeDraft {
  version: 1;
  id: string;
  route: 'new' | 'existing';
  title: string;
  subject: string;
  grade: string;
  periods: string;
  topic: string;
  activityIdea: string;
  expectedPerformance: string;
  background: string;
  foundation: string;
  startingPoint: string;
  sourceText: string;
  teacherNotes: string;
  curriculumIds: string[];
  indicatorIds: string[];
  reviewedFingerprint: string;
  reviewedAt: number | null;
}

const keys = ['version', 'id', 'route', 'title', 'subject', 'grade', 'periods', 'topic', 'activityIdea', 'expectedPerformance', 'background', 'foundation', 'startingPoint', 'sourceText', 'teacherNotes', 'curriculumIds', 'indicatorIds', 'reviewedFingerprint', 'reviewedAt'];
const fieldLimits: Record<string, number> = { id: 160, title: 160, subject: 160, grade: 160, periods: 3, topic: 20000, activityIdea: 20000, expectedPerformance: 20000, background: 20000, foundation: 20000, startingPoint: 20000, sourceText: 60000, teacherNotes: 60000, reviewedFingerprint: 1000000 };
const validCurriculum = new Set(curriculum.map(item => item.id));
const validIndicators = new Set(indicators.entries.map(item => item.id));

export function emptyIntake(route: IntakeDraft['route'] = 'new'): IntakeDraft {
  return { version: 1, id: crypto.randomUUID(), route, title: '', subject: '', grade: '', periods: '', topic: '', activityIdea: '', expectedPerformance: '', background: '', foundation: '', startingPoint: '', sourceText: '', teacherNotes: '', curriculumIds: [], indicatorIds: [], reviewedFingerprint: '', reviewedAt: null };
}

export function validateIntake(value: unknown): IntakeDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('發想草稿格式不符。');
  const original = value as Record<string, unknown>;
  const optional = ['activityIdea', 'expectedPerformance', 'background', 'foundation'];
  const item = { ...Object.fromEntries(optional.filter(key => !(key in original)).map(key => [key, ''])), ...original };
  if (Object.keys(item).sort().join() !== [...keys].sort().join()) throw new Error('發想草稿欄位不相容；原資料保留。');
  if (item.version !== 1 || (item.route !== 'new' && item.route !== 'existing')) throw new Error('發想草稿版本或入口不支援。');
  for (const [key, limit] of Object.entries(fieldLimits)) if (typeof item[key] !== 'string' || (item[key] as string).length > limit) throw new Error(`${key} 長度或型別不符。`);
  if (!item.id || !Number.isInteger(item.reviewedAt) && item.reviewedAt !== null || typeof item.reviewedAt === 'number' && item.reviewedAt < 1) throw new Error('發想草稿識別或核對時間不符。');
  if (!Array.isArray(item.curriculumIds) || item.curriculumIds.length > 12 || item.curriculumIds.some(id => typeof id !== 'string' || !validCurriculum.has(id)) || new Set(item.curriculumIds).size !== item.curriculumIds.length) throw new Error('發想草稿課綱不符。');
  if (!Array.isArray(item.indicatorIds) || item.indicatorIds.length > 2 || item.indicatorIds.some(id => typeof id !== 'string' || !validIndicators.has(id)) || new Set(item.indicatorIds).size !== item.indicatorIds.length) throw new Error('發想草稿子指標不符。');
  return item as unknown as IntakeDraft;
}

export function intakeFingerprint(draft: IntakeDraft): string {
  const { reviewedFingerprint: _fingerprint, reviewedAt: _at, ...content } = draft;
  void _fingerprint; void _at;
  return JSON.stringify(content);
}

export function changeIntake(draft: IntakeDraft, updates: Partial<IntakeDraft>): IntakeDraft {
  return validateIntake({ ...draft, ...updates, reviewedFingerprint: '', reviewedAt: null });
}

export function intakeGaps(draft: IntakeDraft): string[] {
  const gaps: string[] = [];
  if (!draft.subject.trim()) gaps.push('學科');
  if (!draft.grade.trim()) gaps.push('年級');
  if (!draft.title.trim()) gaps.push('單元名稱');
  if (!draft.topic.trim()) gaps.push('學科問題／課程構想');
  if (!Number.isInteger(Number(draft.periods)) || Number(draft.periods) < 1 || Number(draft.periods) > 60) gaps.push('1–60 節的總節數');
  if (draft.route === 'existing' && !draft.sourceText.trim()) gaps.push('去識別的原課程文字');
  if (!draft.curriculumIds.length) gaps.push('至少一條課綱');
  if (!draft.indicatorIds.length) gaps.push('一至兩項子指標');
  return gaps;
}

export function reviewIntake(draft: IntakeDraft): IntakeDraft {
  const gaps = intakeGaps(draft);
  if (gaps.length) throw new Error(`先補齊：${gaps.join('、')}。`);
  return validateIntake({ ...draft, reviewedFingerprint: intakeFingerprint(draft), reviewedAt: Date.now() });
}

export function intakeToInput(draft: IntakeDraft, direction: Pick<CourseInput, 'drivingQuestion' | 'finalProduct'> = {}): CourseInput {
  if (intakeGaps(draft).length || !draft.reviewedAt || draft.reviewedFingerprint !== intakeFingerprint(draft)) throw new Error('請先核對發想草稿、課綱與子指標。');
  const input: CourseInput = {
    title: draft.title.trim(), subject: draft.subject.trim(), grade: draft.grade.trim(), periods: Number(draft.periods), topic: draft.topic.trim(),
    startingPoint: { status: draft.startingPoint.trim() ? 'provided' : 'unknown', text: draft.startingPoint.trim(), assumptions: [] },
    originalSource: { kind: 'teacher', text: draft.route === 'existing' ? draft.sourceText : `教師課程構想：${draft.topic.trim()}` },
    curriculumIds: [...draft.curriculumIds], indicatorIds: [...draft.indicatorIds], teacherNotes: [draft.teacherNotes, draft.activityIdea && `活動構想：${draft.activityIdea}`, draft.expectedPerformance && `期待表現：${draft.expectedPerformance}`, draft.background && `學生背景：${draft.background}`, draft.foundation && `知識基礎：${draft.foundation}`].filter(Boolean).join('\n'),
    indicatorReview: { signature: '', confirmedAt: null },
    ...direction,
  };
  input.indicatorReview = { signature: inputSignature(input), confirmedAt: draft.reviewedAt };
  return input;
}

export function addIntakeProject(workspace: Workspace, draft: IntakeDraft, content: unknown, direction: Pick<CourseInput, 'drivingQuestion' | 'finalProduct'> = {}): Workspace {
  validateDesignContent(content);
  const input = intakeToInput(draft, direction);
  const next = structuredClone(validateWorkspace(workspace));
  if (next.projects.length >= 20) throw new Error('工作區已達 20 個專案上限。請先下載備份，再使用其他工作區。');
  const now = Date.now(), designId = crypto.randomUUID();
  const design: DesignVersion = { ...structuredClone(content as DesignContent), id: designId, createdAt: now, confirmedAt: null, origin: 'ai', inputSnapshot: structuredClone(input), rubricVersion: `npdl-four-v2:${designId}` };
  const project: Project = { id: crypto.randomUUID(), input, designs: [design], activeDesignId: designId, assessments: [], activePreId: null, activePostId: null };
  next.projects.push(project); next.activeProjectId = project.id;
  return validateWorkspace(next);
}

export function intakeStorageKey(workspaceKey: string): string { return `${workspaceKey}:intake:r07`; }

export function loadIntake(storage: Storage, key: string): { draft: IntakeDraft | null; raw: string | null; error: string | null } {
  const raw = storage.getItem(key);
  if (raw === null) return { draft: null, raw, error: null };
  try { return { draft: validateIntake(JSON.parse(raw)), raw, error: null }; }
  catch (error) { return { draft: null, raw, error: `發想草稿無法載入：${error instanceof Error ? error.message : String(error)} 原資料未改寫。` }; }
}

export function saveIntake(storage: Storage, key: string, draft: IntakeDraft, expectedRaw: string | null): string {
  const raw = JSON.stringify(validateIntake(draft));
  if (new TextEncoder().encode(raw).length > 512000) throw new Error('發想草稿超過 512KB 瀏覽器保存上限；請縮短原文。');
  if (storage.getItem(key) !== expectedRaw) throw new Error('其他分頁已修改發想草稿。請重載核對，避免覆蓋。');
  storage.setItem(key, raw);
  return raw;
}

export function clearIntake(storage: Storage, key: string, expectedRaw: string | null): void {
  if (storage.getItem(key) !== expectedRaw) throw new Error('其他分頁已修改發想草稿。請重載核對，避免清掉新內容。');
  storage.removeItem(key);
}
