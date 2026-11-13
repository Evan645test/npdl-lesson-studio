import type { FormEntry, FormSpec } from './formSpec';

// R42：教師在瀏覽器以自己的 Google 帳號授權（Google Identity Services token model）。
// 存取權杖只留在本頁記憶體，不寫入工作區、備份或 localStorage；用戶端 ID 與 Picker 金鑰是公開設定，不是密碼。
// 權限只要 forms.body（建立表單）與 drive.file（只能碰本工具建立或教師選定的檔案與資料夾）。
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/forms.body', 'https://www.googleapis.com/auth/drive.file'];
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const GAPI_SRC = 'https://apis.google.com/js/api.js';
const CLIENT_ID_KEY = 'npdl_next_google_client_id';
const FOLDER_KEY = 'npdl_next_google_folder_v1';
const FORMS_KEY = 'npdl_next_google_forms_v1';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const CLIENT_ID_PATTERN = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global { interface Window { google?: any; gapi?: any } }

export interface DriveFolder { id: string; name: string }
export interface CreatedForm { formId: string; editUrl: string; responderUri: string; createdAt: number; folderId?: string; folderMoved?: boolean }
export interface UploadedFile { id: string; name: string; webViewLink: string }

const store = (): Storage | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const readJson = <T,>(key: string, fallback: T): T => { try { const raw = store()?.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } };
const writeJson = (key: string, value: unknown) => { try { store()?.setItem(key, JSON.stringify(value)); } catch { /* 瀏覽器不允許保存時只在本頁有效 */ } };

export function isValidClientId(value: string) { return CLIENT_ID_PATTERN.test(value.trim()); }
export function builtInClientId(): string { return (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim(); }
export function pickerApiKey(): string { return (import.meta.env.VITE_GOOGLE_PICKER_API_KEY ?? '').trim(); }
export function customClientId(): string { try { return store()?.getItem(CLIENT_ID_KEY)?.trim() ?? ''; } catch { return ''; } }
export function setCustomClientId(value: string) {
  const id = value.trim();
  if (id && !isValidClientId(id)) throw new Error('用戶端 ID 格式應為「數字-英數.apps.googleusercontent.com」。');
  try { if (id) store()?.setItem(CLIENT_ID_KEY, id); else store()?.removeItem(CLIENT_ID_KEY); } catch { /* ignore */ }
}
export function activeClientId(): string { return customClientId() || builtInClientId(); }
/** Picker 的 appId 是 Google Cloud 專案編號，即用戶端 ID 開頭的數字。 */
export function projectNumber(clientId: string): string { return clientId.match(/^(\d+)-/)?.[1] ?? ''; }

export function savedFolder(): DriveFolder | null {
  const value = readJson<DriveFolder | null>(FOLDER_KEY, null);
  return value && typeof value.id === 'string' && typeof value.name === 'string' ? value : null;
}
export function saveFolder(folder: DriveFolder | null) { if (folder) writeJson(FOLDER_KEY, folder); else { try { store()?.removeItem(FOLDER_KEY); } catch { /* ignore */ } } }
export function createdForms(): Record<string, CreatedForm> { return readJson<Record<string, CreatedForm>>(FORMS_KEY, {}); }
export function rememberForm(assessmentId: string, form: CreatedForm) { writeJson(FORMS_KEY, { ...createdForms(), [assessmentId]: form }); }

const scripts = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  const cached = scripts.get(src);
  if (cached) return cached;
  const task = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src; script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { scripts.delete(src); script.remove(); reject(new Error('無法載入 Google 登入元件，請確認網路或關閉阻擋第三方腳本的外掛。')); };
    document.head.append(script);
  });
  scripts.set(src, task);
  return task;
}

let token: { value: string; expiresAt: number; clientId: string } | null = null;
export function hasToken() { return !!token && token.expiresAt > Date.now() + 60_000 && token.clientId === activeClientId(); }

