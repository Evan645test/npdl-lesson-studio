import { useEffect, useRef, useState } from 'react';
import { createSeed } from './data/seed';
import type { Activity, CourseInput, DesignVersion, LegacyImport, Workspace } from './domain/types';
import { inputSignature, validateWorkspace } from './domain/validate';
import { reviseActivity } from './domain/revisions';
import { buildPrompt } from './documents/prompt';
import { importCopies, loadWorkspace, MAX_BACKUP_BYTES, parseBackup, saveWorkspace, storageKey, type Store } from './storage/workspace';
import { createLegacyImport } from './storage/legacy';
import { reviseDesignContent } from './components/courseDraft';
import { ActivitiesPanel } from './components/ActivitiesPanel';
import { AssessmentReview } from './components/AssessmentReview';
import { DeliveryPanel } from './components/DeliveryPanel';
import { CourseStart } from './components/CourseStart';
import { CourseStatus } from './components/CourseStatus';
import { R03Tools } from './components/R03Tools';
import { GoalsPanel } from './components/GoalsPanel';
import { LegacyLibrary } from './components/LegacyLibrary';
import { IntakePanel } from './next/IntakePanel';
import { HelpPage } from './next/HelpPage';
import { DesignFieldEditor } from './next/DesignFieldEditor';
import { AiSetupPanel } from './next/AiSetupPanel';

const browserStore: Store = { getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value) };
const tabs = ['課程與起點', '目標與規準', '活動與鷹架', '前測', '後測三部分', '文件匯出', '使用說明'] as const;
type Tab = typeof tabs[number];

