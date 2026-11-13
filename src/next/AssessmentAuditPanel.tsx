import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { AssessmentVersion } from '../domain/types';
import { auditSource, choicePositionWarnings, repeatedOptionClues, type AuditSource, type AuditStageResult } from '../domain/assessmentAudit';
import { useAiSettings, isValidModelId } from '../services/AiSettings';
import { assessmentAuditRequests, runAssessmentAudit, type AuditStep } from '../services/assessmentAudit';
import { RepairNeeded, RepairFailed } from '../services/openai';
import { FocusDialog } from './FocusDialog';
import { usingLabel } from './AiSetupPanel';
import { workloadPair } from '../domain/assessmentWorkloadAudit';
import { meanClaimIssues } from '../domain/assessmentMeanAudit';
import { WorkloadAuditPanel } from './WorkloadAuditPanel';

const labels: Record<AuditStep, string> = { solve: '完整卷盲作', masked: '遮表檢查題間提示', rubric: '對照題面與教師判讀', claims:'逐選項與例答查證' };
const phaseLabel = (source: AuditSource) => source.phase === 'pre' ? '前測' : '後測';

export function AssessmentAuditPanel({ projectId, pre, post, disabled, activeRequest, onNeedKey }: {
  projectId: string;
  pre?: AssessmentVersion;
  post?: AssessmentVersion;
  disabled: boolean;
  activeRequest: RefObject<AbortController | null>;
  onNeedKey: () => void;
}) {
  const { provider, model, key, setSettingsOpen } = useAiSettings();
  const local = useRef<AbortController | null>(null);
  const stopButton = useRef<HTMLButtonElement>(null);
  const originButton = useRef<HTMLElement | null>(null);
  const entering = useRef(false);
  const exiting = useRef(false);
  const [pending, setPending] = useState<AuditSource | null>(null);
  const [workloadRunning, setWorkloadRunning] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [running, setRunning] = useState<{stage:AuditStep;index:number;total:number} | null>(null);
  const [runSource, setRunSource] = useState<AuditSource | null>(null);
  const [results, setResults] = useState<AuditStageResult[]>([]);
  const [skipped, setSkipped] = useState<AuditStep[]>([]);
  const [notice, setNotice] = useState('');
  const sources = [auditSource(pre), auditSource(post)].filter((s): s is AuditSource => s !== null);

  function resetRequest() {
    const request = local.current;
    request?.abort();
    local.current = null;
    if (request && activeRequest.current === request) activeRequest.current = null;
  }
  useLayoutEffect(() => {
    setPending(null); setAllowed(false); setRunning(null); setRunSource(null); setResults([]); setSkipped([]); setNotice('');
    return resetRequest;
  }, [provider, model, key]);
  useLayoutEffect(() => {
    if (!disabled) return;
    if (local.current) { resetRequest(); setRunning(null); setNotice('驗題已停止；目前題本未改動。'); }
    setPending(null); setAllowed(false);
  }, [disabled]);

  useLayoutEffect(() => {
    if (running && entering.current) {
      entering.current = false;
      stopButton.current?.focus({ preventScroll: true });
    } else if (!running && exiting.current) {
      exiting.current = false;
      if (originButton.current?.isConnected && document.activeElement === document.body) originButton.current.focus({ preventScroll: true });
    }
  }, [running]);

  function prepare(source: AuditSource) {
    if (disabled || local.current || activeRequest.current) return;
    if (!key.trim()) { setNotice('請先填入本頁的 AI 金鑰，再預覽驗題資料。'); onNeedKey(); return; }
    if (!isValidModelId(model, provider)) { setNotice('請先選擇可用的 AI 模型。'); setSettingsOpen(true); return; }
    try { assessmentAuditRequests(projectId, source); }
    catch { setNotice('本次題本太大，無法送出獨立驗題；題本未改動。'); return; }
    originButton.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setNotice(''); setAllowed(false); setPending(source);
  }
  function dismiss() { setPending(null); setAllowed(false); }
  function stop() {
    exiting.current = true; resetRequest(); setRunning(null);
    setNotice('驗題已停止；只顯示已完成的檢查，題本未改動。');
  }
  async function start() {
    if (!pending || !allowed || disabled || local.current || activeRequest.current) return;
    const source = pending, request = new AbortController();
    local.current = request; activeRequest.current = request; entering.current = true;
    dismiss(); setRunSource(source); setResults([]); setSkipped([]); setNotice('');
    const failed: AuditStep[] = [];
    try {
      await runAssessmentAudit({ projectId, source, settings: { provider, model, key }, consent: true, signal: request.signal,
        onStart: (stage,index,total) => setRunning({stage,index,total}), onResult: result => { if (local.current === request) setResults(before => [...before, result]); },
        onSkip: stage => { if (local.current === request) { failed.push(stage); setSkipped([...failed]); } } });
      if (local.current === request) setNotice(failed.length ? '有檢查未完成，請核對已取得的結果；題本未改動。' : '獨立驗題完成；題本未改動。');
    } catch (error) {
      if (local.current === request) setNotice(request.signal.aborted ? '驗題已停止；題本未改動。' :
        error instanceof RepairNeeded || error instanceof RepairFailed ? 'AI 回傳缺少有效題號或原文引文，這一步未完成。可重新驗題，題本未改動。' :
        '驗題未完成。請核對金鑰、額度或連線後再試；題本未改動。');
    } finally {
      if (local.current === request) { exiting.current = true; resetRequest(); setRunning(null); }
    }
  }
  if (!sources.length) return null;
  const localClues = runSource ? repeatedOptionClues(runSource) : [];
  const localMeans = runSource ? meanClaimIssues(runSource) : [];
  const issues = [...localClues,...localMeans];
  for (const result of [...results].sort((a,b) => Number(b.stage === 'claims') - Number(a.stage === 'claims'))) {
    for (const issue of result.issues) {
      if (!issues.some(seen => seen.kind === issue.kind && seen.target === issue.target)) issues.push(issue);
    }
  }
  const pendingRequests = pending ? assessmentAuditRequests(projectId,pending) : [];
  const resultsDone = results.length > 0 && !running && skipped.length === 0 && notice === '獨立驗題完成；題本未改動。';
  const differences = results.flatMap(result => result.answerDifferences);
  const positionWarnings = runSource ? choicePositionWarnings(runSource) : [];
  const pair = workloadPair(pre, post);
  return <section className="card sp-audit" aria-labelledby="assessment-audit-heading">
    <h2 id="assessment-audit-heading">獨立驗題</h2>
    <p>分別核對前測或後測的紙筆題：先盲作，再遮住共用標題、情境與材料找題間提示，最後對照學生題面和教師判讀。按選擇卷與非選卷分開檢查；結果只供核對，不會寫入工作區。</p>
    <div className="actions">
      {sources.map(source => <button type="button" key={source.phase} disabled={disabled || running !== null || workloadRunning} onClick={() => prepare(source)}>驗{phaseLabel(source)}</button>)}
      {running && <button ref={stopButton} type="button" onClick={stop}>停止驗題</button>}
    </div>
    <p role="status">{running ? `${phaseLabel(runSource!)}：${labels[running.stage]}（第 ${running.index}／${running.total} 次）` : notice}</p>
    {runSource && <div>
      <h3>{phaseLabel(runSource)}驗題紀錄</h3>
      {results.length > 0 && <ul>{results.map((result,i) => <li key={result.stage+i}>{labels[result.stage]}：檢查 {result.checked} 項。
        {result.uncertain.length > 0 && <>需再核對：{result.uncertain.join('、')}。</>}</li>)}</ul>}
      {skipped.length > 0 && <p className="notice">未完成：{[...new Set(skipped)].map(stage => labels[stage]).join('、')}。回傳缺少有效題號或原文，未採用。</p>}
      {differences.length > 0 && <div className="notice"><p><strong>盲作與原答案鍵不同，請教師核對</strong></p><ul>
        {differences.map(row => <li key={row.label}>{row.label}：{row.matchedByNumber ? '試算值對應' : '盲作'} {row.blind}「{row.blindText}」；教師答案 {row.key}「{row.keyText}」。<br />盲作依據：{row.work}</li>)}
      </ul></div>}
      {positionWarnings.length > 0 && <div className="notice"><p><strong>選項位置可能提示答案</strong></p><ul>{positionWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}
      {resultsDone && !results.some(result => result.uncertain.length) && !issues.length && !differences.length && !positionWarnings.length && <p>本次未找到有原文支持的問題。仍需教師確認，不能以此判定題本無誤或前後測等難。</p>}
      {results.length > 0 && <details><summary>查看逐題核對理由</summary>{results.map((result,i) => <div key={result.stage+i}>
        <h4>{labels[result.stage]}</h4><ul>{result.observations.map(row => <li key={row.label}><b>{row.label}：</b>{row.text}</li>)}</ul>
      </div>)}</details>}
      {issues.length > 0 && <ol>{issues.map(issue => <li key={issue.kind + issue.target + issue.explanation}>
        <strong>{issue.kind === 'cross-item-clue' ? '題間提示' : '題面與判讀不一致'}｜{issue.label}</strong>
        <p>{issue.explanation}</p>
        <ul>{issue.evidence.map((e,i) => <li key={e.ref+i}><b>{e.label}：</b>「{e.quote}」</li>)}</ul>
      </li>)}</ol>}
    </div>}
    {pair && <WorkloadAuditPanel projectId={projectId} pair={pair} onBusy={setWorkloadRunning} disabled={disabled || running !== null} activeRequest={activeRequest} onNeedKey={onNeedKey} />}
    {pending && <FocusDialog label="獨立驗題送出預覽" onDismiss={dismiss}>
      <h2 tabIndex={-1} data-dialog-start>確認{phaseLabel(pending)}驗題資料</h2>
      <p>使用 {usingLabel(provider, model)}，同意後最多送出 {pendingRequests.length} 次請求，可能產生費用。選項盲查不送答案鍵；只有核對教師判讀或例答時才會送對應教師文字。不送課程原文、其他測次或學生作答。請先去識別。</p>
      <details><summary>查看將送出的資料</summary>{pendingRequests.map(({stage,plan},i) => <label key={i}>{i+1}. {labels[stage]}<textarea readOnly rows={6} value={JSON.stringify(plan.payload,null,2)} /></label>)}</details>
      <label className="consent-check"><input type="checkbox" checked={allowed} onChange={event => setAllowed(event.target.checked)} />我已核對內容、去識別與費用，同意這次驗題</label>
      <div className="actions"><button type="button" className="primary" disabled={!allowed || disabled} onClick={() => { void start(); }}>同意並開始驗題</button><button type="button" onClick={dismiss}>取消</button></div>
    </FocusDialog>}
  </section>;
}
