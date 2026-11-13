import { useState } from 'react';
import { indicators } from '../components/labels';
import { stageName, type AspectPlan, type ScenarioSet } from '../domain/scenarioProgression';
import type { AssessmentVersion } from '../domain/types';
import type { ClassroomKit } from '../domain/classroomKit';
import type { NarrativeKit } from '../domain/narrativeKit';
import { NARRATIVE_COMPARISON_NOTE, NARRATIVE_UNJUDGABLE_NOTE, checklistHeading, narrativeNote } from '../domain/narrativeKit';
import { kitsMissing } from '../domain/scenarioAssessment';
import { modePickerValue } from './ModePicker';
import type { ModeChoice } from '../domain/thresholdSet';

// R33（2026-11-09 使用者決定）：情境進程題的前後測區。流程：確認面向 → 產生前測 → 教師核對確認 → 產生後測（同面向、課程情境）→ 確認。
const nameOf = (id: string) => indicators.entries.find(row => row.id === id)?.name ?? id;

// R36：每個子指標可單獨請 AI 重新產生面向（onRegenerate 未提供時不顯示，例如前測已產生）。
export function AspectEditor({ plans, confirmed, disabled, onChange, onConfirm, onRegenerate }: {
  plans: AspectPlan[]; confirmed: boolean; disabled: boolean; onChange: (plans: AspectPlan[]) => void; onConfirm: () => void; onRegenerate?: (indicatorId: string) => void;
}) {
  const edit = (p: number, a: number, field: 'label' | 'description', value: string) =>
    onChange(plans.map((plan, i) => i !== p ? plan : { ...plan, aspects: plan.aspects.map((x, j) => j === a ? { ...x, [field]: value } : x) }));
  const editAnchor = (p: number, a: number, stage: number, value: string) =>
    onChange(plans.map((plan, i) => i !== p ? plan : { ...plan, aspects: plan.aspects.map((x, j) => j !== a || !x.anchors ? x : { ...x, anchors: x.anchors.map((t, s) => s === stage ? value : t) as typeof x.anchors }) }));
  const ready = plans.every(plan => plan.aspects.every(a => a.label.trim() && a.description.trim() && (!a.anchors || a.anchors.every(t => t.trim()))));
  return <div className="sp-aspects">
    {plans.map((plan, p) => <fieldset key={plan.indicatorId} disabled={disabled}><legend>{nameOf(plan.indicatorId)}</legend>
      <ol>{plan.aspects.map((a, i) => <li key={a.id}>
        <label>面向 {i + 1} 名稱<input maxLength={30} value={a.label} onChange={event => edit(p, i, 'label', event.currentTarget.value)} /></label>
        <label>從低階到高階的差異<textarea rows={2} maxLength={300} value={a.description} onChange={event => edit(p, i, 'description', event.currentTarget.value)} /></label>
        {a.anchors && <details className="sp-aspect-anchors"><summary>判讀錨點（前測、後測共用；學生理由中的線索）</summary>
          {a.anchors.map((text, s) => <label key={s}>{stageName(s)}<textarea rows={2} maxLength={400} value={text} onChange={event => editAnchor(p, i, s, event.currentTarget.value)} /></label>)}
        </details>}
      </li>)}</ol>
      {onRegenerate && <button type="button" onClick={() => onRegenerate(plan.indicatorId)}>請 AI 重新產生這個面向</button>}
    </fieldset>)}
    <div className="actions"><button type="button" disabled={disabled || confirmed || !ready} onClick={onConfirm}>確認面向</button>
      <span role="status">{confirmed ? '面向已確認；修改後需再確認。' : ready ? '核對後按「確認面向」。' : '每個面向都要有名稱、說明，以及四階判讀錨點。'}</span></div>
  </div>;
}

export function ScenarioPaperView({ assessment }: { assessment: AssessmentVersion }) {
  const [anchors, setAnchors] = useState(false);
  return <div className="sp-scenario-paper">
    {(assessment.scenarioSets ?? []).length > 0 && <div className="actions"><button type="button" aria-pressed={anchors} onClick={() => setAnchors(!anchors)}>{anchors ? '隱藏判讀錨點' : '顯示判讀錨點'}</button></div>}
    {(assessment.scenarioSets ?? []).map((set: ScenarioSet) => {
      const plan = assessment.aspects?.find(p => p.indicatorId === set.indicatorId);
      return <section key={set.indicatorId} className="sp-scenario-set"><h3>{nameOf(set.indicatorId)}</h3>
        <ol>{set.items.map(item => <li key={item.id} className="sp-scenario-item">
          <p className="sp-scenario-aspect">面向：{plan?.aspects.find(a => a.id === item.aspectId)?.label ?? item.aspectId}</p>
          <p>{item.scenario}</p><p><strong>{item.prompt}</strong></p>
          <ol type="A">{item.options.map(o => <li key={o.label}>{o.text}<span className="sp-stage-tag-inline">{stageName(o.stage)}</span></li>)}</ol>
          <p>理由題：{item.reasonPrompt}</p>
          {anchors && <dl className="sp-scenario-anchors">{item.anchors.map((text, s) => <div key={s}><dt>{stageName(s)}</dt><dd>{text}</dd></div>)}</dl>}
        </li>)}</ol>
        {set.extension && <div className="sp-scenario-item sp-scenario-extension"><p><strong>第 {set.items.length + 1} 題（延伸題）：</strong>{set.extension.prompt}</p>
          {anchors && <dl className="sp-scenario-anchors">{set.extension.anchors.map((text, s) => <div key={s}><dt>{stageName(s)}</dt><dd>{text}</dd></div>)}</dl>}</div>}
      </section>;
    })}
  </div>;
}

