import type { AssessmentBlueprintSelection, DesignVersion } from '../domain/types';
import { recommendStrategy, strategiesFor } from '../domain/assessmentStrategy';

interface Props {
  design: DesignVersion;
  selection: AssessmentBlueprintSelection;
  onChange: (selection: AssessmentBlueprintSelection) => void;
  disabled: boolean;
}

export function PaperAssessmentSettings({ design, selection, onChange, disabled }: Props) {
  const input = design.inputSnapshot;
  const options = strategiesFor(input.subject);
  const recommended = recommendStrategy(design);
  const strategy = options.find(row => row.id === selection.strategyId) ?? recommended;
  const activityIndex = design.activities.findIndex(row => row.id === selection.postActivityId);
  const activity = activityIndex < 0 ? undefined : design.activities[activityIndex];
  return <fieldset className="sp-paper-settings" aria-label="紙筆出題設定" disabled={disabled}>
    <legend>紙筆出題設定</legend>
    <p className="note">前後測共用同一種證據與推理要求。前測從不需上過這堂課的情境出發；後測延續已確認的課程情境，換上學生沒做過的新材料。出前測時一併保存這些設定；之後出後測會沿用本版設定。</p>
    <div className="fields">
      <label>分科出題策略<select aria-label="分科出題策略" value={strategy.id} onChange={event => onChange({ ...selection, strategyId: event.target.value })}>
        {options.map(row => <option key={row.id} value={row.id}>{row.label}{row.id === recommended.id ? '（建議）' : ''}</option>)}
      </select></label>
      <label>後測情境<select aria-label="後測情境" value={activity?.id ?? ''} onChange={event => onChange({ ...selection, postActivityId: event.target.value || null })}>
        <option value="">單元主情境（建議）</option>
        {design.activities.map((row, index) => <option key={row.id} value={row.id}>第 {index + 1} 節：{row.name}</option>)}
      </select></label>
    </div>
    <div className="sp-paper-review">
      <div><p><strong>材料：</strong>{strategy.material}</p><p><strong>學生要做的判斷：</strong>{strategy.evidence}</p><p><strong>審題時留意：</strong>{strategy.pitfall}</p></div>
      <div>
        <p><strong>後測情境：</strong>{activity ? `第 ${activityIndex + 1} 節：${activity.name}` : input.title}</p>
        {activity ? <p>{activity.task}</p> : <>
          {input.drivingQuestion?.trim() && <p><strong>驅動問題：</strong>{input.drivingQuestion}</p>}
          {input.finalProduct?.trim() && <p><strong>最終作品：</strong>{input.finalProduct}</p>}
          {!input.drivingQuestion?.trim() && !input.finalProduct?.trim() && <p><strong>課程主題：</strong>{input.topic}</p>}
        </>}
      </div>
    </div>
  </fieldset>;
}
