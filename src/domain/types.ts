export const STAGES = ['證據有限', '萌芽', '發展', '精熟'] as const;
export type Stage = typeof STAGES[number];
export type Four = [string, string, string, string];
export interface CourseInput {
  title: string; subject: string; grade: string; periods: number; topic: string;
  startingPoint: { status: 'unknown' | 'provided'; text: string; assumptions: string[] };
  originalSource: { kind: 'manual-example' | 'teacher'; text: string };
  curriculumIds: string[]; indicatorIds: string[];
  teacherNotes?: string;
  // 單一路徑教師選定的驅動問題與最終作品（2026-11-07）；舊專案沒有。
  drivingQuestion?: string; finalProduct?: string;
  indicatorReview?: { signature: string; confirmedAt: number | null };
}
export interface Criterion {
  id: string; indicatorId: string; label: string; observable: string; scope: string; unobserved: string; stages: Four;
  // R31：NPDL 學生版原文逐句 → 本課可觀察表現；stages 由此組成。舊設計可沒有。
  alignment?: string[][];
}
export interface Activity {
  id: string; name: string; periods: number; goalIds: string[]; criterionIds: string[];
  task: string; knowledgeUse: string; evidence: string; formative: string;
  scaffolds: { stage: Stage; support: string; fading: string }[];
}
export interface Conditions {
  knowledge: string; reading: string; complexity: string; reasoning: string; prompts: string;
}
export type ComparisonStatus = '可作有限比較' | '比較條件待確認' | '不宜比較' | '只有單次資料';
export interface DesignVersion {
  id: string; createdAt: number; confirmedAt: number | null; origin: 'manual-example' | 'teacher' | 'ai';
  inputSnapshot: CourseInput; summary: string; rubricVersion: string; rubricSource: string;
  goals: { id: string; kind: 'academic' | 'npdl'; text: string; success: string; curriculumIds: string[] }[];
  criteria: Criterion[]; activities: Activity[];
  elements: { name: '學習夥伴關係' | '學習環境' | '教學實踐' | '數位利用'; practice: string; limitation: string }[];
  integration: { indicatorId: string; status: 'draft' | 'confirmed' | 'missing'; criterionIds: string[]; rule: string }[];
  blueprint: { preId: string; postId: string; criterionIds: string[]; status: ComparisonStatus; reason: string }[];
}
export interface Option { id: string; text: string; supports: string[]; limitations: string[] }
export interface Item {
  id: string; title: string; context: string; data: string; prompt: string;
  criterionIds: string[]; options: Option[]; conditions: Conditions;
  applicationCriteria: { academic: string; capability: string } | null;
  shortResponse?: { prompt: string; example: string; evidence: string };
  curriculumIds?: string[];
}
export interface Reflection {
  indicatorId: string; descriptions: Four; activityIds: string[]; evidencePrompt: string; noEvidenceLabel: string;
}
// 門檻題組（2026-11-06 使用者決定，見 docs/plans/2026-11-06-前後測門檻題組.md）：
// 每個子指標一組＝共同情境＋5 題 2–2–1 門檻選擇題＋三段引導非選題。題目對應門檻，選項不對應階段。
export const THRESHOLDS = ['證據有限→萌芽', '萌芽→發展', '發展→精熟'] as const;
export type Threshold = typeof THRESHOLDS[number];
// 測驗方式（2026-11-06 使用者決定）：教師替每個子指標選一種，前後測相同。
// A 6 選擇；B 5 選擇（2–2–1）＋1 題三段非選；C 3 選擇＋2 題非選；D 2 題非選；E 課中評量＋自評（課中觀察表為主要證據，學生題本附自評）。
export const MODES = ['A', 'B', 'C', 'D', 'E'] as const;
export type SetMode = typeof MODES[number];
const [T1, T2, T3] = THRESHOLDS;
export const MODE_PLAN: Record<SetMode, { label: string; choices: readonly Threshold[]; opens: readonly (readonly Threshold[])[] }> = {
  A: { label: 'A 選擇題組（6 題選擇）', choices: [T1, T1, T2, T2, T3, T3], opens: [] },
  B: { label: 'B 選擇加 1 題非選（5 題選擇 2–2–1＋三段非選）', choices: [T1, T1, T2, T2, T3], opens: [[T1, T2, T3]] },
  C: { label: 'C 選擇加 2 題非選（3 題選擇＋2 題非選）', choices: [T1, T2, T3], opens: [[T1, T2], [T3]] },
  D: { label: 'D 全非選（2 題引導式非選）', choices: [], opens: [[T1, T2], [T3]] },
  E: { label: 'E 課中評量＋自評（不出紙筆題）', choices: [], opens: [] },
};
export interface ThresholdOption { id: string; text: string; above: boolean; thinking: string }
export interface ThresholdItem { id: string; threshold: Threshold; prompt: string; options: ThresholdOption[] }
export interface OpenStep { threshold: Threshold; guide: string; sentenceStarter: string; aboveFeatures: string; aboveExample: string; belowExample: string }
export interface OpenItem { prompt: string; steps: OpenStep[] }
// 方式 E：課中觀察表（主要證據）。四階描述是看得見的行為；座號勾選與一句事實在文件上填寫。學生自評由程式固定提供（fixedReflection）。
export interface Observation { activityIds: string[]; focus: string; behaviors: Four }
export interface ItemSet {
  id: string; indicatorId: string; criterionIds: string[]; title: string; context: string; data: string;
  // mode 是教師選的方式，suggestedMode 是依子指標適合度的原建議；兩者都由程式寫入。
  mode: SetMode; suggestedMode: SetMode;
  choices: ThresholdItem[]; opens: OpenItem[]; observation?: Observation; conditions: Conditions;
}
export type AssessmentFormat = 'threshold-set-v1' | 'scenario-progression-v1';
export const BLUEPRINT_SUPPORT = ['none', 'focus', 'starter'] as const;
export type BlueprintSupport = typeof BLUEPRINT_SUPPORT[number];
export interface ItemWorkload { evidenceUnits: number; operations: number; support: BlueprintSupport }
export interface BlueprintPosition { indicatorId: string; kind: 'choice' | 'open'; question: number; step: number | null; threshold: Threshold }
export interface ItemBlueprintSlot extends BlueprintPosition { judgment: string; evidence: string; pre: ItemWorkload; post: ItemWorkload; balanceNote: string }
export interface ItemBlueprint { version: 1; slots: ItemBlueprintSlot[] }
export interface AssessmentBlueprintSelection { strategyId: string; postActivityId: string | null; itemBlueprint?: ItemBlueprint }
export interface AssessmentVersion {
  id: string; phase: 'pre' | 'post'; parentPreId: string | null; designId: string; rubricVersion: string;
  createdAt: number; reviewedAt: number | null; administeredAt: number | null;
  capability: Item[]; application: Item[]; reflection: Reflection[];
  // 沒有 format 的是舊格式（能力題配對＋課綱應用題）；新格式的 capability／application／reflection 都是空陣列。
  format?: AssessmentFormat; sets?: ItemSet[];
  // 分開出題的前測；reviewedAt 為教師完成實際負擔核對的時間。
  splitSequence?: 1;
  // 紙筆成對題組由程式保存；單份重寫須沿用。舊題組可沒有此欄位。
  assessmentBlueprint?: AssessmentBlueprintSelection;
  // R31：情境自陳題（前測 2、後測 3）。只取得學生自陳，不計分、不改變能力階段。
  selfReport?: import('./selfReport').SelfReport;
  // R33：情境進程題（format scenario-progression-v1）。aspects 為已確認面向，scenarioSets 為各子指標 1 題（R36 起；舊題本 2–3 題）；方式 E 仍放在 sets。
  aspects?: import('./scenarioProgression').AspectPlan[];
  scenarioSets?: import('./scenarioProgression').ScenarioSet[];
  // R41：方式 E 子指標的學習單與課堂表現勾選表（AI 產生、教師核對；只存在前測，後測沿用）。
  classroomKits?: import('./classroomKit').ClassroomKit[];
  // R43：方式 F 經驗敘述前後題、判讀錨點與課堂參與勾選表；只存在前測，後測沿用。
  narrativeKits?: import('./narrativeKit').NarrativeKit[];
}
export interface Project {
  id: string; input: CourseInput; designs: DesignVersion[]; activeDesignId: string;
  assessments: AssessmentVersion[]; activePreId: string | null; activePostId: string | null;
  workflow?: 'single-v1';
  // R12：教師貼上的舊前測，只當題型與難度參考；deidentifiedAt 為教師確認去識別的時間。
  referencePretest?: { text: string; deidentifiedAt: number | null };
}
export interface LegacyImport {
  id: string;
  kind: 'assessment-studio' | 'course-workspace';
  sourceVersion: number;
  filename: string;
  title: string;
  importedAt: number;
  sha256: string;
  raw: string;
}
export interface Workspace { schemaVersion: 1 | 2; activeProjectId: string; projects: Project[]; legacyImports?: LegacyImport[] }