// R41：課中學習單（學生）與課堂表現勾選表（教師）的檢視。
export function KitView({ kit, activityName, criterionLabel }: { kit: ClassroomKit; activityName: (id: string) => string; criterionLabel: (id: string) => string }) {
  return <section className="sp-kit"><h4>{nameOf(kit.indicatorId)}｜學習單：{kit.worksheet.title}</h4>
    <p className="note">{kit.worksheet.intro}</p>
    <ol>{kit.worksheet.questions.map((q, i) => <li key={i}><span className="sp-scenario-aspect">{activityName(q.activityId)}</span><p>{q.prompt}</p></li>)}</ol>
    <h4>課堂表現勾選表</h4>
    {kit.checklist.map(row => <div key={row.criterionId} className="sp-kit-row"><p>{checklistHeading(criterionLabel(row.criterionId), row.focus)}</p>
      <dl className="sp-scenario-anchors">{row.behaviors.map((text, s) => <div key={s}><dt>{stageName(s)}</dt><dd>{text}</dd></div>)}</dl></div>)}
  </section>;
}

function narrativeQuestionList(questions: NarrativeKit['pre'], label: string) {
  return <section className="sp-narrative-questions"><h5>{label}</h5>
    <ol>{questions.map(q => <li key={q.role} className="sp-narrative-question">
      {q.scenario && <p>情境：{q.scenario}</p>}
      <p><strong>{q.prompt}</strong></p>
      <p className="note">回想提示：{q.recall}</p>
      {narrativeNote(q) && <p className="note">{narrativeNote(q)}</p>}
      <ol>{q.steps.map((step, index) => <li key={index}><p>{step.prompt}</p><p className="note">句子開頭：{step.starter}</p></li>)}</ol>
    </li>)}</ol>
  </section>;
}

export function NarrativeKitView({ kit, criterionLabel }: { kit: NarrativeKit; criterionLabel: (id: string) => string }) {
  const [anchorsOpen, setAnchorsOpen] = useState(false);
  return <section className="sp-kit sp-narrative-kit">
    <h4>{nameOf(kit.indicatorId)}｜經驗敘述與參與紀錄</h4>
    <p className="note">{NARRATIVE_COMPARISON_NOTE}</p>
    {narrativeQuestionList(kit.pre, '前測（2 題）')}
    {narrativeQuestionList(kit.post, '後測（2 題，前測產生時一併保存）')}
    <div className="actions"><button type="button" aria-expanded={anchorsOpen} onClick={() => setAnchorsOpen(!anchorsOpen)}>{anchorsOpen ? '收合判讀錨點' : '顯示判讀錨點'}</button></div>
    {anchorsOpen && <><p className="note">{NARRATIVE_UNJUDGABLE_NOTE}</p>
      <dl className="sp-scenario-anchors">{kit.anchors.map((text, s) => <div key={s}><dt>{stageName(s)}</dt><dd>{text}</dd></div>)}</dl></>}
    <h4>課堂表現勾選表</h4>
    {kit.checklist.map(row => <div key={row.criterionId} className="sp-kit-row"><p>{checklistHeading(criterionLabel(row.criterionId), row.focus)}</p>
      <dl className="sp-scenario-anchors">{row.behaviors.map((text, s) => <div key={s}><dt>{stageName(s)}</dt><dd>{text}</dd></div>)}</dl></div>)}
  </section>;
}

export function classroomKitButtonLabel(modes: ModeChoice[]): string {
  const kinds = new Set(modes.filter(row => row.mode === 'E').map(row => modePickerValue(row)));
  if (kinds.has('worksheet') && kinds.has('narrative')) return '請 AI 產生課中評量材料';
  if (kinds.has('narrative')) return '請 AI 產生經驗敘述題與勾選表';
  return '請 AI 產生學習單與勾選表';
}