/** 第一次會跳出 Google 帳號與權限視窗；本頁之後在權杖到期前直接沿用。必須在按鈕點擊中呼叫，避免被擋彈出視窗。 */
export async function getAccessToken(forcePrompt = false): Promise<string> {
  const clientId = activeClientId();
  if (!clientId) throw new Error('這個網站尚未設定 Google 用戶端 ID，請看「Google 連結設定」。');
  if (!forcePrompt && hasToken()) return token!.value;
  await loadScript(GIS_SRC);
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new Error('Google 登入元件尚未就緒，請再按一次。');
  return new Promise<string>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => finish(new Error('Google 授權逾時，請再按一次並完成登入。')), 180_000);
    function finish(result: Error | string) {
      if (done) return; done = true; clearTimeout(timer);
      if (typeof result === 'string') resolve(result); else reject(result);
    }
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SCOPES.join(' '),
      callback: (response: { access_token?: string; expires_in?: number | string; error?: string; error_description?: string }) => {
        if (!response.access_token) { finish(new Error(response.error === 'access_denied' ? '已取消 Google 授權。' : 'Google 授權未完成：' + (response.error_description || response.error || '未知原因'))); return; }
        if (!oauth2.hasGrantedAllScopes(response, ...GOOGLE_SCOPES)) { finish(new Error('需要同時勾選「Google 表單」與「Google 雲端硬碟檔案」兩項權限，請再按一次並全部勾選。')); return; }
        token = { value: response.access_token, expiresAt: Date.now() + Number(response.expires_in ?? 3600) * 1000, clientId };
        finish(response.access_token);
      },
      error_callback: (error: { type?: string }) => finish(new Error(error?.type === 'popup_failed_to_open' ? '瀏覽器擋住了 Google 登入視窗，請允許此網站的彈出式視窗後再試。' : '已關閉 Google 登入視窗。')),
    });
    try { client.requestAccessToken({ prompt: forcePrompt ? 'consent' : '' }); } catch { finish(new Error('無法開啟 Google 登入視窗。')); }
  });
}

export function signOut() {
  const current = token; token = null;
  if (current) try { window.google?.accounts?.oauth2?.revoke(current.value, () => undefined); } catch { /* 已在本頁清除 */ }
}

