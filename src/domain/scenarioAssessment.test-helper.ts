import { createSeed } from '../data/seed';
import { confirmDesign, confirmRules, reviewIndicators } from './lifecycle';
import { decodeAspects, decodeScenarioSets } from './scenarioProgression';
import type { DesignVersion, Workspace } from './types';
import { kitSource, type ClassroomKit } from './classroomKit';

export function scenarioReady(): Workspace { const seed = createSeed(); const id = seed.activeProjectId; const next = confirmDesign(confirmRules(reviewIndicators(seed, id), id), id); next.projects[0].workflow = 'single-v1'; next.projects[0].assessments[1].reflection = []; return next; }
const four = (p: string) => ({ limited: `${p}我會照學長姊去年的做法，省時間也比較保險`, emerging: `${p}我會挑大家常用的方式，家長應該比較熟悉`, developing: `${p}我會比較兩種方式的效果，再選適合的一種`, proficient: `${p}我會先問家長想知道什麼，再決定用哪種方式` });
export function scenarioFixture(_w: Workspace, phase: 'pre' | 'post', ids: string[]) {
  const aspects = decodeAspects(Object.fromEntries(ids.map(id => [id, [1, 2, 3].map(n => ({ label: `面向${n}`, description: `面向${n}從低到高的差異。` }))])), ids);
  const raw = Object.fromEntries(ids.map(id => [id, Object.fromEntries([['extension', { prompt: '回顧前面三題，挑一題說明你為什麼這樣選、這樣做可能有什麼代價。', anchors: { limited: '只說選了哪一個', emerging: '說出一個理由', developing: '說出理由與一個限制', proficient: '比較不同情境並說明判斷依據' } }] as [string, unknown], ...['A1', 'A2', 'A3'].map(a => [a, { scenario: `${phase === 'pre' ? '生活' : '課程'}情境 ${a}。`, prompt: '你會怎麼做？', options: four(a), reasonPrompt: '你會怎麼做？為什麼？', anchors: four('錨點') }])])]));
  return { aspects, scenarioSets: decodeScenarioSets(raw, aspects, phase) };
}


// R41：方式 E 子指標的學習單與勾選表測試資料（由規準與相連活動組成）。
export function kitFixture(design: DesignVersion, indicatorId: string): ClassroomKit {
  const { criteria, activities } = kitSource(design, indicatorId);
  return { indicatorId, worksheet: { title: '課堂學習單', intro: '在課堂活動中寫下你的做法與依據。', questions: [0, 1, 2].map(i => ({ activityId: activities[i % activities.length].id, prompt: `寫出你在這個活動中怎麼做、為什麼這樣做（第 ${i + 1} 題）。`, lines: 4 })) },
    checklist: criteria.map(c => ({ criterionId: c.id, focus: '觀察學生如何比較資料', behaviors: ['只引用單筆資料', '提到要控制條件', '選用條件一致的資料', '檢查變因並提出追加資料'] as [string, string, string, string] })) };
}
