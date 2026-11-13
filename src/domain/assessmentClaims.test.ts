import { describe, expect, it } from 'vitest';
import type { AuditSource } from './assessmentAudit';
import { buildClaimAuditPlan, claimChecks, validateClaimAudit } from './assessmentClaimAudit';
import { meanClaimIssues } from './assessmentMeanAudit';

const data = '甲校：\n甲一：1 分（1人）\n甲二：3 分（1人）\n乙校：\n乙一：5 分（1人）\n乙二：7 分（1人）';
function book(): AuditSource {
  return {
    phase:'pre',assessmentId:'local',targets:[
      {ref:'G1-Q1',item:'G1-Q1',part:'choice',label:'選擇第 1 題',options:['a','b','c']},
      {ref:'G1-O1-S1',item:'G1-O1',part:'open',label:'非選第 1 段',options:[]},
    ],
    student:[
      {ref:'G1-context',label:'共用情境',text:'甲校和乙校的平均分相同。'},
      {ref:'G1-data',label:'共用材料',text:data},
      {ref:'G1-Q1',item:'G1-Q1',target:'G1-Q1',part:'choice',label:'題幹',text:'哪一項可以證明兩校有不同的觀察？'},
      ...['甲校有一位獲得 1 分','乙校有一位獲得 7 分','兩校沒有量測結果'].map((text,i)=>({
        ref:'G1-Q1-'+'abc'[i], item:'G1-Q1',target:'G1-Q1',part:'choice' as const,label:'選項',text,
      })),
      {ref:'G1-O1',item:'G1-O1',part:'open',label:'非選題幹',text:'請核對【史料甲】所記內容。'},
      {ref:'G1-O1-S1',item:'G1-O1',target:'G1-O1-S1',part:'open',label:'非選題面',text:'指出【史料甲】的做法和目的。'},
    ],
    teacher:[
      {ref:'G1-Q1-key',target:'G1-Q1',item:'G1-Q1',part:'choice',label:'答案鍵',text:'a'},
      {ref:'G1-Q1-a-judge',target:'G1-Q1',item:'G1-Q1',part:'choice',label:'選項判讀',text:'雖然平均相同，但兩校有不同的觀察。'},
      {ref:'G1-O1-S1-above',target:'G1-O1-S1',item:'G1-O1',part:'open',label:'教師例答',text:'官員發放植物種子用於治病及安排補查。'},
    ],
  };
}
describe('證據驗題',()=>{
  it('依同單位精確頻數重算，而不是相信共同情境的數值聲稱',()=>{
    const source=book();
    const before=JSON.stringify(source);
    const issues=meanClaimIssues(source);
    expect(issues).toHaveLength(1);
    expect(issues[0].explanation).toMatch(/4 ÷ 2 = 2 分.*12 ÷ 2 = 6 分/);
    expect(issues[0].evidence.every(e=>[...source.student,...source.teacher].some(b=>b.ref===e.ref&&b.text.includes(e.quote)))).toBe(true);
    expect(JSON.stringify(source)).toBe(before);
  });
  it('兩組真的相同、是假設、比較別組、或資料列不完整時，不冒充可驗證的矛盾',()=>{
    const source=book();
    source.student[1].text=data.replace('甲二：3 分（1人）','甲二：3 分（1人）\n甲三：14 分（1人）。');
    expect(meanClaimIssues(source)).toEqual([]);
    source.student[1].text=data.replace('甲二：3 分（1人）','甲二：3 分（1人）\n甲三：9–14 分（1人）');
    expect(meanClaimIssues(source)).toEqual([]);
    source.student[1].text=data;
    for(const text of ['假設甲校和乙校的平均分相同。','甲校和乙校的平均並非相同。','甲校和乙校的平均相同（四捨五入至整數）。','丙校與丁校的平均相同。']){
      source.student[0].text=text; expect(meanClaimIssues(source),text).toEqual([]);
    }
  });
  it('選擇題盲查不送答案，兩項有逐字證據都合題才報警示，無效來源不冒充完成',()=>{
    const check=claimChecks(book()).find(row=>row.part==='choice')!;
    const payload=buildClaimAuditPlan('p',check).payload;
    expect(JSON.stringify(payload)).not.toMatch(/答案鍵|選項判讀|教師例答/);
    const c=(payload.cases as { passages:{id:string;text:string}[] }[])[0];
    const a=c.passages.find(row=>row.text.includes('甲一：'))!.id, b=c.passages.find(row=>row.text.includes('乙二：'))!.id;
    const response={rows:[{target:'G1-Q1',observation:'按各校的量測紀錄逐個核對。',options:[
      {option:'A',status:'yes',reason:'甲校有1分的紀錄。',sourceIds:[a]},
      {option:'B',status:'yes',reason:'乙校有7分的紀錄。',sourceIds:[b]},
      {option:'C',status:'no',reason:'原表有兩組量測。',sourceIds:[]},
    ]}]};
    const issue=validateClaimAudit(check,response).issues[0];
    expect(issue.explanation).toContain('不只一個選項');
    expect(issue.evidence.map(e=>e.quote)).toContain('乙二：7 分（1人）');
    response.rows[0].options[1].status='no';
    expect(validateClaimAudit(check,response).issues).toEqual([]);
    response.rows[0].options[0].sourceIds=['假來源'];
    expect(validateClaimAudit(check,response)).toMatchObject({issues:[],uncertain:['選擇第 1 題']});
  });
  it('只選指定材料，引用真正的片段，建議另查不當作已發生的行動',()=>{
    const source=book();
    source.student[1].text='【史料甲】\n官員發放植物種子供種植。\n【史料乙】\n坊間傳說以植物治病。';
    const check=claimChecks(source).find(row=>row.part==='open')!;
    const payload=buildClaimAuditPlan('p',check).payload;
    expect(JSON.stringify(payload)).not.toContain('坊間傳說');
    const [c]=payload.cases as {passages:{id:string;text:string}[];units:{id:string;text:string}[]}[];
    const evidence=c.passages.find(row=>row.text.includes('供種植'))!.id;
    const result=validateClaimAudit(check,{rows:[{target:'G1-O1-S1',observation:'區分發放目的和日後查證。',units:c.units.map((u,i)=>({
      unit:u.id,status:i===0?'no':'not-claim',reason:i===0?'原文供種植，沒有治病的用途。':'這是後續查證。',sourceIds:i===0?[evidence]:[],
    }))}]});
    expect(result.issues[0].evidence.map(e=>e.quote)).toContain('官員發放植物種子用於治病');
    expect(result.issues[0].evidence.map(e=>e.quote)).toContain('官員發放植物種子供種植。');
  });
});
