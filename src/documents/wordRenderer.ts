import type { Paragraph as WordParagraph, Table as WordTable } from 'docx';
import type { DocumentBlock, TeachingDocument } from './model';

const PAGE_WIDTH = 11906;
const PAGE_HEIGHT = 16838;
const MARGIN = 1050;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FACE = 'Microsoft JhengHei';
const FONT = { ascii: FACE, hAnsi: FACE, eastAsia: FACE, cs: FACE };
const INK = '202421';
const HEADING = '18443E';

function lineTexts(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

function columnWidths(count: number, requested?: readonly number[]): number[] {
  const weights = requested?.length === count && requested.every(weight => Number.isFinite(weight) && weight > 0)
    ? requested : Array.from({ length: count }, () => 1);
  const largest = weights.reduce((max, weight) => Math.max(max, weight), 0);
  const ratios = weights.map(weight => weight / largest);
  const total = ratios.reduce((sum, ratio) => sum + ratio, 0);
  const min = Math.min(480, Math.floor(CONTENT_WIDTH / count));
  const extra = CONTENT_WIDTH - min * count;
  let prefix = 0, used = 0;
  return ratios.map((ratio, i) => {
    prefix += ratio;
    const next = i === count - 1 ? extra : Math.floor(extra * prefix / total);
    const width = min + next - used;
    used = next;
    return width;
  });
}

export async function wordBlob(content: TeachingDocument): Promise<Blob> {
  const {
    AlignmentType, BorderStyle, Document, Footer, HeadingLevel, Packer, PageNumber, Paragraph,
    ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType,
  } = await import('docx');

  const student = content.audience === 'student';
  const ruled = { style: BorderStyle.SINGLE, size: 4, color: '79837D', space: 1 };
  const grid = { style: BorderStyle.SINGLE, size: 4, color: '929B96' };
  const paper = { size: { width: PAGE_WIDTH, height: PAGE_HEIGHT }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN, header: 460, footer: 460 } };
  const runs = (text: string, size: number, bold = false, color = INK) => [new TextRun({ text, font: FONT, size, bold, color, language: { value: 'zh-TW', eastAsia: 'zh-TW' } })];
  const numeric = /^[+\-−]?\d+(?:[.,]\d+)?(?:\s*[^\s\d]+)?$/u;

  function tableFor(data: NonNullable<DocumentBlock['table']>): WordTable | WordParagraph[] | null {
    const count = data.rows.reduce((max, row) => Math.max(max, row.length), data.headers.length);
    if (!count) return null;
    // 保留超寬或不規則來源的全部文字；一般資料使用 Word 真表格。
    if (count > 32) return [data.headers, ...data.rows].filter(row => row.length).flatMap(row => lineTexts(row.join(' ｜ ')).map(text => new Paragraph({ children: runs(text, 22) })));
    const widths = columnWidths(count, data.widths);
    const rightAligned = widths.map((_, i) => {
      const values = data.rows.map(row => row[i]?.trim() ?? '').filter(Boolean);
      return values.length > 0 && values.every(value => numeric.test(value));
    });
    const source = data.headers.length ? [data.headers, ...data.rows] : data.rows;
    return new Table({
      layout: TableLayoutType.FIXED,
      width: { type: WidthType.DXA, size: CONTENT_WIDTH },
      columnWidths: widths,
      margins: { marginUnitType: WidthType.DXA, top: 65, bottom: 65, left: 95, right: 95 },
      borders: { top: grid, right: grid, bottom: grid, left: grid, insideHorizontal: grid, insideVertical: grid },
      rows: source.map((row, rowIndex) => {
        const header = rowIndex === 0 && data.headers.length > 0;
        return new TableRow({
          tableHeader: header,
          cantSplit: true,
          children: widths.map((width, i) => new TableCell({
            width: { type: WidthType.DXA, size: width },
            ...(header ? { shading: { type: ShadingType.CLEAR, fill: 'EEF2EF' } } : {}),
            children: lineTexts(row[i] ?? '').map(text => new Paragraph({
              alignment: rightAligned[i] ? AlignmentType.RIGHT : AlignmentType.LEFT,
              spacing: { before: 0, after: 0, line: 270, ...(student ? { lineRule: 'exact' } : {}) },
              children: runs(text, 21, header),
            })),
          })),
        });
      }),
    });
  }

  function renderBlock(block: DocumentBlock, breakBefore: boolean): (WordParagraph | WordTable)[] {
    const title = block.kind === 'title', heading = block.kind === 'heading', styled = title || heading;
    const answers = Number.isFinite(block.answerLines) && (block.answerLines ?? 0) > 0 ? Math.floor(block.answerLines!) : 0;
    const table = block.table ? tableFor(block.table) : null;
    const lines = block.text || !table && !answers ? lineTexts(block.text) : [];
    const rendered: (WordParagraph | WordTable)[] = lines.map((text, i) => {
      const last = i === lines.length - 1;
      return new Paragraph({
        ...(title ? { heading: HeadingLevel.TITLE } : heading ? { heading: HeadingLevel.HEADING_1 } : {}),
        pageBreakBefore: breakBefore && i === 0,
        keepLines: styled || block.keepTogether,
        keepNext: styled || (block.keepTogether && (!last || answers > 0)) || (last && !!table),
        widowControl: true,
        spacing: { before: i === 0 && heading ? (student ? 110 : 200) : 0, after: last ? (styled ? 130 : 105) : (student ? 0 : 28), line: styled ? 300 : 290, ...(student && !styled ? { lineRule: 'exact' } : {}) },
        children: runs(text, title ? 36 : heading ? 28 : 22, styled, styled ? HEADING : INK),
      });
    });
    if (breakBefore && !lines.length) rendered.push(new Paragraph({ pageBreakBefore: true, keepNext: true, spacing: { before: 0, after: 0, line: 20 }, children: runs('\u00A0', 2) }));
    if (Array.isArray(table)) rendered.push(...table);
    else if (table) rendered.push(table);
    for (let i = 0; i < answers; i++) rendered.push(new Paragraph({
      keepNext: i + 1 < answers,
      keepLines: true,
      spacing: { before: 0, after: i + 1 < answers ? 0 : 150, line: 470, lineRule: 'exact' },
      border: { bottom: ruled, between: ruled },
      children: runs('\u00A0', 22),
    }));
    return rendered;
  }

  const children: (WordParagraph | WordTable)[] = [];
  for (const block of content.blocks) children.push(...renderBlock(block, !!block.pageBreakBefore && children.length > 0));
  return Packer.toBlob(new Document({
    creator: '深學備課室', title: content.title,
    styles: { default: { document: { run: { font: FONT, size: 22, color: INK }, paragraph: { spacing: { after: 100, line: 290 } } } } },
    sections: [{
      properties: { page: paper },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18, color: '5B6661' })] })] }) },
      children,
    }],
  }));
}
