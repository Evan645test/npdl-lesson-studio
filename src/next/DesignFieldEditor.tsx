import { useEffect, useMemo, useState } from 'react';
import type { DesignVersion, Workspace } from '../domain/types';
import { reviseDesignContent } from '../domain/revisions';
import { FieldAiAssist } from './FieldAiAssist';

interface Field { id: string; label: string; value: string; set: (design: DesignVersion, value: string) => void }
function fieldsOf(design: DesignVersion): Field[] {
  const rows: Field[] = [];
  const add = (id: string, label: string, value: string, set: Field['set']) => rows.push({ id, label, value, set });
  add('summary', '設計摘要', design.summary, (d, value) => { d.summary = value; });
  add('rubricSource', '規準來源與限制', design.rubricSource, (d, value) => { d.rubricSource = value; });
  design.goals.forEach((row, index) => {
    add(`goal-${index}-text`, `目標 ${index + 1} 敘述`, row.text, (d, value) => { d.goals[index].text = value; });
    add(`goal-${index}-success`, `目標 ${index + 1} 成功表現`, row.success, (d, value) => { d.goals[index].success = value; });
  });
  design.criteria.forEach((row, index) => {
    for (const key of ['label', 'observable', 'scope', 'unobserved'] as const) add(`criterion-${index}-${key}`, `規準 ${index + 1}・${{ label: '名稱', observable: '可觀察表現', scope: '適用範圍', unobserved: '未觀察事項' }[key]}`, row[key], (d, value) => { d.criteria[index][key] = value; });
    row.stages.forEach((stage, at) => add(`criterion-${index}-stage-${at}`, `規準 ${index + 1}・第 ${at + 1} 階`, stage, (d, value) => { d.criteria[index].stages[at] = value; }));
  });
  design.activities.forEach((row, index) => {
    for (const key of ['name', 'task', 'knowledgeUse', 'evidence', 'formative'] as const) add(`activity-${index}-${key}`, `活動 ${index + 1}・${{ name: '名稱', task: '任務', knowledgeUse: '學科知識運用', evidence: '預期證據', formative: '形成性觀察' }[key]}`, row[key], (d, value) => { d.activities[index][key] = value; });
    row.scaffolds.forEach((scaffold, at) => {
      add(`activity-${index}-support-${at}`, `活動 ${index + 1}・${scaffold.stage}支援`, scaffold.support, (d, value) => { d.activities[index].scaffolds[at].support = value; });
      add(`activity-${index}-fading-${at}`, `活動 ${index + 1}・${scaffold.stage}撤去條件`, scaffold.fading, (d, value) => { d.activities[index].scaffolds[at].fading = value; });
    });
  });
  design.elements.forEach((row, index) => {
    add(`element-${index}-practice`, `${row.name}・設計作法`, row.practice, (d, value) => { d.elements[index].practice = value; });
    add(`element-${index}-limitation`, `${row.name}・限制`, row.limitation, (d, value) => { d.elements[index].limitation = value; });
  });
  design.integration.forEach((row, index) => add(`integration-${index}`, `子指標 ${index + 1}・跨題整合`, row.rule, (d, value) => { d.integration[index].rule = value; d.integration[index].status = value ? 'draft' : 'missing'; }));
  design.blueprint.forEach((row, index) => add(`blueprint-${index}-reason`, `配對 ${index + 1}・比較理由`, row.reason, (d, value) => { d.blueprint[index].reason = value; }));
  return rows;
}
export function DesignFieldEditor({ workspace, projectId, design, onCommit, onMessage, locked }: { workspace: Workspace; projectId: string; design: DesignVersion; onCommit: (next: Workspace, message: string) => boolean; onMessage: (message: string) => void; locked: boolean }) {
  const fields = useMemo(() => fieldsOf(design), [design]);
  const [selected, setSelected] = useState(fields[0]?.id ?? '');
  const field = fields.find(row => row.id === selected) ?? fields[0];
  const [draft, setDraft] = useState(field?.value ?? '');
  useEffect(() => { setSelected(fields[0]?.id ?? ''); setDraft(fields[0]?.value ?? ''); }, [design.id]);
  if (!field) return null;
  function save() {
    if (!draft.trim()) { onMessage('欄位內容不可空白。'); return; }
    try {
      const next = reviseDesignContent(workspace, projectId, current => { field.set(current, draft.trim()); }, field.id === 'summary' ? draft.trim() : `教師修訂「${field.label}」；設計及題組須重新核對。`);
      onCommit(next, `已另存「${field.label}」設計新版，原題組保留。`);
    } catch (error) { onMessage(error instanceof Error ? error.message : '欄位未修改。'); }
  }
  return <section className="card design-field-editor"><div className="eyebrow">選定欄位・另存版本</div><h2>細修課程與規準</h2><p>選擇單一欄位後可手動修改，或請 AI 提出可比較的新建議。採用時另存設計新版；原設計與題組保留。</p><label>要修訂的欄位<select aria-label="要修訂的設計欄位" value={field.id} onChange={event => { const next = fields.find(row => row.id === event.target.value)!; setSelected(next.id); setDraft(next.value); }}>{fields.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label><FieldAiAssist courseId={projectId} key={`${design.id}-${field.id}`} label={field.label} value={draft} context={{ subject: design.inputSnapshot.subject, grade: design.inputSnapshot.grade, topic: design.inputSnapshot.topic, goals: design.goals.map(row => row.text), criterionIds: design.criteria.map(row => row.id) }} onApply={setDraft}><textarea aria-label={`修改${field.label}`} rows={5} maxLength={20000} value={draft} onChange={event => setDraft(event.target.value)} /></FieldAiAssist><div className="actions"><button type="button" className="primary" disabled={locked || !draft.trim() || draft === field.value} onClick={save}>另存設計新版</button><button type="button" onClick={() => setDraft(field.value)}>還原這個欄位</button></div></section>;
}
