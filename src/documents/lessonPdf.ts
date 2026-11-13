import type { Project } from '../domain/types';
import { buildLessonOverview, type LessonOverview } from './lessonOverview';
import { CANVAS_FONT_STACK, drawPdfText, installPdfFont, loadPdfFont, parseCanvasFont, type PdfText } from './pdfFont';

// R12-r10：完整課程 PDF 改為教師備課版面。第一頁「課程一覽」，之後為逐節細節與規準。
// 版面以畫布繪製後以圖片放入 A4 頁面；R31 起另在圖片上疊一層不可見的嵌入字型文字，讓文字可選取與搜尋。
const W = 1240, H = 1754, M = 84, CW = W - M * 2, BOTTOM = H - 110;
const FONT = CANVAS_FONT_STACK;
const C = {
  ink: '#1f2927', soft: '#55625e', faint: '#7b8682', line: '#d7dedb', brand: '#164b45', brandSoft: '#e6f0ee',
  accent: '#b4532a', accentSoft: '#fbeee6', npdl: '#3d4f8f', npdlSoft: '#eaedf7', card: '#f6f8f7', white: '#ffffff',
};

type Ctx = CanvasRenderingContext2D;
interface Page { canvas: HTMLCanvasElement; ctx: Ctx; texts: PdfText[] }

const NO_LINE_START = '，。、；：！？）」』》…,.;:!?)';
function font(ctx: Ctx, size: number, weight = 400) { ctx.font = `${weight} ${size}px ${FONT}`; }
export function wrapText(measure: (text: string) => number, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    // 避頭點：句讀不放在行首，允許略超出行寬。
    for (const char of paragraph) { if (line && measure(line + char) > width && !NO_LINE_START.includes(char)) { lines.push(line); line = char.trimStart(); } else line += char; }
    lines.push(line);
  }
  return lines;
}
export function clampLines(lines: string[], max: number, measure: (text: string) => number, width: number): string[] {
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max); let last = kept[max - 1];
  while (last && measure(last + '…') > width) last = last.slice(0, -1);
  kept[max - 1] = last + '…';
  return kept;
}
function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
}

class Layout {
  pages: Page[] = []; y = 0; page!: Page;
  constructor(private title: string) { this.add(); }
  get ctx() { return this.page.ctx; }
  add() {
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('瀏覽器不支援 PDF 繪圖，請下載 Word。');
    ctx.fillStyle = C.white; ctx.fillRect(0, 0, W, H); ctx.textBaseline = 'top';
    const texts: PdfText[] = [], fill = ctx.fillText.bind(ctx);
    // 記錄每段畫上去的文字與位置，供 PDF 疊上可選取文字層。
    ctx.fillText = (text: string, x: number, y: number, maxWidth?: number) => {
      const { sizePx, bold } = parseCanvasFont(ctx.font);
      const baseline = ctx.textBaseline === 'middle' || ctx.textBaseline === 'alphabetic' ? ctx.textBaseline : 'top';
      texts.push({ text, x, y, sizePx, bold, color: '#000000', align: ctx.textAlign === 'right' || ctx.textAlign === 'end' ? 'right' : 'left', baseline });
      if (maxWidth === undefined) fill(text, x, y); else fill(text, x, y, maxWidth);
    };
    this.page = { canvas, ctx, texts }; this.pages.push(this.page); this.y = this.pages.length === 1 ? 0 : 80;
    if (this.pages.length > 1) { font(ctx, 18, 600); ctx.fillStyle = C.faint; ctx.fillText(this.title, M, 40); ctx.fillStyle = C.line; ctx.fillRect(M, 68, CW, 2); }
  }
  ensure(h: number) { if (this.y + h > BOTTOM) this.add(); }
  lines(text: string, size: number, width: number, weight = 400, max?: number) {
    font(this.ctx, size, weight); const measure = (t: string) => this.ctx.measureText(t).width;
    const all = wrapText(measure, text, width); return max ? clampLines(all, max, measure, width) : all;
  }
  draw(lines: string[], x: number, y: number, size: number, color: string, weight = 400, lead = 1.5) {
    font(this.ctx, size, weight); this.ctx.fillStyle = color; lines.forEach((l, i) => this.ctx.fillText(l, x, y + i * size * lead)); return lines.length * size * lead;
  }
  // 段落可跨頁：逐行放置。
  flow(text: string, size: number, color: string, x = M, width = CW, weight = 400) {
    const lead = size * 1.55;
    for (const line of this.lines(text, size, width, weight)) { this.ensure(lead); this.draw([line], x, this.y, size, color, weight); this.y += lead; }
  }
  section(title: string, color = C.brand) {
    // 標題與下方至少一列內容同頁。
    this.ensure(260); this.y += 26; this.ctx.fillStyle = color; this.ctx.fillRect(M, this.y + 4, 8, 34);
    this.draw([title], M + 22, this.y + 2, 30, C.ink, 700); this.y += 58;
  }
}

