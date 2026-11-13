import { appendIsolatedTeacherRevision, checkTeacherItem, TeacherItemProblem, type TeacherBatch, type TeacherFailure } from '../domain/stagedTeacherReview';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { activeRevision, appendGeneratedPaperRevision, appendPaperRevision, buildPaperStagePlan, canGenerateStage, confirmPaperStage,
  newPaperDraft, PAPER_STAGES, PAPER_STAGE_NAME, paperDraftSignature, readPaperDraft, stageCurrent, type PaperDraft, type PaperStage, type StageValue } from '../domain/stagedPaper';
import { assembleAuditedPaper, buildAuditedTeacherBatch, buildStudentAuditInput, checkStudentAudit, type PreAuditPaper, type StudentAuditReport } from '../domain/stagedStudentAudit';
import type { AssessmentVersion } from '../domain/types';
import type { RequestPlan } from '../services/generation';
import { downloadBlob } from '../documents/export';
import { HEAVY_TIMEOUT_MS, RepairFailed, RepairNeeded, runRequest } from '../services/openai';
import { isValidModelId, useAiSettings } from '../services/AiSettings';
import { AssessmentAuditPanel } from './AssessmentAuditPanel';
import { AssessmentData } from './AssessmentData';
import { FocusDialog } from './FocusDialog';
import { usingLabel } from './AiSetupPanel';
import { AUTO_RETRY_MAX, AutoRetryFailed, runWithAutoRetry } from '../services/autoRetry';
import { buildSelfReportPlan, decodeSelfReport, stageName, type SelfReport } from '../domain/selfReport';
import { planModes } from '../domain/thresholdSet';
import { adoptStudentCandidate, appendStudentCandidate, blockingFindings, candidateAuditDraft, studentRetryNotes, studentRetryPlan } from '../domain/studentRetry';

type Group = StageValue['materials']['groups'][number];
const problem=(error:unknown)=>error instanceof Error?error.message:String(error);
const failureReason=(error:unknown)=>error instanceof AutoRetryFailed?error.problems.map((p,i)=>(i?'重試 '+i+'：':'首次：')+p).join('；')
  :error instanceof RepairNeeded||error instanceof RepairFailed?error.reason:problem(error);
type StudentCandidate={id:string;scope:string;raw:unknown;rounds:number;history:string[]};
function draftsKey(workspaceKey:string,base:RequestPlan){
  const signature=paperDraftSignature(base);
  let hash=2166136261;
  for(let i=0;i<signature.length;i++)hash=Math.imul(hash^signature.charCodeAt(i),16777619);
  return workspaceKey+':paper-draft-v1:'+base.projectId+':'+base.payload.phase+':'+(hash>>>0).toString(36);
}

function Materials({ groups }: {groups:Group[]}){
  return <>{groups.map((group,i)=><article key={group.indicatorId}><h3>第 {i+1} 組｜{group.title}</h3>
    <p>{group.context}</p><AssessmentData text={group.data} label={group.title+' 共用材料'} />
    <p><b>備課核對：</b>{group.coverage}</p>
  </article>)}</>;
}
function Student({ materials, value }: {materials:Group[];value:StageValue['student']}){
  if(value.missing.length)return <div className="notice"><p><b>材料不足，尚未出題</b></p><ul>{value.missing.map((row,i)=><li key={i}>{row.need}</li>)}</ul></div>;
  return <>{value.groups.map((group,i)=>{
    const material=materials.find(row=>row.indicatorId===group.indicatorId);
    return <article key={group.indicatorId}><h3>第 {i+1} 組｜{material?.title}</h3>
      {material&&<><p>{material.context}</p><AssessmentData text={material.data} label={material.title+' 學生材料'} /></>}
      <ol>{group.choices.map((q,j)=><li key={j}><p>{q.prompt}</p><ol type="A">{q.options.map(o=><li key={o.label}>{o.text}</li>)}</ol></li>)}</ol>
      {group.opens.map((q,j)=><div key={j}><h4>非選第 {j+1} 題</h4><p>{q.prompt}</p>
        <ol>{q.steps.map((step,k)=><li key={k}><p>{step.guide}</p><p>{step.sentenceStarter}</p></li>)}</ol></div>)}
    </article>;
  })}</>;
}
function Teacher({value}: {value:StageValue['teacher']}){
  function issueLabel(indicatorId:string,target:string){
    const group=value.groups.findIndex(row=>row.indicatorId===indicatorId)+1;
    const open=target.match(/^O(\d+)-S(\d+)$/);
    const item=open?'非選第 '+open[1]+' 題第 '+open[2]+' 段':'選擇第 '+target.slice(1)+' 題';
    return '第 '+group+' 組｜'+item;
  }
  return <>{value.issues.length>0&&<div className="notice"><p><b>先處理下列問題，程式不會改題</b></p>
    <ul>{value.issues.map((issue,i)=><li key={i}>{issueLabel(issue.indicatorId,issue.target)}：{issue.reason}<br />題面原文：「{issue.quote}」</li>)}</ul></div>}
    {value.groups.map((group,i)=><article key={group.indicatorId}><h3>第 {i+1} 組判讀</h3>
      <ol>{group.choices.map((q,j)=><li key={j}><p><b>選擇第 {j+1} 題：</b>{q.answer??'無法定出唯一答案，需核對'}</p>
        <p>依據：「{q.evidence}」</p><ul>{q.thinking.map(row=><li key={row.label}>{row.label}：{row.text}</li>)}</ul>
      </li>)}</ol>
      {group.opens.map((q,j)=><div key={j}><h4>非選第 {j+1} 題</h4><ol>{q.steps.map((step,k)=><li key={k}>
        <p>依據：「{step.evidence}」</p><p>判讀：{step.aboveFeatures}</p>
        <p>門檻以上例答：{step.aboveExample}</p><p>門檻以下例答：{step.belowExample}</p>
      </li>)}</ol></div>)}
    </article>)}
  </>;
}

