import { useId, useRef, useState } from 'react';
import { indicators } from '../components/labels';
import { BLUEPRINT_LIMITS, slotLabel, SUPPORT_LABEL, validateItemBlueprint, workloadDiffers } from '../domain/itemBlueprint';
import { BLUEPRINT_SUPPORT, type BlueprintPosition, type ItemBlueprint, type ItemBlueprintSlot, type ItemWorkload } from '../domain/types';
import type { ModeChoice } from '../domain/thresholdSet';
import type { AssessmentStrategy } from '../domain/assessmentStrategy';

const indicatorName = (id: string) => indicators.entries.find(row => row.id === id)?.name ?? id;
const loadLabel = (load: ItemWorkload) => `${load.evidenceUnits} 個證據單位／${load.operations} 步／${SUPPORT_LABEL[load.support]}`;

function WorkloadFields({ phase, kind, value, onChange }: { phase: string; kind: ItemBlueprintSlot['kind']; value: ItemWorkload; onChange: (value: ItemWorkload) => void }) {
  return <fieldset className="sp-blueprint-work"><legend>{phase}</legend>
    <label>證據單位<input type="number" min={1} max={BLUEPRINT_LIMITS.evidenceUnits} step={1} value={Number.isNaN(value.evidenceUnits) ? '' : value.evidenceUnits} onChange={event => onChange({ ...value, evidenceUnits: event.currentTarget.valueAsNumber })} /></label>
    <label>推理步數<input type="number" min={1} max={BLUEPRINT_LIMITS.operations} step={1} value={Number.isNaN(value.operations) ? '' : value.operations} onChange={event => onChange({ ...value, operations: event.currentTarget.valueAsNumber })} /></label>
    <label>提示程度<select value={value.support} onChange={event => {
      const support = BLUEPRINT_SUPPORT.find(option => option === event.currentTarget.value);
      if (support) onChange({ ...value, support });
    }}>{BLUEPRINT_SUPPORT.filter(option => kind === 'open' || option !== 'starter').map(option => <option key={option} value={option}>{SUPPORT_LABEL[option]}</option>)}</select></label>
  </fieldset>;
}

const shortLoad = (load: ItemWorkload) => `${load.evidenceUnits} 筆・${load.operations} 步・${SUPPORT_LABEL[load.support].replace(/（.*）/, '')}`;

