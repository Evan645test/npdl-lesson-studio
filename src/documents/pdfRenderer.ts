import type { jsPDF as JsPdf } from 'jspdf';
import type { Audience, DocumentBlock, TeachingDocument } from './model';
import { CANVAS_FONT_STACK, PX_TO_MM, drawPdfText, installPdfFont, loadPdfFont } from './pdfFont';

const WIDTH = 1240, HEIGHT = 1754;
const LEFT = 90, CONTENT_WIDTH = WIDTH - LEFT * 2, TOP = 105, BOTTOM = 1630;
const MAX_PAGES = 120, CONTINUATION_HEIGHT = 46, ANSWER_LINE_HEIGHT = 48;
const FONT = CANVAS_FONT_STACK;
const INK = '#1f2927', ACCENT = '#164b45', RULE = '#737e7a', PALE = '#edf2f0';
const TABLE_SIZE = 21, TABLE_LEADING = 33, TABLE_PADDING = 12;

interface Style { size: number; weight: number; leading: number; color: string; gap: number }
const STYLES: Record<DocumentBlock['kind'], Style> = {
  title: { size: 38, weight: 700, leading: 54, color: ACCENT, gap: 18 },
  heading: { size: 28, weight: 700, leading: 42, color: ACCENT, gap: 12 },
  paragraph: { size: 22, weight: 400, leading: 33, color: INK, gap: 10 },
};
const TABLE_BODY: Style = { size: TABLE_SIZE, weight: 400, leading: TABLE_LEADING, color: INK, gap: 0 };
const TABLE_HEAD: Style = { ...TABLE_BODY, weight: 700 };
const CONTINUATION_STYLE: Style = { size: 18, weight: 600, leading: 26, color: ACCENT, gap: 0 };

type Command =
  | { type: 'text'; text: string; x: number; y: number; style: Style; right?: boolean }
  | { type: 'line'; x: number; y: number; endX: number; endY: number }
  | { type: 'fill'; x: number; y: number; width: number; height: number; color: string };
interface TableLayout {
  widths: number[];
  header: string[][];
  rows: string[][][];
  right: boolean[];
}
interface LayoutBlock {
  block: DocumentBlock;
  style: Style;
  lines: string[];
  answerLines: number;
  table?: TableLayout;
}

function setFont(ctx: CanvasRenderingContext2D, style: Style): void {
  ctx.font = `${style.weight} ${style.size}px ${FONT}`;
}

// An individual Chinese character may be a wrap boundary; never drop overflowing text.
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, style: Style): string[] {
  if (!text) return [];
  setFont(ctx, style);
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const char of paragraph) {
      if (line && ctx.measureText(line + char).width > width) {
        lines.push(line);
        line = char;
      } else line += char;
    }
    lines.push(line);
  }
  return lines;
}

function lineCount(cells: string[][]): number {
  return Math.max(1, ...cells.map(cell => cell.length));
}
function rowHeight(cells: string[][]): number {
  return lineCount(cells) * TABLE_LEADING + TABLE_PADDING * 2;
}

function toTable(ctx: CanvasRenderingContext2D, table: NonNullable<DocumentBlock['table']>): TableLayout | undefined {
  const count = table.headers.length;
  if (count < 1 || count > 12 || table.rows.some(row => row.length !== count)) return undefined;
  const weights = table.widths;
  const max = weights?.length === count ? Math.max(...weights) : 0;
  const normalized = max > 0 && Number.isFinite(max) && weights!.every(value => value > 0)
    ? weights!.map(value => value / max)
    : Array.from({ length: count }, () => 1);
  const sum = normalized.reduce((a, b) => a + b, 0);
  let widths = normalized.map(value => CONTENT_WIDTH * value / sum);
  if (widths.some(width => width < TABLE_PADDING * 2 + TABLE_SIZE * 2)) {
    widths = Array.from({ length: count }, () => CONTENT_WIDTH / count);
  }
  const cells = (row: string[], style: Style) =>
    row.map((text, index) => wrap(ctx, text, widths[index] - TABLE_PADDING * 2, style));
  const header = cells(table.headers, TABLE_HEAD);
  if (rowHeight(header) + TABLE_LEADING + 2 * TABLE_PADDING + CONTINUATION_HEIGHT > BOTTOM - TOP) {
    return undefined;
  }
  const numeric = /^[+−-]?\d+(?:[.,]\d+)?(?:\s*(?:[%°℃μµA-Za-z]+|秒|分鐘|公克|毫升))?$/u;
  const right = table.headers.map((_, index) => table.rows.length > 0 &&
    table.rows.every(row => numeric.test(row[index].trim())));
  return { widths, header, rows: table.rows.map(row => cells(row, TABLE_BODY)), right };
}