function chip(l: Layout, text: string, x: number, y: number, fg: string, bg: string, size = 20) {
  font(l.ctx, size, 600); const w = l.ctx.measureText(text).width + 28;
  roundRect(l.ctx, x, y, w, size + 18, (size + 18) / 2, bg); l.ctx.fillStyle = fg; l.ctx.fillText(text, x + 14, y + 9); return w;
}
function overviewPage(l: Layout, o: LessonOverview) {
  // 標題帶
  // 標題帶高度隨標題行數調整，避免標籤超出底色。
  const titleLines = l.lines(o.title, 46, CW, 800, 2), chipY = 82 + titleLines.length * 58 + 8, bannerH = chipY + 37 + 34;
  l.ctx.fillStyle = C.brand; l.ctx.fillRect(0, 0, W, bannerH);
  l.draw(['完整課程教案・課程一覽'], M, 46, 22, '#bfe0da', 600);
  l.draw(titleLines, M, 82, 46, C.white, 800, 1.25);
  let x = M;
  for (const t of [o.meta, o.status]) x += chip(l, t, x, chipY, C.brand, '#d6ebe7', 19) + 12;
  l.y = bannerH + 32;

  // 大概念與學習目標
  const dq = l.lines(o.drivingQuestion, 26, CW - 64, 700, 3);
  const fp = o.finalProduct ? l.lines(`最終作品：${o.finalProduct}`, 20, CW - 64, 500, 3) : [];
  const dqH = 54 + dq.length * 39 + (fp.length ? 12 + fp.length * 30 : 0) + 24;
  roundRect(l.ctx, M, l.y, CW, dqH, 16, C.accentSoft);
  l.draw(['驅動問題'], M + 32, l.y + 22, 20, C.accent, 700); l.draw(dq, M + 32, l.y + 54, 26, C.ink, 700);
  if (fp.length) l.draw(fp, M + 32, l.y + 54 + dq.length * 39 + 12, 20, C.ink, 500);
  l.y += dqH + 22;
  for (const g of o.goals) {
    const fg = g.kind === '學科' ? C.brand : C.npdl;
    const text = l.lines(g.text, 21, CW - 170, 600, 2), success = l.lines(`成功表現：${g.success}`, 19, CW - 170, 400, 2);
    const h = Math.max(70, text.length * 32 + success.length * 29 + 30);
    l.ensure(h + 12); roundRect(l.ctx, M, l.y, CW, h, 12, C.card);
    chip(l, g.kind, M + 18, l.y + 16, C.white, fg, 18);
    l.draw(text, M + 150, l.y + 15, 21, C.ink, 600); l.draw(success, M + 150, l.y + 15 + text.length * 32, 19, C.soft); l.y += h + 12;
  }

  l.section('單元地圖｜活動主題與學習證據');
  if (!o.groups.length) l.flow('尚無逐節活動。', 18, C.soft);
  for (const group of o.groups) {
    const name = l.lines(group.name, 21, CW - 170, 700, 2);
    const ev = l.lines('學習證據（摘錄）：' + group.evidence, 19, CW - 170, 400, 2);
    const h = 18 + name.length * 32 + ev.length * 29;
    l.ensure(h + 4);
    l.draw([group.label], M, l.y + 8, 19, C.brand, 700);
    l.draw(name, M + 156, l.y + 6, 21, C.ink, 700);
    l.draw(ev, M + 156, l.y + 8 + name.length * 32, 19, C.soft);
    l.ctx.fillStyle = C.line; l.ctx.fillRect(M, l.y + h, CW, 1.5); l.y += h + 4;
  }

  // 前後測與規準對照
  l.section('前後測與規準對照', C.accent);
  l.ensure(60); let sx = M; for (const t of [o.assessment.preStatus, o.assessment.postStatus]) sx += chip(l, t, sx, l.y, C.accent, C.accentSoft, 18) + 12; l.y += 56;
  const cols = [M, M + CW * 0.36, M + CW * 0.72], cw = [CW * 0.34, CW * 0.34, CW * 0.28];
  l.ensure(44); roundRect(l.ctx, M, l.y, CW, 40, 8, C.card); ['前測題（生活情境）', '後測題（課程情境）', '對應規準'].forEach((t, i) => l.draw([t], cols[i] + 14, l.y + 9, 18, C.soft, 700)); l.y += 48;
  if (!o.assessment.pairs.length) { l.flow('尚無前後測配對。', 18, C.soft); }
  for (const pair of o.assessment.pairs) {
    const cells = [pair.pre, pair.post, pair.criteria].map((t, i) => l.lines(t, 18, cw[i] - 24, 400, 2));
    const h = Math.max(...cells.map(c => c.length)) * 27 + 16; l.ensure(h);
    cells.forEach((c, i) => l.draw(c, cols[i] + 14, l.y + 8, 18, i === 2 ? C.npdl : C.ink, i === 2 ? 600 : 400));
    l.ctx.fillStyle = C.line; l.ctx.fillRect(M, l.y + h, CW, 1.5); font(l.ctx, 20, 700); l.ctx.fillStyle = C.faint; l.ctx.fillText('→', cols[1] - 30, l.y + 8); l.y += h + 4;
  }
  l.y += 8; l.flow(o.assessment.extras, 18, C.soft);
}

