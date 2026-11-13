// 門檻題組的教師核對畫面：每個子指標一列，前測題組與後測題組並排。
import type { AssessmentVersion, DesignVersion, ItemSet } from '../domain/types';
import { MODE_PLAN, STAGES } from '../domain/types';
import { estimateAssessmentDuration, estimateSetMinutes, setWarnings } from '../domain/thresholdSet';
import { describePaperAssessment } from '../domain/paperAssessmentSummary';
import { indicators } from '../components/labels';
import { COGNITIVE_NOTE, OBSERVATION_NOTE, SET_READING_NOTE } from '../documents/setJudgment';
import { isCognitiveOnly } from '../data/assessability';
import { AssessmentData } from './AssessmentData';
import { ItemBlueprintReview } from './ItemBlueprintEditor';

const nameOf = (id: string) => indicators.entries.find(row => row.id === id)?.name ?? id;

function ObservationCard({ set, design }: { set: ItemSet; design?: DesignVersion }) {
  const o = set.observation!;
  return <>
    <p className="note">{OBSERVATION_NOTE}</p>
    <p><strong>觀察活動：</strong>{o.activityIds.map(id => design?.activities.find(a => a.id === id)?.name ?? id).join('、')}</p>
    <p><strong>觀察焦點：</strong>{o.focus}</p>
    <ul>{o.behaviors.map((text, i) => <li key={STAGES[i]}><span className="tag">{STAGES[i]}</span> {text}</li>)}<li><span className="tag">尚無法判讀</span> 沒有觀察到足以判斷的行為</li></ul>
    <p className="note">學生題本附這個子指標的自評：四段學生版進程描述、「目前沒有足夠證據」與三個反思問題。</p>
  </>;
}

export function SetCard({ set, label, design }: { set: ItemSet; label: string; design?: DesignVersion }) {
  return <article className="sp-question sp-set">
    <span className="sp-question-label">{label}・方式 {set.mode}{set.mode !== set.suggestedMode ? `（原建議 ${set.suggestedMode}）` : ''}{set.mode === 'E' ? '' : `・約 ${Math.round(estimateSetMinutes(set))} 分鐘`}</span>
    <h4>{set.title}</h4>
    {isCognitiveOnly(set) && <p className="notice">{COGNITIVE_NOTE}</p>}
    {set.mode === 'E' ? <ObservationCard set={set} design={design} /> : <>
      <p>{set.context}</p><AssessmentData text={set.data} label={`${label}情境資料`} />
      <ol>{set.choices.map(choice => <li key={choice.id}>
        <span className="tag">{choice.threshold}</span> <strong>{choice.prompt}</strong>
        <ul>{choice.options.map(option => <li key={option.id}>{option.id}. {option.text}{option.above ? '　✓ 門檻以上' : ''}<br /><span className="note">{option.thinking}</span></li>)}</ul>
      </li>)}</ol>
      {set.opens.map((open, k) => <div key={k}>
        <h5>非選題 {k + 1}：{open.prompt}</h5>
        <ol>{open.steps.map(step => <li key={step.threshold}>
          <span className="tag">{step.threshold}</span> {step.guide}<br /><span className="note">句型開頭：{step.sentenceStarter}</span>
          <details><summary>判讀特徵與參考回答</summary><p>門檻以上的特徵：{step.aboveFeatures}</p><p>門檻以上參考：{step.aboveExample}</p><p>門檻以下參考：{step.belowExample}</p></details>
        </li>)}</ol>
      </div>)}
    </>}
  </article>;
}

export function SetPairView({ pre, post, design }: { pre: AssessmentVersion; post: AssessmentVersion; design?: DesignVersion }) {
  const warnings = [...setWarnings(pre), ...setWarnings(post, pre)];
  const preTime = estimateAssessmentDuration(pre), postTime = estimateAssessmentDuration(post);
  const hasPaper = preTime.paperMinutes !== null || postTime.paperMinutes !== null;
  const hasSelfAssessment = preTime.selfAssessmentMinutes !== null || postTime.selfAssessmentMinutes !== null;
  const estimates = ([['前測', preTime], ['後測', postTime]] as const).flatMap(([phase, time]) => [
    ...(time.paperMinutes !== null ? [`${phase}紙筆題估計約 ${Math.round(time.paperMinutes)} 分鐘`] : []),
    ...(time.selfAssessmentMinutes !== null ? [`${phase}學生自評估計約 ${Math.round(time.selfAssessmentMinutes)} 分鐘`] : []),
  ]);
  return <section className="card">
    <h2>{hasPaper ? '同頁對照前後測門檻題組' : '同頁對照前後測課中評量與自評'}</h2>
    <p>每個子指標一組，目前題組採用的方式：{[...new Set((pre.sets ?? []).map(s => MODE_PLAN[s.mode].label))].join('；')}。</p>
    {hasPaper && design && pre.assessmentBlueprint && <p className="note">{describePaperAssessment(design, pre.assessmentBlueprint)}</p>}
    {pre.assessmentBlueprint?.itemBlueprint && <ItemBlueprintReview blueprint={pre.assessmentBlueprint.itemBlueprint} />}
    {estimates.length > 0 && <p>{estimates.join('；')}（估計值，需以實際安排校準）。</p>}
    {hasSelfAssessment && <p className="note">課中觀察時間依活動安排；學生自評只供核對。</p>}
    {hasPaper && <p className="note">{hasSelfAssessment ? '紙筆題：' : ''}{SET_READING_NOTE}</p>}
    {warnings.length > 0 && <div className="notice" role="status"><strong>提醒（不影響保存）</strong><ul>{warnings.map(text => <li key={text}>{text}</li>)}</ul></div>}
    {(pre.sets ?? []).map(set => {
      const after = post.sets?.find(row => row.indicatorId === set.indicatorId);
      return <div className="sp-pair" key={set.id}><h3>{nameOf(set.indicatorId)}</h3><div><SetCard set={set} label="前測" design={design} />{after && <SetCard set={after} label="後測" design={design} />}</div></div>;
    })}
  </section>;
}