function layoutBlock(ctx: CanvasRenderingContext2D, block: DocumentBlock): LayoutBlock {
  const style = STYLES[block.kind];
  const table = block.table ? toTable(ctx, block.table) : undefined;
  const fallback = block.table && !table
    ? [block.table.headers, ...block.table.rows].map(row => row.join(' ｜ ')).join('\n')
    : block.text;
  const answerLines = block.answerLines ?? 0;
  if (!Number.isSafeInteger(answerLines) || answerLines < 0 || answerLines > 20) {
    throw new Error('文件作答欄的行數不符；原資料保留。');
  }
  return { block, style, lines: table ? [] : wrap(ctx, fallback, CONTENT_WIDTH, style), answerLines, table };
}

class Pagination {
  readonly pages: Command[][] = [[]];
  y = TOP;
  private get current(): Command[] { return this.pages[this.pages.length - 1]; }
  private get empty(): boolean { return this.current.length === 0; }

  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  private text(text: string, x: number, y: number, style: Style, right = false): void {
    this.current.push({ type: 'text', text, x, y, style, right });
  }
  private line(x: number, y: number, endX: number, endY: number): void {
    this.current.push({ type: 'line', x, y, endX, endY });
  }
  private freshCapacity(continuation?: string): number {
    return BOTTOM - TOP - (continuation ? CONTINUATION_HEIGHT : 0);
  }
  private newPage(continuation?: string): void {
    if (this.empty) return;
    if (this.pages.length >= MAX_PAGES) {
      throw new Error('PDF 超過 120 頁，請改下載 Word 或縮短內容；原資料保留。');
    }
    this.pages.push([]);
    this.y = TOP;
    if (!continuation) return;
    const display = continuation.replace(/\s+/g, ' ').trim();
    if (!display) return;
    const lines = wrap(this.ctx, `${display}（續）`, CONTENT_WIDTH - 40, CONTINUATION_STYLE);
    this.text(lines.length > 1 ? `${lines[0]}…` : lines[0], LEFT, this.y, CONTINUATION_STYLE);
    this.line(LEFT, this.y + 30, LEFT + CONTENT_WIDTH, this.y + 30);
    this.y += CONTINUATION_HEIGHT;
  }
  private fit(height: number, continuation?: string): void {
    if (this.y + height <= BOTTOM || this.empty || height > this.freshCapacity()) return;
    this.newPage(height <= this.freshCapacity(continuation) ? continuation : undefined);
  }

