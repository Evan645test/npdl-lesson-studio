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
export async function exportDocument(project: Project, audience: Audience, format: 'md' | 'docx' | 'pdf', options: DocumentOptions = {}): Promise<void> {
  const content = buildDocument(project, audience, options);
  const blob = format === 'md' ? new Blob([documentMarkdown(content)], { type: 'text/markdown;charset=utf-8' }) : format === 'docx' ? await wordBlob(content) : await pdfBlob(content, audience);
  downloadBlob(`${content.title}.${format}`, blob);
}
