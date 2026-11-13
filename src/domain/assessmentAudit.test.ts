import { describe, expect, it, vi } from 'vitest';
import { createSeed } from '../data/seed';
import { sampleSet } from './thresholdSet.test-helper';
import { auditSource, buildAuditPlan, validateAuditResult, type AuditSource } from './assessmentAudit';
import { assessmentAuditRequests, runAssessmentAudit } from '../services/assessmentAudit';
import { RepairNeeded, type runRequest } from '../services/openai';

function example() {
  const project = createSeed().projects[0];
  const assessment = structuredClone(project.assessments.find(a => a.phase === 'post')!);
  const set = sampleSet('critical-evaluate-information', ['c-compare'], '後測', 'B');
  set.data = '共同資料機密測試：甲站只對預約者開放。';
  set.choices[0].prompt = '誰能在週一使用甲站？';
  set.choices[1].prompt = '甲站只對預約者開放，哪項是通知的適用範圍？';
  set.choices[0].options[0].thinking = '只有教師能看見這段話。';
  set.opens[0].steps[0].guide = '指出一項可查核的條件。';
  set.opens[0].steps[0].aboveFeatures = '除條件之外，一律須交代日期。';
  return { ...assessment, format: 'threshold-set-v1' as const, sets: [set] };
}
const checked = (s: AuditSource) => s.targets.map(t => t.ref);
const checks = (s: AuditSource) => s.targets.map(t => ({target:t.ref,observation:'核對題面證據與指定的比較條件。'}));
const responses = (s: AuditSource) => ({
  solve: { checked: checked(s), uncertain: [], answers: s.targets.map(t => ({ target: t.ref, option: t.options[0] ?? null, work:'依指定資料確認比較結果。', numericResult:null })) },
  masked: { checked: checked(s), uncertain: [], checks: checks(s), issues: [{ target: 'G1-Q1', explanation: '第 2 題直接說出對象，可不用查資料。', evidence: [
    { ref: 'G1-Q1', quote: '誰能在週一使用甲站' }, { ref: 'G1-Q2', quote: '甲站只對預約者開放' },
  ] }] },
  rubric: { checked: checked(s), uncertain: [], checks: checks(s), issues: [{ target: 'G1-O1-S1', explanation: '只要求一項條件，教師判讀另加日期。', evidence: [
    { ref: 'G1-O1-S1', quote: '指出一項可查核的條件' }, { ref: 'G1-O1-S1-criteria', quote: '一律須交代日期' },
  ] }] },
});