  private firstTableHeight(table: TableLayout, continuation?: string): number {
    const header = rowHeight(table.header);
    const first = table.rows[0];
    if (!first) return header;
    const room = this.freshCapacity(continuation || '資料表') - header;
    const height = rowHeight(first);
    return header + (height <= room ? height : Math.min(room, TABLE_LEADING * 2 + TABLE_PADDING * 2));
  }
  private firstHeight(value: LayoutBlock | undefined): number {
    if (!value || value.block.pageBreakBefore) return 0;
    if (value.table) return this.firstTableHeight(value.table, value.block.continuation);
    const total = value.lines.length * value.style.leading + value.answerLines * ANSWER_LINE_HEIGHT;
    const first = Math.min(total, Math.max(value.style.leading * 2, ANSWER_LINE_HEIGHT));
    // Keep a following question as a unit with its heading when both can fit on a fresh page.
    return value.block.keepTogether && total + 80 <= this.freshCapacity(value.block.continuation) ? total : first;
  }
  place(value: LayoutBlock, next: LayoutBlock | undefined): void {
    const { block, style, lines, table, answerLines } = value;
    const continuation = block.continuation?.trim();
    if (block.pageBreakBefore) this.newPage();
    if (table) {
      this.table(table, continuation);
      this.y += style.gap;
      return;
    }
    if (!lines.length && !answerLines) return;
    const natural = lines.length * style.leading + answerLines * ANSWER_LINE_HEIGHT;
    const isHeading = block.kind !== 'paragraph';
    if (isHeading) {
      const keep = natural + style.gap + this.firstHeight(next);
      if (keep <= this.freshCapacity(continuation)) this.fit(keep, continuation);
      else this.fit(natural, continuation);
    } else if (block.keepTogether || answerLines) this.fit(natural, continuation);
    let placed = 0;
    for (const text of lines) {
      if (this.y + style.leading > BOTTOM) this.newPage(continuation || (placed && block.keepTogether ? '題目' : undefined));
      this.text(text, LEFT, this.y, style);
      this.y += style.leading;
      placed++;
    }
    if (answerLines) {
      this.fit(answerLines * ANSWER_LINE_HEIGHT, continuation || '作答欄');
      for (let i = 0; i < answerLines; i++) {
        if (this.y + ANSWER_LINE_HEIGHT > BOTTOM) this.newPage(continuation || '作答欄');
        const baseline = this.y + ANSWER_LINE_HEIGHT - 8;
        this.line(LEFT, baseline, LEFT + CONTENT_WIDTH, baseline);
        this.y += ANSWER_LINE_HEIGHT;
      }
    }
    this.y += style.gap;
  }

  private tableRow(table: TableLayout, cells: string[][], header: boolean): void {
    const height = rowHeight(cells);
    const style = header ? TABLE_HEAD : TABLE_BODY;
    if (header) this.current.push({ type: 'fill', x: LEFT, y: this.y, width: CONTENT_WIDTH, height, color: PALE });
    this.line(LEFT, this.y, LEFT + CONTENT_WIDTH, this.y);
    let x = LEFT;
    for (let i = 0; i < cells.length; i++) {
      const width = table.widths[i], right = !header && table.right[i];
      this.line(x, this.y, x, this.y + height);
      const textX = right ? x + width - TABLE_PADDING : x + TABLE_PADDING;
      cells[i].forEach((text, index) => this.text(text, textX, this.y + TABLE_PADDING + index * TABLE_LEADING, style, right));
      x += width;
    }
    this.line(LEFT + CONTENT_WIDTH, this.y, LEFT + CONTENT_WIDTH, this.y + height);
    this.line(LEFT, this.y + height, LEFT + CONTENT_WIDTH, this.y + height);
    this.y += height;
  }
  private table(table: TableLayout, continuation?: string): void {
    const headerHeight = rowHeight(table.header);
    const repeatLabel = continuation || '資料表';
    const rowCapacity = this.freshCapacity(repeatLabel) - headerHeight;
    const nextTablePage = () => {
      this.newPage(repeatLabel);
      this.tableRow(table, table.header, true);
    };
    // A tall first row needs only a viable slice with the header on the first page.
    this.fit(this.firstTableHeight(table, continuation), continuation);
    this.tableRow(table, table.header, true);
    for (const row of table.rows) {
      const height = rowHeight(row);
      if (height <= rowCapacity) {
        if (this.y + height > BOTTOM) nextTablePage();
        this.tableRow(table, row, false);
        continue;
      }
      // A single row taller than a page retains every line. Column positions and headers
      // repeat; a split is used only when the complete row cannot fit even on a fresh page.
      let offset = 0;
      const count = lineCount(row);
      while (offset < count) {
        let available = Math.floor((BOTTOM - this.y - 2 * TABLE_PADDING) / TABLE_LEADING);
        if (available < 1) {
          nextTablePage();
          available = Math.floor((BOTTOM - this.y - 2 * TABLE_PADDING) / TABLE_LEADING);
        }
        if (available < 1) throw new Error('資料表無法分頁，請下載 Word；原資料保留。');
        const end = Math.min(count, offset + available);
        this.tableRow(table, row.map(cell => cell.slice(offset, end)), false);
        offset = end;
        if (offset < count) nextTablePage();
      }
    }
  }
}

