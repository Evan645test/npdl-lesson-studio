import { useEffect, useMemo, useRef, useState } from 'react';
import type { Workspace } from '../domain/types';
import type { DesignContent } from '../domain/lifecycle';
import { curriculum, indicators } from '../components/labels';
import { RepairNeeded, runRequest } from '../services/openai';
import { RequestExpired } from '../services/generation';
import { isValidModelId, useAiSettings } from '../services/AiSettings';
import type { RequestPlan } from '../services/generation';
import { INTAKE_EXAMPLES, intakeFromExample } from './examples';
import { addIntakeProject, changeIntake, clearIntake, emptyIntake, intakeFingerprint, intakeGaps, intakeStorageKey, loadIntake, reviewIntake, saveIntake, type IntakeDraft } from './intake';
import { applyExtraction, buildExtractionPlan, buildInitialDesignPlan, buildSuggestionPlan, validateExtraction, validateIntakeSuggestions, type IntakeSuggestions } from './intakeAi';
import { FieldAiAssist } from './FieldAiAssist';

interface Props {
  workspace: Workspace;
  workspaceKey: string;
  onCreate: (next: Workspace) => boolean;
  onOpenProject: () => void;
}

export function IntakePanel({ workspace, workspaceKey, onCreate, onOpenProject }: Props) {
  const storageKey = intakeStorageKey(workspaceKey);
  const [initial] = useState(() => loadIntake(localStorage, storageKey));
  const [draft, setDraft] = useState<IntakeDraft | null>(initial.draft);
  const [message, setMessage] = useState(initial.error ?? '未完成發想只保存在這個瀏覽器；正式專案另行建立。');
  const [locked, setLocked] = useState(!!initial.error);
  const raw = useRef(initial.raw);
  const current = useRef(draft); current.current = draft;
  const workspaceRef = useRef(workspace); workspaceRef.current = workspace;
  const [query, setQuery] = useState('');
  const [plan, setPlan] = useState<RequestPlan | null>(null);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gaps, setGaps] = useState<string[]>([]);
  const [result, setResult] = useState<{ signature: string; content: unknown } | null>(null);
  const [suggestions, setSuggestions] = useState<{ signature: string; value: IntakeSuggestions } | null>(null);
  const { provider, key, model, setSettingsOpen } = useAiSettings();
  const preparedTarget = useRef('');
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey) { setLocked(true); setMessage('另一個分頁已改動發想草稿。請重載核對；本頁內容暫留記憶體。'); }
    };
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener('storage', onStorage); controller.current?.abort(); };
  }, [storageKey]);

  const matches = useMemo(() => {
    if (!draft || !query.trim()) return [];
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return curriculum.filter(row => !draft.curriculumIds.includes(row.id))
      .map(row => {
        const haystack = `${row.code} ${row.subject} ${row.text}`.toLowerCase();
        const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
        return { row, score: score + (row.subject.includes(draft.subject) && draft.subject ? 2 : 0) };
      })
      .filter(item => item.score >= terms.length)
      .sort((a, b) => b.score - a.score || a.row.code.localeCompare(b.row.code))
      .slice(0, 10).map(item => item.row);
  }, [draft, query]);

  function save(next: IntakeDraft) {
    controller.current?.abort();
    setDraft(next);
    setPlan(null); setApproved(false); setResult(null); setSuggestions(null);
    try {
      if (locked) throw new Error('發想草稿受保護，請重載核對。');
      raw.current = saveIntake(localStorage, storageKey, next, raw.current);
      setMessage('發想草稿已保存在此瀏覽器。');
    } catch (error) { setLocked(true); setMessage(`尚未保存：${error instanceof Error ? error.message : String(error)} 本頁修改暫留記憶體。`); }
  }

  function update(updates: Partial<IntakeDraft>) {
    if (!draft) return;
    try { save(changeIntake(draft, updates)); }
    catch (error) { setMessage(error instanceof Error ? error.message : '欄位未修改。'); }
  }

  function choose(route: IntakeDraft['route']) {
    if (draft && !confirm('改選入口會清除目前尚未完成的發想草稿。確定改選？')) return;
    save(emptyIntake(route)); setGaps([]);
  }

  function chooseExample(id: string) {
    if (draft && !confirm('帶入範例會取代目前尚未完成的發想草稿。確定帶入？')) return;
    try { save(intakeFromExample(id)); setGaps([]); setMessage('模擬範例已帶入新草稿；課綱與子指標仍待教師核對。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '範例未帶入。'); }
  }

  function clear() {
    if (!draft || !confirm('只會清空這份尚未完成的發想草稿；正式專案與原備份不受影響。確定清空？')) return;
    try { clearIntake(localStorage, storageKey, raw.current); raw.current = null; setDraft(null); setGaps([]); setResult(null); setPlan(null); setMessage('未完成發想草稿已清空。'); }
    catch (error) { setLocked(true); setMessage(error instanceof Error ? error.message : '草稿未清空。'); }
  }

  function prepare(kind: 'intake' | 'design' | 'recommend') {
    if (!draft) return;
    if (!key.trim()) { setSettingsOpen(true); setMessage(`請先在頁面上方填入 ${provider === 'gemini' ? 'Gemini' : 'OpenAI'} API key。`); requestAnimationFrame(() => document.getElementById('ai-key-input')?.focus()); return; }
    if (!isValidModelId(model, provider)) { setSettingsOpen(true); setMessage('請先在頁面上方選擇有效的 AI 模型。'); return; }
    try {
      if (locked) throw new Error('發想草稿受保護，請先重載核對。');
      preparedTarget.current = `${provider}:${model}`;
      setPlan(kind === 'intake' ? buildExtractionPlan(draft) : kind === 'recommend' ? buildSuggestionPlan(draft) : buildInitialDesignPlan(draft));
      setApproved(false); setResult(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : '未建立 AI 請求。'); }
  }

  async function send() {
    if (!plan || !approved || busy || !draft || locked) return;
    const request = plan, abort = new AbortController(); controller.current = abort; setBusy(true);
    try {
      if (intakeFingerprint(current.current!) !== request.sourceSignature) throw new RequestExpired();
      if (preparedTarget.current !== `${provider}:${model}`) throw new Error('AI 供應商或模型已變更，請重新預覽資料並同意。');
      const response = await runRequest(request, { provider, key, model }, true, abort.signal, value => {
        if (intakeFingerprint(current.current!) !== request.sourceSignature) throw new RequestExpired();
        if (request.kind === 'intake') validateExtraction(value);
        else if (request.kind === 'recommend') validateIntakeSuggestions(value, current.current!.subject.trim());
        else addIntakeProject(workspaceRef.current, current.current!, value);
      });
      if (abort.signal.aborted || intakeFingerprint(current.current!) !== request.sourceSignature) throw new RequestExpired();
      setPlan(null); setApproved(false);
      if (request.kind === 'intake') {
        const applied = applyExtraction(current.current!, response.value);
        save(applied.draft); setGaps(applied.gaps);
        setMessage('AI 已把原課程解構到可編輯欄位。空欄請由教師補寫或使用欄位 AI 發想；原文保留。');
      } else if (request.kind === 'recommend') {
        setSuggestions({ signature: request.sourceSignature, value: validateIntakeSuggestions(response.value, current.current!.subject.trim()) });
        setMessage('候選已回傳，請核對後再帶入草稿；學科起點和課綱對應仍由教師確認。');
      } else {
        setResult({ signature: request.sourceSignature, content: response.value });
        setMessage('第一版設計已回傳，尚未建立正式專案。請看結果；不滿意可再次生成。');
      }
    } catch (error) {
      if (error instanceof RepairNeeded && !abort.signal.aborted) { setPlan(error.plan); setApproved(false); setMessage(error.message); }
      else { setPlan(null); setApproved(false); setMessage(error instanceof Error ? error.message : 'AI 請求失敗；原稿保留。'); }
    } finally { setBusy(false); controller.current = null; }
  }

  function acceptDesign() {
    if (!draft || !result || result.signature !== intakeFingerprint(draft)) { setMessage('來源已改，請重新生成設計。'); return; }
    try {
      const next = addIntakeProject(workspaceRef.current, draft, result.content);
      if (onCreate(next)) {
        try { clearIntake(localStorage, storageKey, raw.current); raw.current = null; setDraft(null); setResult(null); }
        catch (error) { setLocked(true); setMessage(`正式專案已建立，但未完成草稿未清空：${error instanceof Error ? error.message : String(error)}。請重載核對。`); }
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : '設計未採用，發想草稿保留。'); }
  }

  return <div className="intake-shell">
    <section className="intake-intro"><span className="intake-kicker">教師備課工作台</span><h1>從你手上的課程出發</h1><p>先留下構想，再核對課綱與一至兩項 NPDL 子指標。AI 建議只形成待審設計；課程規劃不等於已實施。</p></section>
    <p role="status" className={locked ? 'status warning' : 'status'}>{message}</p>
    {!draft ? <>
      <div className="intake-routes"><button type="button" className="route-card" onClick={() => choose('new')}><strong>我還沒有課程</strong><span>從學科、年級和一句構想開始；AI 建立第一版設計。</span></button><button type="button" className="route-card" onClick={() => choose('existing')}><strong>我已有一般課程</strong><span>貼上去識別原文，先整理發想，再設計 NPDL 課程。</span></button></div>
      <h2>從模擬範例試看</h2><p className="note">範例只提供課前草稿，沒有真實施測或教學成效。帶入後仍須選課綱、核對指標，並由你手動啟動 AI。</p>
      <div className="example-grid">{INTAKE_EXAMPLES.map(example => <button type="button" key={example.id} className="example-card" onClick={() => chooseExample(example.id)}><strong>{example.label}</strong><span>{example.note}</span></button>)}</div>
      <button type="button" onClick={onOpenProject}>開啟已有的新版工作區</button>
    </> : <>
      <div className="intake-heading"><div><span className="tag">{draft.route === 'new' ? '尚無課程' : '已有一般課程'}</span><h2>{draft.title || '未命名的發想草稿'}</h2></div><div className="actions"><button type="button" onClick={onOpenProject}>查看已有專案</button><button type="button" onClick={clear}>清空這份草稿</button></div></div>
      <div className="intake-columns"><div className="intake-main">
        {draft.route === 'existing' && <section className="card"><h2>貼入原課程</h2><p>請先移除姓名、學校、學生資料與秘密。這段文字只保存在目前瀏覽器；每次送給 AI 前會完整預覽，並由你逐次同意。</p><label>去識別的原課程文字<textarea aria-label="去識別的原課程文字" value={draft.sourceText} maxLength={60000} rows={10} onChange={event => update({ sourceText: event.target.value })} /></label><button type="button" disabled={!draft.sourceText.trim() || locked} onClick={() => prepare('intake')}>請 AI 解構到發想欄位</button></section>}
        <section className="card"><h2>課程發想資料</h2><p className="note">AI 擷取會直接填入這些可編輯欄位，不會確認設計。若原文沒有相關資訊，欄位留空。</p>
          <div className="fields"><label>學科<input aria-label="發想學科" value={draft.subject} maxLength={160} onChange={event => update({ subject: event.target.value })} /></label><label>年級<input aria-label="發想年級" value={draft.grade} maxLength={160} onChange={event => update({ grade: event.target.value })} /></label><FieldAiAssist courseId={draft.id} label="單元名稱" value={draft.title} maxLength={160} context={{ subject: draft.subject, grade: draft.grade, topic: draft.topic }} onApply={text => update({ title: text })}><input aria-label="發想單元名稱" value={draft.title} maxLength={160} onChange={event => update({ title: event.target.value })} /></FieldAiAssist><label>總節數<input aria-label="發想總節數" value={draft.periods} inputMode="numeric" onChange={event => update({ periods: event.target.value.replace(/[^0-9]/g, '').slice(0, 3) })} /></label></div>
          <FieldAiAssist courseId={draft.id} label="一句構想或學科問題" value={draft.topic} context={{ subject: draft.subject, grade: draft.grade, title: draft.title }} onApply={text => update({ topic: text })}><textarea aria-label="發想學科問題" value={draft.topic} maxLength={20000} onChange={event => update({ topic: event.target.value })} /></FieldAiAssist>
          <FieldAiAssist courseId={draft.id} label="活動構想" value={draft.activityIdea} context={{ subject: draft.subject, grade: draft.grade, topic: draft.topic }} onApply={text => update({ activityIdea: text })}><textarea aria-label="發想活動構想" value={draft.activityIdea} maxLength={20000} placeholder="學生預計做什麼？沒有原文依據可先留空。" onChange={event => update({ activityIdea: event.target.value })} /></FieldAiAssist>
          <FieldAiAssist courseId={draft.id} label="期待學生表現" value={draft.expectedPerformance} context={{ subject: draft.subject, grade: draft.grade, topic: draft.topic }} onApply={text => update({ expectedPerformance: text })}><textarea aria-label="發想期待表現" value={draft.expectedPerformance} maxLength={20000} placeholder="這是課程目標，不是已達成的結果。" onChange={event => update({ expectedPerformance: event.target.value })} /></FieldAiAssist>
          <label>學生背景與需求<textarea aria-label="發想學生背景" value={draft.background} maxLength={20000} placeholder="只填教師已知事實；不蒐集學生姓名。" onChange={event => update({ background: event.target.value })} /></label>
          <FieldAiAssist courseId={draft.id} label="學科知識基礎" value={draft.foundation} context={{ subject: draft.subject, grade: draft.grade, topic: draft.topic }} onApply={text => update({ foundation: text })}><textarea aria-label="發想知識基礎" value={draft.foundation} maxLength={20000} placeholder="現有課程所需的概念、技能或資料閱讀基礎。" onChange={event => update({ foundation: event.target.value })} /></FieldAiAssist>
          <button type="button" disabled={locked || !draft.subject.trim() || !draft.grade.trim() || !draft.topic.trim()} onClick={() => prepare('recommend')}>AI 提單元、節數、課綱與子指標候選</button>
          {suggestions && suggestions.signature === intakeFingerprint(draft) && <div className="field-ai-panel"><h3>發想候選，尚待核對</h3><p><strong>{suggestions.value.title}</strong>・{suggestions.value.periods} 節</p><p>{suggestions.value.reason}</p><p>課綱：{suggestions.value.curriculumIds.map(id => curriculum.find(row => row.id === id)?.code).join('、')}</p><p>子指標：{suggestions.value.indicatorIds.map(id => indicators.entries.find(row => row.id === id)?.name).join('、')}</p><button type="button" onClick={() => { update({ title: suggestions.value.title, periods: String(suggestions.value.periods), curriculumIds: suggestions.value.curriculumIds, indicatorIds: suggestions.value.indicatorIds }); setMessage('候選已填入可編輯發想欄位；請逐項核對。'); }}>帶入可編輯欄位</button></div>}
          <label>已知學生起點<textarea aria-label="發想學生起點" value={draft.startingPoint} maxLength={20000} placeholder="沒有實際資料請留空；AI 不會把假設寫成事實。" onChange={event => update({ startingPoint: event.target.value })} /></label>
          <label>教師補充與待核對假設<textarea aria-label="發想教師註記" value={draft.teacherNotes} maxLength={60000} onChange={event => update({ teacherNotes: event.target.value })} /></label>
          {gaps.length > 0 && <div className="notice"><strong>AI 指出的待補資料</strong><ul>{gaps.map(gap => <li key={gap}>{gap}</li>)}</ul></div>}
        </section>
        <section className="card"><h2>課綱與子指標</h2><p>課綱使用固定的高中條目；選擇關係是教師的設計決定，AI 不會替你確認官方對應。</p>
          <label>搜尋課綱<input aria-label="發想搜尋課綱" value={query} onChange={event => setQuery(event.target.value)} placeholder="輸入學科、代碼或條文關鍵字" /></label>
          <div className="results">{matches.map(row => <button type="button" key={row.id} disabled={draft.curriculumIds.length >= 12} onClick={() => { update({ curriculumIds: [...draft.curriculumIds, row.id] }); setQuery(''); }}>加入 {row.code}<small>{row.subject}・{row.text}</small></button>)}</div>
          {draft.curriculumIds.map(id => { const row = curriculum.find(entry => entry.id === id); return <div className="selected-row" key={id}><span>{row?.code}　{row?.text}</span><button type="button" onClick={() => update({ curriculumIds: draft.curriculumIds.filter(value => value !== id) })}>移除</button></div>; })}
          <label>加入一至兩項 NPDL 子指標<select aria-label="發想子指標" value="" disabled={draft.indicatorIds.length >= 2} onChange={event => { if (event.target.value && !draft.indicatorIds.includes(event.target.value)) update({ indicatorIds: [...draft.indicatorIds, event.target.value] }); }}><option value="">選擇子指標</option>{indicators.entries.filter(row => !draft.indicatorIds.includes(row.id)).map(row => <option key={row.id} value={row.id}>{row.dimension}／{row.name}</option>)}</select></label>
          {draft.indicatorIds.map(id => { const row = indicators.entries.find(entry => entry.id === id); return <div className="selected-row" key={id}><span>{row?.dimension}／{row?.name}</span><button type="button" onClick={() => update({ indicatorIds: draft.indicatorIds.filter(value => value !== id) })}>移除</button></div>; })}
        </section>
        <section className="card"><h2>核對後建立第一版設計</h2><p>AI 只根據你核對的課綱與指標建立待審草稿。原課程保留；生成失敗或不滿意時，這份發想不會消失。</p><div className="actions"><button type="button" disabled={locked} onClick={() => { try { save(reviewIntake(draft)); setMessage('發想、課綱與子指標已核對；可預覽設計請求。'); } catch (error) { setMessage(error instanceof Error ? error.message : '仍有欄位未補齊。'); } }}>核對發想、課綱與子指標</button><button type="button" className="primary" disabled={locked || !draft.reviewedAt || draft.reviewedFingerprint !== intakeFingerprint(draft)} onClick={() => prepare('design')}>預覽 AI 建立設計資料</button></div></section>
        {plan && <section className="card consent-panel" aria-label="AI 傳送資料預覽"><h2>{plan.attempt ? '唯一一次格式修復・再次同意' : '核對這次要傳給 AI 的資料'}</h2><p>送往 {preparedTarget.current.startsWith('gemini:') ? 'generativelanguage.googleapis.com（Google Gemini）' : 'api.openai.com（OpenAI）'}，模型 {preparedTarget.current.split(':').slice(1).join(':')}。請檢查自由文字已去識別；原文內的指令只當資料。每次請求都可能產生費用。</p>{preparedTarget.current !== `${provider}:${model}` && <p role="status">供應商或模型已改，請重新預覽資料。</p>}<textarea aria-label="發想 AI 必要資料" readOnly rows={12} value={JSON.stringify(plan.payload, null, 2)} /><label className="consent-check"><input type="checkbox" checked={approved} disabled={busy} onChange={event => setApproved(event.target.checked)} />我已檢查本次資料、去識別與費用，並同意傳送</label><div className="actions"><button type="button" className="primary" disabled={!approved || busy || preparedTarget.current !== `${provider}:${model}`} onClick={() => { void send(); }}>{busy ? '等待 AI 回應' : '同意並送出'}</button><button type="button" onClick={() => { if (busy) controller.current?.abort(); else { setPlan(null); setApproved(false); } }}>取消</button></div></section>}
        {result && <section className="card ai-result"><h2>AI 回傳的第一版設計</h2><p className="note">尚未採用或確認；原文及發想草稿保留。請核對是否合理，再建立正式專案。</p>{(() => { const design = result.content as DesignContent; return <><p>{design.summary}</p><h3>目標與成功表現</h3>{design.goals.map(goal => <div className="reference" key={goal.id}><strong>{goal.kind === 'academic' ? '學科' : 'NPDL'}：{goal.text}</strong><p>{goal.success}</p></div>)}<h3>規準與活動</h3><p>{design.criteria.length} 項規準；{design.activities.length} 項活動；{design.blueprint.length} 組前後測配對。採用後可逐欄修訂並另存版本。</p><ol>{design.activities.map(activity => <li key={activity.id}>{activity.name}・{activity.periods} 節：{activity.task}</li>)}</ol><details><summary>查看完整結構化設計資料</summary><pre>{JSON.stringify(design, null, 2)}</pre></details></>; })()}<div className="actions"><button type="button" className="primary" onClick={acceptDesign}>採用並建立正式專案</button><button type="button" onClick={() => prepare('design')}>不滿意，再生成設計</button></div></section>}
      </div><aside className="intake-rail"><h3>下一步</h3>{intakeGaps(draft).length ? <><p>先補齊這些欄位：</p><ul>{intakeGaps(draft).map(gap => <li key={gap}>{gap}</li>)}</ul></> : <p>欄位已齊。核對來源、課綱和子指標後，再請 AI 建立設計。</p>}<p className="note">{draft.reviewedAt && draft.reviewedFingerprint === intakeFingerprint(draft) ? '這份發想已核對，仍不是正式設計。' : '任何欄位改動後，都要重新核對。'}</p><details><summary>填寫與 AI 使用提醒</summary><p>學生起點未知時保持未知。規準四階不能由選項序號、答對數或平均分數換算。真實教學與施測由另一個 App 記錄。</p></details></aside></div>
    </>}
  </div>;
}