describe('獨立驗題邊界', () => {
  it('純 E 和舊格式不假裝有可驗紙筆題；混合卷不送自評或觀察', () => {
    const paper = example(), e = sampleSet('character-grit-resilience', [], '後測', 'E');
    expect(auditSource({ ...paper, format: undefined })).toBeNull();
    expect(auditSource({ ...paper, sets: [e] })).toBeNull();
    expect(auditSource({ ...paper, sets: [e, ...paper.sets] })).toEqual(auditSource(paper));
  });

  it('三個請求相互獨立，只在最後送判讀，遮表請求完全不含共用資料', () => {
    const source = auditSource(example())!;
    const [solve, masked, rubric] = ['solve', 'masked', 'rubric'].map(stage =>
      buildAuditPlan('course-local', source, stage as 'solve' | 'masked' | 'rubric').payload);
    expect(JSON.stringify(solve)).toContain('共同資料機密測試');
    expect(JSON.stringify(masked)).not.toContain('共同資料機密測試');
    expect(JSON.stringify(masked)).toContain('甲站只對預約者開放，哪項');
    for (const body of [solve, masked]) {
      expect(body.teacher).toBeUndefined();
      expect(JSON.stringify(body)).not.toMatch(/只有教師能看見|一律須交代日期|"above"|"threshold"|course-local/);
    }
    expect(JSON.stringify(rubric)).toContain('一律須交代日期');
    expect(JSON.stringify(rubric)).not.toMatch(/原始教案|course-local/);
  });

  it('遮掉情境內嵌的表格與情境標題，並拒絕引用未送出的段落', () => {
    const assessment = example();
    assessment.sets[0].title = '專屬標題：樣品四唯一可比';
    assessment.sets[0].context = '情境內表格\n| 樣品四 | 70 秒 |';
    const source = auditSource(assessment)!;
    const masked = buildAuditPlan('p', source, 'masked').payload;
    const solve = buildAuditPlan('p', source, 'solve').payload;
    expect(JSON.stringify(solve)).toContain('| 樣品四 | 70 秒 |');
    expect(JSON.stringify(masked)).not.toMatch(/樣品四|70 秒/);
    const body = responses(source).masked;
    body.issues[0].evidence.push({ ref: 'G1-context', quote: '樣品四 | 70 秒' });
    expect(() => validateAuditResult(source, 'masked', body)).toThrow('引文');
  });

  it('兩類問題只允許原題與對應來源的實質逐字引文', () => {
    const source = auditSource(example())!, body = responses(source);
    expect(validateAuditResult(source, 'masked', body.masked).issues[0].kind).toBe('cross-item-clue');
    expect(validateAuditResult(source, 'rubric', body.rubric).issues[0].kind).toBe('prompt-rubric-mismatch');
    const forged = structuredClone(body.masked);
    forged.issues[0].evidence[1].quote = '這一句題本沒有';
    expect(() => validateAuditResult(source, 'masked', forged)).toThrow('引文');
    forged.issues[0].evidence[1] = { ref: 'G1-Q2', quote: '甲' };
    expect(() => validateAuditResult(source, 'masked', forged)).toThrow('引文');
    forged.issues[0].evidence[1] = { ref: 'G1-data', quote: '共同資料機密測試' };
    expect(() => validateAuditResult(source, 'masked', forged)).toThrow('引文');
    forged.issues[0].evidence[1] = { ref: 'G1-O1-S1', quote: '指出一項可查核的條件' };
    expect(() => validateAuditResult(source, 'masked', forged)).toThrow('分卷');
    const mixed = structuredClone(body.masked);
    mixed.issues[0].evidence.push({ ref: 'G1-O1-S1', quote: '指出一項可查核的條件' });
    expect(() => validateAuditResult(source, 'masked', mixed)).toThrow('分卷');
    const mismatched = structuredClone(body.rubric);
    mismatched.issues[0].evidence[1] = { ref: 'G1-Q1-A-judge', quote: '只有教師能看見這段話' };
    expect(() => validateAuditResult(source, 'rubric', mismatched)).toThrow('其他題');
  });

  it('完整卷盲作若和原答案不同，只在本機標記待核對', () => {
    const source = auditSource(example())!;
    const result = validateAuditResult(source, 'solve', {
      ...responses(source).solve,
      answers: source.targets.map(t => ({ target: t.ref, work:'依指定資料確認比較結果。', numericResult:null,
        option: t.ref === 'G1-Q1' ? 'B' : source.teacher.find(b => b.ref === t.ref + '-key')?.text ?? null })),
    });
    expect(result.answerDifferences).toEqual([{ label: '第 1 組 選擇第 1 題', blind: 'B', key: 'A', blindText: '後測第1題選項B', keyText: '後測第1題選項A', work: '依指定資料確認比較結果。' }]);
    expect(result.issues).toEqual([]);
  });

  it('即使模型選了教師答案，仍會把唯一對應試算值的選項標為待核對', () => {
    const assessment = example(), item = assessment.sets[0].choices[3];
    item.options[0].text = 'D 組的快慢指標約為 B 組的 1.60 倍。';
    item.options[1].text = 'D 組的快慢指標約為 B 組的 1.52 倍。';
    const source = auditSource(assessment)!, reply = responses(source).solve;
    const i = reply.answers.findIndex(answer => answer.target === 'G1-Q4');
    const answers = reply.answers.map((answer,n) => n !== i ? {...answer,option:source.teacher.find(b => b.ref === answer.target + '-key')?.text ?? null} : {...answer, option:'D', work:'以原值取比：35 ÷ 23 約等於 1.52 倍。',numericResult:{value:'1.52',unit:'倍'}});
    expect(validateAuditResult(source,'solve',{...reply,answers}).answerDifferences).toEqual([
      expect.objectContaining({ blind:'B', key:'D', matchedByNumber:true }),
    ]);
  });

  it('不能用只查部分題、無效選項或重複題號冒充完成', () => {
    const s = auditSource(example())!, body = responses(s);
    expect(() => validateAuditResult(s, 'solve', { ...body.solve, checked: checked(s).slice(1) })).toThrow('涵蓋');
    expect(() => validateAuditResult(s, 'solve', { ...body.solve, answers: body.solve.answers.map((a,i) => i === 0 ? { ...a, option: 'Z' } : a) })).toThrow('答案');
    expect(() => validateAuditResult(s, 'masked', { ...body.masked, checked: checked(s).map(() => 'G1-Q1') })).toThrow('涵蓋');
  });

  it('未同意不送出；完成第一步後取消時不再送遮表或教師判讀', async () => {
    const s = auditSource(example())!, body = responses(s), controller = new AbortController();
    const request = vi.fn<typeof runRequest>(async (_plan,_settings,_consent,_signal,validate) => {
      validate(body.solve);
      return { value:body.solve, usage:'' };
    });
    const args = { projectId:'p', source:s, settings:{ key:'sk-test-only', model:'gpt-4.1' }, signal:controller.signal,
      onStart:vi.fn(), onResult:() => controller.abort(), request };
    await expect(runAssessmentAudit({ ...args, consent:false })).rejects.toThrow('尚未同意');
    expect(request).not.toHaveBeenCalled();
    await expect(runAssessmentAudit({ ...args, consent:true })).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('分卷遮蔽、分批查證；格式錯誤不採用，其他已同意的獨立階段仍完成', async () => {
    const a = example(), original = JSON.stringify(a), s = auditSource(a)!, body = responses(s);
    const plans = assessmentAuditRequests('p',s);
    expect(plans.filter(p=>p.stage==='masked')).toHaveLength(1);
    const masked = plans.find(p=>p.stage==='masked')!;
    expect(JSON.stringify(masked.plan.payload)).not.toMatch(/G1-O1|共同資料機密測試|teacher/);
    const request = vi.fn<typeof runRequest>(async (plan,_settings,_consent,_signal,validate) => {
      let value:unknown;
      if (plan.payload.task === 'audit-assessment-masked') throw new RepairNeeded(plan,'壞引文');
      if (plan.payload.task === 'audit-assessment-solve') value=body.solve;
      if (plan.payload.task === 'audit-assessment-rubric') value=body.rubric;
      if (String(plan.payload.task).startsWith('audit-assessment-claims-')) {
        const cases = plan.payload.cases as {target:string;options?:{option:string}[];units?:{id:string}[]}[];
        value={rows:cases.map(row=>({target:row.target,observation:'逐項比對測試資料與題目要求。',...(row.options
          ? {options:row.options.map(o=>({option:o.option,status:'no',reason:'測試題不屬此條件。',sourceIds:[]}))}
          : {units:row.units!.map(u=>({unit:u.id,status:'not-claim',reason:'測試資料沒有具體事實。',sourceIds:[]}))})}))};
      }
      validate(value);
      return {value,usage:''};
    });
    const onResult = vi.fn(), onSkip=vi.fn(), args = { projectId:'p', source:s, settings:{ key:'sk-test-only', model:'gpt-4.1' },
      consent:true, signal:new AbortController().signal, onStart:vi.fn(), onResult, onSkip, request };
    await runAssessmentAudit(args);
    expect(onSkip).toHaveBeenCalledExactlyOnceWith('masked');
    expect(onResult.mock.calls.map(([r]) => r.stage)).toEqual(plans.filter(p=>p.stage!=='masked').map(p=>p.stage));
    expect(JSON.stringify(a)).toBe(original);
  });
});
