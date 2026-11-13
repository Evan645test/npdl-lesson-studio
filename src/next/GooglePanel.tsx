import { useRef, useState } from 'react';
import type { Project } from '../domain/types';
import { buildFormSpec, hasWorksheet, phaseAssessment, type FormKind, type FormPhase } from '../google/formSpec';
import {
  activeClientId, builtInClientId, createdForms, createFolder, createGoogleForm, customClientId, getAccessToken, hasToken, isValidClientId,
  listKnownFolders, pickerApiKey, pickFolder, rememberForm, saveFolder, savedFolder, setCustomClientId, signOut, type CreatedForm, type DriveFolder,
} from '../google/googleApi';

// R42：下載頁的 Google 區塊。教師登入自己的 Google 帳號後，可把學生前後測建成 Google 表單，
// 並把教案、題本、手冊存到自己指定的雲端資料夾。登入權杖只留在本頁記憶體。
export type Destination = 'download' | 'drive';
export interface DriveTarget { destination: Destination; folder: DriveFolder | null; asGoogleDoc: boolean }
export function useDriveTarget() {
  const [destination, setDestination] = useState<Destination>('download');
  const [folder, setFolderState] = useState<DriveFolder | null>(() => savedFolder());
  const [asGoogleDoc, setAsGoogleDoc] = useState(false);
  const setFolder = (value: DriveFolder | null) => { saveFolder(value); setFolderState(value); if (!value) setDestination('download'); };
  return { target: { destination, folder, asGoogleDoc } as DriveTarget, setDestination, setFolder, setAsGoogleDoc };
}

const describe = (error: unknown) => error instanceof Error ? error.message : String(error);