function detailPages(l: Layout, o: LessonOverview) {
  l.add();
  l.section('逐節教學細節');
  for (const p of o.periods) {
    font(l.ctx, 24, 700); const labelW = l.ctx.measureText(`${p.label}｜`).width;
    const nameLines = l.lines(p.name, 24, CW - 44 - labelW, 700), cardH = 20 + nameLines.length * 34;
    const detail = [['學生做什麼', p.task], ['教師看什麼', p.evidence], ['怎麼回饋', p.formative], ['學科用途', p.knowledgeUse]] as const;
    const lead = 29.45;
    const detailHeight = detail.reduce((n, [, text]) => n + l.lines(text, 19, CW - 142).length * lead + 8, 0);
    const fullHeight = cardH + 16 + detailHeight;
    l.ensure(fullHeight < BOTTOM - 240 ? fullHeight : cardH + 16 + lead * 2);
    roundRect(l.ctx, M, l.y, CW, cardH, 10, C.brandSoft);
    l.draw([p.label + '｜'], M + 22, l.y + 12, 24, C.brand, 700); l.draw(nameLines, M + 22 + labelW, l.y + 12, 24, C.brand, 700, 34 / 24); l.y += cardH + 16;
    for (const [label, text] of detail) {
      l.ensure(40);
      l.draw([label], M, l.y, 19, C.soft, 700); l.flow(text, 19, C.ink, M + 142, CW - 142); l.y += 8;
    }
    if (p.scaffolds.length) {
      const widths = [132, (CW - 132) / 2, (CW - 132) / 2];
      const starts = [M, M + widths[0], M + widths[0] + widths[1]];
      const head = (continuing = false) => {
        roundRect(l.ctx, M, l.y, CW, 35, 5, C.card);
        [continuing ? '鷹架（續）' : '四階鷹架', '提供什麼支持', '何時撤去'].forEach((label, i) => l.draw([label], starts[i] + 10, l.y + 7, 18, C.brand, 700));
        l.y += 39;
      };
      const rows = p.scaffolds.map(row => [row.stage, row.support, row.fading].map((text, i) => l.lines(text, 18, widths[i] - 20, i === 0 ? 700 : 400)));
      const tableHeight = 39 + rows.reduce((n, row) => n + 14 + Math.max(...row.map(cell => cell.length)) * 27, 0);
      l.ensure(tableHeight <= BOTTOM - 80 ? tableHeight : 90);
      head();
      for (const row of rows) {
        const lineCount = Math.max(...row.map(cell => cell.length));
        for (let offset = 0; offset < lineCount;) {
          const left = lineCount - offset;
          if (l.y + left * 27 + 14 > BOTTOM && left * 27 + 14 <= BOTTOM - 119) { l.add(); head(true); }
          if (l.y + 41 > BOTTOM) { l.add(); head(true); }
          const take = Math.min(left, Math.floor((BOTTOM - l.y - 14) / 27));
          const height = take * 27 + 14;
          row.forEach((cell, i) => l.draw(cell.slice(offset, offset + take), starts[i] + 10, l.y + 6, 18, i === 0 ? C.brand : C.ink, i === 0 ? 700 : 400));
          l.ctx.fillStyle = C.line; l.ctx.fillRect(M, l.y + height - 1, CW, 1.5); l.y += height;
          offset += take;
          if (offset < lineCount) { l.add(); head(true); }
        }
      }
    }
    l.y += 18;
  }
  l.section('共同判讀規準（工具四階）', C.npdl);
  l.flow('四階描述比較同一種表現的品質；空白或證據不足時標記「尚無法判讀」，不是最低階。', 18, C.soft);
  for (const c of o.criteria) {
    l.ensure(120); l.y += 10; l.draw([c.label], M, l.y, 23, C.ink, 700); l.y += 36; l.flow(c.dimension + '｜觀察：' + c.observable + '\n範圍：' + c.scope + '\n未觀察到：' + c.unobserved, 18, C.soft); l.y += 6;
    const colW = (CW - 30) / 4, cells = c.stages.map(s => l.lines(s.text, 17, colW - 28));
    const h = 52 + Math.max(...cells.map(x => x.length)) * 25 + 16;
    if (l.y + h > BOTTOM) l.add();
    c.stages.forEach((s, i) => {
      const x = M + i * (colW + 10); roundRect(l.ctx, x, l.y, colW, h, 10, i === 3 ? C.npdlSoft : C.card, C.line);
      l.draw([s.stage], x + 14, l.y + 14, 19, C.npdl, 700); l.draw(cells[i], x + 14, l.y + 50, 17, C.ink, 400, 25 / 17);
    });
    l.y += h + 16;
  }
  l.section('四要素做法與限制');
  for (const e of o.elements) { l.ensure(70); l.draw([e.name], M, l.y, 20, C.npdl, 700); l.y += 32; l.flow(e.practice, 18, C.ink); l.flow(`限制：${e.limitation}`, 18, C.soft); l.y += 10; }
  if (o.integration.length) { l.section('多題整合規則'); o.integration.forEach(t => { l.flow(t, 18, C.ink); l.y += 6; }); }
  if (o.curriculum.length) { l.section('課綱條目'); o.curriculum.forEach(c => { l.flow(`${c.kind} ${c.code}：${c.text}`, 18, C.ink); l.y += 6; }); }
  l.y += 16; l.flow(o.note, 17, C.faint);
}

