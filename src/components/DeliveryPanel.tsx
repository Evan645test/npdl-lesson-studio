import { useState } from 'react';
import type { Project } from '../domain/types';
import { exportDocument } from '../documents/export';
import { PDF_LIMIT, STUDENT_LIMIT } from './reviewGuidance';

export function DeliveryPanel({ project, onMessage }: { project: Project; onMessage: (message: string) => void }) {
  const [exporting, setExporting] = useState(false);
  async function run(audience: 'student' | 'teacher', format: 'md' | 'docx' | 'pdf') {
    if (exporting) return;
    setExporting(true);
    try {
      await exportDocument(project, audience, format);
      onMessage('文件已產生並交由瀏覽器下載；內容使用所選題組的原設計快照。');
    } catch (error) {
      onMessage(error instanceof Error ? error.message : '文件產生失敗，原內容保留。');
    } finally {
      setExporting(false);
    }
  }
  const formats = [['md', 'Markdown'], ['docx', 'Word'], ['pdf', 'PDF']] as const;
  return <section className="card" aria-label="題本與手冊">
    <h2>帶走題本與手冊</h2>
    <p>{STUDENT_LIMIT}</p>
    <p className="note">{PDF_LIMIT}按下下載才會產生檔案。</p>
    <div className="actions">
      {(['student', 'teacher'] as const).flatMap(audience => formats.map(([format, label]) => <button type="button" key={`${audience}-${format}`} disabled={exporting} onClick={() => { void run(audience, format); }}>由此下載{audience === 'student' ? '學生題本' : '教師手冊'} {label}</button>))}
    </div>
  </section>;
}
