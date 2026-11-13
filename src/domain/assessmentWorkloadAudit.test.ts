import { describe, expect, it } from 'vitest';
import { createSeed } from '../data/seed';
import { sampleSet } from './thresholdSet.test-helper';
import { auditSource, choicePositionWarnings } from './assessmentAudit';
import { buildWorkloadAuditPlan, validateWorkloadAudit, workloadPair, type WorkloadPair } from './assessmentWorkloadAudit';
import type { AssessmentVersion } from './types';

function pairSample() {
  const initial = createSeed().projects[0].assessments[0];
  const a = sampleSet('critical-evaluate-information', ['c-compare'], '前測', 'B');
  const b = sampleSet('critical-evaluate-information', ['c-compare'], '後測', 'B');
  a.opens[0].steps[1].guide = '請自己從四筆紀錄找出可公平比較的兩組。';
  b.opens[0].steps[1].guide = '請比較已指定的 C、F 兩組，並解釋理由。';
  b.opens[0].steps[1].aboveExample = '教師用補充舊資料，不可送到學生卷。';
  const pre: AssessmentVersion = { ...initial, id:'pre', phase:'pre', parentPreId:null, format:'threshold-set-v1', sets:[a] };
  const post: AssessmentVersion = { ...pre, id:'post', phase:'post', parentPreId:'pre', sets:[b] };
  return { pre, post };
}
function sampleReport(pair: WorkloadPair) {
  return { checked: pair.targets.map(target => target.id), uncertain: [], differences: [{
    id:'G1-O1-S2', difference:'前測要選證；後測已指定配對。',
    pre:{ ref:'G1-O1-S2', quote:'從四筆紀錄找出可公平比較的兩組', work:'自己找可比資料' },
    post:{ ref:'G1-O1-S2', quote:'請比較已指定的 C、F 兩組', work:'比較已給的兩組' },
  }] };
}

describe('作答負擔與位置檢查', () => {
  it('只比相連的同設計、同方式紙筆題，方式 E 不進入請求', () => {
    const { pre, post } = pairSample();
    const e = sampleSet('character-grit-resilience', [], '前測', 'E');
    pre.sets!.unshift(e);
    post.sets!.push(e);
    const pair = workloadPair(pre,post)!;
    expect(pair.targets).toHaveLength(8);
    expect(pair.targets.at(-1)).toMatchObject({ preRef:'G1-O1-S3',postRef:'G1-O1-S3' });
    expect(workloadPair(pre,{...post,parentPreId:'another-pre'})).toBeNull();
    expect(workloadPair(pre,{...post,rubricVersion:'different'})).toBeNull();
    expect(workloadPair(pre,{...post,sets:[e]})).toBeNull();
  });
  it('使用雙方實際題面，不送教師資料；有落差必須能對回前後題位及原文', () => {
    const { pre, post } = pairSample();
    const original = JSON.stringify([pre,post]), pair = workloadPair(pre,post)!;
    const payload = buildWorkloadAuditPlan('不送課程名稱',pair).payload;
    expect(JSON.stringify(payload)).toContain('請比較已指定的 C、F');
    expect(JSON.stringify(payload)).not.toMatch(/教師用補充舊資料|不送課程名稱|答案鍵/);
    const report = sampleReport(pair);
    expect(validateWorkloadAudit(pair,report).differences[0]).toMatchObject({pre:{work:'自己找可比資料'},post:{work:'比較已給的兩組'}});
    expect(() => validateWorkloadAudit(pair,{...report,checked:report.checked.slice(1)})).toThrow('涵蓋題號');
    const wrong = structuredClone(report);
    wrong.differences[0].post.quote = report.differences[0].pre.quote;
    expect(validateWorkloadAudit(pair,wrong)).toMatchObject({ rejected:1,differences:[] });
    wrong.differences[0].post = { ref:'G1-Q1', quote:post.sets![0].choices[0].prompt, work:'用另外一題作答' };
    expect(validateWorkloadAudit(pair,wrong)).toMatchObject({ rejected:1,differences:[] });
    expect(JSON.stringify([pre,post])).toBe(original);
  });
  it('允許引用自己的共用材料，不允許引用另一題組的材料', () => {
    const { pre, post } = pairSample();
    post.sets![0].data = '只有甲與丙兩筆可以直接比較。';
    const next = sampleSet('critical-connect-patterns', ['c-compare'], '後測', 'B');
    next.data = '第二組另一份共用材料，和第一組無關。';
    pre.sets!.push(next);
    post.sets!.push(next);
    const pair = workloadPair(pre, post)!;
    const report = sampleReport(pair);
    report.differences[0].post = { ref:'G1-data', quote:'只有甲與丙兩筆可以直接比較', work:'依材料指定配對' };
    expect(validateWorkloadAudit(pair, report).differences[0].post.label).toContain('共用資料');
    report.differences[0].post = { ref:'G2-data', quote:'第二組另一份共用材料', work:'引用別組' };
    expect(validateWorkloadAudit(pair,report)).toMatchObject({ rejected:1,differences:[] });
  });
  it('可識別集中位置，也不把正常分散選項報成問題', () => {
    const { pre } = pairSample();
    const choices = pre.sets![0].choices;
    choices.forEach(q => q.options.forEach((o,i) => o.above = i === 0));
    expect(choicePositionWarnings(auditSource(pre)!)).toEqual([expect.stringContaining('5／5 題的答案在第 1 個選項')]);
    choices.forEach((q,n) => q.options.forEach((o,i) => o.above = i === n % 4));
    expect(choicePositionWarnings(auditSource(pre)!)).toEqual([]);
  });
});
