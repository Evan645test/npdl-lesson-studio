import { STAGES, type DesignVersion } from '../domain/types';
import indicators from '../data/indicators.json';

// R12-r12（2026-11-06 使用者決定）：單一路徑的後測第三部分是固定反思題，不由 AI 產生、不存進題組。
// 每個選定子指標一組：學生進程四階描述（依《學生版學習進程》原文）、「目前沒有足夠證據」與檢核表的三個反思問題。
// 只作反思，不改變能力題的結果。
export interface FixedReflection { dimension: string; name: string; stages: { stage: string; text: string }[]; activities: string[]; questions: string[] }

export const REFLECTION_QUESTIONS = [
  '我目前的表現最接近哪一段描述？請指向這次任務中的具體內容。',
  '我能拿出什麼作品、發言、行動或修訂，支持這個判斷？',
  '下一次我先改善哪一件事？需要什麼支持，之後如何檢核？',
];
export const NO_EVIDENCE_LABEL = '目前沒有足夠證據可以判斷（不扣分，也不代表最低階）';
export const REFLECTION_NOTE = '這部分只作反思與核對，不改變能力題的結果。';

export function fixedReflections(design: DesignVersion): FixedReflection[] {
  return design.inputSnapshot.indicatorIds.flatMap(id => {
    const indicator = indicators.entries.find(row => row.id === id);
    if (!indicator) return [];
    const criteria = new Set(design.criteria.filter(c => c.indicatorId === id).map(c => c.id));
    const activities = design.activities.filter(a => a.criterionIds.some(c => criteria.has(c))).map(a => a.name);
    return [{ dimension: indicator.dimension, name: indicator.name, stages: indicator.stages.map((text, i) => ({ stage: STAGES[i], text })), activities, questions: REFLECTION_QUESTIONS }];
  });
}

// 方式 E（課中評量＋自評）：只取指定子指標的自評，前測與後測都附在學生題本。
export function fixedReflectionFor(design: DesignVersion, indicatorId: string): FixedReflection | undefined {
  return fixedReflections(design).find(row => row.name === indicators.entries.find(entry => entry.id === indicatorId)?.name);
}
export const SELF_ASSESSMENT_NOTE = '自評：讀完四段描述，勾選最接近你目前表現的一段，再回答下面三個問題。老師會對照課堂上的觀察和你一起核對；這不是考試，也不扣分。';
