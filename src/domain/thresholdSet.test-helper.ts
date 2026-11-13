// 門檻題組測試共用：依測驗方式產生一份結構合格的題組（模擬 AI 依新契約回傳的內容）。
import { MODE_PLAN, type ItemSet, type SetMode } from './types';

export function sampleSet(indicatorId: string, criterionIds: string[], variant: string, mode: SetMode = 'B', suggestedMode: SetMode = mode, activityIds: string[] = []): ItemSet {
  const plan = MODE_PLAN[mode];
  const base = { id: `set-${variant}-${indicatorId}`, indicatorId, criterionIds, title: `${variant}題組`, mode, suggestedMode,
    conditions: { knowledge: '不需專業知識', reading: '約一頁', complexity: '兩項資料', reasoning: '比較與取捨', prompts: '句型開頭' } };
  if (mode === 'E') return { ...base, context: '', data: '', choices: [], opens: [], observation: { activityIds, focus: '小組討論時是否引用資料支持主張', behaviors: ['沒有引用資料', '引用一筆資料', '比較多筆資料', '指出資料限制並修正主張'] } };
  return {
    ...base,
    context: `${variant}：社區準備調整回收站位置，住戶意見不一（模擬資料）。`,
    data: `${variant}資料｜時段｜投遞量（模擬資料）\n早上｜120\n晚上｜80`,
    choices: plan.choices.map((threshold, index) => ({
      id: `${variant}-q${index + 1}`, threshold, prompt: `依表中資料，第 ${index + 1} 題哪一種判斷最有依據？`,
      // 門檻以上選項的位置在各題間輪替。
      options: ['A', 'B', 'C', 'D'].map((letter, i) => ({ id: letter, text: `${variant}第${index + 1}題選項${letter}`, above: i === index % 4, thinking: i === index % 4 ? '連結資料與理由' : `常見想法 ${i}，還不足以通過` })),
    })),
    opens: plan.opens.map((steps, k) => ({ prompt: `請依情境回答非選題 ${k + 1}。`, steps: steps.map((threshold, i) => ({ threshold, guide: `第 ${k + 1} 題第 ${i + 1} 段引導問題`, sentenceStarter: '我認為……，因為……', aboveFeatures: '指出資料並說明理由', aboveExample: '早上投遞量較高，所以……', belowExample: '我覺得都可以' })) })),
  };
}
