import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { buildWorkloadAuditPlan, validateWorkloadAudit, type WorkloadAuditResult, type WorkloadPair } from '../domain/assessmentWorkloadAudit';
import type { RequestPlan } from '../services/generation';
import { useAiSettings, isValidModelId } from '../services/AiSettings';
import { RepairFailed, RepairNeeded, runRequest } from '../services/openai';
import { FocusDialog } from './FocusDialog';
import { usingLabel } from './AiSetupPanel';

export function WorkloadAuditPanel({ projectId, pair, disabled, activeRequest, onNeedKey, onBusy }: {
  projectId: string; pair: WorkloadPair; disabled: boolean; activeRequest: RefObject<AbortController | null>; onNeedKey: () => void; onBusy: (value: boolean) => void;
}) {
  const { provider, model, key, setSettingsOpen } = useAiSettings();
  const local = useRef<AbortController | null>(null);
  const origin = useRef<HTMLButtonElement>(null);
  const stopControl = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const [pending, setPending] = useState<RequestPlan | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<WorkloadAuditResult | null>(null);
  const [notice, setNotice] = useState('');

  function abort() {
    const request = local.current;
    local.current = null;
    if (request) onBusy(false);
    if (request && activeRequest.current === request) activeRequest.current = null;
    request?.abort();
  }
  useLayoutEffect(() => {
    setPending(null); setAllowed(false); setResult(null); setNotice(''); setRunning(false);
    return abort;
  }, [provider, model, key, projectId, pair.pre.assessmentId, pair.post.assessmentId]);
  useLayoutEffect(() => {
    if (!disabled) return;
    setPending(null); setAllowed(false);
    if (local.current) { abort(); setRunning(false); setNotice('負擔核對已停止；題本未改動。'); }
  }, [disabled]);
  useLayoutEffect(() => {
    if (running) stopControl.current?.focus({ preventScroll: true });
    else if (returnFocus.current) {
      returnFocus.current = false;
      if (document.activeElement === document.body) origin.current?.focus({ preventScroll: true });
    }
  }, [running]);

  function prepare() {
    if (disabled || activeRequest.current) return;
    if (!key.trim()) { setNotice('請先填入本頁的 AI 金鑰。'); onNeedKey(); return; }
    if (!isValidModelId(model, provider)) { setNotice('請先選擇可用的 AI 模型。'); setSettingsOpen(true); return; }
    try { setPending(buildWorkloadAuditPlan(projectId, pair)); setNotice(''); setAllowed(false); }
    catch { setNotice('前後測資料太大，無法送出；題本未改動。'); }
  }
  function dismiss() { setPending(null); setAllowed(false); }
  function stop() {
    returnFocus.current = true; abort(); setRunning(false); setNotice('負擔核對已停止；題本未改動。');
  }
  async function start() {
    if (!pending || !allowed || disabled || activeRequest.current) return;
    const plan = pending, request = new AbortController();
    local.current = request; activeRequest.current = request; onBusy(true);
    dismiss(); setResult(null); setNotice(''); setRunning(true);
    let validated: WorkloadAuditResult | undefined;
    try {
      await runRequest(plan, { provider, model, key }, true, request.signal, value => { validated = validateWorkloadAudit(pair, value); });
      if (local.current === request) {
        if (!validated) throw new Error('沒有可採用的結果。');
        setResult(validated); setNotice('前後測負擔核對完成；題本未改動。');
      }
    } catch (error) {
      if (local.current === request) setNotice(error instanceof RepairNeeded || error instanceof RepairFailed
        ? '回傳的負擔差異缺少可核對的題號或原文，未採用。'
        : '負擔核對未完成。請檢查金鑰、額度或連線後再試。');
    } finally {
      if (local.current === request) { returnFocus.current = true; abort(); setRunning(false); }
    }
  }

  return <div>
    <h3>前後測作答負擔</h3>
    <p>比對配對題本中，學生實際需要找的證據、推理步驟和題目給的提示。</p>
    <div className="actions">
      <button ref={origin} type="button" disabled={disabled || running} onClick={prepare}>核對前後作答負擔</button>
      {running && <button ref={stopControl} type="button" onClick={stop}>停止負擔核對</button>}
    </div>
    <p role="status">{running ? '正在比對前後測題面…' : notice}</p>
    {result && <>
      <p>已檢查 {result.checked} 個配對題位。{result.uncertain.length > 0 && <>需人工核對：{result.uncertain.join('、')}。</>}</p>
      {result.rejected > 0 && <p className="notice">{result.rejected} 筆差異缺少能對回原卷的引文，未採用。</p>}
      {!result.differences.length && !result.rejected && <p>本次未提出有原文可核對的負擔差異，不能據此認定兩卷等難。</p>}
      {result.differences.length > 0 && <ol>{result.differences.map(row => <li key={row.id}>
        <strong>{row.label}｜作答負擔不同</strong><p>{row.difference}</p>
        <ul><li>前測（{row.pre.label}）：「{row.pre.quote}」；學生需{row.pre.work}。</li>
          <li>後測（{row.post.label}）：「{row.post.quote}」；學生需{row.post.work}。</li></ul>
      </li>)}</ol>}
    </>}
    {pending && <FocusDialog label="前後作答負擔送出預覽" onDismiss={dismiss}>
      <h2 tabIndex={-1} data-dialog-start>確認前後測負擔核對資料</h2>
      <p>使用 {usingLabel(provider, model)}。只送目前配對的兩份學生卷與對應題號，一次請求可能產生費用。請確認題本文字已去識別。</p>
      <details><summary>查看將送出的資料</summary><textarea aria-label="前後測負擔核對資料" readOnly rows={8} value={JSON.stringify(pending.payload, null, 2)} /></details>
      <label className="consent-check"><input type="checkbox" checked={allowed} onChange={event => setAllowed(event.target.checked)} />我已核對內容、去識別與費用，同意負擔核對</label>
      <div className="actions"><button type="button" className="primary" disabled={!allowed || disabled} onClick={() => { void start(); }}>同意並開始負擔核對</button>
        <button type="button" onClick={dismiss}>取消</button></div>
    </FocusDialog>}
  </div>;
}
