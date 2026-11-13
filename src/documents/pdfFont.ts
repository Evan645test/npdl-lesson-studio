import type { jsPDF } from 'jspdf';

// R31（2026-11-09 使用者決定）：PDF 改嵌入本機打包的 Noto Sans TC（SIL OFL 1.1，授權見 public/licenses/），
// jsPDF 只把用到的字形寫進檔案，文字可選取與搜尋。字型讀不到時回到原本的影像版 PDF，不中斷下載。
export const PDF_FONT_FAMILY = 'NPDL Noto Sans TC';
const FONT_FILE = 'fonts/NotoSansTC.ttf';
const VFS_NAME = 'NotoSansTC.ttf';
const PDF_NAME = 'NotoSansTC';
export const CANVAS_FONT_STACK = `"${PDF_FONT_FAMILY}", "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif`;

// 頁面畫素（A4 寬 1240px）換算 mm 與 pt。
export const PX_TO_MM = 210 / 1240;
export const PX_TO_PT = PX_TO_MM * 72 / 25.4;

let pending: Promise<string | null> | undefined;

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function load(): Promise<string | null> {
  try {
    const response = await fetch(new URL(FONT_FILE, document.baseURI));
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength < 1024) return null;
    // 版面量字與 PDF 用同一套字形，換行位置才會一致。
    const face = new FontFace(PDF_FONT_FAMILY, buffer, { weight: '100 900' });
    document.fonts.add(await face.load());
    return toBase64(new Uint8Array(buffer));
  } catch {
    return null;
  }
}

// 只載入一次；失敗會在下次下載時再試。
export async function loadPdfFont(): Promise<string | null> {
  pending ??= load();
  const font = await pending;
  if (!font) pending = undefined;
  return font;
}

export function installPdfFont(pdf: jsPDF, base64: string): void {
  pdf.addFileToVFS(VFS_NAME, base64);
  pdf.addFont(VFS_NAME, PDF_NAME, 'normal');
  pdf.setFont(PDF_NAME, 'normal');
}

export interface PdfText { text: string; x: number; y: number; sizePx: number; color: string; bold: boolean; align: 'left' | 'right'; baseline: 'top' | 'middle' | 'alphabetic' }

// 字型只有一個字重，粗體以描邊加粗。invisible 用於影像頁上的可選取文字層。
export function drawPdfText(pdf: jsPDF, row: PdfText, invisible = false): void {
  if (!row.text) return;
  pdf.setFontSize(row.sizePx * PX_TO_PT);
  pdf.setTextColor(row.color);
  const bold = row.bold && !invisible;
  if (bold) { pdf.setDrawColor(row.color); pdf.setLineWidth(row.sizePx * PX_TO_MM * 0.018); }
  pdf.text(row.text, row.x * PX_TO_MM, row.y * PX_TO_MM, {
    baseline: row.baseline, align: row.align,
    renderingMode: invisible ? 'invisible' : bold ? 'fillThenStroke' : 'fill',
  });
}

// 從 canvas 的 font 字串取出字級與粗細。
export function parseCanvasFont(font: string): { sizePx: number; bold: boolean } {
  const size = Number(font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 16);
  const weight = font.match(/\b(bold|[5-9]00)\b/);
  return { sizePx: size, bold: !!weight };
}