// R31（2026-11-09 使用者決定）：AI 先擬、教師核對；題位改成一張總表，按「修改」才展開該列編輯。
export function ItemBlueprintEditor({ draft, modes, strategy, confirmed, storageFailed, disabled, onChange, onConfirm, onAiDraft, aiBusy = false }: {
  draft: ItemBlueprint; modes: ModeChoice[]; strategy: AssessmentStrategy; confirmed: boolean; storageFailed: boolean; disabled: boolean;
  onChange: (draft: ItemBlueprint) => void; onConfirm: (confirmed: ItemBlueprint) => void; onAiDraft?: () => void; aiBusy?: boolean;
}) {
  const [error, setError] = useState<{ message: string; index: number } | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const id = useId();
  const rows = useRef<(HTMLTableRowElement | null)[]>([]);
  const written = draft.slots.filter(slot => slot.judgment.trim() && slot.evidence.trim()).length;
  const blank = draft.slots.filter(slot => !slot.judgment.trim() && !slot.evidence.trim()).length;
  function edit(index: number, changes: Partial<ItemBlueprintSlot>) {
    setError(null);
    onChange({ ...draft, slots: draft.slots.map((slot, i) => i === index ? { ...slot, ...changes } : slot) });
  }
  function confirm() {
    try {
      const next = validateItemBlueprint(draft, modes);
      setError(null); setEditing(null);
      onConfirm(next);
    } catch (problem) {
      const message = problem instanceof Error ? problem.message : '逐題藍圖無法確認。';
      const number = Number(message.match(/第 (\d+) 個題位/)?.[1]) || 0;
      setError({ message, index: number - 1 });
      if (number) { setEditing(number - 1); requestAnimationFrame(() => (rows.current[number - 1]?.nextElementSibling?.querySelector('textarea, input') as HTMLElement | null)?.focus()); }
    }
  }
  return <section className="sp-blueprint" aria-labelledby={id}>
    <h3 id={id} tabIndex={-1}>逐題藍圖</h3>
    <p>每個題位寫明要測的判斷與必要證據，前後測共用、出題時才換素材。可先請 AI 擬定，再逐列核對；方式 E 不需填寫。</p>
    <div className="actions sp-blueprint-ai">
      {onAiDraft && <button type="button" className="primary" disabled={disabled || aiBusy || !blank} onClick={onAiDraft}>{aiBusy ? 'AI 擬定中…' : blank === draft.slots.length ? '請 AI 擬定逐題藍圖' : `請 AI 擬定其餘 ${blank} 個空白題位`}</button>}
      <span className="note">{blank ? 'AI 只填空白題位，已填的不會被覆蓋；擬好後仍須你核對並確認。' : '所有題位都已填寫；要請 AI 重擬某一列，先清空該列的判斷與證據。'}</span>
    </div>
    <details><summary>怎麼填？</summary>
      <p className="note">證據單位是實際需要查核的格、紀錄或引句；推理步數是篩選、比較、計算或推論等必要操作。必要證據請寫清楚每單位是什麼，兩份的材料長度與用語也要相近。數量是出題目標，不是實測時間或等難證明。</p>
      <p className="note">請填寫可觀察的判斷，例如「判斷哪一筆資料能推翻這項主張」，並指明所需的資料與用途。不要填寫學生、教師或學校姓名。</p>
      <p><strong>{strategy.label}：</strong>{strategy.material}</p><p>{strategy.evidence}</p>
      <p className="note">切換方式、策略或後測情境時會保留相同題位的填寫內容；最近 6 種設定暫存在這個分頁，成功產生題本後才納入工作區備份。</p>
    </details>
    {storageFailed && <p className="notice" role="status">瀏覽器無法暫存草稿。目前編輯仍在畫面上，請在重整前完成出題。</p>}
    <fieldset className="sp-blueprint-fields" disabled={disabled}><legend className="sp-blueprint-sr">編輯紙筆題位</legend>
      <div className="sp-blueprint-table-wrap"><table className="sp-blueprint-table">
        <thead><tr><th scope="col">題位</th><th scope="col">門檻</th><th scope="col">要測的判斷</th><th scope="col">必要證據</th><th scope="col">前／後測負擔</th><th scope="col"><span className="sp-blueprint-sr">操作</span></th></tr></thead>
        <tbody>{draft.slots.map((slot, index) => {
          const open = editing === index, filled = slot.judgment.trim() && slot.evidence.trim();
          return [<tr key={`r${index}`} ref={element => { rows.current[index] = element; }} className={open ? 'is-editing' : filled ? '' : 'is-blank'}>
            <th scope="row"><span className="sp-blueprint-ind">{indicatorName(slot.indicatorId)}</span>{slotLabel(slot)}</th>
            <td className="sp-nowrap">{slot.threshold}</td>
            <td>{slot.judgment || <span className="sp-blueprint-empty">待填</span>}</td>
            <td>{slot.evidence || <span className="sp-blueprint-empty">待填</span>}</td>
            <td className="sp-nowrap">{shortLoad(slot.pre)}{workloadDiffers(slot.pre, slot.post) ? <><br />後：{shortLoad(slot.post)}</> : <><br /><span className="sp-blueprint-same">前後相同</span></>}</td>
            <td><button type="button" aria-expanded={open} onClick={() => setEditing(open ? null : index)}>{open ? '收起' : '修改'}</button></td>
          </tr>,
          open && <tr key={`e${index}`} className="sp-blueprint-editrow"><td colSpan={6}>
            {error?.index === index && <p className="notice" role="alert">{error.message}</p>}
            {slot.kind === 'open' && slot.threshold === '發展→精熟' && <p className="note">這一段要讓學生用新資訊核對原判斷；請把原判斷、需要的新證據及兩者怎麼核對納入規劃。</p>}
            <label>要測的判斷<textarea rows={2} maxLength={BLUEPRINT_LIMITS.judgment} value={slot.judgment} onChange={event => edit(index, { judgment: event.currentTarget.value })} /></label>
            <label>必要證據<textarea rows={2} maxLength={BLUEPRINT_LIMITS.evidence} value={slot.evidence} onChange={event => edit(index, { evidence: event.currentTarget.value })} /></label>
            <div className="sp-blueprint-loads">
              <WorkloadFields phase="前測" kind={slot.kind} value={slot.pre} onChange={pre => edit(index, { pre })} />
              <WorkloadFields phase="後測" kind={slot.kind} value={slot.post} onChange={post => edit(index, { post })} />
            </div>
            {(workloadDiffers(slot.pre, slot.post) || slot.balanceNote) && <label>負擔不同的理由及如何維持可比較性<textarea rows={2} maxLength={BLUEPRINT_LIMITS.balanceNote} value={slot.balanceNote} onChange={event => edit(index, { balanceNote: event.currentTarget.value })} /></label>}
          </td></tr>];
        })}</tbody>
      </table></div>
      {error && (error.index === -1 || editing !== error.index) && <p className="notice" role="alert">{error.message}</p>}
      <div className="actions"><button type="button" onClick={confirm} disabled={confirmed}>確認逐題藍圖</button>
        <p role="status">{confirmed ? '已確認；修改後需再確認。' : `已填判斷與證據：${written}／${draft.slots.length} 個題位。確認後可出題。`}</p></div>
    </fieldset>
  </section>;
}

