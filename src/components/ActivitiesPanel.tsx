import { useEffect, useState } from 'react';
import type { Activity, DesignVersion, Project } from '../domain/types';
import { FieldAiAssist } from '../next/FieldAiAssist';

type ScaffoldDraft = Activity['scaffolds'];

export function ActivitiesPanel({ project, design, onSelectDesign, onSaveTask, onSaveScaffolds }: {
  project: Project; design: DesignVersion; onSelectDesign: (id: string) => void; onSaveTask: (activityId: string, task: string) => void; onSaveScaffolds: (activityId: string, scaffolds: ScaffoldDraft) => void;
}) {
  const [taskEdit, setTaskEdit] = useState<{ id: string; task: string } | null>(null);
  const [scaffoldEdit, setScaffoldEdit] = useState<{ id: string; scaffolds: ScaffoldDraft } | null>(null);
  useEffect(() => { setTaskEdit(null); setScaffoldEdit(null); }, [design.id]);
  return <>
    <div className="section-heading"><div><div className="eyebrow">目標與證據已列出，再核對活動</div><h1>{design.inputSnapshot.periods} 節課，逐步撤去支援</h1></div></div>
    <label>設計版本<select aria-label="設計版本" value={design.id} onChange={event => { onSelectDesign(event.target.value); setTaskEdit(null); setScaffoldEdit(null); }}>{project.designs.map((item, index) => <option value={item.id} key={item.id}>第{index + 1}版・{item.origin === 'manual-example' ? '人工範例' : '教師修訂'}・{item.confirmedAt ? '資料標記已確認' : '待核對'}</option>)}</select></label>
    <p className="note">修改活動或鷹架會另存新的設計草稿。舊版、前後測與原文保留。課程規劃不是已實施的事實，鷹架也不是學生的能力階段。</p>
    {design.activities.map((activity, index) => <section className="card" key={activity.id}><div className="eyebrow">第{index + 1}節・{activity.periods}節</div><h2>{activity.name}</h2>
      {taskEdit?.id === activity.id ? <><FieldAiAssist label="活動任務" value={taskEdit.task} context={{ subject: design.inputSnapshot.subject, topic: design.inputSnapshot.topic, activity: activity.name, goals: design.goals.map(goal => goal.text) }} onApply={text => setTaskEdit({ id: activity.id, task: text })}><textarea aria-label="活動任務" rows={7} value={taskEdit.task} maxLength={20000} onChange={event => setTaskEdit({ id: activity.id, task: event.target.value })} /></FieldAiAssist><div className="actions"><button type="button" className="primary" onClick={() => onSaveTask(activity.id, taskEdit.task)}>另存設計新版</button><button type="button" onClick={() => setTaskEdit(null)}>取消編輯</button></div></> : <><p>{activity.task}</p><button type="button" onClick={() => { setTaskEdit({ id: activity.id, task: activity.task }); setScaffoldEdit(null); }}>編輯活動 {index + 1}</button></>}
      <div className="data"><strong>學科知識如何用得上</strong><p>{activity.knowledgeUse}</p></div>
      <p><strong>產出的證據：</strong>{activity.evidence}</p>
      <p className="note">目標：{activity.goalIds.map(id => design.goals.find(goal => goal.id === id)?.kind === 'academic' ? '學科目標' : '評估資訊論點').join('・')}<br/>判讀特徵：{activity.criterionIds.map(id => design.criteria.find(criterion => criterion.id === id)?.label).join('・')}</p>
      <h3>四階支援與撤去條件</h3>
      <p className="note">依任務提供可選支援。用了哪一階的提示，不能据此推論學生的測驗階段。撤去條件是教師收提示的依據，不是自動判級。</p>
      {scaffoldEdit?.id === activity.id ? <div className="stages">{scaffoldEdit.scaffolds.map((scaffold, scaffoldIndex) => <div key={scaffold.stage}><strong>{scaffold.stage}</strong><FieldAiAssist label="可提供的支援" value={scaffold.support} maxLength={2000} context={{ subject: design.inputSnapshot.subject, topic: design.inputSnapshot.topic, activity: activity.name, task: activity.task, stage: scaffold.stage }} onApply={text => setScaffoldEdit({ id: activity.id, scaffolds: scaffoldEdit.scaffolds.map((item, itemIndex) => itemIndex === scaffoldIndex ? { ...item, support: text } : item) })}><textarea aria-label={`第${index + 1}節${scaffold.stage}支援`} maxLength={2000} value={scaffold.support} onChange={event => setScaffoldEdit({ id: activity.id, scaffolds: scaffoldEdit.scaffolds.map((item, itemIndex) => itemIndex === scaffoldIndex ? { ...item, support: event.target.value } : item) })} /></FieldAiAssist><FieldAiAssist label="撤去條件" value={scaffold.fading} maxLength={2000} context={{ subject: design.inputSnapshot.subject, topic: design.inputSnapshot.topic, activity: activity.name, task: activity.task, stage: scaffold.stage, support: scaffold.support }} onApply={text => setScaffoldEdit({ id: activity.id, scaffolds: scaffoldEdit.scaffolds.map((item, itemIndex) => itemIndex === scaffoldIndex ? { ...item, fading: text } : item) })}><textarea aria-label={`第${index + 1}節${scaffold.stage}撤去條件`} maxLength={2000} value={scaffold.fading} onChange={event => setScaffoldEdit({ id: activity.id, scaffolds: scaffoldEdit.scaffolds.map((item, itemIndex) => itemIndex === scaffoldIndex ? { ...item, fading: event.target.value } : item) })} /></FieldAiAssist></div>)}</div> : <div className="stages">{activity.scaffolds.map(scaffold => <div key={scaffold.stage}><strong>{scaffold.stage}時可提供</strong><p>{scaffold.support}</p><p>{scaffold.fading}</p></div>)}</div>}
      <div className="actions">{scaffoldEdit?.id === activity.id ? <><button type="button" className="primary" onClick={() => onSaveScaffolds(activity.id, scaffoldEdit.scaffolds)}>另存第{index + 1}節鷹架草稿</button><button type="button" onClick={() => setScaffoldEdit(null)}>取消鷹架編輯</button></> : <button type="button" onClick={() => { setScaffoldEdit({ id: activity.id, scaffolds: activity.scaffolds.map(item => ({ ...item })) }); setTaskEdit(null); }}>編輯第{index + 1}節鷹架</button>}</div>
      <details><summary>形成性觀察（只供教學回饋）</summary><p>{activity.formative}</p></details>
    </section>)}
    <section className="card"><h2>四個設計要素與目前限制</h2>{design.elements.map(element => <div className="reference" key={element.name}><strong>{element.name}</strong><p>{element.practice}</p><small>{element.limitation}</small></div>)}</section>
  </>;
}
