// 子指標是否適合用紙筆情境題測量，決定預設測驗方式；教師可改選。
// 2026-11-06 使用者決定採較寬的判定：以 Gemini 依四階描述逐項判斷的稿為準（docs/plans/2026-11-06-子指標適合度對照.md）。
// 不適合紙筆題的子指標，預設改用課中評量＋自評（方式 E）。
import type { SetMode } from '../domain/types';

export type Assessability = 'suitable' | 'partial' | 'unsuitable';
const UNSUITABLE = ['character-grit-resilience', 'collaboration-social-emotional', 'creativity-leadership'];
const SUITABLE = ['citizenship-global-perspective', 'citizenship-sustainability', 'citizenship-real-world-problems', 'citizenship-digital', 'collaboration-digital', 'communication-audience-impact', 'communication-advocacy-impact', 'communication-digital', 'creativity-inquiry-questions', 'creativity-novel-solutions', 'critical-evaluate-information', 'critical-connections-patterns', 'critical-digital'];

export function assessabilityOf(indicatorId: string): Assessability {
  return SUITABLE.includes(indicatorId) ? 'suitable' : UNSUITABLE.includes(indicatorId) ? 'unsuitable' : 'partial';
}
export const ASSESSABILITY_LABEL: Record<Assessability, string> = { suitable: '適合紙筆情境題', partial: '部分適合', unsuitable: '建議課中評量＋自評' };
export function suggestedMode(indicatorId: string): SetMode {
  return ({ suitable: 'B', partial: 'C', unsuitable: 'E' } as const)[assessabilityOf(indicatorId)];
}
// 改選時只提醒、不阻擋。
export function modeNotice(suggested: SetMode, chosen: SetMode): string | null {
  if (suggested === chosen) return null;
  if (suggested === 'E' && chosen !== 'E') return '這個子指標主要看實際行為，建議用課中評量＋自評；紙筆題只能測到知不知道該怎麼做。結果標為「認知理解」，不判定階段。';
  if (chosen === 'A') return suggested === 'B' ? '沒有非選題確認，同一門檻只過一題時只能標「尚無法判讀」。' : '選擇題測不到要學生自己產出的部分。';
  if (suggested === 'C' && chosen === 'B') return '選擇題測不到要學生自己產出的部分。';
  if (chosen === 'E') return '改用課中評量＋自評：不出紙筆題，以課中觀察表為主要證據，學生題本附自評。';
  return null;
}
// 原建議是課中評量、卻改用紙筆題時，結果只算認知理解。
export const isCognitiveOnly = (set: { mode: SetMode; suggestedMode: SetMode }) => set.suggestedMode === 'E' && set.mode !== 'E';
