// R12-r5：同意視窗先用白話列出這次會送出的內容，原始 JSON 收在「進階」。
import { plainProblem } from './uxText';
type Row = Record<string, unknown>;
const count = (value: unknown) => Array.isArray(value) ? value.length : 0;
const chars = (value: unknown) => typeof value === 'string' ? value.length : 0;
const names = (value: unknown, key: string) => Array.isArray(value) ? value.map(item => (item as Row)?.[key]).filter(Boolean).join('、') : '';
const FREE_TEXT = ['sourceText', 'lessonSummary', 'referencePretest', 'teacherSuggestion'] as const;

export function hasFreeText(payload: Row): boolean {
  const postAnchor = (payload.assessmentBlueprint as Row | undefined)?.postAnchor as Row | undefined;
  return FREE_TEXT.some(key => chars(payload[key]) > 0)
    || Boolean((payload.assessmentBlueprint as Row | undefined)?.itemBlueprint)
    || count(payload.observationActivities) > 0
    || Boolean(postAnchor?.kind === 'activity' && (chars(postAnchor.task) || chars(postAnchor.knowledgeUse)))
    || Boolean(postAnchor?.kind === 'course' && (chars(postAnchor.drivingQuestion) || chars(postAnchor.finalProduct)));
}

export function summarizePayload(payload: Row): string[] {
  const lines: string[] = [];
  const course = (payload.course ?? (payload.grade ? payload : null)) as Row | null;
  if (course) lines.push(`課程：${course.grade ?? ''}${course.subject ?? ''}「${course.title ?? ''}」${course.periods ? `，${course.periods} 節` : ''}${course.topic ? `；主題：${course.topic}` : ''}${course.keywords ? `；關鍵字：${course.keywords}` : ''}`);
  // 驅動問題與最終作品（教師選定或自己寫的）：推薦時放在 teacherDirection，之後放在 course。
  const direction = (payload.teacherDirection ?? course ?? {}) as Row;
  if (chars(direction.drivingQuestion)) lines.push(`驅動問題：「${direction.drivingQuestion as string}」`);
  if (chars(direction.finalProduct)) lines.push(`最終作品：「${direction.finalProduct as string}」`);
  if (payload.task === 'recommend-curriculum-and-npdl') {
    lines.push('請 AI 提出 3 個課程方向（各含驅動問題、最終作品、學習表現、學習內容與子指標）', `程式依主題與關鍵字先挑出的候選課綱：學習表現 ${count(payload.learningPerformances)} 條、學習內容 ${count(payload.learningContents)} 條（讓 AI 從中推薦；其他條目你仍可自行選）`, `可選的 NPDL 子指標 ${count(payload.indicators)} 項（只有名稱）`);
  } else {
    if (count(payload.curriculum)) lines.push(`已選課綱 ${count(payload.curriculum)} 條：${names(payload.curriculum, 'code')}`);
    if (count(payload.indicators)) lines.push(`NPDL 子指標：${names(payload.indicators, 'name')}（含四階進程原文）`);
  }
  if (count(payload.approvedGoals)) lines.push(`已核對的學習目標 ${count(payload.approvedGoals)} 項`);
  if (count(payload.approvedCriteria)) lines.push(`已核對的四階規準 ${count(payload.approvedCriteria)} 組`);
  const outline = payload.approvedOutline as Row | undefined;
  if (outline) lines.push(`已核對的目標 ${count(outline.goals)} 項、規準 ${count(outline.criteria)} 組、核心活動 ${count(outline.activities)} 個`);
  const design = payload.design as Row | undefined;
  if (design) lines.push(`已確認的課程設計：目標 ${count(design.goals)} 項、規準 ${count(design.criteria)} 組、前後測配對 ${count(design.blueprint)} 組、教案 ${count(design.activities)} 節`);
  if (payload.goals && payload.lesson) lines.push(`要重寫的節次：${(payload.lesson as Row).name ?? ''}`);
  const blueprint = payload.assessmentBlueprint as Row | undefined;
  const itemBlueprint = blueprint?.itemBlueprint as Row | undefined;
  // R33：情境進程題與面向整理。
  if (payload.task === 'draft-progression-aspects') lines.push('請 AI 從四階原文為每個子指標整理 3 個面向（附教師已確認的本課規準；不送教案、學生或題本資料）');
  if (payload.task === 'draft-classroom-kit') lines.push(`請 AI 為課中觀察的子指標產生學習單與課堂表現勾選表：${((payload.indicators ?? []) as Row[]).map(p => `${p.name}（規準 ${count(p.criteria)} 組、相連活動 ${count(p.activities)} 節）`).join('；')}（不送學生資料）`);
  const scenario = typeof payload.task === 'string' && payload.task.startsWith('scenario-progression-');
  if (scenario) {
    const plans = (payload.indicators ?? []) as Row[];
    lines.push(`本次只產生${payload.phase === 'pre' ? '前測（生活情境）' : '後測（課程情境）'}情境進程題：每個已確認面向各 1 題選擇（附理由），每個子指標另 1 題延伸題：${plans.map(p => `${p.name}（${((p.aspects ?? []) as Row[]).map(a => a.label).join('、')}）`).join('；')}`);
    const ctx = payload.courseContext as Row | undefined;
    if (ctx) lines.push(`後測課程情境參考：驅動問題、最終作品與教案 ${count(ctx.activities)} 節的名稱與任務（不送前測原文）`);
  }
  if (!scenario && (payload.phase === 'pre' || payload.phase === 'post')) {
    lines.push(`本次只產生${payload.phase === 'pre' ? '前測' : '後測'}，沿用已確認的評量規準 ${count(payload.criteria)} 組。`);
    const load = payload.preWorkloadSummary as Row | undefined;
    if (load) lines.push(`已核對的前測負擔摘要：${count(load.slots)} 個題位（只含取證量、步驟、提示程度、材料形式與文字長度；不含題文或答案）`);
    if (count(payload.observationActivities)) lines.push(`可供課中觀察的活動 ${count(payload.observationActivities)} 節`);
  }
  if (itemBlueprint) lines.push(`已確認的逐題藍圖：${count(itemBlueprint.slots)} 個紙筆題位（含判斷、必要證據與${payload.phase === 'pre' ? '前測' : payload.phase === 'post' ? '後測' : '前後測'}作答負擔）`);
  const strategy = blueprint?.strategy as Row | undefined;
  const postAnchor = blueprint?.postAnchor as Row | undefined;
  if (chars(strategy?.label)) lines.push(`分科出題策略：${strategy!.label}（紙筆前後測共用）`);
  if (postAnchor?.kind === 'course') {
    lines.push(`後測情境：單元主情境「${postAnchor.title ?? course?.title ?? ''}」`);
    if (chars(postAnchor.drivingQuestion)) lines.push(`後測驅動問題：「${postAnchor.drivingQuestion}」`);
    if (chars(postAnchor.finalProduct)) lines.push(`後測最終作品：「${postAnchor.finalProduct}」`);
  } else if (postAnchor?.kind === 'activity') {
    lines.push(`後測情境：課堂活動「${postAnchor.label ?? postAnchor.name ?? ''}」`);
    if (chars(postAnchor.task)) lines.push(`該節課堂任務：${postAnchor.task}`);
    if (chars(postAnchor.knowledgeUse)) lines.push(`該節使用的方法：${postAnchor.knowledgeUse}`);
  }
  const current = payload.currentVersion as Row | undefined, paired = payload.pairedTest as Row | undefined;
  if (current) lines.push(`目前這份${Array.isArray(current.sets) ? `題組 ${count(current.sets)} 組` : `題目 ${count(current.capability) + count(current.application)} 題`}（會被新版本取代，舊版保留）`);
  if (paired) lines.push(`不變的${paired.phase === 'pre' ? '前測' : '後測'} ${Array.isArray(paired.sets) ? `${count(paired.sets)} 組` : `${count(paired.capability)} 題`}（只參考題型與難度）`);
  if (payload.selectedItem) lines.push(`要重生的題目：${(payload.selectedItem as Row).title ?? ''}`);
  if (payload.pairedPre || payload.pairedPost) lines.push(`同一配對的${payload.pairedPre ? '前測' : '後測'}題目「${((payload.pairedPre ?? payload.pairedPost) as Row).title ?? ''}」（只供 AI 避免照抄、對齊難度，不會被改動）`);
  if (chars(payload.sourceText)) lines.push(`去識別後的教案文字（${chars(payload.sourceText)} 字）`);
  if (chars(payload.lessonSummary)) lines.push(`教案重點摘要（${chars(payload.lessonSummary)} 字）`);
  if (chars(payload.referencePretest)) lines.push(`舊前測（${chars(payload.referencePretest)} 字，只參考題型與難度）`);
  if (chars(payload.teacherSuggestion)) lines.push(`老師建議：「${payload.teacherSuggestion as string}」`);
  const batch = payload.batch as Row | undefined;
  if (batch) lines.push(Number(batch.index) === 1 ? `完整逐節教案分 ${batch.total} 批產生（每批最多 4 節）；同意後各批依序送出，第 2 批起附上前面節次的名稱與任務摘要` : `完整逐節教案第 ${batch.index}/${batch.total} 批（第 ${batch.from}–${batch.to} 節），附上前面節次的名稱與任務摘要`);
  if (payload.repair) lines.push(`上次 AI 回傳的內容，以及要它修正的地方：${plainProblem(String((payload.repair as Row).problem ?? ''))}`);
  lines.push('不會送出：API key、學生作答或學生資料。');
  return lines;
}