export function ItemBlueprintReview({ blueprint, label = '本版逐題藍圖' }: { blueprint: ItemBlueprint; label?: string }) {
  return <details className="sp-blueprint sp-blueprint-review"><summary>{label}（{blueprint.slots.length} 個題位）</summary>
    <ol>{blueprint.slots.map(slot => <li key={`${slot.indicatorId}-${slot.kind}-${slot.question}-${slot.step}`}>
      <strong>{indicatorName(slot.indicatorId)}・{slotLabel(slot)}・{slot.threshold}</strong>
      <p>判斷：{slot.judgment}</p><p>必要證據：{slot.evidence}</p>
      <p>前測：{loadLabel(slot.pre)}；後測：{loadLabel(slot.post)}</p>
      {slot.balanceNote && <p>差異理由：{slot.balanceNote}</p>}
    </li>)}</ol>
  </details>;
}

export type PhaseItemBlueprint = { version: 1; slots: (BlueprintPosition & { judgment: string; evidence: string; workload: ItemWorkload; balanceNote?: string })[] };
export function ItemPhaseBlueprintReview({ blueprint, phase }: { blueprint: PhaseItemBlueprint; phase: 'pre' | 'post' }) {
  return <details className="sp-blueprint sp-blueprint-review"><summary>本次{phase === 'pre' ? '前測' : '後測'}逐題藍圖（{blueprint.slots.length} 個題位）</summary>
    <ol>{blueprint.slots.map(slot => <li key={`${slot.indicatorId}-${slot.kind}-${slot.question}-${slot.step}`}>
      <strong>{indicatorName(slot.indicatorId)}・{slotLabel(slot)}・{slot.threshold}</strong>
      <p>判斷：{slot.judgment}</p><p>必要證據：{slot.evidence}</p><p>作答負擔：{loadLabel(slot.workload)}</p>
      {slot.balanceNote && <p>差異理由：{slot.balanceNote}</p>}
    </li>)}</ol>
  </details>;
}
