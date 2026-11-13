import type { Project, Workspace } from '../domain/types';
import { inputSignature } from '../domain/validate';
import { reviewAssessment, selectAssessmentPair } from '../domain/lifecycle';
import { AssessmentPanel } from './AssessmentPanel';
import { ItemRevision } from '../next/ItemRevision';
import { DeliveryPanel } from './DeliveryPanel';
import { SNAPSHOT_LIMIT, comparisonHeadline, reviewGuidance, versionLabel, type ReviewFacts } from './reviewGuidance';

function openPostPreview() {
  const details = document.querySelector('.r03-tools');
  if (details instanceof HTMLDetailsElement) details.open = true;
  const button = document.getElementById('prepare-post');
  if (!(button instanceof HTMLButtonElement)) return;
  button.scrollIntoView({ block: 'center' });
  button.focus();
  if (!button.disabled) button.click();
}

function openDesignConfirmation(nextButtonId: string) {
  const details = document.querySelector('.r03-tools');
  if (!(details instanceof HTMLDetailsElement)) return;
  details.open = true;
  const button = document.getElementById(nextButtonId);
  if (!(button instanceof HTMLButtonElement)) return;
  button.scrollIntoView({ block: 'center' });
  button.focus();
}

export function AssessmentReview({
  phase, workspace, project, onCommit, onMessage, locked, message,
}: {
  phase: 'pre' | 'post';
  workspace: Workspace;
  project: Project;
  onCommit: (next: Workspace, success: string) => boolean;
  onMessage: (message: string) => void;
  locked: boolean;
  message: string;
}) {
  const pre = project.assessments.find(item => item.id === project.activePreId);
  const post = project.assessments.find(item => item.id === project.activePostId);
  const current = phase === 'pre' ? pre : post;
  const linked = project.designs.find(item => item.id === current?.designId);
  const preDesign = project.designs.find(item => item.id === pre?.designId);
  const postDesign = project.designs.find(item => item.id === post?.designId);
  const sourceChanged = !!linked && inputSignature(project.input) !== inputSignature(linked.inputSnapshot);
  const rules = linked?.integration ?? [];
  const inputReviewed = !!project.input.indicatorReview?.confirmedAt && project.input.indicatorReview.signature === inputSignature(project.input);
  const rulesConfirmed = rules.length > 0 && rules.every(rule => rule.status === 'confirmed');
  const facts: ReviewFacts = {
    phase,
    hasPre: !!pre,
    hasPost: !!post,
    preReviewed: !!pre?.reviewedAt,
    preAdministered: !!pre?.administeredAt,
    postReviewed: !!post?.reviewedAt,
    postAdministered: !!post?.administeredAt,
    sourceChanged,
    designConfirmed: !!linked?.confirmedAt,
    rulesConfirmed,
    rulesMissing: rules.length === 0 || rules.some(rule => rule.status === 'missing' || !rule.rule.trim()),
    sameDesign: !!pre && !!post && pre.designId === post.designId,
    blueprintComparable: !!linked && linked.blueprint.length > 0 && linked.blueprint.every(pair => pair.status === '可作有限比較'),
    locked,
    saveFailed: locked || message.includes('尚未保存'),
    cancelled: message.includes('已取消'),
  };
  const guidance = reviewGuidance(facts);
  const blocked = locked || sourceChanged;
  function run(action: () => Workspace, success: string) {
    try { onCommit(action(), success); }
    catch (error) { onMessage(error instanceof Error ? error.message : '未套用修改。'); }
  }
  function confirmCurrent() {
    if (!current) return;
    run(() => reviewAssessment(workspace, project.id, current.id), `${phase === 'pre' ? '前測' : '後測'}題組已核對；仍未標記施測。`);
  }
  return <div id="assessment-review">
    <section className="card" aria-label="題組版本與狀態">
      <div className="chip-row">
        <span className="tag">{current ? versionLabel(!!current.reviewedAt, !!current.administeredAt, sourceChanged) : '尚未建立'}</span>
        <span className="tag">{phase === 'pre' ? '前測' : '後測'}</span>
      </div>
      <h2>{guidance.title}</h2>
      <p>{guidance.detail}</p>
      {current && linked && !linked.confirmedAt && !sourceChanged && (linked.id === project.activeDesignId
        ? <button type="button" onClick={() => openDesignConfirmation(!inputReviewed ? 'review-indicators' : !rulesConfirmed ? 'confirm-rules' : 'confirm-design')}>前往設計確認步驟</button>
        : <p className="notice">這份題組引用設計 {linked.id}。請先到「活動與鷹架」切換至該設計版本，再依上方步驟確認。</p>)}
      <p className="note">{SNAPSHOT_LIMIT}</p>
      <dl className="meta">
        <div><dt>題組</dt><dd>{current?.id ?? '尚未建立'}</dd></div>
        <div><dt>設計</dt><dd>{linked?.id ?? '題組尚未引用設計'}</dd></div>
        <div><dt>規準版本</dt><dd>{current?.rubricVersion ?? linked?.rubricVersion ?? '尚未建立'}</dd></div>
        <div><dt>配對前測</dt><dd>{phase === 'post' ? (post?.parentPreId ?? '未配對') : (pre?.id ?? '尚未建立')}</dd></div>
      </dl>
      <div className="fields">
        <label>審閱用的前測版本
          <select aria-label="審閱用的前測版本" value={project.activePreId ?? ''} disabled={!project.assessments.some(item => item.phase === 'pre')} onChange={event => run(() => selectAssessmentPair(workspace, project.id, event.target.value, null), '已選前測歷史版本。後測要重新配對；已施測的題目不會被改寫。')}>
            {!project.activePreId && <option value="">尚無前測</option>}
            {project.assessments.filter(item => item.phase === 'pre').map(item => <option key={item.id} value={item.id}>{item.id}／{item.administeredAt ? '已施測' : '未施測'}</option>)}
          </select>
        </label>
        <label>審閱用的配對後測
          <select aria-label="審閱用的配對後測" value={project.activePostId ?? ''} disabled={!project.activePreId} onChange={event => run(() => selectAssessmentPair(workspace, project.id, project.activePreId!, event.target.value || null), '已切換配對後測版本。已施測快照保留。')}>
            <option value="">未選後測</option>
            {project.assessments.filter(item => item.parentPreId === project.activePreId).map(item => <option key={item.id} value={item.id}>{item.id}／{item.administeredAt ? '已施測' : '未施測'}</option>)}
          </select>
        </label>
      </div>
      <div className="actions">
        <button type="button" disabled={!current || blocked} onClick={confirmCurrent}>確認這份{phase === 'pre' ? '前測' : '後測'}題組</button>
        {phase === 'post' && <button type="button" id="open-post-only" onClick={openPostPreview}>只補後測，先看要傳的資料</button>}
      </div>
      {sourceChanged && <p className="notice">來源已變。確認和施測先停在這份舊題組上；請從版本清單回查已施測原版，或另生成新題組。</p>}
      {!current?.reviewedAt && <p className="note">請先確認題組。確認還不是施測。</p>}
    </section>
    <section className="card" aria-label="比較限制">
      <h2>比較限制</h2>
      <p>{comparisonHeadline(facts)}</p>
      <p className="note">規準來源：{linked?.rubricSource ?? preDesign?.rubricSource ?? '題組尚未引用規準'}。工具四階是證據有限、萌芽、發展、精熟，不能換成書中學生五階或設計品質四階。</p>
      {(linked ?? preDesign)?.blueprint.map(pair => <div className="reference" key={`${pair.preId}-${pair.postId}`}><strong>{pair.preId} → {pair.postId}・{pair.status}</strong><p>{pair.reason}</p></div>)}
      {post && pre && pre.designId !== post.designId && <p className="notice">前測設計 {preDesign?.id}，後測設計 {postDesign?.id}。設計不同，不宜比較。</p>}
    </section>
    <AssessmentPanel assessment={current} design={linked} />
    <ItemRevision workspace={workspace} project={project} assessment={current} onCommit={onCommit} onMessage={onMessage} locked={locked} />
    <DeliveryPanel project={project} onMessage={onMessage} />
  </div>;
}
