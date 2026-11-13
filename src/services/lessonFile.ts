// 教案檔只在瀏覽器解析；原檔與檔名不保存，只回傳待教師去識別的純文字。
export const LESSON_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const LESSON_TEXT_MAX_CHARS = 60000;
const PDF_MAX_PAGES = 300;
export interface LessonText { text: string; format: 'pdf' | 'docx' | 'txt' | 'paste'; characters: number; truncated: boolean }

export function normalizeLessonText(raw: string): string {
  return raw.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
}
function finish(raw: string, format: LessonText['format']): LessonText {
  const normalized = normalizeLessonText(raw);
  if (normalized.length < 20) throw new Error(format === 'pdf' ? 'PDF 幾乎沒有可擷取文字，可能是掃描檔；請先完成 OCR 或轉成 DOCX／TXT。' : '內容幾乎沒有可分析文字，請確認後再試。');
  return { text: normalized.slice(0, LESSON_TEXT_MAX_CHARS), format, characters: normalized.length, truncated: normalized.length > LESSON_TEXT_MAX_CHARS };
}
export function lessonTextFromPaste(raw: string): LessonText { return finish(raw, 'paste'); }

async function pdfText(file: File): Promise<string> {
  const [{ getDocument, GlobalWorkerOptions }, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  GlobalWorkerOptions.workerSrc = worker.default;
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()), enableXfa: false });
  try {
    const doc = await task.promise;
    if (doc.numPages > PDF_MAX_PAGES) throw new Error(`PDF 共 ${doc.numPages} 頁，超過 ${PDF_MAX_PAGES} 頁；請只保留本單元的頁面再上傳。`);
    let text = '';
    for (let page = 1; page <= doc.numPages && text.length <= LESSON_TEXT_MAX_CHARS; page++) {
      const content = await (await doc.getPage(page)).getTextContent();
      text += content.items.map(item => 'str' in item ? item.str : '').join(' ') + '\n';
    }
    return text;
  } finally { await task.destroy(); }
}

export async function lessonTextFromFile(file: File): Promise<LessonText> {
  if (file.size <= 0) throw new Error('檔案是空白的，請重新選擇。');
  if (file.size > LESSON_FILE_MAX_BYTES) throw new Error('檔案超過 10 MB，請縮小後再上傳。');
  const extension = file.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '';
  if (extension === '.doc') throw new Error('不支援舊版 .doc；請另存為 .docx 或 UTF-8 TXT。');
  const format = extension === '.pdf' || file.type === 'application/pdf' ? 'pdf' : extension === '.docx' ? 'docx' : extension === '.txt' || file.type === 'text/plain' ? 'txt' : null;
  if (!format) throw new Error('只接受文字型 PDF、DOCX 或 UTF-8 TXT。');
  let raw: string;
  try {
    if (format === 'pdf') raw = await pdfText(file);
    else if (format === 'docx') { const mammoth = await import('mammoth/mammoth.browser.js'); raw = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value; }
    else raw = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  } catch (error) {
    if (error instanceof Error && error.message.includes('超過')) throw error;
    throw new Error(format === 'pdf' ? '無法讀取 PDF。若是掃描影像，請先完成 OCR 或轉成 DOCX／TXT。' : format === 'docx' ? '無法讀取 DOCX，檔案可能損壞或受密碼保護。' : '無法以 UTF-8 讀取文字檔，請另存為 UTF-8 後再試。');
  }
  return finish(raw, format);
}
