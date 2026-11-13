import { dataTable } from '../documents/paperLayout';

type Dimension='time'|'temperature'|'volume'|'concentration'|'mass'|'length'|'percent'|'ratio';
type Quantity={dimension:Dimension;value:number;text:string;index:number;column?:string;series?:number};
type Unit={dimension:Dimension;scale:number};
export type TeacherPassage={id:string;text:string};
type DataRow=TeacherPassage&{label:string;cells:Quantity[]};
export type RowProblem={reason:string;quote:string};
const units:Record<string,Unit>={
 s:{dimension:'time',scale:1},sec:{dimension:'time',scale:1},'秒':{dimension:'time',scale:1},
 ms:{dimension:'time',scale:0.001},'毫秒':{dimension:'time',scale:0.001},
 min:{dimension:'time',scale:60},'分':{dimension:'time',scale:60},'分鐘':{dimension:'time',scale:60},
 h:{dimension:'time',scale:3600},'小時':{dimension:'time',scale:3600},
 '°c':{dimension:'temperature',scale:1},'度c':{dimension:'temperature',scale:1},'攝氏度':{dimension:'temperature',scale:1},
 ml:{dimension:'volume',scale:1},l:{dimension:'volume',scale:1000},
 'mol/l':{dimension:'concentration',scale:1},'mmol/l':{dimension:'concentration',scale:0.001},
 g:{dimension:'mass',scale:1},mg:{dimension:'mass',scale:0.001},kg:{dimension:'mass',scale:1000},
 cm:{dimension:'length',scale:1},mm:{dimension:'length',scale:0.1},
 '%':{dimension:'percent',scale:1},'倍':{dimension:'ratio',scale:1},
};
const number='[+−-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
const unit='mmol\\s*/\\s*l|mol\\s*/\\s*l|°\\s*c|攝氏度|毫秒|分鐘|小時|秒|ms|min|sec|kg|mg|ml|cm|mm|l|g|s|h|%|倍';
const normalize=(s:string)=>s.normalize('NFKC').replace(/−/g,'-');
const parsed=(s:string)=>Number(s.replace(/,/g,''));
const unitOf=(text:string)=>units[text.replace(/\s/g,'').toLowerCase()]??(text==='M'?units['mol/l']:undefined);
function quantities(text:string):Quantity[]{
 const value=normalize(text), re=new RegExp('(?<![\\w.±+×])('+number+')\\s*('+unit+'|M)(?![A-Za-z/])','giu');
 return [...value.matchAll(re)].flatMap(match=>{
  const u=unitOf(match[2]);
  if(!u)return [];
  const tail={dimension:u.dimension,value:parsed(match[1])*u.scale,text:match[0],index:match.index};
  const prefix=value.slice(0,match.index).match(/(?<![\w.])(?:[+-]?\d+(?:\.\d+)?\s*(?:、\s*|,\s+))+$/u);
  if(!prefix)return [tail];
  const earlier=[...prefix[0].matchAll(/[+-]?\d+(?:\.\d+)?/gu)];
  return [...earlier.map(m=>({...tail,value:Number(m[0])*u.scale,text:m[0]+' '+match[2],index:match.index-prefix[0].length+m.index,series:tail.index})),
    {...tail,series:tail.index}];
 });
}
function headerUnit(header:string){
 const text=normalize(header);
 const bracket=text.match(/\(([^()]+)\)\s*$/u)?.[1];
 const exact=bracket&&unitOf(bracket);
 if(exact)return exact;
 if(/秒/u.test(text)&&/時間|時長|耗時|用時|歷時|秒數/u.test(text))return units.s;
 if(/分鐘/u.test(text)&&/時間|時長|耗時|用時|歷時/u.test(text))return units.min;
 if(/攝氏/u.test(text)&&/溫度/u.test(text))return units['°c'];
 return undefined;
}
const splitLines=(text:string)=>text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
export function numericTable(text:string,passages:TeacherPassage[]):DataRow[]{
 const lines=splitLines(text), rows:DataRow[]=[];
 // The document and the checker use the same table parser. Non-table material stays as text.
 for(let i=0;i<lines.length;){
  if(!/[|｜]/u.test(lines[i])){i++;continue;}
  let end=i+1;
  while(end<lines.length&&/[|｜]/u.test(lines[end]))end++;
  const block=lines.slice(i,end), parsedTable=dataTable(block.join('\n'));
  i=end;
  if(!parsedTable)continue;
  const colUnits=parsedTable.headers.map(headerUnit);
  for(const [j,cells] of parsedTable.rows.entries()){
   const original=block[block.length-parsedTable.rows.length+j];
   const passage=passages.find(p=>p.text===original);
   if(!passage)continue; // Do not assign a partial fragment to a full data row.
   const facts=cells.flatMap((c,k)=>{
    if(k===0||/備註|說明|來源/u.test(parsedTable.headers[k]))return [];
    const v=normalize(c);
    const column=normalize(parsedTable.headers[k]).replace(/\([^()]+\)\s*$/u,'').trim();
    const inline=quantities(v).map(q=>({...q,column}));
    if(inline.length&&new RegExp('^'+number+'\\s*(?:'+unit+'|M)$','iu').test(v))return inline;
    const u=colUnits[k];
    const n=v.match(new RegExp('^('+number+')(?:\\s*[±]\\s*'+number+')?$','u'))?.[1];
    if(u&&n)return [{dimension:u.dimension,value:parsed(n)*u.scale,text:c,index:0,column}];
    const list=v.split(/、\s*|,\s+|[；;]\s*/u);
    if(u&&list.length>1&&list.every(x=>new RegExp('^'+number+'$','u').test(x.trim())))
      return list.map(x=>({dimension:u.dimension,value:parsed(x.trim())*u.scale,text:x.trim(),index:0,column}));
    return [];
   });
   if(facts.length)rows.push({...passage,label:normalize(cells[0]).replace(/^第\s*|\s*(?:組|列|號|次)$/gu,''),cells:facts});
  }
 }
 return rows;
}
const same=(a:number,b:number)=>Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(a),Math.abs(b));
function compatible(cell:Quantity,value:Quantity){return cell.dimension===value.dimension&&same(cell.value,value.value);}
function approximately(value:Quantity,candidate:number){
 const places=value.text.match(/\.(\d+)/u)?.[1].length??0;
 return same(value.value,candidate)||Math.abs(value.value-candidate)<=0.5*10**-places+1e-9;
}
const hypothetical=/^\s*(?:若要再|建議(?:再|另)?|可(?:另|再)?(?:補測|加測|測試|進行|設計)|假設|假如|例如設定|可以設定|可固定|應再|另做|再做)/u;
const delta=/(?:相差|差距(?:為|是)?|多(?:了|出)?|少(?:了|用)?|快|慢|縮短|增加|減少|延長)\s*(?:約|近)?\s*$/u;
const groupName=/(?:第\s*|(?:實驗)?(?:編號|第)\s*|實驗\s*|(?:紀錄|記錄)\s*)([A-Za-z0-9甲乙丙丁戊己庚辛壬癸]+)\s*(?:組|筆|列|號|次)?|([A-Z][A-Z0-9]*|[甲乙丙丁戊己庚辛壬癸]|\d+)\s*組/gu;
function sentenceParts(text:string){
 return normalize(text).split(/[。！？；;\n]/u).flatMap(sentence=>{
  // A proposal following an observed statement does not turn the observation into a proposal.
  return sentence.split(/(?:[,，]|並)(?=\s*(?:建議|可(?:再|另)?(?:補測|加測|設計|進行|測試)|若要再|假設))/u);
 });
}
export function verifyExampleRows(example:string,rows:DataRow[],sourceIds:string[],promptSources:TeacherPassage[]):RowProblem|undefined {
 if(!rows.length)return undefined;
 const cited=rows.filter(r=>sourceIds.includes(r.id));
 const citedPrompt=promptSources.filter(p=>sourceIds.includes(p.id)).flatMap(p=>quantities(p.text));
 const fallback=cited[0]??promptSources[0]??rows[0];
 const tableDimensions=new Set(rows.flatMap(r=>r.cells.map(c=>c.dimension)));
 for(const sentence of sentenceParts(example)){
  if(hypothetical.test(sentence))continue;
  const values=quantities(sentence);
  const labels=[...sentence.matchAll(groupName)].flatMap(m=>{
   const matches=rows.filter(r=>r.label.toLowerCase()===(m[1]??m[2]).toLowerCase());
   return matches.length===1?[{index:m.index,row:matches[0]}]:[];
  });
  const measured=values.filter(q=>q.dimension!=='ratio'&&tableDimensions.has(q.dimension));
  const singleRowObservation=!labels.length&&measured.filter(q=>q.dimension==='time').length===1&&
    new Set(measured.map(q=>q.dimension)).size===measured.length&&measured.length>1&&
    !/(?:比較|相差|相比|兩組|分別|而另一)/u.test(sentence);
  if(singleRowObservation&&!cited.some(r=>measured.every(v=>r.cells.some(c=>compatible(c,v))))&&
    !measured.every(v=>citedPrompt.some(c=>compatible(c,v)))){
   return {reason:'例答把 '+measured.map(q=>q.text).join('、')+' 放在同一筆紀錄，但所引資料沒有這組數值。',quote:fallback.text};
  }
  for(const q of values){
   const before=sentence.slice(0,q.index);
   const respective=before.lastIndexOf('分別');
   const respectiveRows=labels.filter(l=>l.index<respective);
   const respectiveValues=values.filter(v=>v.index>respective&&v.dimension===q.dimension);
   const respectiveSeries=[...new Set(respectiveValues.map(v=>v.series??v.index))];
   const listed=respective>=0&&respectiveRows.length===respectiveSeries.length&&respectiveRows.length>=2
     ?respectiveRows[respectiveSeries.indexOf(q.series??q.index)]?.row:undefined;
   const prior=listed??labels.filter(l=>l.index<q.index).at(-1)?.row;
   const columns=[...new Set(rows.flatMap(r=>r.cells.flatMap(c=>c.dimension===q.dimension&&c.column&&c.column.length>=2?[c.column]:[])))];
   const context=before.split(/[,，、；]/u).at(-1)??'';
   const directColumns=columns.filter(column=>context.includes(column)).sort((a,b)=>b.length-a.length);
   const column=directColumns.length&&directColumns.every(c=>directColumns[0].includes(c))?directColumns[0]:undefined;
   const matches=(c:Quantity)=>compatible(c,q)&&(!column||c.column===column);
   const earlierValues=values.filter(v=>v.index<q.index&&v.dimension===q.dimension);
   if(q.dimension==='ratio'){
    const timeRatio=/(?:1\s*\/\s*[tT]|相對速率|速率指標|時間.{0,15}(?:倍|比)|快|慢)/u.test(sentence);
    const times=cited.flatMap(r=>r.cells.filter(c=>c.dimension==='time').map(c=>c.value)).filter(v=>v>0);
    const named=labels.filter(l=>l.index<q.index).slice(-2);
    const relative=/(?:相對速率|速率指標|速率|[快慢])/u.test(sentence);
    const directed=named.length===2&&named[0].row.id!==named[1].row.id&&
     /是|為|比|相對於/u.test(before.slice(named[0].index,named[1].index))&&
     named.every(l=>cited.some(r=>r.id===l.row.id));
    const t1=directed?named[0].row.cells.find(c=>c.dimension==='time')?.value:undefined;
    const t2=directed?named[1].row.cells.find(c=>c.dimension==='time')?.value:undefined;
    const directionKnown=relative&&/是|為/u.test(before.slice(named[0]?.index??0))&&!/相差|差距|慢/u.test(before);
    const comparative=t1&&t2&&/比/u.test(before.slice(named[0]?.index??0,named[1]?.index))&&
      before.slice(named[1]?.index??0).match(/(快|慢)(?:了|約|近|為)?\s*$/u)?.[1];
    if(comparative&&t1&&t2&&(comparative==='快'?t1>=t2:t1<=t2))
      return {reason:'例答所寫的快慢方向與所引兩列的時間相反。',quote:named[0].row.text};
    if(timeRatio&&t1&&t2&&directionKnown&&!approximately(q,t2/t1))
     return {reason:'例答的 '+q.text+' 與所引兩列的速率比方向不一致。',quote:named[0].row.text};
    if(timeRatio&&times.length<2&&/(?:1\s*\/\s*[tT]|相對速率|速率指標)/u.test(sentence))
     return {reason:'例答的 '+q.text+' 需要兩筆原值，所引資料不足以重算。',quote:fallback.text};
    if(timeRatio&&times.length===2&&!approximately(q,times[0]/times[1])&&!approximately(q,times[1]/times[0]))
     return {reason:'例答的 '+q.text+' 無法用所引兩列的時間 '+times.join('、')+' 秒重算。',quote:fallback.text};
    continue;
   }
   if(!tableDimensions.has(q.dimension))continue;
   const mean=/(?:平均(?:時間|用時|值|為|是)?|均值)(?:為|是|約)?\s*$/u.test(before);
   if(mean&&!prior){
    const valuesByRow=cited.map(r=>r.cells.filter(c=>c.dimension===q.dimension&&(!column||c.column===column)));
    if(valuesByRow.length>=2&&valuesByRow.every(row=>row.length===1)){
     const average=valuesByRow.reduce((sum,row)=>sum+row[0].value,0)/valuesByRow.length;
     if(!approximately(q,average))return {reason:'例答的平均值 '+q.text+' 與所引資料列重算的結果不一致。',quote:fallback.text};
     continue;
    }
   }
   const diff=delta.test(before)&&/相差|相隔|比|縮短|差距|少用|多用/u.test(before);
   if(diff){
    const vals=cited.flatMap(r=>r.cells.filter(c=>c.dimension===q.dimension).map(c=>c.value));
    if(vals.length<2)return {reason:'例答的差值 '+q.text+' 需要兩筆同類欄位，所引資料不足以重算。',quote:fallback.text};
    if(vals.length===2&&!approximately(q,Math.abs(vals[0]-vals[1])))return {reason:'例答的差值 '+q.text+' 與所引兩列無法對應。',quote:fallback.text};
    continue;
   }
   if(prior){
    const series=q.series===undefined?[]:values.filter(v=>v.series===q.series);
    const rowValues=prior.cells.filter(c=>c.dimension===q.dimension&&(!column||c.column===column));
    if(series.length>1&&rowValues.length>1&&series[0]===q&&cited.some(r=>r.id===prior.id)){
     const unmatched=[...rowValues];
     for(const entry of series){
      const i=unmatched.findIndex(v=>compatible(v,entry));
      if(i<0)return {reason:'例答列出的重複量測（'+series.map(v=>v.text).join('、')+'）與第 '+prior.label+' 筆資料不一致。',quote:prior.text};
      unmatched.splice(i,1);
     }
    }
    if(!cited.some(r=>r.id===prior.id))return {reason:'例答使用第 '+prior.label+' 筆的 '+q.text+'，但引文未包含該列（'+prior.id+'）。',quote:prior.text};
    if(!prior.cells.some(matches))return {reason:'例答把 '+q.text+' 配到第 '+prior.label+' 筆（'+prior.id+'），與該列對應欄位不一致。',quote:prior.text};
   }else if(q.dimension==='time'&&measured.filter(v=>v.dimension==='time').length>1){
    const relativeLabel=before.match(/(?:前者|後者)(?=[^前後]*$)/u)?.[0];
    const relativeAt=before.search(/前者|後者/u);
    if(relativeLabel){
     const paired=new Map<Dimension,Quantity[]>();
     for(const v of measured.filter(v=>v.index<relativeAt&&v.dimension!=='time'))paired.set(v.dimension,[...(paired.get(v.dimension)??[]),v]);
     const pair=[...paired.values()].find(v=>v.length===2&&!same(v[0].value,v[1].value));
     const selected=pair?.[relativeLabel==='前者'?0:1];
     if(selected&&!cited.some(r=>r.cells.some(c=>compatible(c,selected))&&r.cells.some(matches)))
      return {reason:'例答把 '+q.text+' 配給'+relativeLabel+'（'+selected.text+'），與所引資料列不一致。',quote:fallback.text};
    }
    const previous=earlierValues.at(-1)?.index??-1;
    const qualifiers=measured.filter(v=>v.index>previous&&v.index<q.index&&v.dimension!=='time');
    const localText=sentence.slice(Math.max(0,previous),q.index);
    if(qualifiers.length&&new Set(qualifiers.map(v=>v.dimension)).size===qualifiers.length&&!/相差|差距/u.test(localText)&&
       !cited.some(r=>[...qualifiers,q].every(v=>r.cells.some(c=>compatible(c,v))))&&
       ![...qualifiers,q].every(v=>citedPrompt.some(c=>compatible(c,v)))){
      return {reason:'例答並列的 '+[...qualifiers,q].map(v=>v.text).join('、')+' 在所引原文中沒有對應到同一列。',quote:fallback.text};
    }
    if(!cited.some(r=>r.cells.some(matches))&&!citedPrompt.some(c=>compatible(c,q)))
      return {reason:'例答的 '+q.text+' 與引用資料列的時間欄不一致。',quote:fallback.text};
   }else if(!cited.some(r=>r.cells.some(matches))&&!citedPrompt.some(c=>compatible(c,q))){
    // If a sentence lists a derived value in a distinct unit or a follow-up condition, it is not an original observation.
    if(!earlierValues.length&&/換算|計算|平均|推算/u.test(before))continue;
    return {reason:'例答的 '+q.text+' 與引用資料列的同類欄位不一致，或沒有引用可核對的資料列。',quote:fallback.text};
   }
  }
 }
 return undefined;
}
