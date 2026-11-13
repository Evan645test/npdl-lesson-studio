// R12-r11：給教師看的白話訊息與等待預估。技術原因只送給 AI 修正用，不顯示在畫面上。

// AI 回傳不符合規定時，依技術原因換成老師看得懂的一句話。
export function plainProblem(reason: string): string {
  // R36：情境題的原因已逐題寫出字數與改法，直接給老師看（放最前面，避免被「四階」「欄位」等規則攔截）。
  if (reason.startsWith('情境題：')) return `AI 出的情境題${reason.slice(4).replace(/[。.]+$/, '')}。`;
  if (reason.startsWith('學習單：')) return `AI 產生的學習單或勾選表${reason.slice(4).replace(/[。.]+$/, '')}。`;
  // 誘答線索（2026-11-07）：放在最前面，原因文字含「門檻」等字，不能落到後面的結構錯誤。
  // 課程方向不足（2026-11-07）：原因文字含「課綱建議」等字，要先判斷。
  if (reason.startsWith('課程方向不足')) return `AI 提出的課程方向不足 3 個${(reason.match(/只有 (\d+) 個方向/) ?? [])[1] ? `（只有 ${(reason.match(/只有 (\d+) 個方向/) ?? [])[1]} 個符合規定）` : ''}，其他方向缺學習表現、學習內容或子指標，或欄位不符合規定。`;
  if (reason.startsWith('誘答線索')) return '題目已產生，但有些選項不讀情境也可能猜到答案（正確選項特別長，或錯誤選項用了「完全、任何」這類字）。';
  if (reason.includes('資料量太大')) return 'AI 的回覆格式不對，而且內容太長，無法再請 AI 修正。';
  if (/JSON|Unexpected|position \d+/i.test(reason)) return 'AI 的回覆在中途斷掉或格式壞了，常發生在內容很長的時候。';
  if (reason.includes('題目用途')) return 'AI 把能力題寫成了應用題的格式。';
  // 課綱與子指標推薦（第 1 步）的原因。
  if (reason.includes('課綱建議')) return 'AI 推薦的課綱條目對不上本學科的固定課綱資料。';
  if (/驅動問題或最終作品|缺少 directions/.test(reason)) return 'AI 提出的課程方向少了驅動問題或最終作品。';
  if (/課程方向缺(學習表現|學習內容|子指標)/.test(reason)) return `AI 提出的課程方向${(reason.match(/缺(學習表現|學習內容|子指標)/) ?? ['', ''])[0]}。`;
  if (reason.includes('子指標建議')) return 'AI 推薦的 NPDL 子指標對不上 29 項清單。';
  if (/發想建議|名稱、節數或理由/.test(reason)) return 'AI 推薦的單元名稱、節數或理由格式不對。';
  if (reason.includes('推薦須包含學習表現')) return 'AI 推薦的課綱只有學習內容，沒有學習表現。';
  // 門檻題組（2026-11-06）：截斷與門檻結構的原因。
  if (reason.includes('題本不完整')) return `AI 的題本少了內容，可能在中途被截斷：${reason.replace(/^題本不完整：/, '').replace(/[。.]+$/, '')}。`;
  if (/門檻|題組數|恰好 1 個/.test(reason)) return 'AI 出的門檻題組結構不對（題數、門檻順序或正確選項數）。';
  // R12-r9 起課綱題的原因已是具體白話（指出缺哪一條），直接保留。
  if (/課綱題|課綱編號|學習表現/.test(reason)) return `AI 出的課綱題不完整：${reason.replace(/[。.]+$/, '')}。`;
  if (/配對|blueprint|題號/.test(reason)) return 'AI 出的前後測配對題和設計對不上。';
  if (/欄位|outputSchema|結構/.test(reason)) return 'AI 回傳的欄位和要求的不一樣。';
  if (/四階|stage/.test(reason)) return 'AI 回傳的四階描述不完整。';
  return 'AI 回傳的內容有地方不符合規定。';
}