function SelfReportView({value}:{value:SelfReport}){
  return <ol>{value.items.map(item=><li key={item.id}>
    <p><b>{item.postOnly?'後測新增，不與前測比較':item.pairedWith?'與前測第 '+item.pairedWith+' 題配對':'自陳題'}</b></p>
    <p>{item.scenario}</p><p>{item.prompt}</p>
    <ol type="A">{item.options.map(o=><li key={o.label}>{o.text}<span className="sp-stage">（教師對照：{stageName(o.stage)}）</span></li>)}</ol>
  </li>)}</ol>;
}

export function StagedPaperPanel({base,pre,workspaceKey,disabled,activeRequest,onNeedKey,onClose,onPreview,onSave,current}: {
  base:RequestPlan;pre?:PreAuditPaper;workspaceKey:string;disabled:boolean;activeRequest:RefObject<AbortController|null>;
  onNeedKey:()=>void;onClose:()=>void;onPreview:(value:unknown)=>AssessmentVersion|undefined;onSave:(value:unknown)=>boolean;
  current:()=>boolean;
}){
  const {provider,model,key}=useAiSettings();
  const storageKey=draftsKey(workspaceKey,base);
  const initial=useRef<{draft:PaperDraft;raw:string|null;error:string}|null>(null);
  if(!initial.current){
    try{const raw=sessionStorage.getItem(storageKey);initial.current={raw,draft:readPaperDraft(base,raw),error:''};}
    catch{initial.current={raw:null,draft:newPaperDraft(base),error:'目前無法讀取原草稿，未覆寫已保存的內容。'};}
  }
  const [draft,setDraft]=useState(initial.current.draft);
  const raw=useRef(initial.current.raw), local=useRef<AbortController|null>(null);
  const heading=useRef<HTMLHeadingElement>(null);
  const [stage,setStage]=useState<PaperStage>(()=>activeRevision(draft,'student')?'student':'materials');
  const [notice,setNotice]=useState(initial.current.error);
  const [storageBlocked,setStorageBlocked]=useState(!!initial.current.error);
  const [busy,setBusy]=useState(false), [consent,setConsent]=useState(false), [checked,setChecked]=useState(false);
  const [editing,setEditing]=useState<Group[]|null>(null);
  const [editingStudent,setEditingStudent]=useState<StageValue['student']|null>(null);
  const [pending,setPending]=useState<RequestPlan|TeacherBatch|null>(null);
  const [teacherFailures,setTeacherFailures]=useState<TeacherFailure[]>([]);
  const [teacherProgress,setTeacherProgress]=useState<{done:number;total:number}|null>(null);
  const [preview,setPreview]=useState<AssessmentVersion>();
  const [auditUpdate,setAuditUpdate]=useState(0);
  const auditStorage=storageKey+':student-audit-v1';
  const [archives,setArchives]=useState<PaperDraft[]>([]);
  const candidateStorage=storageKey+':student-candidate-v1';
  const [candidateUpdate,setCandidateUpdate]=useState(0);
  const [candidateChecked,setCandidateChecked]=useState(false);
  const [retryLog,setRetryLog]=useState<string[]>([]);
  const selfReportStorage=storageKey+':self-report-v1';
  const [selfReport,setSelfReportState]=useState<SelfReport|undefined>(()=>{
    try{const raw=sessionStorage.getItem(selfReportStorage);return raw?JSON.parse(raw) as SelfReport:undefined;}catch{return undefined;}
  });
  function setSelfReport(value:SelfReport|undefined){
    try{if(value)sessionStorage.setItem(selfReportStorage,JSON.stringify(value));else sessionStorage.removeItem(selfReportStorage);}catch{/* 只影響本分頁暫存；畫面仍可用。 */}
    setSelfReportState(value);
  }
  const selfIndicatorIds=planModes(base).map(m=>m.indicatorId);
  const preHasSelfReport=!!pre?.selfReport;
  const label=base.payload.phase==='pre'?'前測':'後測';
  const materials=activeRevision(draft,'materials'), student=activeRevision(draft,'student'), teacher=activeRevision(draft,'teacher');
  const active=activeRevision(draft,stage), stale=active&&!stageCurrent(draft,stage);
  const auditInput=useMemo(()=>{
    try{return {input:buildStudentAuditInput(base,draft,pre),error:''};}
    catch(error){return {input:undefined,error:problem(error)};}
  },[base,draft,pre]);
  const audit=useMemo(()=>{
    if(!auditInput.input)return undefined;
    try{
      const raw=sessionStorage.getItem(auditStorage);
      if(!raw||raw.length>350_000)return undefined;
      const saved=JSON.parse(raw);
      if(saved.scope!==auditInput.input.scope||typeof saved.acknowledged!=='boolean'||!(saved.previousTeacherId===null||typeof saved.previousTeacherId==='string'))return undefined;
      return {report:checkStudentAudit(auditInput.input,saved.raw),acknowledged:saved.acknowledged,previousTeacherId:saved.previousTeacherId as string|null};
    }catch{return undefined;}
  },[auditInput,auditStorage,auditUpdate]);
  const studentCandidate=useMemo(()=>{
    try{
      const raw=sessionStorage.getItem(candidateStorage);
      if(!raw||raw.length>350_000)return undefined;
      const saved=JSON.parse(raw) as StudentCandidate;
      const input=buildStudentAuditInput(base,candidateAuditDraft(draft,saved.id),pre);
      if(input.scope!==saved.scope)return undefined;
      const report=checkStudentAudit(input,saved.raw);
      if(blockingFindings(report).length)return undefined;
      return {...saved,report};
    }catch{return undefined;}
  },[base,draft,pre,candidateStorage,candidateUpdate]);
  const auditReady=!!audit?.acknowledged;
  const teacherNeedsRerun=!!teacher&&(teacher.teacherIsolation!=='r29'||!!audit&&teacher.id===audit.previousTeacherId);
  const auditPending=!!pending&&'payload' in pending&&pending.payload.task==='audit-staged-student';
  const teacherPending=!!pending&&'items' in pending;
  const selfPending=!!pending&&'payload' in pending&&pending.payload.task==='self-report-items';

  function stop(){
    const r=local.current;local.current=null;r?.abort();
    if(r&&activeRequest.current===r)activeRequest.current=null;
  }
  useEffect(()=>()=>stop(),[provider,model,key]);
  useEffect(()=>{heading.current?.focus();},[stage]);
  useEffect(()=>{
    setPending(null);setConsent(false);setBusy(false);setTeacherProgress(null);
  },[provider,model,key]);
  useEffect(()=>{
    if(!disabled)return;
    stop();setBusy(false);setPending(null);setTeacherProgress(null);
  },[disabled]);
  function save(next:PaperDraft){
    if(storageBlocked||!current())return false;
    try{
      if(sessionStorage.getItem(storageKey)!==raw.current)throw Error('草稿已變更；請關閉後再開啟核對。');
      const serialized=JSON.stringify(next);
      if(serialized.length>2_000_000){setNotice('這次修改會讓草稿超過保存上限，未採用；可先下載已保存的草稿。');return false;}
      sessionStorage.setItem(storageKey,serialized);raw.current=serialized;
      setDraft(next);setPreview(undefined);return true;
    }catch(error){setStorageBlocked(true);setNotice(problem(error));return false;}
  }
  function saveAudit(report:StudentAuditReport,acknowledged:boolean,previousTeacherId:string|null){
    if(!current()||!auditInput.input||report.scope!==auditInput.input.scope||sessionStorage.getItem(storageKey)!==raw.current)throw Error('學生卷已更新；未沿用舊驗題結果。');
    const value=JSON.stringify({scope:report.scope,raw:report.raw,acknowledged,previousTeacherId});
    if(value.length>350_000)throw Error('驗題報告超過保存上限；學生卷未改動。');
    sessionStorage.setItem(auditStorage,value);
    setAuditUpdate(n=>n+1);
  }
  function navigate(to:PaperStage){setStage(to);setChecked(false);setEditing(null);setEditingStudent(null);setNotice('');}
  function prepareSelfReport(){
    if(disabled||busy||storageBlocked||activeRequest.current||!current())return;
    if(!key.trim()){onNeedKey();setNotice('請先設定本頁的 AI 金鑰。');return;}
    if(!isValidModelId(model,provider)){setNotice('請先選擇有效的 AI 模型。');return;}
    try{setPending(buildSelfReportPlan(base,selfIndicatorIds,base.payload.phase==='post'?'post':'pre',preHasSelfReport));setConsent(false);}
    catch(error){setNotice(problem(error));}
  }
  function prepare(forAudit=false){
    if(disabled||busy||storageBlocked||activeRequest.current||!current())return;
    if(!key.trim()){onNeedKey();setNotice('請先設定本頁的 AI 金鑰。');return;}
    if(!isValidModelId(model,provider)){setNotice('請先選擇有效的 AI 模型。');return;}
    try{
      const input=auditInput.input;
      if((forAudit||stage==='teacher')&&!input)throw Error(auditInput.error);
      setPending(forAudit?input!.plan:stage==='teacher'?buildAuditedTeacherBatch(base,draft,input!,audit?.report,auditReady,pre):buildPaperStagePlan(base,draft,stage));
      setConsent(false);
    }
    catch(error){setNotice(problem(error));}
  }
  async function send(){
    if(!pending||!consent||disabled||activeRequest.current||!current())return;
    const plan=pending,r=new AbortController(), requested=stage;
    const input=auditInput.input;
    local.current=r;activeRequest.current=r;setPending(null);setConsent(false);setBusy(true);setNotice('');
    try{
      if('items' in plan){
        const answers=new Map<string,unknown>(), failures=new Map<string,TeacherFailure>(), retried:string[]=[];
        let cursor=0, done=0;
        setTeacherProgress({done,total:plan.items.length});
        const worker=async()=>{
          while(local.current===r&&!r.signal.aborted&&current()&&cursor<plan.items.length){
            const item=plan.items[cursor++];
            let rejected:TeacherFailure|undefined;
            try{
              const result=await runWithAutoRetry(item.plan,{provider,model,key},r.signal,value=>{
                rejected=undefined;
                try{checkTeacherItem(item,value);}catch(error){
                  if(error instanceof TeacherItemProblem)rejected=error.finding;
                  throw error;
                }
              },HEAVY_TIMEOUT_MS);
              if(local.current===r&&!r.signal.aborted&&current()){
                answers.set(item.id,result.value);
                if(result.retries)retried.push(item.label+'（自動重試 '+result.retries+' 次後通過；先前原因：'+result.problems.join('；')+'）');
              }
            }catch(error){
              if(local.current===r&&!r.signal.aborted&&current())failures.set(item.id,rejected?{...rejected,reason:failureReason(error)}:{
                id:item.id,label:item.label,reason:failureReason(error),
              });
            }
            if(local.current===r)setTeacherProgress({done:++done,total:plan.items.length});
          }
        };
        await Promise.all(Array.from({length:Math.min(3,plan.items.length)},worker));
        if(local.current!==r||r.signal.aborted||!current())return;
        const ordered=plan.items.flatMap(item=>failures.has(item.id)?[failures.get(item.id)!]:[]);
        setTeacherFailures(ordered);
        setRetryLog(retried);
        if(ordered.length){
          setNotice('本次回應未通過檢查：'+ordered.length+' 個題位須核對。學生卷與舊判讀保留。');
        }else if(save(appendIsolatedTeacherRevision(base,draft,plan,answers))){
          setChecked(false);setNotice(retried.length?'已保存這一步的草稿；'+retried.length+' 個題位經自動重試才通過，請特別核對。':'已保存這一步的草稿，請先核對。');
        }
        return;
      }
      if(plan.payload.task==='self-report-items'){
        let made:SelfReport|undefined;
        const phase=base.payload.phase==='post'?'post':'pre';
        const result=await runWithAutoRetry(plan,{provider,model,key},r.signal,value=>{made=decodeSelfReport(value,selfIndicatorIds,phase,preHasSelfReport,crypto.randomUUID().slice(0,8));},HEAVY_TIMEOUT_MS);
        if(local.current!==r||r.signal.aborted||!current()||!made)return;
        setSelfReport(made);
        setRetryLog(result.retries?result.problems.map((p,i)=>(i?'重試 '+i+'：':'首次：')+p):[]);
        setNotice('已產生情境自陳題'+(result.retries?'（自動重試 '+result.retries+' 次後通過）':'')+'，請核對後再保存正式題本。');
        return;
      }
      const isAudit=plan.payload.task==='audit-staged-student';
      let next:PaperDraft|undefined, report:StudentAuditReport|undefined;
      const result=await runWithAutoRetry(plan,{provider,model,key},r.signal,value=>{
        if(isAudit){if(!input||plan.sourceSignature!==input.scope)throw Error('學生卷已更新。');report=checkStudentAudit(input,value);}
        else next=appendGeneratedPaperRevision(base,draft,requested,value);
      },HEAVY_TIMEOUT_MS);
      if(local.current!==r||r.signal.aborted||!current())return;
      const retriedNote=result.retries?'（自動重試 '+result.retries+' 次後通過）':'';
      setRetryLog(result.retries?result.problems.map((p,i)=>(i?'重試 '+i+'：':'首次：')+p):[]);
      if(report){
        saveAudit(report,false,teacher?.id??null);setNotice('獨立驗題完成'+retriedNote+'，請先閱讀報告。學生卷未改動。');
        const blocking=blockingFindings(report);
        if(blocking.length&&input)await retryStudent(r,studentRetryNotes(blocking,input.phase));
      }
      if(next&&save(next)){setChecked(false);setNotice('已保存這一步的草稿'+retriedNote+'，請先核對。');}
    }catch(error){
      if(local.current===r)setNotice(error instanceof AutoRetryFailed||error instanceof RepairNeeded||error instanceof RepairFailed
        ? '本次回應未通過檢查：'+failureReason(error)+'；原草稿保留。' : problem(error));
    }finally{if(local.current===r){stop();setBusy(false);setTeacherProgress(null);}}
  }
  // 驗題發現明確問題時自動重出學生卷並再驗；只有再驗無明確問題的版本才成為候選，目前學生卷不變。
  async function retryStudent(r:AbortController,firstNotes:string[]){
    let notes=firstNotes, work=draft;
    const history=['驗題：'+firstNotes.join('；')];
    for(let round=1;round<=AUTO_RETRY_MAX;round++){
      if(local.current!==r||r.signal.aborted||!current())return;
      setNotice('驗題發現 '+notes.length+' 個問題，正在自動重出學生卷（第 '+round+'／'+AUTO_RETRY_MAX+' 次）…');
      try{
        let made:{draft:PaperDraft;id:string}|undefined;
        await runRequest(studentRetryPlan(base,work,notes),{provider,model,key},true,r.signal,value=>{made=appendStudentCandidate(base,work,value);},HEAVY_TIMEOUT_MS);
        if(!made||local.current!==r||r.signal.aborted||!current())return;
        const candidateInput=buildStudentAuditInput(base,candidateAuditDraft(made.draft,made.id),pre);
        let report:StudentAuditReport|undefined;
        await runRequest(candidateInput.plan,{provider,model,key},true,r.signal,value=>{report=checkStudentAudit(candidateInput,value);},HEAVY_TIMEOUT_MS);
        if(!report||local.current!==r||r.signal.aborted||!current())return;
        const blocking=blockingFindings(report);
        if(!blocking.length){
          if(!save(made.draft))return;
          const value=JSON.stringify({id:made.id,scope:report.scope,raw:report.raw,rounds:round,history} satisfies StudentCandidate);
          if(value.length>350_000)throw Error('候選驗題資料超過保存上限。');
          sessionStorage.setItem(candidateStorage,value);
          setCandidateUpdate(n=>n+1);setCandidateChecked(false);setRetryLog(history);
          setNotice('第 '+round+' 次自動重出的學生卷再驗未發現明確問題，已列為候選。目前學生卷未改動，請比對後決定是否採用。');
          return;
        }
        notes=studentRetryNotes(blocking,candidateInput.phase);
        history.push('第 '+round+' 次重出再驗：'+notes.join('；'));
      }catch(error){
        if(local.current!==r||r.signal.aborted)return;
        history.push('第 '+round+' 次重出未通過：'+failureReason(error));
      }
    }
    setRetryLog(history);
    setNotice('自動重出 '+AUTO_RETRY_MAX+' 次仍有問題，保留原學生卷；各次原因列在下方。');
  }
  function adoptCandidate(){
    if(!studentCandidate||!candidateChecked||disabled||busy||activeRequest.current||!current())return;
    try{
      const next=adoptStudentCandidate(draft,studentCandidate.id);
      const scope=buildStudentAuditInput(base,next,pre).scope;
      if(scope!==studentCandidate.report.scope)throw Error('候選學生卷的驗題範圍已變更，請重新驗題。');
      const report=JSON.stringify({scope,raw:studentCandidate.report.raw,acknowledged:false,previousTeacherId:teacher?.id??null});
      if(!save(next))return;
      sessionStorage.setItem(auditStorage,report);setAuditUpdate(n=>n+1);
      sessionStorage.removeItem(candidateStorage);setCandidateUpdate(n=>n+1);setRetryLog([]);
      setNotice('已採用候選學生卷，並沿用它的驗題報告。請閱讀報告後再進教師盲查；原學生卷保留在舊草稿。');
    }catch(error){setNotice(problem(error));}
  }
  function dropCandidate(){
    try{sessionStorage.removeItem(candidateStorage);}catch{/* 移除失敗只會讓候選留著，不影響目前學生卷。 */}
    setCandidateUpdate(n=>n+1);setNotice('已保留原學生卷，不採用候選。');
  }
  function confirm(){
    if(!checked||!active||stale||disabled||busy||activeRequest.current||!current())return;
    try{
      const next=confirmPaperStage(draft,stage);
      if(!save(next))return;
      if(stage==='teacher'){
        try{setPreview(onPreview(assembleAuditedPaper(base,next,audit?.report,auditReady,audit?.previousTeacherId??null,pre)));setNotice('已確認教師判讀。可獨立驗題，再決定是否保存正式題本。');}
        catch(error){setNotice(problem(error));}
      }else if(stage==='student'){setChecked(false);setNotice('已確認學生卷，請先進行獨立驗題。');}
      else navigate('student');
    }catch(error){setNotice(problem(error));}
  }
  function startFresh(){
    if(disabled||busy||storageBlocked||activeRequest.current||!current())return;
    try{
      if(raw.current===null||sessionStorage.getItem(storageKey)!==raw.current)throw Error('目前草稿已變更，請重新開啟。');
      sessionStorage.setItem(storageKey+':archive:'+crypto.randomUUID(),raw.current);
      if(save(newPaperDraft(base))){setArchives(rows=>[...rows,draft]);navigate('materials');setNotice('已保留上一輪草稿，現在可開始新的材料。');}
    }catch(error){setNotice(problem(error));}
  }
  useEffect(()=>{
    try{
      const prefix=storageKey+':archive:';
      const archived=Array.from({length:sessionStorage.length},(_,i)=>sessionStorage.key(i)).flatMap(name=>{
        if(!name?.startsWith(prefix))return [];
        try{return [readPaperDraft(base,sessionStorage.getItem(name))];}catch{return [];}
      });
      setArchives(archived);
    }catch{/* A failed archive read never replaces the current draft. */}
  },[storageKey]);
  function publish(){
    if(disabled||busy||activeRequest.current||!current())return;
    try{const value={...assembleAuditedPaper(base,draft,audit?.report,auditReady,audit?.previousTeacherId??null,pre),...(selfReport?{selfReport}:{})};if(onSave(value)){setSelfReport(undefined);onClose();}}
    catch(error){setNotice(problem(error));}
  }
  function auditPreview(){
    try{setPreview(onPreview({...assembleAuditedPaper(base,draft,audit?.report,auditReady,audit?.previousTeacherId??null,pre),...(selfReport?{selfReport}:{})}));}catch(error){setNotice(problem(error));}
  }
  const canPublish=auditReady&&!teacherNeedsRerun&&!teacherFailures.length&&!!teacher?.confirmed&&stageCurrent(draft,'teacher')&&!teacher.value.issues.length&&!teacher.value.groups.some(g=>g.choices.some(q=>q.answer===null));
  const starterSlots=(base.payload.assessmentBlueprint as {itemBlueprint?:{slots:{indicatorId:string;kind:string;question:number;step:number|null;workload:{support:string}}[]}}|undefined)?.itemBlueprint?.slots??[];
  const showStarter=(indicatorId:string,question:number,step:number)=>starterSlots.some(slot=>slot.indicatorId===indicatorId&&slot.kind==='open'&&slot.question===question&&slot.step===step&&slot.workload.support==='starter');
  const editable=stage==='materials'&&materials&&!disabled&&!busy&&!storageBlocked;
  return <section className="card" aria-labelledby="staged-paper-title">
    <h2 id="staged-paper-title">{label}｜三頁製作</h2>
    <p>每一步產出後會立即顯示。確認材料才出題。確認學生卷後，先獨立驗題並閱讀報告，再進教師盲查。</p>
    <nav className="actions" aria-label="三頁出題步驟">{PAPER_STAGES.map((part,i)=><button key={part} type="button" aria-current={stage===part?'step':undefined}
      disabled={busy} onClick={()=>navigate(part)}>{i+1}. {PAPER_STAGE_NAME[part]}</button>)}</nav>
    <h3 ref={heading} tabIndex={-1}>{PAPER_STAGE_NAME[stage]}</h3>
    {stale&&<p className="notice">上一步已更新；以下是舊成果，需重新核對，不可用來進下一步。</p>}
    {stage==='materials'&&materials&&!editing&&<Materials groups={materials.value.groups}/>}
    {stage==='student'&&student&&!editingStudent&&<Student materials={draft.revisions.find(r=>r.id===student.parent)?.value.groups as Group[]??[]} value={student.value}/>}
    {stage==='teacher'&&!auditReady&&<p className="notice">請先回學生題本完成獨立驗題並閱讀報告。既有判讀可查看；尚不能產生或保存新版。</p>}
    {stage==='teacher'&&auditReady&&teacherNeedsRerun&&<p className="notice">以下是舊教師判讀。請重新逐題盲查，才可確認與保存。</p>}
    {stage==='teacher'&&teacherFailures.length>0&&<section className="notice" aria-label="逐題盲查問題">
      <p><b>下列題位未採用，學生卷未改動</b></p>
      <ul>{teacherFailures.map(f=><li key={f.id}><b>{f.label}：</b>{f.reason}{f.quote&&<><br />題面原文：「{f.quote}」</>}</li>)}</ul>
    </section>}
    {stage==='teacher'&&retryLog.length>0&&<details><summary>自動重試紀錄（{retryLog.length}）</summary><ul>{retryLog.map((row,i)=><li key={i}>{row}</li>)}</ul></details>}
    {stage==='teacher'&&teacher&&<Teacher value={teacher.value}/>}
    {editable&&!editing&&<button type="button" onClick={()=>setEditing(structuredClone(materials.value.groups))}>編輯材料另存新版</button>}
    {editing&&<div>{editing.map((group,i)=><fieldset key={group.indicatorId}><legend>第 {i+1} 組</legend>
      {(['title','context','data','coverage'] as const).map((field,k)=><label key={field}>{['標題','情境','材料','備課核對'][k]}
        <textarea aria-label={['標題','情境','材料','備課核對'][k]} value={group[field]} rows={field==='data'?6:2} onChange={event=>{const value=event.currentTarget.value;
          setEditing(rows=>rows?.map((row,n)=>n===i?{...row,[field]:value}:row)??null);
        }}/></label>)}</fieldset>)}
      <div className="actions"><button type="button" onClick={()=>{try{
        if(save(appendPaperRevision(base,draft,'materials',{groups:editing}))){
          setEditing(null);setChecked(false);setNotice('已另存材料；既有學生題本和判讀須重新核對。');
        }
      }catch(error){setNotice(problem(error));}}}>保存材料新版</button>
      <button type="button" onClick={()=>setEditing(null)}>取消編輯</button></div></div>}
    {stage==='student'&&student&&!stale&&!student.value.missing.length&&!editingStudent&&<button type="button" disabled={disabled||busy||storageBlocked}
      onClick={()=>setEditingStudent(structuredClone(student.value))}>編輯學生題本另存新版</button>}
    {editingStudent&&<form onSubmit={event=>{event.preventDefault();try{
      if(save(appendPaperRevision(base,draft,'student',editingStudent))){
        setEditingStudent(null);setChecked(false);setNotice('已另存學生題本；舊教師判讀須重新核對。');
      }
    }catch(error){setNotice(problem(error));}}}>
      {editingStudent.groups.map((group,g)=><fieldset key={group.indicatorId}><legend>第 {g+1} 組</legend>
        {group.choices.map((q,i)=><fieldset key={i}><legend>選擇第 {i+1} 題</legend>
          <label>題幹<textarea value={q.prompt} onChange={event=>{const value=event.currentTarget.value;
            setEditingStudent(source=>{const copy=structuredClone(source!);copy.groups[g].choices[i].prompt=value;return copy;});
          }}/></label>
          {q.options.map((o,j)=><label key={o.label}>選項 {o.label}<textarea value={o.text} onChange={event=>{const value=event.currentTarget.value;
            setEditingStudent(source=>{const copy=structuredClone(source!);copy.groups[g].choices[i].options[j].text=value;return copy;});
          }}/></label>)}
        </fieldset>)}
        {group.opens.map((q,i)=><fieldset key={i}><legend>非選第 {i+1} 題</legend>
          <label>題幹<textarea value={q.prompt} onChange={event=>{const value=event.currentTarget.value;
            setEditingStudent(source=>{const copy=structuredClone(source!);copy.groups[g].opens[i].prompt=value;return copy;});
          }}/></label>
          {q.steps.map((part,j)=><div key={j}><label>第 {j+1} 段作答要求<textarea value={part.guide} onChange={event=>{const value=event.currentTarget.value;
            setEditingStudent(source=>{const copy=structuredClone(source!);copy.groups[g].opens[i].steps[j].guide=value;return copy;});
          }}/></label>{showStarter(group.indicatorId,i+1,j+1)&&<label>第 {j+1} 段句架<textarea value={part.sentenceStarter} onChange={event=>{
            const value=event.currentTarget.value;
            setEditingStudent(source=>{const copy=structuredClone(source!);copy.groups[g].opens[i].steps[j].sentenceStarter=value;return copy;});
          }}/></label>}</div>)}
        </fieldset>)}
      </fieldset>)}
      <div className="actions"><button type="submit" disabled={disabled||busy||storageBlocked}>保存學生題本新版</button>
        <button type="button" onClick={()=>setEditingStudent(null)}>取消編輯學生題本</button></div>
    </form>}
    {!canGenerateStage(draft,stage)&&<p>請先確認目前版本的上一步。</p>}
    <div className="actions">
      {!editing&&!editingStudent&&<button type="button" disabled={disabled||busy||storageBlocked||!canGenerateStage(draft,stage)||stage==='teacher'&&!auditReady}
        onClick={()=>prepare()}>{active?'重新產生':'預覽並產生'}{PAPER_STAGE_NAME[stage]}</button>}
      {busy&&<button type="button" onClick={()=>{stop();setBusy(false);setTeacherProgress(null);setNotice('已停止；前一步與原草稿保留。');}}>停止這一步</button>}
      <button type="button" onClick={()=>{stop();onClose();}}>返回前後測</button>
    </div>
    {active&&!stale&&!editing&&!editingStudent&&!active.confirmed&&!(stage==='teacher'&&(!auditReady||teacherNeedsRerun||teacherFailures.length>0))&&!(stage==='student'&&student?.value.missing.length)&&<>
      <label className="consent-check"><input type="checkbox" checked={checked} onChange={event=>setChecked(event.currentTarget.checked)}/>
        {stage==='materials'?'我已核對材料能支撐逐題藍圖。':stage==='student'?'我已核對這是要送去獨立驗題的學生卷。':'我已核對答案、可接受答法、證據與判讀理由。'}</label>
      <button type="button" disabled={!checked||disabled||busy||storageBlocked} onClick={confirm}>確認{PAPER_STAGE_NAME[stage]}</button>
    </>}
    {stage==='student'&&student?.confirmed&&!stale&&!editingStudent&&<section className="sp-audit" aria-label="學生卷獨立驗題">
      <h4>學生卷獨立驗題</h4>
      <p>依逐題藍圖檢查必要材料、題間提示與作答負擔。只回報問題，保留學生原稿。</p>
      <p>{label==='前測'?'目前只和藍圖核對；後測生成後才比較兩卷的實際作答負擔。':'本次會對讀已核對的前測學生卷。前測原文只送給這次驗題，不會進出題或教師盲查。'}</p>
      {!auditInput.input&&<p className="notice">{auditInput.error}</p>}
      <button type="button" disabled={disabled||busy||storageBlocked||!auditInput.input} onClick={()=>prepare(true)}>{audit?'重新檢查學生卷':'預覽並檢查學生卷'}</button>
      {audit&&<>
        <p>已檢查 {audit.report.checked} 個題位。{audit.report.findings.length?'請核對下列問題或尚無法確認之處。':'本次未發現具體問題；仍須由老師核對。'}</p>
        {audit.report.findings.length>0&&<ul>{audit.report.findings.map(f=><li key={f.target.id+f.kind}>
          <b>{f.target.label}｜{f.kind==='material'?'缺料':f.kind==='hint'?'題間提示':'作答負擔'}{f.status==='uncertain'?'（待核對）':''}</b>：{f.reason}
          {f.current&&<><br />{label}原文（{f.current.id}）：「{f.current.text}」</>}
          {f.other&&<><br />{f.kind==='workload'?'前測原文':f.kind==='hint'?'提示來源':'相關材料'}（{f.other.id}）：「{f.other.text}」</>}
        </li>)}</ul>}
        <p>閱讀報告只代表已知悉，問題不會被清除。可回頭編輯另存並重驗，或繼續讓教師獨立盲查。</p>
        <div className="actions"><button type="button" className="primary" disabled={disabled||busy||storageBlocked} onClick={()=>{
          try{saveAudit(audit.report,true,audit.previousTeacherId);navigate('teacher');}catch(error){setNotice(problem(error));}
        }}>已閱讀驗題報告，前往教師盲查</button>
        <button type="button" onClick={()=>downloadBlob(label+'-學生卷獨立驗題.json',new Blob([JSON.stringify(audit.report,null,2)],{type:'application/json'}))}>下載學生卷驗題報告</button></div>
      </>}
      {studentCandidate&&<section className="notice" aria-label="自動重出的候選學生卷">
        <p><b>候選學生卷（第 {studentCandidate.rounds} 次自動重出，再驗未發現明確問題）</b></p>
        <p>目前學生卷未改動。請比對下方候選與上方原卷；採用後原卷保留在舊草稿，教師判讀須重新盲查。</p>
        <ul>{studentCandidate.history.map((row,i)=><li key={i}>{row}</li>)}</ul>
        {studentCandidate.report.findings.length>0&&<p>候選再驗仍有 {studentCandidate.report.findings.length} 項待核對（非明確問題）。</p>}
        <details><summary>查看候選學生卷</summary>
          <Student materials={materials?.value.groups??[]} value={draft.revisions.find(r=>r.id===studentCandidate.id)!.value as StageValue['student']}/></details>
        <label className="consent-check"><input type="checkbox" checked={candidateChecked} onChange={event=>setCandidateChecked(event.currentTarget.checked)}/>我已比對候選學生卷，確認要送去教師盲查的是這一份。</label>
        <div className="actions"><button type="button" className="primary" disabled={!candidateChecked||disabled||busy||storageBlocked} onClick={adoptCandidate}>採用候選學生卷</button>
          <button type="button" disabled={busy} onClick={dropCandidate}>保留原學生卷</button></div>
      </section>}
      {!studentCandidate&&retryLog.length>0&&<details open><summary>自動重試紀錄</summary><ul>{retryLog.map((row,i)=><li key={i}>{row}</li>)}</ul></details>}
    </section>}
    {stage==='teacher'&&canPublish&&<section className="sp-self-report" aria-label="情境自陳題">
      <h4>情境自陳題（{label} {base.payload.phase==='post'?3:2} 題）</h4>
      <p>學生依情境選出自己最可能的做法。只取得自陳，不計分、不改變能力階段；選項已打亂，階段對照只出現在教師版。{base.payload.phase==='post'?(preHasSelfReport?'第 1、2 題與前測同序配對，第 3 題為後測新增。':'前測沒有自陳題，三題都不與前測比較。'):''}</p>
      {selfReport?<><SelfReportView value={selfReport}/>
        <div className="actions"><button type="button" disabled={disabled||busy||storageBlocked} onClick={prepareSelfReport}>重新產生自陳題</button>
          <button type="button" disabled={busy} onClick={()=>{setSelfReport(undefined);setNotice('已移除自陳題；保存的正式題本不含自陳題。');}}>不附自陳題</button></div></>
        :<><p>尚未產生；不產生也可保存正式題本，但不含自陳題。</p>
          <button type="button" disabled={disabled||busy||storageBlocked} onClick={prepareSelfReport}>預覽並產生自陳題</button></>}
    </section>}
    {stage==='teacher'&&canPublish&&<div className="actions">
      <button type="button" disabled={disabled||busy} onClick={auditPreview}>檢視獨立驗題</button>
      <button type="button" className="primary" disabled={disabled||busy||storageBlocked} onClick={publish}>保存正式{label}題本</button>
    </div>}
    {stage==='teacher'&&preview&&<AssessmentAuditPanel key={preview.id} projectId={base.projectId} pre={preview.phase==='pre'?preview:undefined} post={preview.phase==='post'?preview:undefined}
      disabled={disabled||busy} activeRequest={activeRequest} onNeedKey={onNeedKey}/>}
    {draft.revisions.some(r=>r.stage===stage&&draft.active[r.stage]!==r.id&&r.id!==studentCandidate?.id)&&<details><summary>查看保留的舊草稿</summary>
      {draft.revisions.filter(r=>r.stage===stage&&draft.active[r.stage]!==r.id&&r.id!==studentCandidate?.id).map((r,i)=><details key={r.id}><summary>{PAPER_STAGE_NAME[r.stage]}・舊稿 {i+1}</summary>
        {r.stage==='materials'?<Materials groups={(r.value as StageValue['materials']).groups}/>
          :r.stage==='student'?<Student materials={draft.revisions.find(old=>old.id===r.parent)?.value.groups as Group[]??[]} value={r.value as StageValue['student']}/>
          :<Teacher value={r.value as StageValue['teacher']}/>}</details>)}</details>}
    {draft.revisions.length>0&&<button type="button" onClick={()=>downloadBlob(
      label+'-三頁草稿紀錄.json',new Blob([JSON.stringify(draft,null,2)],{type:'application/json'})
    )}>下載目前三頁草稿紀錄</button>}
    {(draft.revisions.length>=60||notice.includes('保存上限'))&&<button type="button" disabled={disabled||busy||storageBlocked} onClick={startFresh}>保留這輪草稿並開始空白</button>}
    {archives.length>0&&<details><summary>查看先前草稿的{PAPER_STAGE_NAME[stage]}</summary>
      {archives.map((archive,i)=><details key={i}><summary>草稿 {i+1}</summary>
        {archive.revisions.filter(r=>r.stage===stage).map(r=><article key={r.id}>
          {r.stage==='materials'?<Materials groups={(r.value as StageValue['materials']).groups}/>
            :r.stage==='student'?<Student materials={archive.revisions.find(old=>old.id===r.parent)?.value.groups as Group[]??[]} value={r.value as StageValue['student']}/>
            :<Teacher value={r.value as StageValue['teacher']}/>}
        </article>)}</details>)}</details>}
    <p role="status">{busy&&notice.startsWith('驗題發現')?notice:busy?teacherProgress?'正在逐題盲查：已處理 '+teacherProgress.done+'／'+teacherProgress.total+' 題位。':stage==='student'&&active?.confirmed?'正在檢查學生卷…':'正在產生'+PAPER_STAGE_NAME[stage]+'…':notice}</p>
    {pending&&<FocusDialog label="三頁出題資料預覽" onDismiss={()=>setPending(null)}>
      <h2 tabIndex={-1} data-dialog-start>確認送出：{auditPending?'學生卷獨立驗題':selfPending?'情境自陳題':PAPER_STAGE_NAME[stage]}</h2>
      <p>使用 {usingLabel(provider,model)}。{teacherPending?'本次將發出 '+pending.items.length+' 次獨立請求，每次只送一個題位與同組材料。':'這一步只送出下列資料一次。'}可能產生費用。未通過程式檢查時，會用同一份資料加上失敗原因自動重試，最多 {AUTO_RETRY_MAX} 次，不再詢問；{auditPending?'驗題若發現明確問題，會再自動重出學生卷並再驗，最多 '+AUTO_RETRY_MAX+' 輪，結果只列為候選。':'結果仍須你核對。'}請先去識別。</p>
      <details><summary>查看將送出的資料</summary><textarea rows={10} readOnly aria-label="三頁出題本次資料" value={JSON.stringify('items' in pending?pending.items.map(item=>item.plan.payload):pending.payload,null,2)}/></details>
      <label className="consent-check"><input type="checkbox" checked={consent} onChange={event=>setConsent(event.currentTarget.checked)}/>我已核對資料並同意這次送出</label>
      <button type="button" disabled={!consent||disabled} onClick={()=>{void send();}}>同意並產生</button>
      <button type="button" onClick={()=>setPending(null)}>取消</button>
    </FocusDialog>}
  </section>;
}
