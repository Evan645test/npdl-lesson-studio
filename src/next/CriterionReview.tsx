import { useState, type ReactNode } from 'react';
import type { SingleCriterion } from './singlePath';
import { assembleStage, progressionLines } from '../domain/progressionAlignment';

// R31（2026-11-09 使用者決定）：證據與規準先以閱讀方式呈現，按「修改」才變成可編輯欄位；四階並排成一列方便比較。
// 有逐句對應時，四階規準由「NPDL 原文每一句 → 本課可觀察表現」組成，修改也逐句進行，由程式重組該階規準。
const FIELDS = [['label', '判讀項目'], ['observable', '可觀察行為'], ['scope', '觀察範圍'], ['unobserved', '本題組看不到的能力']] as const;
const STAGE_NAMES = ['證據有限', '萌芽', '發展', '精熟'] as const;
const CIRCLED = ['①', '②', '③', '④', '⑤'];

function originalLines(indicatorId: string) {
  try { return progressionLines(indicatorId); } catch { return null; }
}

// readOnly：正式專案的課程頁只閱讀，不提供修改（修改規準須回發想流程）。
export function CriterionReview({ name, criterion, note, onChange, readOnly = false }: {
  name: string; criterion: SingleCriterion; note?: ReactNode; onChange?: (next: SingleCriterion) => void; readOnly?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [compare, setCompare] = useState(false);
  const lines = originalLines(criterion.indicatorId);
  const aligned = !!criterion.alignment && !!lines;
  const emit = (next: SingleCriterion) => onChange?.(next);
  const set = (field: typeof FIELDS[number][0], value: string) => emit({ ...criterion, [field]: value });
  const setStage = (at: number, value: string) => emit({ ...criterion, stages: criterion.stages.map((text, i) => i === at ? value : text) as SingleCriterion['stages'] });
  const setLine = (stage: number, line: number, value: string) => {
    const alignment = criterion.alignment!.map((row, s) => s === stage ? row.map((text, l) => l === line ? value : text) : [...row]);
    emit({ ...criterion, alignment, stages: criterion.stages.map((text, s) => s === stage ? assembleStage(alignment[s]) : text) as SingleCriterion['stages'] });
  };
  return <div className="sp-edit-group sp-criterion">
    <div className="sp-criterion-head"><h3>{name}</h3>
      <div className="actions">
        {lines && <button type="button" aria-pressed={compare} onClick={() => setCompare(!compare)}>{compare ? '收起進程原文' : '對比 NPDL 進程原文'}</button>}
        {!readOnly && <button type="button" aria-expanded={editing} onClick={() => setEditing(!editing)}>{editing ? '完成修改' : '修改這組規準'}</button>}
      </div></div>
    {note}
    {editing
      ? FIELDS.map(([field, label]) => <label key={field}>{label}<textarea value={criterion[field]} onChange={event => set(field, event.target.value)} /></label>)
      : <dl className="sp-criterion-fields">{FIELDS.map(([field, label]) => <div key={field}><dt>{label}</dt><dd>{criterion[field] || '（空白）'}</dd></div>)}</dl>}
    {compare && lines && !aligned && <p className="notice">尚無逐句對應：這組規準是舊版產生的整段文字。{readOnly ? '' : '按下方「重新產生這一段」可改由原文逐句對應產生。'}</p>}
    <div className="sp-stage-grid" role="group" aria-label={name + ' 四階敘述'}>
      {criterion.stages.map((text, at) => <div className="sp-stage-cell" key={at}>
        <span className="sp-stage-name">{STAGE_NAMES[at]}</span>
        {aligned && (compare || editing)
          ? <ol className="sp-line-map">{lines![at].map((line, l) => <li key={line.id}>
              <span className="sp-stage-tag">NPDL 原文{CIRCLED[l] ?? l + 1}</span>
              <p className="sp-line-source">{line.text}</p>
              <span className="sp-stage-tag">本課可觀察表現</span>
              {editing
                ? <textarea aria-label={`${name} ${STAGE_NAMES[at]} 原文${l + 1} 的本課表現`} value={criterion.alignment![at][l]} onChange={event => setLine(at, l, event.target.value)} />
                : <p>{criterion.alignment![at][l]}</p>}
            </li>)}</ol>
          : <>
            {compare && <span className="sp-stage-tag">本課規準</span>}
            {editing && !aligned ? <textarea aria-label={name + ' ' + STAGE_NAMES[at]} value={text} onChange={event => setStage(at, event.target.value)} /> : <p>{text || '（空白）'}</p>}
            {compare && lines && <div className="sp-stage-source"><span className="sp-stage-tag">NPDL 學生版原文</span><p>{lines[at].map(line => line.text).join('\n')}</p></div>}
          </>}
      </div>)}
    </div>
  </div>;
}
