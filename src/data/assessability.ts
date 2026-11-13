// 子指標是否適合用紙筆情境題測量，決定預設測驗方式；教師可改選。
// 2026-11-06 使用者決定採較寬的判定：以 Gemini 依四階描述逐項判斷的稿為準（docs/plans/2026-11-06-子指標適合度對照.md）。
// 不適合紙筆題的子指標，預設改用課中評量＋自評（方式 E）。
import type { SetMode } from '../domain/types';

export type Assessability = 'suitable' | 'partial' | 'unsuitable';
const UNSUITABLE = ['character-grit-resilience', 'collaboration-social-emotional', 'creativity-leadership', 'character-learning-to-learn', 'character-empathy-integrity', 'citizenship-diversity-equity', 'citizenship-sustainability', 'communication-reflection', 'communication-identity-humanity', 'critical-real-world-action'];
const NARRATIVE = new Set(['character-learning-to-learn', 'character-empathy-integrity', 'citizenship-diversity-equity', 'citizenship-sustainability', 'communication-reflection', 'communication-identity-humanity']);
const SUITABLE = ['citizenship-global-perspective', 'citizenship-sustainability', 'citizenship-real-world-problems', 'citizenship-digital', 'collaboration-digital', 'communication-audience-impact', 'communication-advocacy-impact', 'communication-digital', 'creativity-inquiry-questions', 'creativity-novel-solutions', 'critical-evaluate-information', 'critical-connections-patterns', 'critical-digital'];

export function assessabilityOf(indicatorId: string): Assessability {
  return UNSUITABLE.includes(indicatorId) ? 'unsuitable' : SUITABLE.includes(indicatorId) ? 'suitable' : 'partial';
}
export const ASSESSABILITY_LABEL: Record<Assessability, string> = { suitable: '適合紙筆情境題', partial: '部分適合', unsuitable: '建議課中評量或經驗敘述' };
export function suggestedEvidence(indicatorId: string): 'worksheet' | 'narrative' { return NARRATIVE.has(indicatorId) ? 'narrative' : 'worksheet'; }
export function suggestedMode(indicatorId: string): SetMode {
  return ({ suitable: 'B', partial: 'C', unsuitable: 'E' } as const)[assessabilityOf(indicatorId)];
}
export const NARRATIVE_MODE_NOTICE = '前測請學生寫相關經驗與想法，後測寫課程參與；教師在課堂用勾選表觀察。前後測證據類型不同，比較條件待確認。';
const WORKSHEET_EVIDENCE_NOTICE = '課堂學習單以課中任務與作品為主；經驗敘述著重學生自述。請依本子指標選合適的方式。';

// 改選時只提醒、不阻擋。
export function modeNotice(suggested: SetMode, chosen: SetMode): string | null {
  if (suggested === chosen) return null;
  if (suggested === 'E' && chosen !== 'E') return '這個子指標主要看實際行為，建議用課中評量＋自評；紙筆題只能測到知不知道該怎麼做。結果標為「認知理解」，不判定階段。';
  if (chosen === 'A') return suggested === 'B' ? '沒有非選題確認，同一門檻只過一題時只能標「尚無法判讀」。' : '選擇題測不到要學生自己產出的部分。';
  if (suggested === 'C' && chosen === 'B') return '選擇題測不到要學生自己產出的部分。';
  if (chosen === 'E') return '改用課中評量＋自評：不出紙筆題，以課中觀察表為主要證據，學生題本附自評。';
  return null;
}
export function choiceNotice(row: { indicatorId: string; suggestedMode: SetMode; mode: SetMode; evidence?: 'worksheet' | 'narrative' }): string | null {
  const base = modeNotice(row.suggestedMode, row.mode);
  if (base) return base;
  const suggestedEvidenceKind = suggestedEvidence(row.indicatorId);
  const chosenEvidence = row.mode === 'E' ? (row.evidence ?? suggestedEvidenceKind) : undefined;
  if (row.mode === 'E' && row.suggestedMode === 'E' && chosenEvidence !== suggestedEvidenceKind) {
    return chosenEvidence === 'narrative' ? NARRATIVE_MODE_NOTICE : WORKSHEET_EVIDENCE_NOTICE;
  }
  if (row.mode === 'E' && chosenEvidence === 'narrative' && row.suggestedMode !== 'E') return NARRATIVE_MODE_NOTICE;
  return null;
}
// 原建議是課中評量、卻改用紙筆題時，結果只算認知理解。
export const isCognitiveOnly = (set: { mode: SetMode; suggestedMode: SetMode }) => set.suggestedMode === 'E' && set.mode !== 'E';
