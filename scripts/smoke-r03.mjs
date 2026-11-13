import { chromium } from 'playwright-core';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { root } from './files.mjs';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--url') throw new Error('使用 --url 本機 R03、R04 或 R05 預覽。');
const url = new URL(args[1]);
if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') throw new Error('僅允許本機 HTTP。');
const round = url.pathname.match(/^\/(R\d{2}(?:-[a-z0-9]+)?)\//)?.[1] ?? 'R03-development';
const output = resolve(root, 'verification', round); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const errors = [], external = [], reports = [], requests = [];
const testKey = 'sk-isolated-browser-test-key';
async function backup(page, name) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: '下載備份', exact: true }).click(); const download = await wait, path = resolve(output, name); await download.saveAs(path); return JSON.parse(await readFile(path, 'utf8')); }
async function openTools(page) { if (!(await page.locator('.r03-tools').getAttribute('open'))) await page.locator('.r03-tools > summary').click(); }
async function consent(page) { await page.getByRole('checkbox', { name: '我已檢查必要資料、去識別與費用，同意這一次請求' }).check(); await page.getByRole('button', { name: '同意並送出這次請求', exact: true }).click(); }
async function generated(page, label) { await page.getByRole('status').filter({ hasText: label }).waitFor({ timeout: 20000 }); }
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 1000 : 844 }, deviceScaleFactor: 1 });
    let fixture, mode = 'valid', count = 0;
    await context.route('**/*', async route => {
      const dest = new URL(route.request().url());
      if (dest.origin === url.origin) return route.continue();
      if (dest.href !== 'https://api.openai.com/v1/responses') { external.push(dest.origin); return route.abort(); }
      const body = route.request().postDataJSON(), matched = body.input.match(/<<<BEGIN_INPUT_DATA>>>\n([\s\S]*)\n<<<END_INPUT_DATA>>>/);
      assert(matched, '請求必須有資料界線'); const data = JSON.parse(matched[1]);
      assert.equal(body.store, false); assert(!JSON.stringify(body).includes(testKey)); assert(!JSON.stringify(data).includes('teacherNotes')); assert(!JSON.stringify(data).includes('originalSource'));
      requests.push({ width, kind: data.task, repair: !!data.repair, bytes: Buffer.byteLength(JSON.stringify(body)), mocked: true }); count++;
      if (mode === 'failure') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'simulated failure' } }) });
      if (mode === 'delay') await new Promise(resolve => setTimeout(resolve, 900));
      let value;
      if (mode === 'invalid') { value = { invalid: '僅作隔離測試' }; mode = 'valid'; }
      else if (data.task === 'recommend') value = { recommendations: [{ indicatorId: 'critical-evaluate-information', reason: '依目前資料判斷與有限主張的目標提供推薦。', assumptions: ['學生起點未知，待教師核對。'] }] };
      else if (data.task === 'design') { const { id, createdAt, confirmedAt, origin, inputSnapshot, rubricVersion, ...content } = fixture.projects[0].designs[0]; value = { ...content, summary: '隔離模擬 AI 設計，等待教師核對；未使用真實供應商。' }; }
      else { const a = fixture.projects[0].assessments[data.task === 'pre' ? 0 : 1]; value = { capability: a.capability, application: a.application, reflection: a.reflection }; }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }], usage: { total_tokens: 200 } }) }).catch(() => {});
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(url.href); await page.getByRole('heading', { name: '把「學會什麼」' }).waitFor();
    const checkWidth = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `頁面溢出 ${width}px`);
    await checkWidth();
    const r04Passed = [];
    if (/\/R0[45]/.test(url.pathname)) {
      await page.getByRole('button', { name: '前測', exact: false }).click();
      assert.equal(await page.getByText('回看自己的課程證據', { exact: true }).count(), 0);
      assert(await page.getByText('前測沒有課程應用，也沒有自評。', { exact: true }).isVisible());
      assert.equal(await page.locator('.question').count(), 4);
      await page.locator('.question').first().getByText('教師核對：逐選項支持與限制', { exact: true }).click();
      assert(await page.getByText('辨識最小時間。', { exact: true }).isVisible());
      assert(await page.getByText('比較條件待確認', { exact: false }).first().isVisible());
      assert(await page.getByText('tool-four-chemistry-2026-10-07-v1', { exact: false }).first().isVisible());
      assert(await page.getByRole('region', { name: '比較限制' }).getByText('不能把兩份題本的差異寫成變化', { exact: false }).isVisible());
      await page.getByRole('button', { name: '後測三部分', exact: false }).click();
      await page.getByRole('heading', { name: '後測第一部分：可比較能力題', exact: true }).waitFor();
      assert.equal(await page.getByText('學科與能力的課程應用', { exact: true }).count(), 1);
      assert.equal(await page.getByText('回看自己的課程證據', { exact: true }).count(), 1);
      assert(await page.getByText('目前沒有足夠課程證據可自評；不因此降級。', { exact: true }).isVisible());
      assert(await page.getByText('不扣分', { exact: false }).first().isVisible());
      assert(await page.getByText('先找公平比較，再談快慢', { exact: false }).isVisible());
      assert(await page.getByText('這裡沒有上傳學生作答的地方', { exact: false }).isVisible());
      assert(await page.getByText('PDF 以影像保留繁體中文', { exact: false }).first().isVisible());
      assert(await page.getByText('學生題本不含選項支持', { exact: false }).first().isVisible());
      await checkWidth();
      await page.getByRole('button', { name: '課程與起點', exact: false }).click();
      r04Passed.push('seed-pre-without-reflection', 'seed-post-three-parts', 'seed-no-score', 'seed-comparison-visible', 'seed-no-overflow');
    }
    fixture = await backup(page, `fixture-${width}.json`); assert.equal(fixture.schemaVersion, 2);
    await page.getByRole('textbox', { name: '教師來源註記', exact: true }).fill('隔離教師註記，不能自動送出');
    await page.reload(); assert.equal(await page.getByRole('textbox', { name: '教師來源註記', exact: true }).inputValue(), '隔離教師註記，不能自動送出');
    await openTools(page); await page.getByRole('textbox', { name: '本頁 API key', exact: true }).fill(testKey);
    await page.getByRole('button', { name: '預覽子指標推薦資料', exact: true }).click();
    assert(await page.getByRole('button', { name: '同意並送出這次請求', exact: true }).isDisabled());
    assert(!(await page.getByRole('textbox', { name: '本次必要資料' }).inputValue()).includes('隔離教師註記'));
    await page.getByRole('button', { name: '取消這次請求', exact: true }).click(); assert.equal(count, 0);
    await page.getByRole('button', { name: '預覽子指標推薦資料', exact: true }).click(); await consent(page); await generated(page, '推薦已收到'); assert.equal(count, 1); await checkWidth();
    await page.getByRole('textbox', { name: '單元名稱', exact: true }).fill(`R03 隔離單元 ${width}`);
    assert(await page.getByRole('button', { name: '將推薦放入子指標草稿' }).isDisabled());
    await page.getByRole('button', { name: '核對此起點、課綱與子指標', exact: true }).click(); await generated(page, '已核對');
    await page.getByRole('button', { name: '預覽新版設計資料', exact: true }).click(); await checkWidth(); await consent(page); await generated(page, 'AI 設計另存成新版草稿');
    const designed = await backup(page, `designed-${width}.json`); assert.equal(designed.projects[0].designs.length, 2); assert.deepEqual(designed.projects[0].assessments, fixture.projects[0].assessments); assert.equal(designed.projects[0].designs[1].inputSnapshot.title, `R03 隔離單元 ${width}`);
    await page.getByRole('button', { name: '確認此設計的整合規則', exact: true }).click(); await generated(page, '整合規則已由教師確認');
    await page.getByRole('button', { name: '確認目前設計', exact: true }).click(); await generated(page, '設計已由教師確認');
    mode = 'invalid'; await page.getByRole('button', { name: '預覽前測生成資料', exact: true }).click(); await consent(page);
    await page.getByRole('heading', { name: '唯一一次格式修復・再次同意', exact: true }).waitFor();
    assert(!(await page.getByRole('checkbox', { name: '我已檢查必要資料、去識別與費用，同意這一次請求' }).isChecked()));
    await consent(page); await generated(page, '完整前測已保存');
    const beforePost = await backup(page, `pre-complete-${width}.json`); assert.equal(beforePost.projects[0].assessments.length, 3); assert.equal(beforePost.projects[0].activePostId, null);
    mode = 'failure'; await page.getByRole('button', { name: '預覽只補後測資料', exact: true }).click(); await consent(page); await generated(page, 'HTTP 503');
    const failed = await backup(page, `post-failed-${width}.json`); assert.deepEqual(failed, beforePost);
    await page.reload(); await openTools(page); assert.equal(await page.getByRole('textbox', { name: '本頁 API key', exact: true }).inputValue(), ''); await page.getByRole('textbox', { name: '本頁 API key', exact: true }).fill(testKey);
    mode = 'valid'; await page.getByRole('button', { name: '預覽只補後測資料', exact: true }).click(); await consent(page); await generated(page, '完整後測三部分已保存');
    const completed = await backup(page, `completed-${width}.json`); assert.equal(completed.projects[0].assessments.length, 4); assert.deepEqual(completed.projects[0].assessments[2], beforePost.projects[0].assessments[2]); assert.equal(completed.projects[0].assessments[3].parentPreId, beforePost.projects[0].activePreId); assert.equal(completed.projects[0].assessments[3].reflection.length, 1);
    mode = 'delay'; await page.getByRole('button', { name: '預覽只補後測資料', exact: true }).click(); await consent(page); await page.getByRole('button', { name: '取消這次請求', exact: true }).click(); await generated(page, '已取消'); assert.deepEqual(await backup(page, `cancelled-${width}.json`), completed); mode = 'valid';
    await page.getByRole('button', { name: '確認前測題組', exact: true }).click(); await generated(page, '前測題組已核對');
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '記錄前測已施測', exact: true }).click(); await generated(page, '已記錄實際施測');
    if (url.pathname.includes('/R05')) {
      await page.getByRole('button', { name: '後測三部分', exact: false }).click();
      assert(await page.getByRole('region', { name: '比較限制' }).getByText('後測尚未記錄實際施測', { exact: false }).isVisible());
    }
    await page.getByRole('button', { name: '確認後測題組', exact: true }).click(); await generated(page, '後測題組已核對');
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: '記錄後測已施測', exact: true }).click(); await generated(page, '已記錄實際施測');
    const tested = await backup(page, `tested-${width}.json`); assert(tested.projects[0].assessments[2].administeredAt); assert(tested.projects[0].assessments[3].administeredAt);
    for (const audience of ['學生題本', '教師手冊']) for (const format of ['Markdown', 'Word', 'PDF']) {
      const ext = format === 'Markdown' ? 'md' : format === 'Word' ? 'docx' : 'pdf';
      const waiting = page.waitForEvent('download', { timeout: 60000 }); await page.getByRole('button', { name: `下載${audience} ${format}`, exact: true }).click();
      const download = await waiting; await download.saveAs(resolve(output, `${audience === '學生題本' ? 'student' : 'teacher'}-${width}.${ext}`));
      await generated(page, '文件已產生');
    }
    const student = await readFile(resolve(output, `student-${width}.md`), 'utf8'), teacher = await readFile(resolve(output, `teacher-${width}.md`), 'utf8');
    assert(student.includes('後測第三部分')); assert(!student.includes('可支持：')); assert(teacher.includes('完整教師判讀提示詞')); assert(teacher.includes('不支持／限制：')); assert(!teacher.includes(testKey));
    await checkWidth(); await page.screenshot({ path: resolve(output, `tools-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: '後測三部分', exact: false }).click(); await page.locator('.r03-tools > summary').click(); await checkWidth(); await page.screenshot({ path: resolve(output, `post-${width}.png`), fullPage: true });
    if (/\/R0[45]/.test(url.pathname)) {
      assert(await page.getByText('已施測', { exact: true }).first().isVisible());
      if (url.pathname.includes('/R05')) assert(await page.getByRole('region', { name: '比較限制' }).getByText('藍圖中的比較條件尚待核對', { exact: false }).isVisible());
      else assert(await page.getByRole('region', { name: '比較限制' }).getByText('沒有總分或名次', { exact: false }).isVisible());
      const supplement = page.getByRole('button', { name: '只補後測，先看要傳的資料', exact: true });
      await supplement.focus();
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), '只補後測，先看要傳的資料');
      await page.keyboard.press('Enter');
      await page.getByRole('heading', { name: '這次要傳給 OpenAI 的必要資料', exact: true }).waitFor();
      await page.getByRole('button', { name: '取消這次請求', exact: true }).click();
      await page.getByRole('button', { name: '由此下載學生題本 Markdown', exact: true }).waitFor();
      await checkWidth();
      r04Passed.push('administered-visible', 'keyboard-post-only-consent', 'page-export-entry', 'no-growth-score');
    }
    await page.getByRole('button', { name: '活動與鷹架', exact: false }).click(); await page.getByRole('button', { name: '編輯活動 1', exact: true }).click(); await page.getByRole('textbox', { name: '活動任務', exact: true }).fill('R03 施測後新活動草稿，不能混入歷史提示詞'); await page.getByRole('button', { name: '另存設計新版', exact: true }).click();
    await page.getByRole('button', { name: '教師判讀提示詞', exact: false }).click(); assert(!(await page.getByRole('textbox', { name: '完整教師判讀提示詞' }).inputValue()).includes('R03 施測後新活動草稿'));
    const revised = await backup(page, `revised-${width}.json`); assert.deepEqual(revised.projects[0].assessments, tested.projects[0].assessments); assert.equal(revised.projects[0].designs[2].confirmedAt, null);
    await page.getByLabel('轉入備份檔案', { exact: true }).setInputFiles(resolve(output, `revised-${width}.json`)); await generated(page, '備份已轉入新副本'); await page.reload(); assert.equal(await page.getByRole('combobox', { name: '工作區專案', exact: true }).locator('option').count(), 2);
    await page.getByLabel('轉入備份檔案', { exact: true }).setInputFiles({ name: 'unknown.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...revised, extra: '不得丟棄' })) }); await generated(page, '未轉入'); assert.equal(await page.getByRole('combobox', { name: '工作區專案', exact: true }).locator('option').count(), 2);
    if (url.pathname.includes('/R05')) {
      const oldAssessment = JSON.stringify({ version: 1, activeId: 'old-project', projects: [{ id: 'old-project', input: { title: '舊評量課' }, versions: [
        { id: 'pre-old', phase: 'pre', preId: null, sourceKey: 'old-source', administeredAt: 100, input: { title: '舊評量課' }, plan: { rubrics: ['原規準'] }, blocks: [{ cases: [{ questions: [{ prompt: '原始前測題' }] }] }] },
        { id: 'post-old', phase: 'post', preId: 'pre-old', sourceKey: 'old-source', administeredAt: 200, input: { title: '舊評量課' }, plan: { rubrics: ['原規準'] }, blocks: [{ cases: [{ questions: [{ prompt: '原始後測題' }] }] }] },
      ] }] });
      const oldCourse = JSON.stringify({ schemaVersion: 5, courseId: 'old-course', form: { unitName: '舊課程' }, selectedRecordIds: [], design: { activities: ['原活動'] }, assessment: { preQuestions: ['原題'] }, students: [] });
      for (const [name, raw] of [['old-assessment.json', oldAssessment], ['old-course.json', oldCourse]]) {
        await page.getByLabel('轉入備份檔案', { exact: true }).setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(raw) });
        await generated(page, '舊備份已保留為原始副本');
      }
      await page.reload();
      await page.locator('.legacy-library > summary').click();
      assert(await page.getByText('舊評量課', { exact: true }).isVisible());
      assert(await page.getByText('舊課程', { exact: true }).isVisible());
      const legacyBackup = await backup(page, `legacy-imported-${width}.json`);
      assert.equal(legacyBackup.legacyImports[0].raw, oldAssessment);
      assert.equal(legacyBackup.legacyImports[1].raw, oldCourse);
      assert.equal(legacyBackup.projects.length, 2);
      const waitLegacy = page.waitForEvent('download');
      await page.getByRole('button', { name: '下載這份原始備份' }).first().click();
      const oldDownload = await waitLegacy;
      const oldPath = resolve(output, `legacy-source-${width}.json`);
      await oldDownload.saveAs(oldPath);
      assert.equal(await readFile(oldPath, 'utf8'), oldAssessment);
      await page.getByLabel('轉入備份檔案', { exact: true }).setInputFiles({ name: 'students.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...JSON.parse(oldCourse), students: [{ name: '不可轉入' }] })) });
      await generated(page, '含學生證據');
      assert.equal((await backup(page, `legacy-rejected-${width}.json`)).legacyImports.length, 2);
      r04Passed.push('old-assessment-raw-copy', 'old-course-raw-copy', 'legacy-download-exact', 'student-evidence-rejected', 'comparison-gates');
    }
    await checkWidth(); reports.push({ width, requests: count, passed: ['notes-reload-original-kept', 'cancel-consent-zero-requests', 'recommend-stale-blocked', 'reviewed-design-new-version', 'pre-invalid-one-repair-consent', 'pre-saved-post-failure-reload-post-only', 'memory-key-cleared-reload', 'in-flight-cancel-preserves', 'review-versus-administer', 'six-real-downloads', 'student-no-teacher-rules', 'three-purpose-parts', 'tested-snapshots-immutable', 'backup-copy-unknown-rejected', 'no-overflow', ...r04Passed] }); await context.close();
  }
  const context = await browser.newContext(), page = await context.newPage();
  await context.route('**/*', route => new URL(route.request().url()).origin === url.origin ? route.continue() : route.abort());
  await page.goto(url.href); await page.evaluate(() => { const round = location.pathname.match(/^\/(R\d{2}(?:-[a-z0-9]+)?)\//)?.[1]; localStorage.setItem(`npdl_next_workspace_v1${round ? ':preview:' + round : ''}`, '{broken'); }); await page.reload(); assert(await page.getByRole('button', { name: '下載原儲存內容' }).isVisible()); await context.close();
  const migrationContext = await browser.newContext(), migrationPage = await migrationContext.newPage();
  await migrationContext.route('**/*', route => new URL(route.request().url()).origin === url.origin ? route.continue() : route.abort());
  await migrationPage.goto(url.href);
  const legacyPath = resolve(root, 'verification/R02/backup-1440.json');
  const legacy = JSON.parse(await readFile(legacyPath, 'utf8'));
  await migrationPage.getByLabel('轉入備份檔案', { exact: true }).setInputFiles(legacyPath); await generated(migrationPage, '備份已轉入新副本');
  const migrated = await backup(migrationPage, 'r02-v1-imported.json'), copy = migrated.projects[1];
  assert.equal(migrated.schemaVersion, 2); assert.deepEqual(copy.assessments, legacy.projects[0].assessments); assert.deepEqual(copy.input.originalSource, legacy.projects[0].input.originalSource); assert.equal(copy.input.indicatorReview.confirmedAt, null);
  await migrationPage.reload(); assert.equal(await migrationPage.getByRole('combobox', { name: '工作區專案', exact: true }).locator('option').count(), 2);
  await migrationContext.close();
  const quotaContext = await browser.newContext(); await quotaContext.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); }; });
  await quotaContext.route('**/*', route => new URL(route.request().url()).origin === url.origin ? route.continue() : route.abort());
  const quotaPage = await quotaContext.newPage(); await quotaPage.goto(url.href); await quotaPage.getByRole('textbox', { name: '單元名稱', exact: true }).fill('儲存配額失敗草稿'); await generated(quotaPage, '尚未保存');
  const quotaBackup = await backup(quotaPage, 'quota-preserved.json'); assert.equal(quotaBackup.projects[0].input.title, '儲存配額失敗草稿'); await openTools(quotaPage); assert(await quotaPage.getByRole('button', { name: '預覽前測生成資料', exact: true }).isDisabled()); await quotaContext.close();
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const result = { status: 'passed', url: url.href, browser: 'isolated Google Chrome', realAI: false, externalRequests: external, mockedRequests: requests, pageErrors: errors, viewports: reports, corruptStorageProtected: true };
  await writeFile(resolve(output, 'smoke.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify({ status: result.status, viewports: reports.map(r => r.width), mockedRequests: requests.length, realAI: false }));
} catch (error) { await writeFile(resolve(output, 'smoke-failure.json'), JSON.stringify({ status: 'failed', error: error.message, pageErrors: errors, externalRequests: external }, null, 2)); throw error; }
finally { await browser.close(); }
