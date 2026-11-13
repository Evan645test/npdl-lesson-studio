import { expect, it } from 'vitest';
import { activeRevision, appendGeneratedPaperRevision, confirmPaperStage, newPaperDraft } from './stagedPaper';
import { assembleAuditedPaper, buildAuditedTeacherBatch, buildStudentAuditInput, checkStudentAudit, requireStudentAudit, type PreAuditPaper, type StudentAuditRaw } from './stagedStudentAudit';
import type { RequestPlan } from '../services/generation';

const slots=[{kind:'open',question:1,step:1},{kind:'open',question:1,step:2},{kind:'open',question:2,step:1}]
 .map(s=>({...s,indicatorId:'skill',judgment:'查史料再判斷',evidence:'要用題面所指史料',workload:{evidenceUnits:1,operations:1,support:'none'}}));
const base:RequestPlan={kind:'pre',projectId:'history',sourceSignature:'fixed',attempt:0,instructions:'',
 payload:{phase:'pre',modes:[{indicatorId:'skill',mode:'D',suggestedMode:'D'}],assessmentBlueprint:{itemBlueprint:{version:1,slots}}}};
const m=confirmPaperStage(appendGeneratedPaperRevision(base,newPaperDraft(base),'materials',{fields:{G1:{title:'工事史料',context:'共附兩則史料。',data:'史料甲：三月開始。\n史料乙：木材已入庫。',coverage:'教師備課不送出'}}}),'materials');
const student={needs:{G1:null},fields:{'G1-O1':{prompt:'查工事史料。'},'G1-O1-S1':{guide:'何時開始？'},'G1-O1-S2':{guide:'已知三月開始，比較兩則。'},'G1-O2':{prompt:'檢視新增史料。'},'G1-O2-S1':{guide:'查第三則史料再判斷。'}}};
const d=confirmPaperStage(appendGeneratedPaperRevision(base,m,'student',student),'student');
it('綁定確認學生稿，只送學生可見材料；缺料與段間提示各帶原文、不改稿',()=>{
 const input=buildStudentAuditInput(base,d);
 const good={status:'ok' as const,reason:'已核對學生資料。',currentId:null,otherId:null};
 const raw:StudentAuditRaw={checks:Object.fromEntries(slots.map((s,i)=>['G1-O'+s.question+'-S'+s.step,{material:good,hint:i===0?{status:'issue',reason:'第二段直接給時段。',currentId:'G1-O1-S1-P1',otherId:'G1-O1-S2-P1'}:good,
  workload:good}]))};
 raw.checks['G1-O2-S1'].material={status:'issue',reason:'沒有第三則史料。',currentId:'G1-O2-S1-P1',otherId:null};
 const before=JSON.stringify(d), report=checkStudentAudit(input,raw);
 expect(JSON.stringify(input.plan.payload)).not.toMatch(/教師備課不送出|aboveExample|verdict/);
 expect(report.findings.map(f=>[f.kind,f.current?.text,f.other?.text])).toEqual([
   ['hint','何時開始？','已知三月開始，比較兩則。'],['material','查第三則史料再判斷。',undefined],
 ]);
 expect(()=>requireStudentAudit(input,report,false)).toThrow();
 expect(()=>requireStudentAudit(input,report,true)).not.toThrow();
 const next=confirmPaperStage(appendGeneratedPaperRevision(base,m,'student',student),'student');
 expect(()=>requireStudentAudit(buildStudentAuditInput(base,next),report,true)).toThrow();
 expect(JSON.stringify(d)).toBe(before);
 expect(()=>checkStudentAudit(input,{checks:{...raw.checks,'G1-O1-S1':{...raw.checks['G1-O1-S1'],hint:{...raw.checks['G1-O1-S1'].hint,otherId:'G1-O1-S1-P1'}}}})).toThrow();
});

const teacherRubric={aboveFeatures:'找出原文。',aboveExample:'史料甲。',belowExample:'沒有證據。',sourceId:'G1-M3',otherSourceId:null,thirdSourceId:null,concern:null};
const oldTeacher=confirmPaperStage(appendGeneratedPaperRevision(base,d,'teacher',{fields:{
 'G1':{knowledge:'讀史料',reading:'兩則',complexity:'閱讀',reasoning:'核對',prompts:'無'},
 ...Object.fromEntries(slots.map(s=>['G1-O'+s.question+'-S'+s.step,teacherRubric])),
}}),'teacher');
const good={status:'ok' as const,reason:'已核對學生資料。',currentId:null,otherId:null};
const clean:StudentAuditRaw={checks:Object.fromEntries(slots.map(s=>['G1-O'+s.question+'-S'+s.step,{material:good,hint:good,workload:good}]))};
it('R27 舊教師稿不能跳過驗題後的盲查，且新教師請求不帶藍圖或驗題結果',()=>{
 const input=buildStudentAuditInput(base,oldTeacher), report=checkStudentAudit(input,clean);
 const previousId=activeRevision(oldTeacher,'teacher')!.id;
 expect(()=>assembleAuditedPaper(base,oldTeacher,report,true,previousId)).toThrow('早於本次驗題');
 expect(()=>assembleAuditedPaper(base,oldTeacher,report,true,null)).toThrow('尚未經逐題盲查');
 const batch=buildAuditedTeacherBatch(base,oldTeacher,input,report,true);
 expect(batch.items.map(i=>i.id)).toEqual(['G1-O1-S1','G1-O1-S2','G1-O2-S1']);
 const plan=batch.items[0].plan;
 expect(Object.keys(plan.payload).sort()).toEqual(['groupMaterials','item','outputSchema','phase','task']);
 expect(JSON.stringify(plan.payload)).not.toMatch(/第二段|已知三月開始|G1-O1-S2|教師備課|上述藍圖/);
});