function render(ctx: CanvasRenderingContext2D, commands: Command[]): void {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.textBaseline = 'top';
  ctx.strokeStyle = RULE;
  ctx.lineWidth = 1.4;
  for (const command of commands) {
    if (command.type === 'text') {
      setFont(ctx, command.style);
      ctx.fillStyle = command.style.color;
      ctx.textAlign = command.right ? 'right' : 'left';
      ctx.fillText(command.text, command.x, command.y);
    } else if (command.type === 'line') {
      ctx.beginPath();
      ctx.moveTo(command.x, command.y);
      ctx.lineTo(command.endX, command.endY);
      ctx.stroke();
    } else {
      ctx.fillStyle = command.color;
      ctx.fillRect(command.x, command.y, command.width, command.height);
    }
  }
}

// R31：以同一份版面指令寫成 PDF 向量文字與線條，取代整頁影像。
function drawVector(pdf: JsPdf, commands: Command[]): void {
  for (const command of commands) {
    if (command.type === 'text') {
      drawPdfText(pdf, { text: command.text, x: command.x, y: command.y, sizePx: command.style.size, color: command.style.color,
        bold: command.style.weight >= 600, align: command.right ? 'right' : 'left', baseline: 'top' });
    } else if (command.type === 'line') {
      pdf.setDrawColor(RULE);
      pdf.setLineWidth(1.4 * PX_TO_MM);
      pdf.line(command.x * PX_TO_MM, command.y * PX_TO_MM, command.endX * PX_TO_MM, command.endY * PX_TO_MM);
    } else {
      pdf.setFillColor(command.color);
      pdf.rect(command.x * PX_TO_MM, command.y * PX_TO_MM, command.width * PX_TO_MM, command.height * PX_TO_MM, 'F');
    }
  }
}

export async function pdfBlob(content: TeachingDocument, audience: Audience = 'teacher'): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const font = await loadPdfFont();
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('瀏覽器不支援 PDF 繪圖，請下載 Word。');
    const layout = new Pagination(ctx);
    let current: LayoutBlock | undefined;
    for (const block of content.blocks) {
      const next = layoutBlock(ctx, block);
      if (current) layout.place(current, next);
      current = next;
    }
    if (current) layout.place(current, undefined);
    const pages = layout.pages.filter(page => page.length);
    if (!pages.length) throw new Error('PDF 內容空白，請先確認要下載的內容；原資料保留。');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    pdf.setProperties({
      title: content.title, author: '深學備課室', creator: '深學備課室',
      ...(audience === 'teacher' ? { subject: '題本未以真實作答校準' } : {}),
    });
    if (font) installPdfFont(pdf, font);
    for (const [index, page] of pages.entries()) {
      const number = `${index + 1} / ${pages.length}`;
      const footer = audience === 'teacher' ? `深學備課室・教師用｜${number}` : number;
      if (font) {
        if (index) pdf.addPage();
        drawVector(pdf, page);
        drawPdfText(pdf, { text: footer, x: LEFT, y: 1680, sizePx: 18, color: '#54615e', bold: false, align: 'left', baseline: 'top' });
        continue;
      }
      render(ctx, page);
      ctx.font = '18px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#54615e';
      ctx.fillText(footer, LEFT, 1680);
      if (index) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.96), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    return pdf.output('blob');
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
