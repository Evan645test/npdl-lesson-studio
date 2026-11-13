// R12-r10：以隔離 Chrome 將工作區備份中的專案繪成完整課程 PDF 頁面圖，供版面核對。
// 用法：node scripts/render-lesson-pdf-pages.mjs --url http://127.0.0.1:5193/ --backup <備份.json> --out <資料夾> [--runs 1,3]
import { chromium } from 'playwright-core';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const url = arg('--url') ?? 'http://127.0.0.1:5193/', backup = resolve(arg('--backup')), out = resolve(arg('--out'));
const workspace = JSON.parse(await readFile(backup, 'utf8'));
const projects = workspace.projects.filter(p => p.id !== 'manual-chemistry');
// --stress：以第 3 份產出製作極端資料（12 節、超長標題與無斷點長字、缺題組、無活動）檢查版面。
if (process.argv.includes('--stress')) {
  const base = projects[2], clone = () => structuredClone(base), design = p => p.designs.find(d => d.id === p.activeDesignId);
  const long = clone(), d = design(long);
  d.inputSnapshot.title = '公共政策參與與社區提案：從巷口候車困擾到可被公部門採納的完整政策建議書與受眾導向溝通設計';
  while (d.activities.length < 12) d.activities.push({ ...structuredClone(d.activities[d.activities.length % 8]), id: `stress-${d.activities.length}` });
  d.activities[0].name = 'A'.repeat(120); d.activities[1].task = 'https://example.org/' + 'x'.repeat(400);
  d.inputSnapshot.topic = d.inputSnapshot.topic.repeat(6);
  const noTests = clone(); noTests.assessments = []; noTests.activePreId = null; noTests.activePostId = null;
  const empty = clone(); design(empty).activities = []; design(empty).blueprint = []; design(empty).elements = [];
  projects.splice(0, projects.length, long, noTests, empty);
}
const runs = arg('--runs') ? arg('--runs').split(',').map(Number) : projects.map((_, i) => i + 1);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await (await browser.newContext()).newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(url);
const summary = [];
for (const run of runs) {
  const pages = await page.evaluate(async ({ project, modulePath }) => {
    const m = await import(modulePath); await document.fonts.ready;
    return m.renderLessonPages(project).map(c => c.toDataURL('image/png'));
  }, { project: projects[run - 1], modulePath: new URL('src/documents/lessonPdf.ts', url).pathname });
  for (const [i, data] of pages.entries()) await writeFile(resolve(out, `run${run}-p${i + 1}.png`), Buffer.from(data.split(',')[1], 'base64'));
  summary.push({ run, title: projects[run - 1].input.title, pages: pages.length });
}
await browser.close();
await writeFile(resolve(out, 'pages.json'), JSON.stringify({ url, summary, errors }, null, 2) + '\n');
console.log(JSON.stringify({ summary, errors }));
