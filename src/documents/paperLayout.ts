import type { DocumentTable } from './model';

export function dataTable(text: string): DocumentTable | null {
  const lines = text.trim().split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length < 2 || !lines.every(line => /[|｜]/.test(line))) return null;
  const split = (line: string) => line.replace(/^[|｜]\s*|\s*[|｜]$/g, '').split(/[|｜]/).map(cell => cell.trim());
  const [headers, ...body] = lines.map(split);
  if (headers.length < 2 || headers.length > 6 || headers.some(h => !h || h.length > 60) || body.some(r => r.length !== headers.length)) return null;
  const explicitHeader = body[0].every(cell => /^:?-{3,}:?$/.test(cell));
  const looksLikeObservation = /^(?:第\s*)?[甲乙丙丁戊己庚辛壬癸A-Za-z\d０-９]+(?:\s*[組杯次號])?$/u.test(headers[0]);
  // 無明確分隔列且含裸數字時，首列可能是觀察資料，不猜測為表頭。
  const hasBareNumber = headers.slice(1).some(cell => /^[+-]?(?:\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)%?$/.test(cell.normalize('NFKC')));
  if (!explicitHeader && (looksLikeObservation || hasBareNumber)) return null;
  const rows = explicitHeader ? body.slice(1) : body;
  return rows.length ? { headers, rows } : null;
}

export function studentContext(text: string): string {
  return text.replace(/^\s*依(?:教師)?建議(?:改寫|重寫)[：:]\s*/, '');
}

export function studentSetTitle(text: string, index: number): string {
  const title = studentContext(text).trim().replace(/^(?:依(?:教師)?建議)?(?:改寫|重寫)(?:的)?(?:前測|後測)?題組\s*[：:｜]\s*/, '');
  const isEditLabel = /^(?:依(?:教師)?建議)?(?:改寫|重寫)(?:的)?(?:前測|後測)?題組(?:\s*\d+)?$/.test(title);
  return '題組 ' + index + (!title || isEditLabel ? '' : '｜' + title);
}