export function renderLessonPages(project: Project): HTMLCanvasElement[] {
  return renderLessonLayout(project).map(p => p.canvas);
}
function renderLessonLayout(project: Project): Page[] {
  const o = buildLessonOverview(project), l = new Layout(`${o.title}・完整課程教案`);
  overviewPage(l, o); detailPages(l, o);
  if (l.pages.length > 120) throw new Error('PDF 超過 120 頁，請改下載 Word；原資料保留。');
  l.pages.forEach((p, i) => { font(p.ctx, 17, 400); p.ctx.fillStyle = C.faint; p.ctx.fillText(`深學備課室・課程規劃未實施｜${i + 1} / ${l.pages.length}`, M, H - 70); });
  return l.pages;
}

export async function lessonPdfBlob(project: Project): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const font = await loadPdfFont();
  await document.fonts.ready;
  const title = buildLessonOverview(project).title;
  const pages = renderLessonLayout(project);
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  pdf.setProperties({ title: `${title}・完整課程教案`, author: '深學備課室', subject: '課程規劃；尚未實施或校準', creator: '深學備課室 R12-r10' });
  if (font) installPdfFont(pdf, font);
  for (const [i, { canvas, texts }] of pages.entries()) {
    if (i) pdf.addPage(); pdf.addImage(canvas.toDataURL('image/jpeg', 0.94), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
    if (font) for (const row of texts) drawPdfText(pdf, row, true);
    canvas.width = 0; canvas.height = 0; await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  return pdf.output('blob');
}
