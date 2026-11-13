import { MODE_PLAN } from './types';
import type { ModeChoice } from './thresholdSet';
import type { PaperStage, StageValue } from './stagedPaper';

const labels=['A','B','C','D'] as const;
const str={type:'string'};
const choiceVerdict={type:'string',enum:['fits','not_fit','uncertain']};
const nullable=(value:object)=>({anyOf:[value,{type:'null'}]});
const object=(properties:Record<string,object>)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const conditionKeys=['knowledge','reading','complexity','reasoning','prompts'] as const;
const moreSources={otherSourceId:nullable(str),thirdSourceId:nullable(str)};
const sourceRecord=object({reason:str,sourceId:str});
const concern=nullable(sourceRecord);
const namedOptions=(value:object)=>object(Object.fromEntries(labels.map(key=>[key,value])));
type Group=StageValue['materials']['groups'][number];
type Student=StageValue['student']['groups'][number];
interface SlotGroup {
  id:string; indicatorId:string; mode:ModeChoice['mode'];
  choices:{id:string;threshold:string}[];
  opens:{id:string;steps:{id:string;threshold:string;starter:boolean}[]}[];
}

export function paperSlots(selected:ModeChoice[],blueprint:unknown):SlotGroup[]{
  const slots=(blueprint as {itemBlueprint?:{slots?:{indicatorId:string;kind:string;question:number;step:number|null;workload:{support:string}}[]}}|undefined)?.itemBlueprint?.slots??[];
  return selected.map(({indicatorId,mode},i)=>{
    const id='G'+(i+1), plan=MODE_PLAN[mode];
    return {id,indicatorId,mode,choices:plan.choices.map((threshold,j)=>({id:id+'-Q'+(j+1),threshold})),
      opens:plan.opens.map((steps,j)=>{
        const open=id+'-O'+(j+1);
        return {id:open,steps:steps.map((threshold,k)=>({id:open+'-S'+(k+1),threshold,
          starter:slots.some(s=>s.indicatorId===indicatorId&&s.kind==='open'&&s.question===j+1&&s.step===k+1&&s.workload.support==='starter')}))};
      })};
  });
}

function fieldShapes(stage:PaperStage,groups:SlotGroup[]){
  const fields:Record<string,object>={};
  for(const group of groups){
    if(stage==='materials'){fields[group.id]=object({title:str,context:str,data:str,coverage:str});continue;}
    if(stage==='teacher')fields[group.id]=object(Object.fromEntries(conditionKeys.map(k=>[k,str])));
    for(const q of group.choices)fields[q.id]=stage==='student'
      ? nullable(object({prompt:str,options:namedOptions(str)}))
      : object({options:namedOptions(object({verdict:choiceVerdict,reason:str,sourceId:nullable(str),...moreSources})),concern});
    for(const q of group.opens){
      if(stage==='student')fields[q.id]=nullable(object({prompt:str}));
      for(const step of q.steps)fields[step.id]=stage==='student'
        ? nullable(object(step.starter?{guide:str,sentenceStarter:str}:{guide:str}))
        : object({sourceId:str,...moreSources,aboveFeatures:str,aboveExample:str,belowExample:str,concern});
    }
  }
  return fields;
}
export const teacherFieldShapes=(groups:SlotGroup[])=>fieldShapes('teacher',groups);
export function slotSchema(stage:PaperStage,groups:SlotGroup[]){
  return object({fields:object(fieldShapes(stage,groups)),...(stage==='student'?{needs:object(Object.fromEntries(groups.map(g=>[g.id,nullable(str)])))}:{})});
}

export function paperSourceChunks(text:string){
  return text.split(/\r?\n/).flatMap(line=>{
    if(line.trim().length<=300)return [line.trim()];
    const pieces:string[]=[];
    let piece='';
    for(const char of line){
      if(piece.length+char.length>260){pieces.push(piece.trim());piece='';}
      piece+=char;
    }
    if(piece)pieces.push(piece.trim());
    return pieces;
  }).filter(text=>/[\p{L}\p{N}]/u.test(text));
}

