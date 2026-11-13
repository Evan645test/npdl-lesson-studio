import type { AuditIssue, AuditSource } from './assessmentAudit';

const equal = /(?:平均[^，。；！？\n]{0,14}(?:相同|相等|一樣)|相同的平均)/u;
const conditional = /(?:假設|假如|如果|是否|若|傳言|聲稱|據說|以為|不一定|未必|不見得|不(?:相同|相等|一樣)|並非|絕非|並不是|不正確|不成立|錯誤|未確認|有別|實際上|與否|約略|大約|四捨五入|取整)/u;
const row = /^\s*[^：:\n]+[：:]\s*(\d+(?:\.\d+)?)\s*([^\d（(\n]+?)\s*[（(]\s*(\d+)\s*([^）)\n]+)\s*[）)]\s*[。；]?\s*$/u;
const isHeading = /^\s*[^：:\n]{1,60}[：:]\s*$/u;
const dataLike = /[（(]\s*\d+\s*\p{L}[^）)]*[）)]/u;
const countUnits = new Set(['人','人次','次','筆','件','名','份','個','個體','例','隻','組','株','顆','張','台','輛','袋']);
const claimsEqual = (value: string) => value.split(/[。！？；\n]/).filter(line => equal.test(line) && !conditional.test(line));

function identifiesPair(context: string, a: string, b: string): boolean {
  const names = [a,b].map(name => name.replace(/[（(].*$/u, '').trim());
  if (names.some(name => !name)) return false;
  if (names.every(name => context.includes(name))) return true;
  const [m,n] = names.map(name => name.match(/^(.*?)([A-Za-z0-9]+)$/u));
  if (!m || !n || !m[1] || m[1] !== n[1]) return false;
  return ['和','與','及','、'].some(join => context.includes(names[0]+join+n[2]) || context.includes(names[1]+join+m[2]));
}

function quantityFits(claim: string, unit: string) {
  if (/^(分鐘|秒|小時|天|日|毫秒)$/u.test(unit)) return /時間|等候|等待|耗時|工時|時長|歷時/u.test(claim) && !/年齡/u.test(claim);
  if (/^(分|點)$/u.test(unit)) return /分數|評分|得分|平均分|成績/u.test(claim);
  if (/^(公斤|公克|毫克|克|kg|g)$/u.test(unit)) return /重量|質量|體重/u.test(claim);
  if (/^(公尺|公分|公里|m|cm|km)$/u.test(unit)) return /長度|距離|高度|身高/u.test(claim);
  return false;
}

function weightedGroups(text: string) {
  const rows = text.split('\n');
  const recognized = new Set<number>();
  const groups: { name:string; lines:string[]; sum:number; count:number; unit:string; countUnit:string }[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (!isHeading.test(rows[i]) || !row.test(rows[i+1] ?? '')) continue;
    const group = { name: rows[i].trim().replace(/[：:]$/, ''), lines: [rows[i]], sum:0,count:0,unit:'',countUnit:'' };
    let matches = 0;
    while (i+1 < rows.length) {
      const raw = rows[i+1], match = raw.match(row);
      if (!match) {
        if (dataLike.test(raw) && !isHeading.test(raw)) return null;
        break;
      }
      i++; recognized.add(i);
      const [,x,unit,n,countUnit] = match;
      if (matches && (unit.trim() !== group.unit || countUnit.trim() !== group.countUnit)) return null;
      const amount = Number(x), frequency = Number(n);
      if (!Number.isFinite(amount) || !Number.isSafeInteger(frequency) || frequency <= 0 || !countUnits.has(countUnit.trim())) return null;
      group.unit = unit.trim();group.countUnit = countUnit.trim();
      group.sum += amount*frequency;group.count += frequency;group.lines.push(raw);matches++;
    }
    const next = rows.slice(i+1).find(line => line.trim());
    if (next && dataLike.test(next) && !isHeading.test(next)) return null;
    if (matches < 2 || !Number.isFinite(group.sum) || !Number.isSafeInteger(group.count)) return null;
    groups.push(group);
  }
  if (rows.some((line,i) => !recognized.has(i) && dataLike.test(line) && /[：:]/.test(line))) return null;
  if (groups.length !== 2 || groups[0].name === groups[1].name || groups[0].unit !== groups[1].unit || groups[0].countUnit !== groups[1].countUnit) return null;
  return groups;
}

export function meanClaimIssues(source: AuditSource): AuditIssue[] {
  const result: AuditIssue[] = [];
  for (const target of source.targets) {
    const g = target.ref.split('-')[0];
    const ctx = source.student.find(item => item.ref === g + '-context');
    const data = source.student.find(item => item.ref === g + '-data');
    const prompt = source.student.find(item => item.ref === target.ref);
    if (!ctx || !data || !prompt) continue;
    // A hypothesis on a question alone is not a factual premise. Require an
    // assertion in the shared context and a corresponding teacher claim.
    const claim = claimsEqual(ctx.text)[0];
    const key = source.teacher.find(item => item.ref === target.ref + '-key')?.text;
    const teacher = source.teacher.find(item => item.target === target.ref && claimsEqual(item.text).length > 0
      && (target.part === 'choice' ? key && item.ref === target.ref + '-' + key + '-judge' : item.ref.endsWith('-above') || item.ref.endsWith('-criteria')));
    if (!claim || !teacher) continue;
    const groups = weightedGroups(data.text);
    if (!groups) continue;
    const [a,b] = groups;
    if (!quantityFits(claim,a.unit)) continue;
    const referential = /(?:兩|二)(?:家|館|校|組|班|側)(?:的|各自的)?平均/u.test(claim);
    if (!identifiesPair(claim,a.name,b.name) && !(referential && identifiesPair(ctx.text,a.name,b.name))) continue;
    const m = a.sum/a.count, n = b.sum/b.count;
    if (Math.abs(m-n) <= Math.max(1,Math.abs(m),Math.abs(n))*1e-9) continue;
    const display = (value: number) => Number(value.toPrecision(14)).toString();
    result.push({ kind:'prompt-rubric-mismatch', target:target.ref, label:target.label,
      explanation: `題面和教師判讀稱平均相同，但按原始頻數加權：${a.name} ${display(a.sum)} ÷ ${a.count} = ${display(m)} ${a.unit}；${b.name} ${display(b.sum)} ÷ ${b.count} = ${display(n)} ${b.unit}。兩組不同，請核對這個前提。`,
      evidence:[{ref:ctx.ref,label:ctx.label,quote:claim.trim()},
        ...groups.map(group => ({ref:data.ref,label:data.label,quote:group.lines.join('\n').trim()})),
        {ref:prompt.ref,label:prompt.label,quote:prompt.text},
        {ref:teacher.ref,label:teacher.label,quote:teacher.text}] });
  }
  return result;
}
