import type { Audience, DocumentOptions } from './model';
import { buildDocument, documentMarkdown } from './model';
import type { Project } from '../domain/types';
import { pdfBlob } from './pdfRenderer';
import { wordBlob } from './wordRenderer';
export { pdfBlob, wordBlob };

export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = name.replace(/[\\/:*?"<>|\u0000-\u001F]/g, '-'); anchor.style.display = 'none';
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// R42：先產生檔案，再由呼叫端決定下載或存到 Google 雲端資料夾。
export async function buildExportFile(project: Project, audience: Audience, format: 'md' | 'docx' | 'pdf', options: DocumentOptions = {}): Promise<{ name: string; blob: Blob }> {
  const content = buildDocument(project, audience, options);
  const blob = format === 'md' ? new Blob([documentMarkdown(content)], { type: 'text/markdown;charset=utf-8' }) : format === 'docx' ? await wordBlob(content) : await pdfBlob(content, audience);
  return { name: `${content.title}.${format}`, blob };
}
export async function exportDocument(project: Project, audience: Audience, format: 'md' | 'docx' | 'pdf', options: DocumentOptions = {}): Promise<void> {
  const { name, blob } = await buildExportFile(project, audience, format, options);
  downloadBlob(name, blob);
}
