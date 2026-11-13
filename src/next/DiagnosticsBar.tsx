import { useRef, useState, useSyncExternalStore } from 'react';
import {
  canPreviewFailure, clearFailures, diagnosticsText, failuresRevision,
  previewFailureOutput, readFailures, subscribeFailures,
} from '../services/aiFailureLog';

const taskNames = { recommend: '推薦課綱與子指標', design: '課程設計', pre: '前測', post: '後測', intake: '課程輸入', field: '欄位發想', item: '題目修訂' };
const failureNames = { 'invalid-json': 'JSON 格式錯誤', validation: '未通過內容檢查', incomplete: '回應未完成' };
interface Editor { id: string; text: string; truncated: boolean; checked: boolean }

export function DiagnosticsBar({ courseId }: { courseId: string }) {
  return <CourseDiagnostics key={courseId} courseId={courseId} />;
}
function CourseDiagnostics({ courseId }: { courseId: string }) {
  useSyncExternalStore(subscribeFailures, failuresRevision, () => 0);
  const rows = readFailures(courseId);
  const [note, setNote] = useState('');
  const [fallback, setFallback] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const copyAttempt = useRef(0);
  const currentEditor = editor && canPreviewFailure(courseId, editor.id) ? editor : null;
  if (!rows.length) return null;

  function resetCopy() {
    copyAttempt.current++;
    setFallback('');
    setNote('');
  }
  async function copy(text: string, rawId?: string) {
    const attempt = ++copyAttempt.current;
    setFallback('');
    try {
      await navigator.clipboard.writeText(text);
      if (copyAttempt.current === attempt) setNote(rawId ? '已複製這筆核對後文字。' : '已複製目前課程的診斷摘要。');
    } catch {
      if (copyAttempt.current !== attempt) return;
      if (rawId) {
        if (canPreviewFailure(courseId, rawId)) setNote('瀏覽器不允許自動複製，請手動複製核對後的文字。');
      } else {
        setFallback(text);
        setNote('瀏覽器不允許自動複製，請在下方文字框全選後複製。');
      }
    }
  }
  function openEditor(id: string) {
    const output = previewFailureOutput(courseId, id);
    resetCopy();
    setEditor(output ? { id, ...output, checked: false } : null);
  }
  return <div className="sp-diagnostics" role="region" aria-label="AI 失敗診斷">
    <p>目前課程有 {rows.length} 筆 AI 失敗紀錄。診斷摘要只包含任務、供應商、失敗類型與回應字數等資訊。</p>
    <div className="actions">
      <button type="button" onClick={() => { void copy(diagnosticsText(courseId)); }}>複製診斷資料</button>
      <button type="button" onClick={() => { clearFailures(courseId); resetCopy(); setEditor(null); }}>清除紀錄</button>
    </div>
    <ul>
      {rows.map(row => <li key={row.id}>
        <span>{new Date(row.at).toLocaleString('zh-TW')}：{taskNames[row.task]}・{failureNames[row.kind]}</span>
        {' '}{canPreviewFailure(courseId, row.id) && <button type="button" onClick={() => openEditor(row.id)}>查看這筆原始回應</button>}
      </li>)}
    </ul>
    {currentEditor && <div className="field-ai-panel">
      <p><strong>原始回應可能複述你輸入的資料。</strong> 常見金鑰格式已遮蔽，分享前請自行移除姓名、個資與其他敏感內容。原文只在本分頁暫留。</p>
      {currentEditor.truncated && <p>回應較長，這裡只保留前段。</p>}
      <label>待去識別的原始回應<textarea rows={8} value={currentEditor.text} onChange={event => {
        resetCopy();
        setEditor({ ...currentEditor, text: event.target.value, checked: false });
      }} /></label>
      <label className="consent-check"><input type="checkbox" checked={currentEditor.checked} onChange={event => {
        resetCopy();
        setEditor({ ...currentEditor, checked: event.target.checked });
      }} />我已檢查並移除個資和敏感資料</label>
      <div className="actions">
        <button type="button" disabled={!currentEditor.checked || !currentEditor.text.trim()} onClick={() => {
          if (currentEditor.checked && canPreviewFailure(courseId, currentEditor.id)) void copy(currentEditor.text, currentEditor.id);
        }}>複製這筆核對後文字</button>
        <button type="button" onClick={() => { resetCopy(); setEditor(null); }}>關閉原始回應</button>
      </div>
    </div>}
    {note && <p className="note" role="status">{note}</p>}
    {fallback && <textarea aria-label="診斷資料" readOnly rows={8} value={fallback} onFocus={event => event.currentTarget.select()} />}
  </div>;
}