async function googleFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const access = await getAccessToken();
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${access}`, ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) } });
  const text = await response.text();
  if (!response.ok) {
    if (response.status === 401) token = null;
    let detail = '';
    try { detail = JSON.parse(text)?.error?.message ?? ''; } catch { detail = text.slice(0, 200); }
    throw new Error(googleProblem(response.status, detail));
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export function googleProblem(status: number, detail: string): string {
  if (status === 401) return 'Google 登入已過期，請重新連結 Google 帳號。';
  if (status === 403 && /has not been used|is disabled|SERVICE_DISABLED/i.test(detail)) return '網站的 Google Cloud 專案尚未啟用 Forms API 或 Drive API，請網站管理者依設定說明啟用。';
  if (status === 403) return 'Google 拒絕這次操作（權限不足）。若是學校帳號，可能是學校管理員限制了第三方應用程式。' + (detail ? `（${detail}）` : '');
  if (status === 404) return '找不到指定的雲端資料夾或檔案；本工具只能使用你在選擇器中選取、或由本工具建立的資料夾，請重新選擇資料夾。';
  if (status === 429) return 'Google 暫時限制請求次數，請稍後再試。';
  return `Google 回應錯誤（${status}）` + (detail ? `：${detail}` : '。');
}

// ---- Google 表單 ----
export function formRequests(spec: FormSpec): object[] {
  const requests: object[] = [{ updateFormInfo: { info: { title: spec.title, description: spec.description }, updateMask: 'description' } }];
  spec.entries.forEach((entry, index) => requests.push({ createItem: { item: formItem(entry), location: { index } } }));
  return requests;
}
function formItem(entry: FormEntry): object {
  const head = { title: entry.title, ...(entry.description ? { description: entry.description } : {}) };
  switch (entry.kind) {
    case 'section': return { ...head, pageBreakItem: {} };
    case 'text': return { ...head, textItem: {} };
    case 'choice': return { ...head, questionItem: { question: { required: !!entry.required, choiceQuestion: { type: 'RADIO', options: entry.options.map(value => ({ value })) } } } };
    case 'paragraph': return { ...head, questionItem: { question: { required: !!entry.required, textQuestion: { paragraph: true } } } };
    case 'short': return { ...head, questionItem: { question: { required: !!entry.required, textQuestion: { paragraph: false } } } };
  }
}

export async function createGoogleForm(spec: FormSpec, folder: DriveFolder | null, onStep: (text: string) => void = () => undefined): Promise<CreatedForm> {
  onStep('建立表單…');
  const created = await googleFetch<{ formId?: string; responderUri?: string }>('https://forms.googleapis.com/v1/forms', { method: 'POST', body: JSON.stringify({ info: { title: spec.title, documentTitle: spec.title } }) });
  if (!created.formId) throw new Error('Google 沒有回傳表單編號。');
  const id = encodeURIComponent(created.formId);
  onStep('寫入題目…');
  await googleFetch(`https://forms.googleapis.com/v1/forms/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: formRequests(spec) }) });
  const current = await googleFetch<{ responderUri?: string; settings?: { emailCollectionType?: string } }>(`https://forms.googleapis.com/v1/forms/${id}`);
  if (current.settings?.emailCollectionType && current.settings.emailCollectionType !== 'DO_NOT_COLLECT') {
    await googleFetch(`https://forms.googleapis.com/v1/forms/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ updateSettings: { settings: { emailCollectionType: 'DO_NOT_COLLECT' }, updateMask: 'emailCollectionType' } }] }) });
  }
  onStep('開放作答…');
  await googleFetch(`https://forms.googleapis.com/v1/forms/${id}:setPublishSettings`, { method: 'POST', body: JSON.stringify({ publishSettings: { publishState: { isPublished: true, isAcceptingResponses: true } }, updateMask: 'publishState' }) });
  const result: CreatedForm = { formId: created.formId, editUrl: `https://docs.google.com/forms/d/${created.formId}/edit`, responderUri: current.responderUri ?? created.responderUri ?? '', createdAt: Date.now() };
  if (folder) {
    onStep('移到指定資料夾…');
    try { await moveIntoFolder(created.formId, folder.id); result.folderId = folder.id; result.folderMoved = true; }
    catch { result.folderMoved = false; }
  }
  return result;
}

// ---- Google 雲端硬碟 ----
async function moveIntoFolder(fileId: string, folderId: string) {
  const id = encodeURIComponent(fileId);
  const file = await googleFetch<{ parents?: string[] }>(`https://www.googleapis.com/drive/v3/files/${id}?fields=parents&supportsAllDrives=true`);
  const params = new URLSearchParams({ addParents: folderId, supportsAllDrives: 'true', fields: 'id' });
  const remove = (file.parents ?? []).filter(p => p !== folderId).join(',');
  if (remove) params.set('removeParents', remove);
  await googleFetch(`https://www.googleapis.com/drive/v3/files/${id}?${params}`, { method: 'PATCH', body: '{}' });
}

export async function createFolder(name: string): Promise<DriveFolder> {
  const title = name.trim().slice(0, 200);
  if (!title) throw new Error('請輸入資料夾名稱。');
  const created = await googleFetch<{ id: string; name: string }>('https://www.googleapis.com/drive/v3/files?fields=id,name', { method: 'POST', body: JSON.stringify({ name: title, mimeType: FOLDER_MIME }) });
  return { id: created.id, name: created.name };
}

/** drive.file 權限只看得到本工具建立或教師選過的資料夾。 */
export async function listKnownFolders(): Promise<DriveFolder[]> {
  const q = encodeURIComponent(`mimeType='${FOLDER_MIME}' and trashed=false`);
  const result = await googleFetch<{ files?: DriveFolder[] }>(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&orderBy=modifiedTime desc&pageSize=50&supportsAllDrives=true&includeItemsFromAllDrives=true`);
  return result.files ?? [];
}

export async function uploadToDrive(name: string, blob: Blob, folder: DriveFolder, asGoogleDoc: boolean): Promise<UploadedFile> {
  const safe = name.replace(/[\\/:*?"<>|\u0000-\u001F]/g, '-');
  const convert = asGoogleDoc && /\.docx$/i.test(safe);
  const metadata = { name: convert ? safe.replace(/\.docx$/i, '') : safe, parents: [folder.id], ...(convert ? { mimeType: 'application/vnd.google-apps.document' } : {}) };
  const body = new FormData();
  body.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  body.append('file', blob, safe);
  return googleFetch<UploadedFile>('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink&supportsAllDrives=true', { method: 'POST', body });
}

/** Google Picker：讓教師從自己的雲端硬碟（含共用雲端硬碟）選一個資料夾；選取後本工具才有權限寫入該資料夾。 */
export async function pickFolder(): Promise<DriveFolder | null> {
  const apiKey = pickerApiKey(), clientId = activeClientId();
  if (!apiKey) throw new Error('這個網站尚未設定 Google Picker 金鑰，請改用「建立新資料夾」。');
  const access = await getAccessToken();
  await loadScript(GAPI_SRC);
  await new Promise<void>((resolve, reject) => window.gapi?.load ? window.gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('無法載入 Google 資料夾選擇器。')) }) : reject(new Error('無法載入 Google 資料夾選擇器。')));
  const picker = window.google?.picker;
  if (!picker) throw new Error('Google 資料夾選擇器尚未就緒，請再按一次。');
  return new Promise<DriveFolder | null>(resolve => {
    const mine = new picker.DocsView(picker.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes(FOLDER_MIME).setOwnedByMe(true);
    const shared = new picker.DocsView(picker.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes(FOLDER_MIME).setEnableDrives(true);
    new picker.PickerBuilder()
      .setTitle('選擇要存放備課文件的資料夾')
      .setLocale('zh-TW')
      .addView(mine).addView(shared)
      .setOAuthToken(access).setDeveloperKey(apiKey).setAppId(projectNumber(clientId))
      .enableFeature(picker.Feature.SUPPORT_DRIVES)
      .setCallback((data: { action?: string; docs?: { id: string; name: string }[] }) => {
        if (data.action === picker.Action.PICKED && data.docs?.[0]) resolve({ id: data.docs[0].id, name: data.docs[0].name });
        else if (data.action === picker.Action.CANCEL) resolve(null);
      })
      .build().setVisible(true);
  });
}