function download(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type })), anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function App() {
  const key = storageKey(location.pathname);
  const [initial] = useState(() => loadWorkspace(browserStore, key));
  const [workspace, setWorkspace] = useState<Workspace>(initial.workspace);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const raw = useRef(initial.raw);
  const [locked, setLocked] = useState(!!initial.error);
  const [message, setMessage] = useState(initial.error ?? (initial.raw === null ? '人工設計範例已載入；修改後會保存在本機瀏覽器。' : '已載入此瀏覽器的工作區；修改後會保存在本機。'));
  const [tab, setTab] = useState<Tab>('課程與起點');
  const [view, setView] = useState<'intake' | 'project'>('intake');
  const project = workspace.projects.find(item => item.id === workspace.activeProjectId)!;
  const design = project.designs.find(item => item.id === project.activeDesignId)!;
  const pre = project.assessments.find(item => item.id === project.activePreId);
  const post = project.assessments.find(item => item.id === project.activePostId);
  const prompt = buildPrompt(project);
  const stale = inputSignature(project.input) !== inputSignature(design.inputSnapshot);
  const assessmentStale = pre?.designId !== design.id;
  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === key) { setLocked(true); setMessage('其他分頁已變更工作區。本頁編輯保留，請下載備份，再重載核對。'); } };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key]);
  function commit(next: Workspace, success = '已保存在此瀏覽器；可下載備份。'): boolean {
    try {
      const checked = validateWorkspace(next);
      setWorkspace(checked);
      if (locked) { setMessage('本頁編輯已保留，儲存仍受保護；請下載備份再重載核對。'); return false; }
      const result = saveWorkspace(browserStore, key, checked, raw.current);
      raw.current = result.raw;
      setMessage(result.error ?? success);
      if (result.error) setLocked(true);
      return !result.error;
    } catch (error) { setMessage(`未套用修改：${error instanceof Error ? error.message : String(error)}`); return false; }
  }
  function updateInput(nextInput: CourseInput) {
    commit({ ...workspace, projects: workspace.projects.map(item => item.id === project.id ? { ...item, input: { ...nextInput, indicatorReview: { signature: '', confirmedAt: null } } } : item) }, '輸入草稿已保存。設計快照與題組維持原版。');
  }
  function saveGoals(goals: DesignVersion['goals']) {
    try {
      const next = reviseDesignContent(workspace, project.id, current => {
        current.goals = current.goals.map(goal => {
          const replacement = goals.find(item => item.id === goal.id);
          return replacement ? { ...goal, text: replacement.text, success: replacement.success } : goal;
        });
      }, '教師修訂目標與成功表現草稿；前後測仍引用原設計，需重新核對。');
      commit(next, '已另存目標草稿。前後測仍引用原設計。');
      return true;
    } catch (error) { setMessage(`未套用修改：${error instanceof Error ? error.message : String(error)}`); return false; }
  }
  function saveTask(activityId: string, task: string) {
    try { commit(reviseActivity(workspace, project.id, activityId, task), '已另存新設計草稿；原題組仍參照原版。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  }
  function saveScaffolds(activityId: string, scaffolds: Activity['scaffolds']) {
    try {
      if (scaffolds.some(item => !item.support.trim() || !item.fading.trim())) throw new Error('支援與撤去條件不可空白。');
      const next = reviseDesignContent(workspace, project.id, current => {
        const activity = current.activities.find(item => item.id === activityId);
        if (!activity) throw new Error('活動不存在。');
        activity.scaffolds = activity.scaffolds.map(item => {
          const replacement = scaffolds.find(candidate => candidate.stage === item.stage);
          return replacement ? { ...item, support: replacement.support.trim(), fading: replacement.fading.trim() } : item;
        });
      }, '教師修訂四階鷹架草稿；前後測仍引用原設計，需重新核對。');
      commit(next, '已另存鷹架草稿。前後測仍引用原設計。');
    } catch (error) { setMessage(`未套用修改：${error instanceof Error ? error.message : String(error)}`); }
  }
  async function importFile(file: File | undefined) {
    if (!file) return;
    try {
      if (locked) throw new Error('目前儲存受保護，請先下載備份並重載核對。');
      if (file.size > MAX_BACKUP_BYTES) throw new Error('備份超過8MB。');
      const before = workspaceRef.current;
      const beforeRaw = raw.current;
      const text = await file.text();
      let parsed: unknown;
      try { parsed = JSON.parse(text.replace(/^\uFEFF/, '')); }
      catch { throw new Error('備份不是完整 JSON。'); }
      const looksNew = !!parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'schemaVersion' in parsed && 'projects' in parsed;
      const legacy = looksNew ? null : await createLegacyImport(text, file.name);
      if (workspaceRef.current !== before || raw.current !== beforeRaw) throw new Error('讀取備份時本頁工作區已改變；請重新選取檔案，避免覆蓋新編輯。');
      const next = looksNew
        ? importCopies(before, parseBackup(text))
        : validateWorkspace({ ...before, legacyImports: [...(before.legacyImports ?? []), legacy!] });
      if (new TextEncoder().encode(JSON.stringify(next)).length > MAX_BACKUP_BYTES) throw new Error('轉入後工作區將超過 8MB；尚未修改，請改用較小的備份。');
      commit(next, looksNew ? '新版備份已轉入新副本；原專案及版本保留。' : '舊備份已保留為原始副本，待教師核對；沒有換算舊題型或結果。');
    } catch (error) { setMessage(`未轉入：${error instanceof Error ? error.message : String(error)}。原工作區保留。`); }
  }
  function resetProtected() {
    if (!window.confirm('請先下載原儲存內容。確認後會把原內容另存保護副本，並在本輪工作區載入新的人工範例。')) return;
    try {
      const previous = browserStore.getItem(key);
      if (previous !== null) browserStore.setItem(`${key}:recovery:${Date.now()}`, previous);
      const fresh = validateWorkspace(createSeed());
      const result = saveWorkspace(browserStore, key, fresh, previous);
      if (result.error) throw new Error(result.error);
      raw.current = result.raw;
      setWorkspace(fresh);
      setLocked(false);
      setMessage('已另存原內容保護副本，重新載入人工範例。');
    } catch (error) { setMessage(`未重新建立：${error instanceof Error ? error.message : String(error)}。請保留下載備份。`); }
  }
  function downloadLegacy(item: LegacyImport) { download(`舊備份原始副本-${item.id}.json`, item.raw); }
  const progress = [!!project.input.indicatorReview?.confirmedAt, !!design.confirmedAt, !!pre?.reviewedAt, !!post?.reviewedAt];
  const nextTab: Tab = !progress[0] ? '課程與起點' : !progress[1] ? '目標與規準' : !progress[2] ? '前測' : !progress[3] ? '後測三部分' : '文件匯出';
  return <div className="app"><header className="topbar"><a className="brand" href="#main"><span className="brand-mark">深</span><span>深學備課室<small>教師設計工作台・R08-r2 預覽</small></span></a><span className="edition">從課程構想，走到可核對的學習證據。</span><button type="button" onClick={() => { setView(view === 'intake' ? 'project' : 'intake'); setTab('課程與起點'); }}>{view === 'intake' ? '已有專案' : '新課程／已有課程'}</button></header><AiSetupPanel />
    {view === 'intake' ? <main id="main" className="intake-page"><IntakePanel workspace={workspace} workspaceKey={key} onCreate={next => { const ok = commit(next, '新專案已建立；AI 設計尚待教師核對。'); if (ok) { setView('project'); setTab('課程與起點'); } return ok; }} onOpenProject={() => setView('project')} /><footer>本版只處理課程設計與未施測題組；真實 AI 品質由教師以自己的金鑰試看。</footer></main> :
    <div className="layout"><aside><div className="eyebrow">這次的備課</div><h2>{project.input.title}</h2><p>{project.input.grade}<br/>{project.input.subject}・{project.input.periods} 節</p><nav aria-label="備課導覽">{tabs.map((item, index) => <button type="button" key={item} aria-current={tab === item ? 'page' : undefined} onClick={() => setTab(item)}><span>{String(index + 1).padStart(2, '0')}</span>{item}</button>)}</nav><div className="aside-note"><strong>先目標，再活動</strong><p>前後測能力、課程應用與自評分開；形成性觀察只作教學回饋。</p></div></aside>
    <main id="main"><div className="toolbar"><label className="project-select">工作區<select aria-label="工作區專案" value={project.id} onChange={event => commit({ ...workspace, activeProjectId: event.target.value })}>{workspace.projects.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.input.title}</option>)}</select></label><div className="actions"><button type="button" onClick={() => download('深學備課室-R08-r2-備份.json', JSON.stringify(workspace, null, 2))}>下載備份</button><label className="button">轉入備份副本<input aria-label="轉入備份檔案" type="file" accept=".json,application/json" onChange={event => { void importFile(event.target.files?.[0]); event.target.value = ''; }} /></label></div></div>
    {tab !== '使用說明' && <section className="progress-strip" aria-label="備課進度"><div><span className="eyebrow">目前進度</span><strong>{progress.filter(Boolean).length}／4 項核對完成</strong></div><div className="progress-meter"><span style={{ width: `${progress.filter(Boolean).length * 25}%` }} /></div><button type="button" onClick={() => setTab(nextTab)}>下一步：{nextTab}</button></section>}
    <p role="status" className={message.includes('未') || locked ? 'status warning' : 'status'}>{message}</p>
    {locked && <div className="notice"><p>原儲存內容受保護，編輯只留在本頁。先下載備份再重載核對。</p><button type="button" onClick={() => download('原儲存內容.txt', raw.current ?? '', 'text/plain')}>下載原儲存內容</button><button type="button" onClick={resetProtected}>另存原內容並載入新範例</button></div>}
    {stale && <p className="notice">課程輸入已修改，現有設計仍保留原起點快照，需重新核對後採用。請核對起點、課綱與子指標後另生成新版設計。</p>}
    {assessmentStale && <p className="notice">目前查看的是新設計草稿；前後測與提示詞仍依原設計快照，待核對。原題組沒有被改寫。</p>}
    {tab !== '使用說明' && <><LegacyLibrary imports={workspace.legacyImports ?? []} onDownload={downloadLegacy} />
    <R03Tools workspace={workspace} onCommit={commit} onMessage={setMessage} locked={locked} />
    <CourseStatus project={project} design={design} input={project.input} pre={pre} post={post} tab={tab} onTab={setTab} /></>}
    {tab === '課程與起點' && <CourseStart input={project.input} onInput={updateInput} onError={text => setMessage(`未套用修改：${text}`)} onShowGoals={() => setTab('目標與規準')} />}
    {tab === '目標與規準' && <><GoalsPanel design={design} onSave={saveGoals} onError={text => setMessage(`未套用修改：${text}`)} onShowActivities={() => setTab('活動與鷹架')} /><DesignFieldEditor workspace={workspace} projectId={project.id} design={design} onCommit={commit} onMessage={setMessage} locked={locked} /></>}
    {tab === '活動與鷹架' && <><ActivitiesPanel project={project} design={design} onSelectDesign={id => commit({ ...workspace, projects: workspace.projects.map(item => item.id === project.id ? { ...item, activeDesignId: id } : item) }, '已切換設計版本。題組仍引用原快照。')} onSaveTask={saveTask} onSaveScaffolds={saveScaffolds} /><DesignFieldEditor workspace={workspace} projectId={project.id} design={design} onCommit={commit} onMessage={setMessage} locked={locked} /></>}
    {tab === '前測' && <AssessmentReview phase="pre" workspace={workspace} project={project} onCommit={commit} onMessage={setMessage} locked={locked} message={message} />}
    {tab === '後測三部分' && <AssessmentReview phase="post" workspace={workspace} project={project} onCommit={commit} onMessage={setMessage} locked={locked} message={message} />}
    {tab === '文件匯出' && <><div className="eyebrow">教師整理去識別資料後自行使用</div><h1>確認內容，帶走文件</h1><p>學生題本與教師手冊引用所選題組的原設計快照。此處不登錄已施測，也不產生學生結果。</p><DeliveryPanel project={project} onMessage={setMessage} /><details><summary>展開教師判讀提示詞</summary><p>提示詞包含題組、逐選項支持與限制、四階規準與比較條件。教師需自行附去識別資料與真實施測條件。</p><div className="actions"><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(prompt); setMessage('完整提示詞已複製，請在外部 AI 使用前核對資料。'); } catch { setMessage('未能直接複製；可下載或從文字框複製。'); } }}>複製提示詞</button><button type="button" onClick={() => download('R08-r2-教師判讀提示詞.txt', prompt, 'text/plain;charset=utf-8')}>下載提示詞</button></div><textarea className="prompt" aria-label="完整教師判讀提示詞" value={prompt} readOnly rows={18} /></details></>}
    {tab === '使用說明' && <HelpPage />}
    <footer>R08-r2 預覽・設計、題組與文件待教師核對。沒有學生上傳或自動判級；真實 AI 品質尚待使用者以自有金鑰試看。</footer></main></div>}
  </div>;
}
