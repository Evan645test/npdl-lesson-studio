import { useState } from 'react';
import type { AssessmentVersion, DesignVersion } from '../domain/types';
import { slotLabel, SUPPORT_LABEL } from '../domain/itemBlueprint';
import { setWarnings } from '../domain/thresholdSet';
import { indicators } from '../components/labels';
import { SetCard } from './SetPairView';

export function SeparatePreReview({ pre, design, blocked, onReview, onPost, onDownload }: {
  pre: AssessmentVersion; design?: DesignVersion; blocked: boolean; onReview: () => void; onPost: () => void; onDownload: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const slots = pre.assessmentBlueprint?.itemBlueprint?.slots ?? [];
  const warnings = setWarnings(pre);
  const hasObservation = pre.sets?.some(set => set.mode === 'E');
  return <section className="card" aria-label="前測核對與後測">
    <h2>先核對這份前測</h2>
    <p>前測已獨立保存。後測不會自動產生，將沿用這份前測的藍圖。</p>
    {warnings.length > 0 && <div className="notice"><strong>核對提醒</strong><ul>{warnings.map(text => <li key={text}>{text}</li>)}</ul></div>}
    {slots.length > 0 && <details open={!pre.reviewedAt}><summary>逐題核對要點（{slots.length} 個題位）</summary>
      <ol>{slots.map(slot => <li key={`${slot.indicatorId}-${slot.kind}-${slot.question}-${slot.step}`}>
        <strong>{indicators.entries.find(row => row.id === slot.indicatorId)?.name ?? slot.indicatorId}・{slotLabel(slot)}</strong>
        <p>{slot.judgment}；必要證據：{slot.evidence}。</p>
        <p>前測應查 {slot.pre.evidenceUnits} 個證據單位、做 {slot.pre.operations} 步推理、{SUPPORT_LABEL[slot.pre.support]}。</p>
      </li>)}</ol>
    </details>}
    {pre.sets?.map(set => <SetCard key={set.id} set={set} label="前測" design={design} />)}
    {pre.reviewedAt ? <p className="note">前測已核對。{slots.length ? '後測會附上課堂錨點、同版藍圖和前測負擔摘要，不帶前測原文、選項或答案。' : '後測仍採課中觀察與自評，只會帶上相關活動和觀察規準。'}</p> : <>
      <p>請依學生題面實際試答，核對取證量、操作、提示與教師判讀。若有偏差，從「調整出題設定或重出前測」另存新版。</p>
      <label className="consent-check"><input type="checkbox" checked={checked} disabled={blocked} onChange={event => setChecked(event.currentTarget.checked)} />
        {slots.length ? '我已逐題試答，確認實際作答負擔符合藍圖，並核對教師判讀。' + (hasObservation ? '課中觀察表也已核對。' : '') : '我已核對觀察重點和記錄方式。'}
      </label>
    </>}
    <div className="actions">
      {!pre.reviewedAt && <button type="button" className="primary" disabled={!checked || blocked} onClick={onReview}>確認前測與作答負擔</button>}
      {pre.reviewedAt && <button type="button" onClick={onDownload}>前往前測下載</button>}
      <button type="button" className={pre.reviewedAt ? 'primary' : undefined} disabled={!pre.reviewedAt || blocked} onClick={onPost}>產生後測</button>
    </div>
  </section>;
}
