import { useEffect, useRef, useState } from 'react';
import type { Project, Workspace } from '../domain/types';
import { addGeneratedAssessment, addGeneratedDesign } from '../domain/generated';
import { confirmDesign, confirmRules, reviewAssessment, reviewIndicators, selectAssessmentPair } from '../domain/lifecycle';
import { reviseDesignContent } from '../domain/revisions';
import { buildRequestPlan, RequestExpired, sourceSignature, validateRecommendations, type GenerationKind, type Recommendation, type RequestPlan } from '../services/generation';
import { RepairNeeded, runRequest } from '../services/openai';
import { exportDocument } from '../documents/export';
import { indicatorById } from './labels';
import { isValidModelId, useAiSettings } from '../services/AiSettings';

export function R03Tools({ workspace, onCommit, onMessage, locked }: { workspace: Workspace; onCommit: (next: Workspace, message: string) => boolean; onMessage: (message: string) => void; locked: boolean }) {
  const latest = useRef(workspace); latest.current = workspace;
  const project = workspace.projects.find(p => p.id === workspace.activeProjectId)!;
  const design = project.designs.find(d => d.id === project.activeDesignId)!;
  const { provider, key, model, setSettingsOpen } = useAiSettings();
  const preparedTarget = useRef('');
  const [excerpt, setExcerpt] = useState('');
  const [pending, setPending] = useState<RequestPlan | null>(null);
  const [approved, setApproved] = useState(false), [busy, setBusy] = useState(false), [exporting, setExporting] = useState(false);
  const [recommendations, setRecommendations] = useState<{ signature: string; rows: Recommendation[] } | null>(null);
  const [usage, setUsage] = useState('尚無用量。');
  const [ruleDraft, setRuleDraft] = useState(design.integration.map(r => r.rule));
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { setRuleDraft(design.integration.map(r => r.rule)); }, [design.id, design.integration]);
  useEffect(() => () => controller.current?.abort(), []);
  function currentProject(): Project { return latest.current.projects.find(p => p.id === project.id)!; }
  function guard(action: () => Workspace, message: string) { try { onCommit(action(), message); } catch (error) { onMessage(error instanceof Error ? error.message : '未套用修改。'); } }
  function prepare(kind: GenerationKind) {
    if (!key.trim()) { setSettingsOpen(true); onMessage(`請先在頁面上方填入 ${provider === 'gemini' ? 'Gemini' : 'OpenAI'} API key。`); requestAnimationFrame(() => document.getElementById('ai-key-input')?.focus()); return; }
    if (!isValidModelId(model, provider)) { setSettingsOpen(true); onMessage('請先在頁面上方選擇有效的 AI 模型。'); return; }
    try { if (locked) throw new Error('儲存受保護，請先下載備份再重載。'); preparedTarget.current = `${provider}:${model}`; setPending(buildRequestPlan(project, kind, excerpt)); setApproved(false); }
    catch (error) { onMessage(error instanceof Error ? error.message : '未建立請求。'); }
  }
  function applyValue(plan: RequestPlan, value: unknown): Workspace | null {
    const active = latest.current.projects.find(p => p.id === latest.current.activeProjectId)!;
    if (active.id !== plan.projectId || sourceSignature(active) !== plan.sourceSignature) throw new RequestExpired();
    if (plan.kind === 'recommend') { validateRecommendations(value); return null; }
    if (plan.kind === 'design') return addGeneratedDesign(latest.current, plan.projectId, value);
    if (plan.kind === 'pre' || plan.kind === 'post') return addGeneratedAssessment(latest.current, plan.projectId, plan.kind, value);
    throw new Error('不支援的生成任務。');
  }
  async function send() {
    if (!pending || busy || !approved || locked) return;
    const plan = pending, abort = new AbortController(); controller.current = abort; setBusy(true);
    try {
      if (sourceSignature(currentProject()) !== plan.sourceSignature || latest.current.activeProjectId !== plan.projectId) throw new Error('請求脈絡已變更，請重新預覽資料。');
      if (preparedTarget.current !== `${provider}:${model}`) throw new Error('AI 供應商或模型已變更，請重新預覽資料並同意。');
      const result = await runRequest(plan, { provider, key, model }, approved, abort.signal, value => { applyValue(plan, value); });
      if (abort.signal.aborted) throw new Error('已取消，原稿保留。');
      const next = applyValue(plan, result.value);
      setUsage(result.usage); setPending(null); setApproved(false);
      if (plan.kind === 'recommend') { setRecommendations({ signature: plan.sourceSignature, rows: validateRecommendations(result.value) }); onMessage('推薦已收到，請對照理由、假設及四階後選擇；尚未採用或確認。'); }
      else if (next) onCommit(next, plan.kind === 'pre' ? '完整前測已保存。可重新載入後只補後測；不會改寫原題組。' : plan.kind === 'post' ? '完整後測三部分已保存，題組尚待教師確認。' : 'AI 設計另存成新版草稿，原設計與題組保留。請核對目標、規準、藍圖和鷹架。');
    } catch (error) {
      if (error instanceof RepairNeeded && !abort.signal.aborted) { setPending(error.plan); setApproved(false); onMessage(error.message); }
      else { setPending(null); setApproved(false); onMessage(error instanceof Error ? error.message : '請求失敗，原稿保留。'); }
    } finally { controller.current = null; setBusy(false); }
  }
  async function exportFile(audience: 'student' | 'teacher', format: 'md' | 'docx' | 'pdf') {
    if (exporting) return; setExporting(true);
    try { await exportDocument(project, audience, format); onMessage('文件已產生並交由瀏覽器下載；內容使用所選題組的原設計快照。'); }
    catch (error) { onMessage(error instanceof Error ? error.message : '文件產生失敗，原內容保留。'); }
    finally { setExporting(false); }
  }
  const suggestionStale = recommendations?.signature !== sourceSignature(project);
  return <details className="card r03-tools"><summary>AI 生成、版本確認與文件</summary>
    <p>先核對課綱與子指標，AI 設計另存草稿；確認設計後分別生成前測與後測。每次請求都先預覽並同意。原始來源和教師註記不會自動送出。</p>
    <div className="actions"><button type="button" id="review-indicators" disabled={busy || locked} onClick={() => guard(() => reviewIndicators(latest.current, project.id), '此起點、課綱與子指標已核對；仍須核對設計與題組。')}>核對此起點、課綱與子指標</button></div>
    <p className="note">子指標：{project.input.indicatorReview?.confirmedAt ? '已核對此輸入脈絡' : '尚未核對'}。修改起點、課綱、子指標或來源註記後須重新核對。</p>
    <p className="note">OpenAI／Gemini 的 API key 與模型在頁面上方設定；重載後金鑰需重填。</p><fieldset disabled={busy}><legend>這次使用的課程摘錄</legend><label>去識別課程摘錄（選填）<textarea aria-label="去識別課程摘錄" maxLength={60000} value={excerpt} onChange={e => setExcerpt(e.target.value)} placeholder="若從既有課程開始，僅貼設計所需的內容。請先移除姓名、學校、學生資料與秘密；原始來源保持。" /></label></fieldset>
    <div className="actions"><button type="button" disabled={busy || locked} onClick={() => prepare('recommend')}>預覽子指標推薦資料</button><button type="button" disabled={busy || locked} onClick={() => prepare('design')}>預覽新版設計資料</button><button type="button" disabled={busy || locked} onClick={() => prepare('pre')}>預覽前測生成資料</button><button type="button" id="prepare-post" disabled={busy || locked || !project.activePreId} onClick={() => prepare('post')}>預覽只補後測資料</button></div>
    {pending && <section className="consent-panel" aria-label="AI 傳送資料預覽"><h3>{pending.attempt ? '唯一一次格式修復・再次同意' : '這次要傳給 AI 的必要資料'}</h3><p>送往 {preparedTarget.current.startsWith('gemini:') ? 'generativelanguage.googleapis.com（Google Gemini）' : 'api.openai.com（OpenAI）'}，模型 {preparedTarget.current.split(':').slice(1).join(':')}。按下送出會產生供應商費用；取消已送出的請求不保證供應商不計費。金鑰只作請求授權，不進工作區、備份或文件。</p>{preparedTarget.current !== `${provider}:${model}` && <p role="status">供應商或模型已改，請重新預覽資料。</p>}<p className="note">未傳學生作答；原始來源、教師註記及其他專案未自動附上。請逐項檢查下列自由文字是否已去識別。</p><textarea aria-label="本次必要資料" readOnly rows={12} value={JSON.stringify(pending.payload, null, 2)} /><details><summary>固定生成指引</summary><p>{pending.instructions}</p></details><label className="consent-check"><input type="checkbox" checked={approved} disabled={busy} onChange={e => setApproved(e.target.checked)} />我已檢查必要資料、去識別與費用，同意這一次請求</label><div className="actions"><button type="button" className="primary" disabled={!approved || busy || locked || preparedTarget.current !== `${provider}:${model}`} onClick={() => { void send(); }}>{busy ? '等待 AI 回應' : '同意並送出這次請求'}</button><button type="button" onClick={() => { if (busy) controller.current?.abort(); else { setPending(null); setApproved(false); } }}>取消這次請求</button></div></section>}
    <p aria-live="polite" className="note">{usage}</p>
    {recommendations && <section><h3>待教師選擇的推薦</h3>{suggestionStale && <p className="notice">脈絡已變更，推薦不可採用；請重新請求。</p>}{recommendations.rows.map(r => <div className="reference" key={r.indicatorId}><strong>{indicatorById(r.indicatorId)?.name}</strong><p>{r.reason}</p>{r.assumptions.map(a => <p key={a}>待核對假設：{a}</p>)}</div>)}<button type="button" disabled={suggestionStale || busy || locked} onClick={() => guard(() => { const next = structuredClone(latest.current), p = next.projects.find(p => p.id === project.id)!; p.input.indicatorIds = recommendations.rows.map(r => r.indicatorId); p.input.indicatorReview = { signature: '', confirmedAt: null }; return next; }, '推薦已放入輸入草稿，尚未核對，也未改寫設計或題組。')}>將推薦放入子指標草稿</button></section>}
    <h3>目前設計的多題整合規則</h3>{design.integration.map((r, i) => <label key={r.indicatorId}>{indicatorById(r.indicatorId)?.name}（{r.status}）<textarea aria-label={`整合規則 ${i + 1}`} maxLength={20000} value={ruleDraft[i] ?? ''} onChange={e => setRuleDraft(rows => rows.map((text, at) => at === i ? e.target.value : text))} /></label>)}
    <div className="actions"><button type="button" disabled={busy || locked} onClick={() => guard(() => reviseDesignContent(latest.current, project.id, d => { d.integration = d.integration.map((r, i) => ({ ...r, rule: ruleDraft[i].trim(), status: ruleDraft[i].trim() ? 'draft' : 'missing' })); }, '教師修訂多題整合規則；另存草稿，原題組保留。'), '已另存規則草稿，須重新確認設計及生成新題組。')}>另存整合規則草稿</button><button type="button" id="confirm-rules" disabled={busy || locked} onClick={() => guard(() => { if (ruleDraft.some((s, i) => s !== design.integration[i].rule)) throw new Error('規則有未保存修改，請先另存草稿。'); return confirmRules(latest.current, project.id); }, '目前設計的多題整合規則已由教師確認。')}>確認此設計的整合規則</button><button type="button" id="confirm-design" disabled={busy || locked} onClick={() => guard(() => confirmDesign(latest.current, project.id), '目前設計已由教師確認；不代表課程已實施或題組已施測。')}>確認目前設計</button></div>
    <h3>題組版本與教師確認</h3><label>前測版本<select aria-label="前測版本" value={project.activePreId ?? ''} disabled={busy} onChange={e => guard(() => selectAssessmentPair(latest.current, project.id, e.target.value, null), '已選前測歷史版本。後測另選配對版本。')}><option value="" disabled>尚無前測</option>{project.assessments.filter(a => a.phase === 'pre').map(a => <option key={a.id} value={a.id}>{a.id}／{a.administeredAt ? '歷史已施測' : '未施測'}</option>)}</select></label><label>配對後測版本<select aria-label="配對後測版本" value={project.activePostId ?? ''} disabled={busy || !project.activePreId} onChange={e => guard(() => selectAssessmentPair(latest.current, project.id, project.activePreId!, e.target.value || null), '已切換配對後測版本。')}><option value="">未選後測／只補後測</option>{project.assessments.filter(a => a.parentPreId === project.activePreId).map(a => <option key={a.id} value={a.id}>{a.id}／{a.administeredAt ? '歷史已施測' : '未施測'}</option>)}</select></label>
    <div className="actions">{[project.activePreId, project.activePostId].map((id, index) => id && <span key={id}><button type="button" disabled={busy || locked} onClick={() => guard(() => reviewAssessment(latest.current, project.id, id), `${index ? '後測' : '前測'}題組已核對。`)}>確認{index ? '後測' : '前測'}題組</button></span>)}</div>
    <h3>學生題本與教師手冊</h3><p className="note">Word 可編輯；PDF 嵌入本機中文字型，文字可選取與搜尋。三種格式使用同一份題組快照；教師手冊含完整規準、選項支持／限制、整合規則與提示詞。學生題本不含教師判讀依據。</p><div className="actions">{(['student', 'teacher'] as const).flatMap(audience => (['md', 'docx', 'pdf'] as const).map(format => <button type="button" key={`${audience}-${format}`} disabled={exporting} onClick={() => { void exportFile(audience, format); }}>下載{audience === 'student' ? '學生題本' : '教師手冊'} {format === 'md' ? 'Markdown' : format === 'docx' ? 'Word' : 'PDF'}</button>))}</div>
  </details>;
}