export function GooglePanel({ project, blocks, drive }: {
  project: Project;
  blocks: Record<FormPhase, string>;
  drive: ReturnType<typeof useDriveTarget>;
}) {
  const [connected, setConnected] = useState(hasToken());
  const [busy, setBusy] = useState(false);
  // 用 ref 立即上鎖：連點時 state 還沒重繪，兩次點擊會同時建立表單或資料夾。
  const lock = useRef(false);
  const [status, setStatus] = useState('');
  const [newName, setNewName] = useState('深學備課室');
  const [known, setKnown] = useState<DriveFolder[] | null>(null);
  const [forms, setForms] = useState<Record<string, CreatedForm>>(() => createdForms());
  const [clientDraft, setClientDraft] = useState(customClientId());
  const [, setClientVersion] = useState(0);
  const clientId = activeClientId();
  const { target, setDestination, setFolder, setAsGoogleDoc } = drive;

  async function run(label: string, task: () => Promise<string | void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setStatus(label + '…');
    try { const done = await task(); setConnected(hasToken()); setStatus(done || ''); }
    catch (error) { setConnected(hasToken()); setStatus(label + '未完成：' + describe(error)); }
    finally { lock.current = false; setBusy(false); }
  }
  const connect = () => run('連結 Google 帳號', async () => { await getAccessToken(true); return '已連結 Google 帳號（只在這個分頁有效，關閉或重新整理後需再連結）。'; });
  const disconnect = () => { signOut(); setConnected(false); setKnown(null); setStatus('已中斷 Google 連結，本頁不再保留登入權杖。'); };
  const choose = () => run('選擇雲端資料夾', async () => {
    const picked = await pickFolder();
    if (!picked) return '已取消選擇資料夾。';
    setFolder(picked); setDestination('drive');
    return `之後的檔案會存到「${picked.name}」。`;
  });
  const create = () => run('建立雲端資料夾', async () => {
    const folder = await createFolder(newName);
    setFolder(folder); setDestination('drive');
    return `已在「我的雲端硬碟」建立「${folder.name}」，之後的檔案會存到這裡。`;
  });
  const loadKnown = () => run('讀取資料夾', async () => { const list = await listKnownFolders(); setKnown(list); return list.length ? '' : '還沒有本工具可以使用的資料夾，請建立新資料夾或從雲端硬碟選擇。'; });
  const LABEL: Record<FormKind, string> = { pre: '前測', post: '後測', worksheet: '課堂學習單' };
  const recordKey = (kind: FormKind) => { const a = phaseAssessment(project, kind === 'post' ? 'post' : 'pre'); return kind === 'worksheet' ? a.id + ':worksheet' : a.id; };
  const makeForm = (kind: FormKind) => run(`建立${LABEL[kind]} Google 表單`, async () => {
    const spec = buildFormSpec(project, kind);
    const key = recordKey(kind);
    const form = await createGoogleForm(spec, target.folder, step => setStatus(step));
    rememberForm(key, form);
    setForms(createdForms());
    const where = form.folderMoved ? `，已放進「${target.folder?.name}」` : form.folderMoved === false ? '，但沒能移進指定資料夾（留在我的雲端硬碟）' : '';
    return `「${spec.title}」已建立並開放作答${where}。請先打開編輯頁核對題目，再把作答連結給學生。`;
  });
  const saveClient = () => {
    try { setCustomClientId(clientDraft); signOut(); setConnected(false); setClientVersion(v => v + 1); setStatus(clientDraft.trim() ? '已改用自訂的 Google 用戶端 ID（只存在這台電腦的瀏覽器）。' : '已改回網站預設設定。'); }
    catch (error) { setStatus(describe(error)); }
  };

  const formFor = (kind: FormKind): { id: string; form?: CreatedForm } | null => {
    try { const key = recordKey(kind); return { id: key, form: forms[key] }; } catch { return null; }
  };
  const kinds: FormKind[] = hasWorksheet(project) ? ['pre', 'post', 'worksheet'] : ['pre', 'post'];

  return <div className="sp-google" aria-label="Google 表單與雲端資料夾">
    <h3>Google 表單與雲端資料夾</h3>
    <p className="note">用你自己的 Google 帳號登入後，可以把學生前測、後測直接建成 Google 表單，也可以把下面的檔案存到你指定的雲端資料夾。本工具只能使用它建立的檔案和你選的資料夾，看不到雲端硬碟裡的其他檔案；登入只在這個分頁有效。</p>
    <p className="sp-export-announcement" role="status">{status}</p>
    {!clientId ? <p className="notice">這個網站還沒設定 Google 登入用的用戶端 ID，暫時無法連結。網站管理者可依「Google 連結設定」說明設定；也可以在下方「進階設定」貼上自己學校的用戶端 ID。</p>
      : <div className="actions">
        {connected ? <><span className="sp-google-state">已連結 Google 帳號</span><button type="button" onClick={disconnect} disabled={busy}>中斷連結</button></>
          : <button type="button" className="primary" onClick={connect} disabled={busy}>登入 Google 帳號</button>}
      </div>}

    {clientId && <>
      <div className="sp-google-block">
        <h4>學生前後測 → Google 表單</h4>
        <p className="note">表單內容與學生題本相同，不含答案、階段或判讀錨點；不收集 Email，學生只填班級代號與座號。每按一次會建立一份新表單。</p>
        <div className="sp-downloads sp-phase-downloads">
          {kinds.map(phase => {
            const label = LABEL[phase], info = formFor(phase), block = blocks[phase === 'worksheet' ? 'pre' : phase];
            return <div key={phase}><h5>{phase === 'worksheet' ? '課堂學習單（上課時填）' : '學生' + label}</h5>
              {block ? <p className="note">{block}</p> : null}
              <div className="actions"><button type="button" disabled={busy || !!block} onClick={() => void makeForm(phase)}>{info?.form ? `再建立一份${label}表單` : `建立${label} Google 表單`}</button></div>
              {info?.form && <p className="note">已建立（{new Date(info.form.createdAt).toLocaleString('zh-TW')}）：<a href={info.form.editUrl} target="_blank" rel="noreferrer">開啟編輯頁</a>{info.form.responderUri && <>｜<a href={info.form.responderUri} target="_blank" rel="noreferrer">學生作答連結</a></>}</p>}
            </div>;
          })}
        </div>
      </div>

      <div className="sp-google-block">
        <h4>檔案存放位置</h4>
        <fieldset className="sp-google-destination"><legend>按下下方 PDF／Word 按鈕時</legend>
          <label><input type="radio" name="sp-destination" checked={target.destination === 'download'} onChange={() => setDestination('download')} /> 下載到這台電腦</label>
          <label><input type="radio" name="sp-destination" checked={target.destination === 'drive'} disabled={!target.folder} onChange={() => setDestination('drive')} /> 存到 Google 雲端資料夾{target.folder ? `「${target.folder.name}」` : '（請先選資料夾）'}</label>
          {target.destination === 'drive' && <label><input type="checkbox" checked={target.asGoogleDoc} onChange={event => setAsGoogleDoc(event.target.checked)} /> Word 檔轉成 Google 文件（PDF 不轉換）</label>}
        </fieldset>
        <div className="actions">
          {pickerApiKey() && <button type="button" disabled={busy} onClick={() => void choose()}>從雲端硬碟選擇資料夾</button>}
          <button type="button" disabled={busy} onClick={() => void loadKnown()}>使用本工具建立過的資料夾</button>
          {target.folder && <button type="button" disabled={busy} onClick={() => { setFolder(null); setStatus('已取消指定資料夾，檔案改為下載到這台電腦。'); }}>不使用雲端資料夾</button>}
        </div>
        {known && known.length > 0 && <div className="actions" aria-label="本工具建立過的資料夾">{known.map(folder => <button type="button" key={folder.id} aria-pressed={target.folder?.id === folder.id} onClick={() => { setFolder(folder); setDestination('drive'); setStatus(`之後的檔案會存到「${folder.name}」。`); }}>{folder.name}</button>)}</div>}
        <div className="sp-google-new"><label>新資料夾名稱<input value={newName} maxLength={200} onChange={event => setNewName(event.target.value)} /></label><button type="button" disabled={busy || !newName.trim()} onClick={() => void create()}>在我的雲端硬碟建立新資料夾</button></div>
        {!pickerApiKey() && <p className="note">網站尚未設定 Google 資料夾選擇器，目前只能建立新資料夾，或使用本工具建立過的資料夾；建立後可在 Google 雲端硬碟把它移到任何位置。</p>}
        {target.folder && <p className="note">目前資料夾：<a href={`https://drive.google.com/drive/folders/${encodeURIComponent(target.folder.id)}`} target="_blank" rel="noreferrer">{target.folder.name}</a>。新建立的 Google 表單也會放進這個資料夾。</p>}
      </div>
    </>}

    <details className="sp-google-advanced"><summary>進階設定：自訂 Google 用戶端 ID</summary>
      <p className="note">網站預設{builtInClientId() ? '已設定' : '尚未設定'}用戶端 ID。學校若有自己的 Google Cloud 專案，可貼上「網頁應用程式」類型的用戶端 ID（不是密碼）；只存在這台電腦的瀏覽器。留白則使用網站預設。</p>
      <div className="sp-google-new"><label>用戶端 ID<input value={clientDraft} placeholder="123456789012-xxxx.apps.googleusercontent.com" onChange={event => setClientDraft(event.target.value)} aria-invalid={!!clientDraft.trim() && !isValidClientId(clientDraft)} /></label><button type="button" onClick={saveClient}>儲存</button></div>
    </details>
  </div>;
}
