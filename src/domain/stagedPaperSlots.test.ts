import { expect,it } from 'vitest';
import { buildPaperStagePlan, newPaperDraft } from './stagedPaper';
import type { RequestPlan } from '../services/generation';
const base: RequestPlan={kind:'pre',projectId:'trial',sourceSignature:'fixed',attempt:0,instructions:'',
  payload:{phase:'pre',modes:[{indicatorId:'skill',mode:'B',suggestedMode:'B'}]}};
it('材料的輸出位置由程式指定為唯一 G1，模型不得送自己組成的群組陣列',()=>{
  const plan=buildPaperStagePlan(base,newPaperDraft(base),'materials');
  expect(plan.structuredResponse).toBe(true);
  expect(plan.payload.outputSchema).toMatchObject({
    properties:{fields:{required:['G1'],additionalProperties:false}},required:['fields'],additionalProperties:false,
  });
});

import { activeRevision, appendGeneratedPaperRevision, assembleStagedPaper, confirmPaperStage } from './stagedPaper';
import { paperSlots, teacherFieldShapes, teacherSources } from './stagedPaperSlots';
import type { ModeChoice } from './thresholdSet';

const material={fields:{G1:{title:'反應紀錄',context:'在相同終點下觀察。',data:'甲：25°C，濃度 0.10 M。\n乙：25°C，濃度 0.20 M。\n丙：25°C，濃度 0.30 M。',coverage:'可找只改濃度的資料。'}}};
const options={A:'比較甲、乙。',B:'混合所有紀錄。',C:'忽略比較條件。',D:'比較乙、丙。'};
const student={needs:{G1:null},fields:{
  ...Object.fromEntries(Array.from({length:5},(_,i)=>['G1-Q'+(i+1),{prompt:'哪一對可公平比較？',options}])),
  'G1-O1':{prompt:'請看同一份紀錄。'},'G1-O1-S1':{guide:'指出第一筆紀錄。'},
  'G1-O1-S2':{guide:'比較兩筆紀錄。'},'G1-O1-S3':{guide:'寫出結論限制。'},
}};
function drafts(){
 const m=confirmPaperStage(appendGeneratedPaperRevision(base,newPaperDraft(base),'materials',material),'materials');
 return {m,s:confirmPaperStage(appendGeneratedPaperRevision(base,m,'student',student),'student')};
}
it('不採用額外材料組，固定五選、一題三段；缺口回報不冒充可用學生卷',()=>{
 expect(()=>appendGeneratedPaperRevision(base,newPaperDraft(base),'materials',{fields:{...material.fields,G2:material.fields.G1}})).toThrow('多出 G2');
 const {m,s}=drafts(), g=activeRevision(s,'student')!.value.groups[0];
 expect(g.opens.map(q=>q.steps.length)).toEqual([3]);
 expect(g.choices[0].options.map(o=>o.label)).toEqual(['A','B','C','D']);
 expect(()=>appendGeneratedPaperRevision(base,m,'student',{...student,fields:{...student.fields,'G1-O2':{prompt:'多出的題'}}})).toThrow('G1-O2');
 const lacking=appendGeneratedPaperRevision(base,m,'student',{...student,needs:{G1:'缺一筆可比較紀錄。'}});
 expect(()=>confirmPaperStage(lacking,'student')).toThrow('材料不足');
});
it('教師盲查同時接受 A 與 D 時，保留原題、引用實際材料、沒有唯一鍵；拒絕跨題編號',()=>{
 const {s}=drafts();
 const slots=paperSlots(base.payload.modes as ModeChoice[],undefined);
 const [sources]=teacherSources(slots,activeRevision(s,'materials')!.value.groups,activeRevision(s,'student')!.value.groups);
 const a=sources.passages.find(x=>x.text.startsWith('甲：'))!,d=sources.passages.find(x=>x.text.startsWith('丙：'))!;
 const more={otherSourceId:null,thirdSourceId:null};
 const review=(double:boolean)=>({options:{A:{verdict:'fits',reason:'甲、乙同溫且只改濃度。',sourceId:a.id,...more,otherSourceId:d.id},
  B:{verdict:'not_fit',reason:'不同條件不可混用。',sourceId:null,...more},
  C:{verdict:'not_fit',reason:'必須查比較條件。',sourceId:null,...more},
  D:{verdict:double?'fits':'not_fit',reason:'乙、丙也是同溫且只改濃度。',sourceId:d.id,...more}},concern:null});
 const rubric={aboveFeatures:'指出表中一筆。',aboveExample:'甲組為 25°C。',belowExample:'缺少原始紀錄。',sourceId:a.id,...more,concern:null};
 const fields={'G1':{knowledge:'同一科學概念',reading:'三筆',complexity:'兩組',reasoning:'核對控制條件',prompts:'只依題面'},
   ...Object.fromEntries(slots[0].choices.map((q,i)=>[q.id,review(i===0)])), 'G1-O1-S1':rubric,'G1-O1-S2':rubric,'G1-O1-S3':rubric};
 const before=JSON.stringify(s);
 const t=appendGeneratedPaperRevision(base,s,'teacher',{fields});
 const g=activeRevision(t,'teacher')!.value;
 expect(g.groups[0].choices[0].answer).toBeNull();
 expect(g.issues.filter(i=>i.target==='Q1').map(i=>i.quote)).toEqual([a.text,d.text]);
 expect(g.issues[0].reason).toContain(d.text);
 expect(g.issues.every(i=>i.reason.includes('A、D'))).toBe(true);
 expect(JSON.stringify(s)).toBe(before);
 expect(()=>assembleStagedPaper(base,confirmPaperStage(t,'teacher'))).toThrow('仍有已回報的判讀問題');
 const wrong={...fields,'G1-O1-S1':{...rubric,sourceId:sources.choices[0].promptSources[0].id}};
 expect(()=>appendGeneratedPaperRevision(base,s,'teacher',{fields:wrong})).toThrow('G1-O1-S1');
 const plan=buildPaperStagePlan(base,s,'teacher');
 expect(JSON.stringify(plan.payload.studentBook)).not.toMatch(/"answer"|"above"|"verdict"/);
});

