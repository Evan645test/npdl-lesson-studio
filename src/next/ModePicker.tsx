// 先選新題組的方式；已保存的題組須重新產生成對前後測才會套用改選。
import { type Project, type SetMode } from '../domain/types';
import { SET_FORMAT, type ModeChoice } from '../domain/thresholdSet';
import { ASSESSABILITY_LABEL, assessabilityOf, modeNotice, suggestedMode } from '../data/assessability';
import { indicators } from '../components/labels';

// 粗估每種方式的作答時間（分鐘），只用來在產生前提醒；產生後依實際內容估算。方式 E 只有自評。
const MODE_MINUTES: Record<SetMode, number> = { A: 9, B: 12, C: 18, D: 17, E: 5 };

export const ASSESSMENT_MODE_GUIDANCE = '情境進程題讓學生在具體情境中選出並說明自己會怎麼做，用來看他在四階進程的位置，不看對錯；課中觀察＋自評以課中觀察表為主要證據，不出情境題。';
// R33：新題本只剩兩種方式；非 E 一律為情境進程題（內部沿用 B 作為代表值）。
export const SCENARIO_MODE: SetMode = 'B';
const MODE_LABEL = (mode: SetMode) => mode === 'E' ? '課堂學習單＋表現勾選表（不出情境題）' : '情境進程題（3 題選擇附理由＋1 題延伸）';
export const PENDING_ASSESSMENT_MODE_MESSAGE = '新選擇尚未套用到已產生的前後測。請重新產生成對前後測，或沿用已產生題組的方式。';

function activeSetPhase(project: Project, phase: 'pre' | 'post') {
  const design = project.designs.find(row => row.id === project.activeDesignId);
  if (!design) return undefined;
  const id = phase === 'pre' ? project.activePreId : project.activePostId;
  const saved = project.assessments.find(row => row.id === id && row.phase === phase);
  return saved?.format === SET_FORMAT && saved.sets && saved.designId === design.id && saved.rubricVersion === design.rubricVersion
    ? { version: saved, sets: saved.sets }
    : undefined;
}

function currentModes(project: Project, pre = activeSetPhase(project, 'pre')): ModeChoice[] {
  const design = project.designs.find(row => row.id === project.activeDesignId);
  const savedPre = project.assessments.find(row => row.id === project.activePreId && row.format === 'scenario-progression-v1' && row.designId === design?.id);
  return (design?.inputSnapshot.indicatorIds ?? []).map(indicatorId => {
    const suggested = suggestedMode(indicatorId) === 'E' ? 'E' : SCENARIO_MODE;
    if (savedPre) return { indicatorId, suggestedMode: suggestedMode(indicatorId), mode: savedPre.sets?.some(set => set.indicatorId === indicatorId) ? 'E' : SCENARIO_MODE };
    const saved = pre?.sets.find(set => set.indicatorId === indicatorId && set.suggestedMode === suggestedMode(indicatorId));
    return { indicatorId, suggestedMode: suggestedMode(indicatorId), mode: saved ? (saved.mode === 'E' ? 'E' : SCENARIO_MODE) : suggested };
  });
}

function validModeSelection(current: ModeChoice[], value: ModeChoice[] | null): value is ModeChoice[] {
  return value !== null && value.length === current.length && value.every((row, i) =>
    row.indicatorId === current[i].indicatorId && row.suggestedMode === current[i].suggestedMode && (row.mode === 'E' || row.mode === SCENARIO_MODE));
}

export function effectiveModes(project: Project, value: ModeChoice[] | null): ModeChoice[] {
  const current = currentModes(project);
  // 呼叫者另以專案、設計版本隔離本頁選擇；這裡核對子指標與建議方式。
  return validModeSelection(current, value) ? value : current;
}

// R34（Codex 複審第 6 項）：新題本只用情境進程題／課中觀察＋自評；舊門檻題組題本為唯讀歷史，
// 改選方式只影響之後產生的新題本，不再以「尚未套用」擋住現有題本的確認與下載。
export function hasPendingAssessmentModes(_project: Project, _value: ModeChoice[] | null): boolean {
  return false;
}

export function ModePicker({ project, value, onChange, disabled = false }: { project: Project; value: ModeChoice[] | null; onChange: (next: ModeChoice[]) => void; disabled?: boolean }) {
  const modes = effectiveModes(project, value);
  const paperMinutes = modes.reduce((n, row) => n + (row.mode === 'E' ? 0 : MODE_MINUTES[row.mode]), 0);
  const selfMinutes = modes.reduce((n, row) => n + (row.mode === 'E' ? MODE_MINUTES.E : 0), 0);
  const timing = [
    paperMinutes ? `紙筆題粗估約 ${paperMinutes} 分鐘` : '',
    selfMinutes ? `學生自評粗估約 ${selfMinutes} 分鐘（課中觀察時間依活動安排）` : '',
  ].filter(Boolean).join('；');
  return <div className="sp-mode-picker" role="group" aria-label="測驗方式">
    <h3>每個子指標的測驗方式</h3>
    <p className="note">預設依子指標是否適合用情境題引出做法與想法；可以改選，前後測會用同一種方式。</p>
    {activeSetPhase(project, 'pre') && <p className="note">目前題本是舊格式（門檻題組），這裡的選擇只用於新的情境進程題題本；舊題本仍可檢視與下載。</p>}
    {modes.map((row, index) => {
      const name = indicators.entries.find(entry => entry.id === row.indicatorId)?.name ?? row.indicatorId;
      const notice = modeNotice(row.suggestedMode, row.mode);
      return <div className="sp-mode-row" key={row.indicatorId}>
        <label>{name}<span className="tag">{ASSESSABILITY_LABEL[assessabilityOf(row.indicatorId)]}・建議{row.suggestedMode === 'E' ? '課中觀察' : '情境題'}</span>
          <select aria-label={`${name}的測驗方式`} value={row.mode === 'E' ? 'E' : SCENARIO_MODE} disabled={disabled} onChange={event => onChange(modes.map((m, i) => i === index ? { ...m, mode: event.target.value as SetMode } : m))}>
            {([SCENARIO_MODE, 'E'] as SetMode[]).map(mode => <option value={mode} key={mode}>{MODE_LABEL(mode)}{(mode === 'E') === (row.suggestedMode === 'E') ? '（建議）' : ''}</option>)}
          </select>
        </label>
        {notice && row.mode === 'E' !== (row.suggestedMode === 'E') && <p className="notice" role="status">{notice}</p>}
      </div>;
    })}
    {timing && <p className="note">每次評量：{timing}。產生後依實際內容重新估算。{paperMinutes + selfMinutes > 30 ? '學生作答與自評合計超過 30 分鐘，可以考慮精簡。' : ''}</p>}
  </div>;
}
