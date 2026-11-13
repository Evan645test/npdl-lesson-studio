import { describe, expect, it } from 'vitest';
import { createSeed } from '../data/seed';
import { validateWorkspace } from './validate';
import { reviseActivity } from './revisions';
import { importCopies, loadWorkspace, parseBackup, saveWorkspace, storageKey, type Store } from '../storage/workspace';
import { buildPrompt } from '../documents/prompt';

function store(): Store { const data=new Map<string,string>();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,v);}}; }
describe('完整單元與用途邊界',()=>{
  it('完整單元通過所有參照及內容驗證',()=>expect(validateWorkspace(createSeed())).toEqual(createSeed()));
  it('輸入與歷史起點不是同一個可變物件',()=>{const d=createSeed();d.projects[0].input.topic='新問題';expect(d.projects[0].designs[0].inputSnapshot.topic).not.toBe('新問題');});
  it('確認設計必須先確認整合規則',()=>{const d=createSeed();d.projects[0].designs[0].confirmedAt=Date.now();expect(()=>validateWorkspace(d)).toThrow('規則確認');});
  it('施測須先確認題組及設計',()=>{const d=createSeed();d.projects[0].assessments[0].administeredAt=Date.now();expect(()=>validateWorkspace(d)).toThrow('須先確認');d.projects[0].assessments[0].reviewedAt=Date.now();expect(()=>validateWorkspace(d)).toThrow('設計確認');});
  it('時間不能以小數保存',()=>{const d=createSeed();d.projects[0].designs[0].createdAt=1.5;expect(()=>validateWorkspace(d)).toThrow('數值不符');});
  it('備份完整往返保留三部分、鷹架、規準與來源',()=>{const data=createSeed();expect(parseBackup(JSON.stringify(data))).toEqual(data);});
  it('拒絕未知欄位，不能靜默丟棄',()=>{const data={...createSeed(),futureField:'保留'};expect(()=>validateWorkspace(data)).toThrow('未知欄位');});
  it('拒絕不相容版本',()=>expect(()=>validateWorkspace({...createSeed(),schemaVersion:99})).toThrow('版本'));
  it('前測不允許自評',()=>{const d=createSeed();d.projects[0].assessments[0].reflection=d.projects[0].assessments[1].reflection;expect(()=>validateWorkspace(d)).toThrow('前測');});
  it('後測缺少任一部分拒絕',()=>{const d=createSeed();d.projects[0].assessments[1].application=[];expect(()=>validateWorkspace(d)).toThrow('三部分');});
  it('能力題不可混入應用判準',()=>{const d=createSeed();d.projects[0].assessments[0].capability[0].applicationCriteria={academic:'學科',capability:'應用'};expect(()=>validateWorkspace(d)).toThrow('混用');});
  it('已知條件不同不能標有限比較',()=>{const d=createSeed();d.projects[0].designs[0].blueprint[0].status='可作有限比較';d.projects[0].assessments[1].capability[0].conditions.prompts='額外引導';expect(()=>validateWorkspace(d)).toThrow('條件不同');});
  it('後測必須換實質情境與資料',()=>{const d=createSeed();d.projects[0].assessments[1].capability[0].context=d.projects[0].assessments[0].capability[0].context;expect(()=>validateWorkspace(d)).toThrow('新情境');});
  it('活動節數不得與設計不符',()=>{const d=createSeed();d.projects[0].designs[0].activities[0].periods=2;expect(()=>validateWorkspace(d)).toThrow('節數合計');});
  it('鷹架階段不可重複',()=>{const d=createSeed();d.projects[0].designs[0].activities[0].scaffolds[0].stage='精熟';expect(()=>validateWorkspace(d)).toThrow('不可重複');});
  it('沒有多題規則只能明示缺漏',()=>{const d=createSeed();d.projects[0].designs[0].integration[0].rule='';expect(()=>validateWorkspace(d)).toThrow('需提供內容');d.projects[0].designs[0].integration[0].status='missing';expect(()=>validateWorkspace(d)).not.toThrow();});
  it('不同選項數不等於四階',()=>{const q=createSeed().projects[0].assessments[0].capability;expect(q.map(q=>q.options.length)).toEqual([3,5,3,3]);expect(q[0].options[0]).not.toHaveProperty('stage');});
});
describe('版本與安全保存',()=>{
  it('修改活動新增草稿，不改原題組、原文或舊版',()=>{const original=createSeed();const next=reviseActivity(original,original.activeProjectId,'act-1','教師新的活動任務。');expect(original).toEqual(createSeed());expect(next.projects[0].designs).toHaveLength(2);expect(next.projects[0].assessments).toEqual(original.projects[0].assessments);expect(next.projects[0].designs[0]).toEqual(original.projects[0].designs[0]);expect(next.projects[0].input.originalSource).toEqual(original.projects[0].input.originalSource);});
  it('空白與無變化的修訂不保存',()=>{const d=createSeed();expect(()=>reviseActivity(d,d.activeProjectId,'act-1',' ')).toThrow('不可空白');expect(()=>reviseActivity(d,d.activeProjectId,'act-1',d.projects[0].designs[0].activities[0].task)).toThrow('沒有變更');});
  it('備份轉入新的專案副本，保留所有版本',()=>{const d=createSeed(),next=importCopies(d,d);expect(next.projects).toHaveLength(2);expect(next.projects[1].id).not.toBe(d.projects[0].id);expect(next.projects[1].assessments).toEqual(d.projects[0].assessments);expect(d.projects).toHaveLength(1);});
  it('拒絕超出20個專案上限而保留現有',()=>{const d=createSeed();d.projects=Array.from({length:20},(_,i)=>({...structuredClone(d.projects[0]),id:i===0?d.activeProjectId:String(i)}));expect(()=>importCopies(d,createSeed())).toThrow('數量');expect(d.projects).toHaveLength(20);});
  it('損壞儲存原文保持不變',()=>{const s=store();s.setItem('key','{broken');const loaded=loadWorkspace(s,'key');expect(loaded.error).not.toBeNull();expect(loaded.raw).toBe('{broken');expect(s.getItem('key')).toBe('{broken');});
  it('保存失败仍保留記憶體草稿',()=>{const d=createSeed(),s:Store={getItem:()=>null,setItem:()=>{throw new Error('QuotaExceededError');}};expect(saveWorkspace(s,'key',d,null).error).toContain('本頁編輯仍保留');expect(d).toEqual(createSeed());});
  it('其他分頁修改不能被覆蓋',()=>{const s=store();s.setItem('key','別頁');expect(saveWorkspace(s,'key',createSeed(),null).error).toContain('其他分頁');expect(s.getItem('key')).toBe('別頁');});
  it('正常保存/重載完全相同',()=>{const s=store(),d=createSeed();expect(saveWorkspace(s,'key',d,null).error).toBeNull();expect(loadWorkspace(s,'key').workspace).toEqual(d);});
  it('不同輪預覽與開發工作區分離',()=>{expect(storageKey('/')).toBe('npdl_next_workspace_v1');expect(storageKey('/R01/')).not.toBe(storageKey('/R02/'));expect(storageKey('/R01-r2/')).not.toBe(storageKey('/R01/'));});
  it('損壞/過大備份有清楚錯誤',()=>{expect(()=>parseBackup('{')).toThrow('不是完整JSON');expect(()=>parseBackup('x'.repeat(8*1024*1024+1))).toThrow('8MB');});
  it('提示詞使用題組原設計，沒有因活動新版改寫',()=>{const d=createSeed(),next=reviseActivity(d,d.activeProjectId,'act-1','新的任務');expect(buildPrompt(next.projects[0])).toBe(buildPrompt(d.projects[0]));});
  it('提示詞明示没有作答、指令資料界線及獨立三部分',()=>{const prompt=buildPrompt(createSeed().projects[0]);expect(prompt).toContain('<<<BEGIN_DESIGN_DATA>>>');expect(prompt).toContain('沒有學生作答');expect(prompt).toContain('application');expect(prompt).toContain('reflection');expect(prompt).not.toContain('formative');});
});