it('學生卷不採用直接列出選項答案的題幹',()=>{
 const {m}=drafts();
 const fields={...student.fields,'G1-Q1':{prompt:'答案：A。哪一對可公平比較？',options}};
 expect(()=>appendGeneratedPaperRevision(base,m,'student',{...student,fields})).toThrow('學生卷包含答案');
});

it('罕用漢字的引用不切開字元，也符合驗證使用的字串長度',()=>{
 const {s}=drafts();
 const slots=paperSlots(base.payload.modes as ModeChoice[],undefined);
 const data='𠮷'.repeat(400);
 const materials=activeRevision(s,'materials')!.value.groups.map(g=>({...g,data}));
 const [source]=teacherSources(slots,materials,activeRevision(s,'student')!.value.groups);
 const rare=source.passages.filter(p=>p.text.startsWith('𠮷'));
 expect(rare.length).toBeGreaterThan(1);
 expect(rare.every(p=>p.text.length<=260)).toBe(true);
 expect(rare.map(p=>p.text).join('')).toBe(data);
});
it('R30 非選教師判讀先填引用、再寫例答：模型依欄位順序生成，引用列先綁定',()=>{
 const slots=paperSlots(base.payload.modes as ModeChoice[],undefined);
 const shapes=teacherFieldShapes(slots) as Record<string,{properties:Record<string,unknown>;required:string[]}>;
 const open=slots[0].opens[0].steps[0].id;
 const keys=Object.keys(shapes[open].properties);
 expect(keys.slice(0,3)).toEqual(['sourceId','otherSourceId','thirdSourceId']);
 expect(keys.indexOf('aboveExample')).toBeGreaterThan(keys.indexOf('thirdSourceId'));
 expect(shapes[open].required).toEqual(keys);
});
