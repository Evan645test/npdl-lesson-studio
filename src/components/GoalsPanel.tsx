import { useEffect, useState } from 'react';
import { STAGES, type DesignVersion } from '../domain/types';
import { curriculumById } from './labels';
import { FieldAiAssist } from '../next/FieldAiAssist';

function successLabel(kind: 'academic' | 'npdl', goals: DesignVersion['goals']): string {
  const base = kind === 'academic' ? '學科成功表現' : 'NPDL成功表現';
  return goals.filter(goal => goal.kind === kind).length > 1 ? `${base}（同類型有多項）` : base;
}

export function GoalsPanel({ design, onSave, onError, onShowActivities }: {
  design: DesignVersion; onSave: (goals: DesignVersion['goals']) => boolean; onError: (message: string) => void; onShowActivities: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(design.goals);
  useEffect(() => { setEditing(false); }, [design.id]);
  function open() { setDraft(design.goals.map(goal => ({ ...goal }))); setEditing(true); }
  function save() {
    if (draft.some(goal => !goal.text.trim() || !goal.success.trim())) { onError('目標與成功表現不可空白。'); return; }
    if (onSave(draft.map(goal => ({ ...goal, text: goal.text.trim(), success: goal.success.trim() })))) setEditing(false);
  }
  return <>
    <div className="section-heading"><div><div className="eyebrow">先於活動</div><h1>先約定成功表現</h1></div><span className="tag">{design.confirmedAt ? '資料標記教師已確認' : '設計草稿・未確認'}</span></div>
    <p>{design.summary}</p>
    <p className="notice">這裡改的是目前設計版本的目標與成功表現。儲存會另存新草稿，不套用尚未核對的輸入草稿，也不改寫前後測。活動排在規準和藍圖之後。</p>
    {design.goals.map(goal => <section className="card" key={goal.id}><div className="eyebrow">{goal.kind === 'academic' ? '學科目標' : 'NPDL目標'}</div><h2>{goal.text}</h2><p><strong>成功表現：</strong>{goal.success}</p><p className="note">{goal.curriculumIds.map(id => curriculumById(id)?.code).filter(Boolean).join('・') || '此目標沒有附課綱代碼'}</p></section>)}
    {editing ? <section className="card"><h2>修改目標與成功表現</h2>{draft.map((goal, index) => <fieldset key={goal.id}><legend>{goal.kind === 'academic' ? '學科目標' : 'NPDL目標'}</legend><FieldAiAssist label={`${goal.kind === 'academic' ? '學科' : 'NPDL'}目標敘述`} value={goal.text} maxLength={2000} context={{ subject: design.inputSnapshot.subject, grade: design.inputSnapshot.grade, topic: design.inputSnapshot.topic, curriculumIds: goal.curriculumIds, indicatorIds: design.inputSnapshot.indicatorIds }} onApply={text => setDraft(draft.map((item, itemIndex) => itemIndex === index ? { ...item, text } : item))}><textarea aria-label={goal.kind === 'academic' ? '學科目標敘述' : 'NPDL目標敘述'} maxLength={2000} value={goal.text} onChange={event => setDraft(draft.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item))} /></FieldAiAssist><FieldAiAssist label={successLabel(goal.kind, design.goals)} value={goal.success} maxLength={2000} context={{ subject: design.inputSnapshot.subject, grade: design.inputSnapshot.grade, goal: goal.text, curriculumIds: goal.curriculumIds, indicatorIds: design.inputSnapshot.indicatorIds }} onApply={text => setDraft(draft.map((item, itemIndex) => itemIndex === index ? { ...item, success: text } : item))}><textarea aria-label={successLabel(goal.kind, design.goals)} maxLength={2000} value={goal.success} onChange={event => setDraft(draft.map((item, itemIndex) => itemIndex === index ? { ...item, success: event.target.value } : item))} /></FieldAiAssist></fieldset>)}<div className="actions"><button type="button" className="primary" onClick={save}>另存目標草稿</button><button type="button" onClick={() => setEditing(false)}>取消修改目標</button></div></section> : <button type="button" onClick={open}>修改目標與成功表現</button>}
    <p className="notice">工具四階：證據有限／萌芽／發展／精熟。沒有作答或不足以判讀，是「尚無法判讀」，不是最低階，也不是第五階。</p>
    {design.criteria.map(criterion => <section className="card" key={criterion.id}><h2>{criterion.label}</h2><p>{criterion.observable}</p><div className="stages">{criterion.stages.map((stage, index) => <div key={stage}><strong>{STAGES[index]}</strong><p>{stage}</p></div>)}</div><p className="note">適用範圍：{criterion.scope}<br/>未觀察：{criterion.unobserved}</p></section>)}
    <section className="card"><h2>跨題整合規則</h2>{design.integration.map(rule => <div key={rule.indicatorId}><span className="tag">{rule.status === 'confirmed' ? '資料標記教師已確認' : rule.status === 'missing' ? '尚缺整合規則' : '待教師確認'}</span><p>{rule.rule}</p></div>)}<p className="note">未確認規則前只能分項列證據；不由答對題數、選項序號、平均或加總換階。</p></section>
    <section className="card"><h2>前後測藍圖</h2>{design.blueprint.map((pair, index) => <div className="reference" key={pair.preId}><strong>前測第{index + 1}題 → 後測能力第{index + 1}題</strong><p>{design.criteria.find(criterion => criterion.id === pair.criterionIds[0])?.label}・{pair.status}</p><small>{pair.reason}</small></div>)}<p className="note">規準來源：{design.rubricSource}</p><p className="note">藍圖先於活動。改活動或另存目標草稿，都不會改掉已存在的前後題組；題組仍引用它們建立時的設計。</p></section>
    <button type="button" className="primary" onClick={onShowActivities}>接著核對活動支援</button>
  </>;
}
