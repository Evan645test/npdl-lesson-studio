import { chromium } from 'playwright-core';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { root } from './files.mjs';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--url') throw new Error('使用 --url http://127.0.0.1:5199/R09/');
const url = new URL(args[1]);
if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.pathname.endsWith('/R09/')) throw new Error('R09 驗證限本機預覽。');
const curriculum = JSON.parse(await readFile(resolve(root, 'src/data/curriculum.json'), 'utf8'));
const indicators = JSON.parse(await readFile(resolve(root, 'src/data/indicators.json'), 'utf8'));
const performance = curriculum.find(row => row.subject === '化學' && row.kind === 'learning_performance') ?? curriculum.find(row => row.subject === '自然科學' && row.kind === 'learning_performance');
assert(performance);
const suggestion = { title: '生活資料判讀', periods: 3, curriculumIds: [performance.id], indicatorIds: [indicators.entries[0].id], reason: '由生活資料判讀連結學習表現與可觀察能力。' };
const output = resolve(root, 'verification/R09');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const reports = [];
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
    const page = await context.newPage();
    const errors = []; const external = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', route => {
      const destination = new URL(route.request().url());
      if (destination.origin === url.origin) return route.continue();
      if (destination.origin === 'https://api.openai.com') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(suggestion) }] }], usage: { total_tokens: 100 } }) });
      external.push(destination.origin); return route.abort();
    });
    await page.goto(url.href);
    await page.getByRole('heading', { name: '填寫課程方向' }).waitFor();
    assert.equal(await page.getByRole('heading', { name: '查看並選擇課綱' }).count(), 0);
    await page.getByLabel('發想 API key').fill('sk-isolated-browser-test');
    await page.getByRole('button', { name: '完成設定並收起' }).click();
    await page.getByLabel('年級').selectOption('高二');
    await page.getByLabel('學科').selectOption(performance.subject);
    await page.getByLabel('教學主題').fill('如何從生活資料提出可信的判斷？');
    await page.getByLabel('單元名稱').fill('生活資料判讀');
    await page.getByLabel('核心關鍵字').fill('資料、證據、判讀');
    await page.getByRole('button', { name: '請 AI 推薦課綱與 NPDL' }).click();
    await page.getByRole('dialog', { name: 'AI 傳送資料預覽' }).waitFor();
    const preview = await page.getByLabel('AI 必要資料').inputValue();
    assert(preview.includes(performance.id));
    assert(!preview.includes('sk-isolated-browser-test'));
    await page.getByRole('checkbox', { name: '我已檢查本次資料、去識別與費用，同意傳送' }).check();
    await page.getByRole('button', { name: '同意並送出' }).click();
    await page.getByRole('heading', { name: 'AI 推薦，待老師選擇' }).waitFor();
    await page.getByRole('button', { name: '帶入建議，再逐項核對' }).click();
    assert.equal(await page.getByLabel('總節數').inputValue(), '3');
    await page.getByText('查看四階進程敘述').first().click();
    assert(await page.getByText('證據有限：').first().isVisible());
    await page.reload();
    await page.getByRole('heading', { name: '查看並選擇課綱' }).waitFor();
    assert.equal(await page.getByLabel('總節數').inputValue(), '3');
    assert.equal(await page.locator('.sp-dimension').count(), 6);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    await page.screenshot({ path: resolve(output, `selection-${width}.png`), fullPage: true });
    reports.push({ width, persisted: true, sixPictureCards: true, noHorizontalOverflow: true, pageErrors: errors.length, external });
    await context.close();
  }
} finally { await browser.close(); }
await writeFile(resolve(output, 'smoke.json'), JSON.stringify({ url: url.href, reports, realAiRequests: 0 }, null, 2) + '\n');
console.log(JSON.stringify({ result: 'passed', reports }));