export function teacherSources(groups:SlotGroup[],materials:Group[],students:Student[]){
  return groups.map((g,i)=>{
    const m=materials[i], p=students[i];
    const passages=[m.title,m.context,m.data].flatMap(paperSourceChunks).map((text,index)=>({id:g.id+'-M'+(index+1),text}));
    const choices=g.choices.map((slot,j)=>({id:slot.id,
      options:Object.fromEntries(p.choices[j].options.map(o=>[o.label,o.text])),
      promptSources:paperSourceChunks(p.choices[j].prompt).map((text,k)=>({id:slot.id+'-P'+(k+1),text}))}));
    const opens=g.opens.map((slot,j)=>({id:slot.id,
      promptSources:paperSourceChunks(p.opens[j].prompt).map((text,k)=>({id:slot.id+'-P'+(k+1),text})),
      steps:slot.steps.map((step,k)=>({id:step.id,
        sentenceStarter:p.opens[j].steps[k].sentenceStarter,
        guideSources:paperSourceChunks(p.opens[j].steps[k].guide).map((text,n)=>({id:step.id+'-P'+(n+1),text}))}))}));
    return {id:g.id,passages,choices,opens};
  });
}

const verify=(input:unknown,keys:string[],location:string)=>{
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error(location+'應填入固定欄位。');
  const row=input as Record<string,unknown>;
  const missing=keys.filter(k=>!Object.hasOwn(row,k)), extra=Object.keys(row).filter(k=>!keys.includes(k));
  if(missing.length||extra.length)throw Error(location+'欄位不符'+(missing.length?'；缺 '+missing.join('、'):'')+(extra.length?'；多出 '+extra.join('、'):'')+'。');
  return row;
};
const valueText=(value:unknown,max:number,location:string)=>{
  if(typeof value!=='string'||!value.trim()||value.length>max)throw Error(location+'文字空白或超過上限。');
  return value.trim();
};
export function decodePaperSlots(
  stage:PaperStage,groups:SlotGroup[],raw:unknown,materials:Group[],students:Student[],
):StageValue[PaperStage]{
  const root=verify(raw,stage==='student'?['fields','needs']:['fields'],'本階段回應');
  const fields=verify(root.fields,Object.keys(fieldShapes(stage,groups)),'填入的題位');
  if(stage==='materials')return {groups:groups.map(g=>({
    indicatorId:g.indicatorId,...verify(fields[g.id],['title','context','data','coverage'],g.id+' 材料'),
  } as Group))};
  if(stage==='student'){
    const needs=verify(root.needs,groups.map(g=>g.id),'材料缺口');
    const missing=groups.flatMap(g=>needs[g.id]===null?[]:[{indicatorId:g.indicatorId,need:valueText(needs[g.id],2000,g.id+' 材料缺口')}]);
    if(missing.length)return {groups:[],missing};
    return {missing:[],groups:groups.map(g=>({
      indicatorId:g.indicatorId,
      choices:g.choices.map(q=>{
        const row=verify(fields[q.id],['prompt','options'],q.id);
        const options=verify(row.options,[...labels],q.id+' 選項');
        return {prompt:row.prompt as string,options:labels.map(label=>({label,text:options[label] as string}))};
      }),
      opens:g.opens.map(q=>({prompt:verify(fields[q.id],['prompt'],q.id).prompt as string,
        steps:q.steps.map(s=>{
          const row=verify(fields[s.id],s.starter?['guide','sentenceStarter']:['guide'],s.id);
          return {guide:row.guide as string,sentenceStarter:s.starter?row.sentenceStarter as string:'請作答。'};
        })})),
    }))};
  }

  const issues:StageValue['teacher']['issues']=[];
  const sources=teacherSources(groups,materials,students);
  const result=groups.map((g,i)=>{
    const {passages,choices,opens}=sources[i];
    type Source={id:string;text:string};
    const resolve=(ref:unknown,allowed:Source[],key:string)=> {
      const row=allowed.find(s=>s.id===ref);
      if(!row)throw Error(key+' 引用的片段編號不存在或屬於別題：'+(typeof ref==='string'?ref.slice(0,60):'未填')+'。');
      return row.text;
    };
    const supporting=(row:Record<string,unknown>,allowed:Source[],key:string)=>{
      const refs=[row.sourceId,row.otherSourceId,row.thirdSourceId].filter(ref=>ref!==null);
      if(refs.length!==new Set(refs).size||row.sourceId===null&&refs.length)throw Error(key+' 引用請從第一個編號起填，且不可重複。');
      return refs.map(ref=>resolve(ref,allowed,key));
    };
    const annotate=(quotes:string[])=>quotes.map(quote=>'；題面依據：「'+quote+'」').join('');
    const push=(target:string,reason:string,quote:string)=>issues.push({indicatorId:g.indicatorId,target,reason,quote});
    const addConcern=(value:unknown,allowed:Source[],key:string,target:string)=>{
      if(value===null)return;
      const row=verify(value,['reason','sourceId'],key+' 疑義');
      push(target,valueText(row.reason,1500,key+' 疑義'),resolve(row.sourceId,allowed,key));
    };
    return {
      indicatorId:g.indicatorId,
      conditions:(()=>{const row=verify(fields[g.id],[...conditionKeys],g.id+' 作答條件');return {knowledge:valueText(row.knowledge,2000,g.id),reading:valueText(row.reading,2000,g.id),complexity:valueText(row.complexity,2000,g.id),reasoning:valueText(row.reasoning,2000,g.id),prompts:valueText(row.prompts,2000,g.id)};})(),
      choices:g.choices.map((slot,j)=>{
        const allowed=[...passages,...choices[j].promptSources],target='Q'+(j+1);
        const field=verify(fields[slot.id],['options','concern'],slot.id), opts=verify(field.options,[...labels],slot.id+' 盲查');
        const evaluated=labels.map(label=>{
          const row=verify(opts[label],['verdict','reason','sourceId',...Object.keys(moreSources)],slot.id+' 選項 '+label);
          if(row.verdict!=='fits'&&row.verdict!=='not_fit'&&row.verdict!=='uncertain')throw Error(slot.id+' 選項 '+label+' 判定不符。');
          const reason=valueText(row.reason,850,slot.id+' 選項 '+label+' 理由');
          const [quote,...extra]=supporting(row,allowed,slot.id+' 選項 '+label);
          if(row.verdict==='fits'&&!quote)throw Error(slot.id+' 選項 '+label+' 缺少可查核的依據。');
          return {label,verdict:row.verdict,reason:reason+annotate(extra),quote};
        });
        const fits=evaluated.filter(o=>o.verdict==='fits'), unclear=evaluated.filter(o=>o.verdict==='uncertain');
        const fallback=choices[j].promptSources[0]?.text??passages[0]?.text;
        if(!fallback)throw Error(slot.id+' 缺少可查核的題面。');
        if(fits.length>1){
          for(const o of fits)push(target,(fits.length===2?'疑似雙解：':'疑似多解：')+fits.map(v=>v.label).join('、')+' 均符合題意。'+o.label+'：'+o.reason,o.quote!);
        }else if(unclear.length){
          for(const o of unclear)push(target,'無法確認唯一答案，選項 '+o.label+'：'+o.reason,o.quote??fallback);
        }else if(!fits.length){
          push(target,'盲查未找到完全符合題意的選項。',fallback);
        }
        addConcern(field.concern,allowed,slot.id,target);
        const answer=fits.length===1&&!unclear.length?fits[0].label:null;
        return {answer,thinking:evaluated.map(o=>({label:o.label,text:o.reason+(o.quote&&o.label!==answer?annotate([o.quote]):'')})),
          evidence:fits[0]?.quote??fallback};
      }),
      opens:g.opens.map((q,j)=>({steps:q.steps.map((s,k)=>{
        const allowed=[...passages,...opens[j].promptSources,...opens[j].steps[k].guideSources];
        const field=verify(fields[s.id],['aboveFeatures','aboveExample','belowExample','sourceId',...Object.keys(moreSources),'concern'],s.id);
        addConcern(field.concern,allowed,s.id,'O'+(j+1)+'-S'+(k+1));
        const [evidence,...extra]=supporting(field,allowed,s.id);
        if(!evidence)throw Error(s.id+' 缺少可查核的依據。');
        return {aboveFeatures:valueText(field.aboveFeatures,950,s.id+' 判讀特徵')+annotate(extra),aboveExample:field.aboveExample as string,
          belowExample:field.belowExample as string,evidence};
      })})),
    };
  });
  return {groups:result,issues};
}
