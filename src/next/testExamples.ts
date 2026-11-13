// R12-r6：試用與測試用的最少資料（五項起點），一鍵帶入；節數、課綱與子指標仍由教師選或請 AI 推薦。
export interface TestExample { id: string; label: string; grade: string; subject: string; topic: string; title: string; keywords: string }
export const TEST_EXAMPLES: TestExample[] = [
  { id: 'chem-rate-minimal', label: '化學・反應速率', grade: '高二', subject: '化學', topic: '如何用實驗證據判斷化學反應的快慢？', title: '反應速率', keywords: '反應速率、變因控制、實驗證據' },
  { id: 'math-data-distribution-minimal', label: '數學・平均數與資料分布', grade: '高一', subject: '數學', topic: '兩組資料的平均數相同，為什麼分布還可能不同？', title: '平均數與資料分布', keywords: '平均數、標準差、數據分析' },
  { id: 'bio-school-biodiversity-minimal', label: '生物・校園生物多樣性', grade: '高一', subject: '生物', topic: '校園不同棲地的物種多樣性有哪些差異？', title: '校園生物多樣性', keywords: '物種多樣性、生態系、棲地' },
  { id: 'chinese-editorial-evidence-minimal', label: '國語文・校刊評論的觀點與論據', grade: '高二', subject: '國語文', topic: '同一件校園事件，兩篇校刊評論的立場與論據有什麼不同？', title: '校刊評論的觀點與論據', keywords: '評論、論據、因果論證' },
];