export function ScenarioPanel({ hasScenario, aspectPlans, aspectsConfirmed, aspectsFromPre, pre, post, blocked, modes, onDraftAspects, onRegenerateAspect, onAspectsChange, onConfirmAspects, onGenerate, onReviewPre, onConfirmPair, onGenerateKits, activityName, criterionLabel }: {
  hasScenario: boolean; aspectPlans: AspectPlan[] | null; aspectsConfirmed: boolean; aspectsFromPre: boolean;
  pre?: AssessmentVersion; post?: AssessmentVersion; blocked: boolean; modes: ModeChoice[];
  onDraftAspects: () => void; onRegenerateAspect: (indicatorId: string) => void; onAspectsChange: (plans: AspectPlan[]) => void; onConfirmAspects: () => void;
  onGenerate: (phase: 'pre' | 'post') => void; onReviewPre: () => void; onConfirmPair: () => void;
  onGenerateKits: () => void; activityName: (id: string) => string; criterionLabel: (id: string) => string;
}) {
  const scenarioPre = pre?.format === 'scenario-progression-v1' ? pre : undefined;
  const scenarioPost = post?.format === 'scenario-progression-v1' && post.parentPreId === scenarioPre?.id ? post : undefined;
  return <section className="card sp-scenario-panel" aria-labelledby="scenario-title">
    <h2 id="scenario-title">情境進程前後測</h2>
    <p>不看對錯：學生在情境中選出自己會怎麼做並寫下理由，教師依判讀錨點看他在四階進程的位置。每個子指標 3 題選擇（各對應一個面向、附理由）＋1 題延伸題；課中評量子指標改用學習單、經驗敘述題與勾選表。先出前測、確認後再出後測。</p>
    {hasScenario && <section className="sp-step"><h3>1. 確認面向</h3>
      <p className="note">AI 依本課規準與子指標四階原文為每個子指標整理 3 個面向；你可修改，或請 AI 重新產生。前測產生後，後測沿用同一組面向。</p>
      {!aspectPlans && <button type="button" className="primary" disabled={blocked} onClick={onDraftAspects}>請 AI 整理面向</button>}
      {aspectPlans && <><AspectEditor plans={aspectPlans} confirmed={aspectsConfirmed} disabled={blocked || aspectsFromPre} onChange={onAspectsChange} onConfirm={onConfirmAspects} onRegenerate={aspectsFromPre ? undefined : onRegenerateAspect} />
        {aspectsFromPre ? <p className="note">目前沿用已保存前測的面向（已鎖定；後測會用同一組）。要換面向：<button type="button" disabled={blocked} onClick={onDraftAspects}>請 AI 重新整理面向（之後要重新產生前測）</button></p> : aspectPlans.length > 1 && <button type="button" disabled={blocked} onClick={onDraftAspects}>請 AI 全部重新整理</button>}</>}
    </section>}
    <section className="sp-step"><h3>2. 前測</h3>
      <button type="button" className="primary" disabled={blocked || hasScenario && !aspectsConfirmed} onClick={() => onGenerate('pre')}>{!hasScenario ? (scenarioPre ? '重新組成前測' : '由規準組成前測（不需 AI）') : scenarioPre ? '重新產生前測' : '產生前測'}</button>
      {hasScenario && !aspectsConfirmed && <p className="note">請先確認面向。</p>}
      {scenarioPre && <><ScenarioPaperView assessment={scenarioPre} />
        {(scenarioPre.sets ?? []).length > 0 && <section className="sp-step sp-kits"><h3>課中證據材料</h3>
          <p className="note">課中評量子指標前後測共用材料；經驗敘述含前後題、判讀錨點與參與勾選表。</p>
          {(scenarioPre.classroomKits ?? []).map(kit => <KitView key={kit.indicatorId} kit={kit} activityName={activityName} criterionLabel={criterionLabel} />)}
          {(scenarioPre.narrativeKits ?? []).map(kit => <NarrativeKitView key={kit.indicatorId} kit={kit} criterionLabel={criterionLabel} />)}
          {!scenarioPre.reviewedAt && (scenarioPre.sets ?? []).length > 0 && <div className="actions"><button type="button" className="primary" disabled={blocked} onClick={onGenerateKits}>{classroomKitButtonLabel(modes)}</button></div>}
          {scenarioPre.reviewedAt && !(scenarioPre.classroomKits ?? []).length && !(scenarioPre.narrativeKits ?? []).length && <p className="note">這份前測確認於課中證據材料功能之前；要產生請重新產生前測。</p>}
        </section>}
        <div className="actions">{scenarioPre.reviewedAt ? <span>前測已確認。</span> : <button type="button" disabled={blocked || kitsMissing(scenarioPre)} onClick={onReviewPre}>我已核對，確認前測</button>}{!scenarioPre.reviewedAt && kitsMissing(scenarioPre) && <span className="note">請先產生課中評量材料（學習單或經驗敘述題與勾選表）。</span>}</div></>}
    </section>
    {scenarioPre && <section className="sp-step"><h3>3. 後測</h3>
      <p className="note">沿用前測的面向，改用本課程情境；不送前測原文。</p>
      <button type="button" className="primary" disabled={blocked || !scenarioPre.reviewedAt} onClick={() => onGenerate('post')}>{!(scenarioPre.scenarioSets ?? []).length ? (scenarioPost ? '重新組成後測' : '由規準組成後測（不需 AI）') : scenarioPost ? '重新產生後測' : '產生後測'}</button>
      {!scenarioPre.reviewedAt && <p className="note">請先確認前測。</p>}
      {scenarioPost && <><ScenarioPaperView assessment={scenarioPost} />
        <div className="actions">{scenarioPost.reviewedAt ? <span>前後測已確認，可到「下載成果」。</span> : <button type="button" disabled={blocked} onClick={onConfirmPair}>確認前後測，前往下載</button>}</div></>}
    </section>}
  </section>;
}