export function repairMessage(reason: string): string {
  return `${plainProblem(reason)}這不是你的操作問題。按「請 AI 修正一次」讓它依原因重寫；已確認的內容不會改動。`;
}

export type FailureKind = 'billing' | 'key' | 'rate' | 'other';
// 依錯誤文字判斷要給哪一種下一步按鈕。
export function failureKind(text: string): FailureKind {
  if (/額度或付費設定不足|HTTP 402/.test(text)) return 'billing';
  if (/金鑰無法使用|API key 無效|未授權/.test(text)) return 'key';
  if (/頻率限制|HTTP 429/.test(text)) return 'rate';
  return 'other';
}

// 各種請求平常要等多久（秒，取常見範圍的上限）。進度條只是依此預估，AI 不會回報實際進度。
export const TYPICAL_SECONDS: Record<string, number> = { extract: 30, recommend: 20, goals: 20, evidence: 25, activities: 25, full: 180, splitPre: 120, splitPost: 120, rePre: 120, rePost: 120, lesson: 40, aspects: 25, scenarioPre: 60, scenarioPost: 60, blueprint: 40, classroomKit: 40 };
export const TYPICAL_LABEL: Record<string, string> = { extract: '通常 10–30 秒', recommend: '通常 10–20 秒', goals: '通常 10–20 秒', evidence: '通常 10–25 秒', activities: '通常 10–25 秒', full: '通常 1–3 分鐘', splitPre: '通常 1–2 分鐘', splitPost: '通常 1–2 分鐘', rePre: '通常 1–2 分鐘', rePost: '通常 1–2 分鐘', lesson: '通常 20–40 秒', aspects: '通常 10–25 秒', scenarioPre: '通常 30–60 秒', scenarioPost: '通常 30–60 秒', blueprint: '通常 20–40 秒', classroomKit: '通常 20–40 秒' };

// 依已等待秒數推估進度：到常見上限時約 90%，之後停在 90% 並標示比平常久。
export function estimateProgress(elapsedSeconds: number, typicalSeconds: number): { percent: number; overdue: boolean } {
  const t = Math.max(0, elapsedSeconds), typical = Math.max(1, typicalSeconds);
  if (t >= typical) return { percent: 90, overdue: true };
  return { percent: Math.round((t / typical) * 90), overdue: false };
}

export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
}

// R12-r12：規準裡評量內在心態的字眼（不退回，只提醒教師改成看得見的表現）。
const MINDSET = ['真誠', '勇氣', '熱情', '自主性', '自主', '態度', '動機', '志趣', '承諾', '用心', '積極性', '內在'];
export function mindsetWords(texts: string[]): string[] {
  const joined = texts.join('\n');
  return MINDSET.filter(word => joined.includes(word) && !(word === '自主' && joined.includes('自主性') && !joined.replace(/自主性/g, '').includes('自主')));
}

// 被略過的課程方向，原因換成老師看得懂的一句（例如「方向 2：課綱條目對不上」）。
export function plainDirectionProblem(problem: string): string {
  const [, label, reason] = problem.match(/^(方向 \d+)：(.*)$/) ?? [null, '', problem];
  if (!label) return problem.replace(/^只回傳 (\d+) 個方向，應有 3 個$/, 'AI 只回傳 $1 個方向');
  const text = reason.includes('課綱建議') ? '課綱條目對不上本學科' : reason.includes('子指標建議') ? '子指標對不上 29 項清單' : reason.includes('缺學習表現') ? `缺學習表現${reason.includes('對不上') ? '（部分課綱對不上本學科）' : ''}` : reason.includes('缺學習內容') ? `缺學習內容${reason.includes('對不上') ? '（部分課綱對不上本學科）' : ''}` : reason.includes('缺子指標') ? '缺子指標' : reason.includes('學習表現') ? '只有學習內容，沒有學習表現' : reason.includes('驅動問題或最終作品') ? '缺驅動問題或最終作品' : '格式不對';
  return `${label}：${text}`;
}