it('後測只能用鎖定的前測，兩測的證據編號不能混用',()=>{
 const post:RequestPlan={...base,kind:'post',lockedPreId:'locked',payload:{...base.payload,phase:'post'}};
 const md=confirmPaperStage(appendGeneratedPaperRevision(post,newPaperDraft(post),'materials',{fields:{G1:{title:'後測工事史料',context:'兩則史料。',data:'史料甲：四月開始。',coverage:'備課'}}}),'materials');
 const sd=confirmPaperStage(appendGeneratedPaperRevision(post,md,'student',student),'student');
 const pre={
  id:'locked',phase:'pre',reviewedAt:1,
  sets:[{...activeRevision(d,'materials')!.value.groups[0],...activeRevision(d,'student')!.value.groups[0],mode:'D'}],
  assessmentBlueprint:{itemBlueprint:{version:1,slots:slots.map(({workload,...s})=>({...s,pre:workload,post:workload}))}},
 } as unknown as PreAuditPaper;
 expect(()=>buildStudentAuditInput(post,sd,{...pre,id:'different'})).toThrow('已核對前測');
 const input=buildStudentAuditInput(post,sd,pre), raw=structuredClone(clean);
 raw.checks['G1-O1-S1'].workload={status:'issue',reason:'前後作答材料不同。',currentId:'G1-M3',otherId:'G1-M3'};
 expect(()=>checkStudentAudit(input,raw)).toThrow('指定的題位或測次');
 raw.checks['G1-O1-S1'].workload.otherId='PRE-G1-M3';
 const report=checkStudentAudit(input,raw);
 expect(report.findings.map(f=>[f.current?.text,f.other?.text])).toEqual([['史料甲：四月開始。','史料甲：三月開始。']]);
});

it('R31 驗題問題自動重出：候選不改目前學生卷，採用後驗題範圍與候選驗題一致；後測負擔問題不帶前測原文',async()=>{
 const {appendStudentCandidate,adoptStudentCandidate,blockingFindings,candidateAuditDraft,studentRetryNotes,studentRetryPlan}=await import('./studentRetry');
 const input=buildStudentAuditInput(base,d);
 const raw:StudentAuditRaw={checks:Object.fromEntries(slots.map(s=>['G1-O'+s.question+'-S'+s.step,{material:good,hint:good,workload:good}]))};
 raw.checks['G1-O2-S1'].material={status:'issue',reason:'沒有第三則史料。',currentId:'G1-O2-S1-P1',otherId:null};
 raw.checks['G1-O1-S1'].workload={status:'uncertain',reason:'難以判定。',currentId:'G1-O1-S1-P1',otherId:null};
 const report=checkStudentAudit(input,raw);
 const blocking=blockingFindings(report);
 expect(blocking.map(f=>f.kind)).toEqual(['material']);
 const notes=studentRetryNotes(blocking,'pre');
 expect(notes[0]).toMatch(/缺料：沒有第三則史料。.*查第三則史料再判斷/);
 const plan=studentRetryPlan(base,d,notes);
 expect(plan.payload.task).toBe('staged-paper-student');
 expect((plan.payload.retryNotes as {problems:string[]}).problems).toEqual(notes);
 const before=activeRevision(d,'student')!.id;
 const c=appendStudentCandidate(base,d,student);
 expect(c.draft.active.student).toBe(before);
 expect(c.draft.revisions.some(r=>r.id===c.id&&!r.confirmed)).toBe(true);
 const auditDraft=candidateAuditDraft(c.draft,c.id);
 const candidateScope=buildStudentAuditInput(base,auditDraft).scope;
 const adopted=adoptStudentCandidate(c.draft,c.id);
 expect(activeRevision(adopted,'student')).toMatchObject({id:c.id,confirmed:true});
 expect(buildStudentAuditInput(base,adopted).scope).toBe(candidateScope);
 expect(()=>adoptStudentCandidate(adopted,c.id)).toThrow('已失效或已採用');
 const workload={...blocking[0],kind:'workload' as const,reason:'前測原文：自行挑兩筆。',other:{id:'x',group:'G1',owner:null,role:'material' as const,text:'前測原文'}};
 expect(studentRetryNotes([workload],'post')[0]).not.toMatch(/前測原文|自行挑兩筆/);
});
