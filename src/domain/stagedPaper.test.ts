import { describe, expect, it } from 'vitest';
import { createSeed } from '../data/seed';
import { confirmDesign, confirmRules, reviewAssessment, reviewIndicators } from './lifecycle';
import { addSeparateSetPhase, buildSeparatePostPlan, buildSeparatePrePlan, defaultAssessmentBlueprint, defaultModes } from './thresholdSet';
import { newItemBlueprint } from './itemBlueprint';
import { activeRevision, appendPaperRevision, assembleStagedPaper, buildPaperStagePlan, canGenerateStage, confirmPaperStage, newPaperDraft, readPaperDraft, stageCurrent } from './stagedPaper';

function setup() {
  const seed=createSeed(), id=seed.activeProjectId, workspace=confirmDesign(confirmRules(reviewIndicators(seed,id),id),id);
  const project=workspace.projects[0],modes=defaultModes(project).map(row=>({...row,mode:'D' as const})), indicatorId=modes[0].indicatorId;
  const itemBlueprint=newItemBlueprint(modes);
  for(const slot of itemBlueprint.slots){
    slot.judgment='能判斷資料支持的範圍';
    slot.evidence='指出其中一則原始紀錄';
    if(slot.kind==='open'&&slot.question===1&&slot.step===1){slot.pre.support='none';slot.post.support='none';}
  }
  const base=buildSeparatePrePlan(project,'',modes,{...defaultAssessmentBlueprint(project),itemBlueprint});
  const materials={groups:[{indicatorId,title:'檢查兩組紀錄',context:'閱讀同一時間的實驗紀錄。',data:'甲組等了20秒，乙組等了30秒。',coverage:'可支持每段比較。'}]};
  const student={groups:[{indicatorId,choices:[],opens:[
    {prompt:'先讀甲組及乙組。',steps:[{guide:'指出甲組時間。',sentenceStarter:'我看到'},{guide:'比較兩組時間。',sentenceStarter:'甲組'}]},
    {prompt:'釐清原主張。',steps:[{guide:'指出結論的範圍。',sentenceStarter:'如果'}]},
  ]}],missing:[]};
  const example={aboveFeatures:'引用題面資料並說明。',aboveExample:'甲組等了20秒，結論限於本次紀錄。',belowExample:'直接猜較快。',evidence:'甲組等了20秒'};
  const teacher={groups:[{indicatorId,choices:[],opens:[{steps:[example,example]},{steps:[example]}],
    conditions:{knowledge:'不需課外知識',reading:'閱讀兩筆',complexity:'同一情境',reasoning:'比較並限縮',prompts:'按藍圖'}}],issues:[]};
  return {workspace,id,base,materials,student,teacher,indicatorId};
}
describe('三頁紙筆草稿',()=>{
  it('每頁獨立取資料，先確認材料，再試答學生卷，正式保存仍走既有版本與配對契約',()=>{
    const {workspace,id,base,materials,student,teacher}=setup();
    let draft=newPaperDraft(base);
    expect(()=>buildPaperStagePlan(base,draft,'student')).toThrow('先確認');
    expect(buildPaperStagePlan(base,draft,'materials').payload).not.toHaveProperty('student');
    draft=confirmPaperStage(appendPaperRevision(base,draft,'materials',materials),'materials');
    const s=buildPaperStagePlan(base,draft,'student').payload;
    expect(JSON.stringify(s)).toContain('甲組等了20秒');
    expect(JSON.stringify(s)).not.toContain('可支持每段比較');
    draft=confirmPaperStage(appendPaperRevision(base,draft,'student',student),'student');
    const t=buildPaperStagePlan(base,draft,'teacher').payload;
    expect(t).not.toHaveProperty('assessmentBlueprint');
    expect(JSON.stringify([t.studentBook,t.structure])).not.toMatch(/aboveExample|criterionIds|教師判讀內容/);
    draft=appendPaperRevision(base,draft,'teacher',teacher);
    expect(()=>assembleStagedPaper(base,draft)).toThrow('確認');
    draft=confirmPaperStage(draft,'teacher');
    const orig=JSON.stringify(workspace);
    const next=addSeparateSetPhase(workspace,id,base,assembleStagedPaper(base,draft));
    const pre=next.projects[0].assessments.find(a=>a.id===next.projects[0].activePreId)!;
    expect(pre.sets?.[0].opens[0].steps[0].sentenceStarter).toBe('請作答。');
    expect(pre.reviewedAt).toBeNull();
    const reviewed=reviewAssessment(next,id,pre.id);
    const post=buildSeparatePostPlan(reviewed.projects[0]);
    expect(post.payload).toHaveProperty('preWorkloadSummary');
    expect(JSON.stringify(buildPaperStagePlan(post,newPaperDraft(post),'materials').payload)).not.toContain('甲組等了20秒');
    expect(JSON.stringify(workspace)).toBe(orig);
  });
  it('回改材料使下游過期而不刪，刷新可讀回所有版本，舊判讀不能正式保存',()=>{
    const {base,materials,student,teacher}=setup();
    let draft=newPaperDraft(base);
    draft=confirmPaperStage(appendPaperRevision(base,draft,'materials',materials),'materials');
    draft=confirmPaperStage(appendPaperRevision(base,draft,'student',student),'student');
    draft=confirmPaperStage(appendPaperRevision(base,draft,'teacher',teacher),'teacher');
    const old=activeRevision(draft,'teacher');
    const revised=structuredClone(materials);revised.groups[0].data='甲組等了25秒，乙組等了30秒。';
    draft=appendPaperRevision(base,draft,'materials',revised);
    expect(activeRevision(draft,'teacher')).toEqual(old);
    expect(stageCurrent(draft,'student')).toBe(false);
    expect(canGenerateStage(draft,'teacher')).toBe(false);
    expect(()=>assembleStagedPaper(base,draft)).toThrow('三頁都確認');
    expect(readPaperDraft(base,JSON.stringify(draft))).toEqual(draft);
  });
  it('材料不足先回報，判讀引文必須屬於同題或共用資料，有問題不自動改題或發布',()=>{
    const {base,materials,student,teacher,indicatorId}=setup();
    let draft=confirmPaperStage(appendPaperRevision(base,newPaperDraft(base),'materials',materials),'materials');
    const missing=appendPaperRevision(base,draft,'student',{groups:[],missing:[{indicatorId,need:'請補一筆同條件資料。'}]});
    expect(()=>confirmPaperStage(missing,'student')).toThrow('材料不足');
    draft=confirmPaperStage(appendPaperRevision(base,draft,'student',student),'student');
    const wrong=structuredClone(teacher);
    wrong.groups[0].opens[0].steps[0].evidence='釐清原主張。';
    expect(()=>appendPaperRevision(base,draft,'teacher',wrong)).toThrow('該題學生卷');
    wrong.groups[0].opens[0].steps[0].evidence='。';
    expect(()=>appendPaperRevision(base,draft,'teacher',wrong)).toThrow('該題學生卷');
    const wrongIssue={...teacher,issues:[{indicatorId,target:'O1-S1',reason:'用另一題當依據。',quote:'釐清原主張。'}]};
    expect(()=>appendPaperRevision(base,draft,'teacher',wrongIssue)).toThrow('該題已確認');
    const blocked={...teacher,issues:[{indicatorId,target:'O1-S2',reason:'題間提示會代做比較。',quote:'比較兩組時間。'}]};
    draft=confirmPaperStage(appendPaperRevision(base,draft,'teacher',blocked),'teacher');
    expect(()=>assembleStagedPaper(base,draft)).toThrow('仍有已回報');
    expect(activeRevision(draft,'student')?.value.groups[0].opens[0].steps[1].guide).toBe('比較兩組時間。');
  });
});
