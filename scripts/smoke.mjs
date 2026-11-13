import { chromium } from 'playwright-core';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { root } from './files.mjs';

const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--url')throw new Error('使用 --url http://127.0.0.1:5192/R01/');
const url=new URL(args[1]);if(url.hostname!=='127.0.0.1'||url.protocol!=='http:')throw new Error('驗證限本機HTTP。');
const round=url.pathname.match(/^\/(R\d{2}(?:-[a-z0-9]+)?)\//)?.[1]??'development';
if (round === 'R09') { await import('./smoke-r09.mjs'); process.exit(0); }
if (round === 'R07' || round.startsWith('R07-r')) { await import('./smoke-r07.mjs'); process.exit(0); }
if (round === 'R08-r2') { await import('./smoke-r08r2.mjs'); process.exit(0); }
if (round === 'R08' || round.startsWith('R08-r')) { await import('./smoke-r08.mjs'); process.exit(0); }
if (round.startsWith('R03') || round.startsWith('R04') || round.startsWith('R05')) { await import('./smoke-r03.mjs'); process.exit(0); }
const output=resolve(root,'verification',round);await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const reports=[];const errors=[];const external=[];
try {
  for(const width of [1440,390,320]){
    const context=await browser.newContext({viewport:{width,height:width===1440?1000:844},deviceScaleFactor:1});
    await context.route('**/*',route=>{const dest=new URL(route.request().url());if(dest.origin!==url.origin){external.push(dest.origin);return route.abort();}return route.continue();});
    await context.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.__copiedPrompt=value;}}});});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url.href);await page.getByRole('heading',{name:'把「學會什麼」'}).waitFor();
    const checkWidth=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`頁面溢出 ${width}px`);
    await checkWidth();await page.screenshot({path:resolve(output,`cover-${width}.png`)});await page.screenshot({path:resolve(output,`desktop-${width}.png`),fullPage:true});
    await page.getByRole('heading',{name:'原始來源',exact:true}).waitFor();
    assert(await page.getByText('人工設計範例：三節反應速率資料探究課。',{exact:false}).isVisible());
    assert(await page.getByText('尚未納入學生共同設計課程、成功標準或評量',{exact:false}).isVisible());
    assert.equal(await page.getByText('設計快照學科：化學',{exact:true}).count(),1);
    const title=`隔離驗證單元-${width}`;await page.getByRole('textbox',{name:'單元名稱',exact:true}).fill(title);
    await page.reload();assert.equal(await page.getByRole('textbox',{name:'單元名稱',exact:true}).inputValue(),title);
    await page.getByRole('textbox',{name:'學科',exact:true}).fill('隔離驗證學科');
    await page.reload();assert.equal(await page.getByRole('textbox',{name:'學科',exact:true}).inputValue(),'隔離驗證學科');
    assert.equal(await page.getByText('設計快照學科：化學',{exact:true}).count(),1);
    assert.equal(await page.getByText('輸入草稿學科：隔離驗證學科',{exact:true}).count(),1);
    await page.getByRole('textbox',{name:'搜尋課綱',exact:true}).fill('CAa-Ⅴa-1');
    await page.getByRole('button',{name:'加入課綱 CAa-Ⅴa-1',exact:false}).click();
    assert.equal(await page.getByText('輸入草稿課綱：4 條',{exact:true}).count(),1);
    assert.equal(await page.getByText('設計快照課綱：3 條',{exact:true}).count(),1);
    await page.getByRole('combobox',{name:'加入草稿的子指標',exact:true}).selectOption('character-learning-to-learn');
    await page.getByRole('button',{name:'把選取的子指標加入草稿',exact:true}).click();
    assert.equal(await page.getByText('輸入草稿子指標：批判思考／評估資訊論點、品格／積極學習態度',{exact:true}).count(),1);
    assert.equal(await page.getByText('設計快照子指標：批判思考／評估資訊論點',{exact:true}).count(),1);
    assert(await page.getByRole('combobox',{name:'加入草稿的子指標',exact:true}).isDisabled());
    await checkWidth();
    const assumption='隔離驗證假設：尚未取得全班起點。';
    await page.getByRole('textbox',{name:'新增起點假設',exact:true}).fill(assumption);
    await page.getByRole('button',{name:'加入假設',exact:true}).click();
    await page.reload();
    assert(await page.getByText(assumption,{exact:true}).isVisible());
    assert.equal(await page.getByText('輸入草稿課綱：4 條',{exact:true}).count(),1);
    await page.getByRole('button',{name:'目標與規準',exact:false}).click();
    const goalOrder=await page.evaluate(()=>{const text=document.body.innerText;const success=text.indexOf('成功表現：');const blueprint=text.indexOf('前後測藍圖');return success>-1&&blueprint>success&&text.indexOf('三節課，逐步撤去支援')===-1;});
    assert.equal(goalOrder,true);
    await page.getByRole('button',{name:'活動與鷹架',exact:false}).click();
    assert(await page.getByText('能辨認同溫兩組後撤去色框。',{exact:true}).isVisible());
    await page.getByRole('button',{name:'編輯活動 1',exact:true}).click();await page.getByRole('textbox',{name:'活動任務',exact:true}).fill('隔離驗證的新版活動任務；保留原題組快照。');await page.getByRole('button',{name:'另存設計新版',exact:true}).click();
    assert.equal(await page.getByRole('combobox',{name:'設計版本',exact:true}).locator('option').count(),2);await page.reload();await page.getByRole('button',{name:'活動與鷹架',exact:false}).click();assert.equal(await page.getByRole('combobox',{name:'設計版本',exact:true}).locator('option').count(),2);
    await checkWidth();await page.getByRole('button',{name:'目標與規準',exact:false}).click();assert.equal(await page.getByText('跨題整合規則',{exact:true}).count(),1);await checkWidth();
    await page.getByRole('button',{name:'前測',exact:false}).click();assert.equal(await page.locator('.question').count(),4);assert.equal(await page.getByText('回看自己的課程證據',{exact:true}).count(),0);await page.locator('.question').first().getByText('教師核對：逐選項支持與限制',{exact:true}).click();assert(await page.getByText('辨識最小時間。',{exact:true}).isVisible());await checkWidth();
    await page.getByRole('button',{name:'後測三部分',exact:false}).click();assert.equal(await page.locator('.question').count(),6);assert.equal(await page.getByText('學科與能力的課程應用',{exact:true}).count(),1);assert.equal(await page.getByText('回看自己的課程證據',{exact:true}).count(),1);assert(await page.getByText('目前沒有足夠課程證據可自評；不因此降級。',{exact:true}).isVisible());await checkWidth();await page.screenshot({path:resolve(output,`post-${width}.png`),fullPage:true});
    await page.getByRole('button',{name:'教師判讀提示詞',exact:false}).click();await page.getByRole('button',{name:'複製完整提示詞',exact:true}).click();const copied=await page.evaluate(()=>window.__copiedPrompt);assert(copied.includes('<<<BEGIN_DESIGN_DATA>>>'));assert(copied.includes('沒有學生作答'));assert(!copied.includes('隔離驗證的新版活動任務'));
    const promptDownload=page.waitForEvent('download');await page.getByRole('button',{name:'下載提示詞',exact:true}).click();const textDownload=await promptDownload;await textDownload.saveAs(resolve(output,`prompt-${width}.txt`));assert.equal(await readFile(resolve(output,`prompt-${width}.txt`),'utf8'),copied);
    const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'下載備份',exact:true}).click();const backup=await downloadEvent;const backupPath=resolve(output,`backup-${width}.json`);await backup.saveAs(backupPath);const payload=JSON.parse(await readFile(backupPath,'utf8'));assert.equal(payload.projects[0].designs.length,2);assert.equal(payload.projects[0].assessments[0].designId,payload.projects[0].designs[0].id);
    await page.getByLabel('轉入備份檔案',{exact:true}).setInputFiles(backupPath);await page.getByRole('status').filter({hasText:'備份已轉入新副本'}).waitFor();assert.equal(await page.getByRole('combobox',{name:'工作區專案',exact:true}).locator('option').count(),2);await page.reload();assert.equal(await page.getByRole('combobox',{name:'工作區專案',exact:true}).locator('option').count(),2);
    await page.getByLabel('轉入備份檔案',{exact:true}).setInputFiles({name:'future.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...payload,schemaVersion:99}))});await page.getByRole('status').filter({hasText:'未轉入'}).waitFor();assert((await page.getByRole('status').textContent()).includes('未轉入'));assert.equal(await page.getByRole('combobox',{name:'工作區專案',exact:true}).locator('option').count(),2);
    const goalText='隔離驗證的成功表現草稿，尚未取代原題組。';
    const fadingText='隔離驗證才撤去提示。';
    await page.getByRole('button',{name:'目標與規準',exact:false}).click();
    await page.getByRole('button',{name:'修改目標與成功表現',exact:true}).click();
    await checkWidth();
    await page.getByRole('textbox',{name:'學科成功表現',exact:true}).fill(goalText);
    await page.getByRole('button',{name:'另存目標草稿',exact:true}).click();
    await page.getByRole('button',{name:'活動與鷹架',exact:false}).click();
    assert.equal(await page.getByRole('combobox',{name:'設計版本',exact:true}).locator('option').count(),3);
    await page.getByRole('button',{name:'編輯第1節鷹架',exact:true}).click();
    await checkWidth();
    await page.getByRole('textbox',{name:'第1節證據有限撤去條件',exact:true}).fill(fadingText);
    await page.getByRole('button',{name:'另存第1節鷹架草稿',exact:true}).click();
    assert.equal(await page.getByRole('combobox',{name:'設計版本',exact:true}).locator('option').count(),4);
    await page.reload();await page.getByRole('button',{name:'活動與鷹架',exact:false}).click();
    assert.equal(await page.getByRole('combobox',{name:'設計版本',exact:true}).locator('option').count(),4);
    await page.getByRole('button',{name:'教師判讀提示詞',exact:false}).click();
    await page.getByRole('button',{name:'複製完整提示詞',exact:true}).click();
    const revisedPrompt=await page.evaluate(()=>window.__copiedPrompt);
    assert(revisedPrompt.includes('<<<BEGIN_DESIGN_DATA>>>'));
    assert(revisedPrompt.includes('能選用可比較資料'));
    assert(!revisedPrompt.includes(goalText));
    assert(!revisedPrompt.includes(fadingText));
    assert(!revisedPrompt.includes('隔離驗證的新版活動任務'));
    const revisedDownload=page.waitForEvent('download');await page.getByRole('button',{name:'下載備份',exact:true}).click();const revisedBackup=await revisedDownload;const revisedPath=resolve(output,`revision-${width}.json`);await revisedBackup.saveAs(revisedPath);
    const revised=JSON.parse(await readFile(revisedPath,'utf8'));
    const active=revised.projects.find(item=>item.id===revised.activeProjectId);
    assert.equal(active.designs.length,4);
    assert.equal(active.assessments[0].designId,active.designs[0].id);
    assert.equal(active.assessments[1].designId,active.designs[0].id);
    assert.equal(active.assessments[1].application.length,2);
    assert.equal(active.assessments[1].reflection.length,1);
    assert.equal(active.designs[0].activities[0].scaffolds[0].fading,'能辨認同溫兩組後撤去色框。');
    assert.equal(active.designs[2].goals[0].success,goalText);
    assert.equal(active.designs[3].activities[0].scaffolds[0].fading,fadingText);
    assert.equal(active.designs[3].inputSnapshot.subject,'化學');
    assert.equal(active.input.subject,'隔離驗證學科');
    assert.deepEqual(active.input.indicatorIds,['critical-evaluate-information','character-learning-to-learn']);
    assert.deepEqual(active.designs[0].inputSnapshot.indicatorIds,['critical-evaluate-information']);
    await checkWidth();
    reports.push({width,passed:['no-overflow','edit-save-reload','draft-subject-keeps-design-snapshot','curriculum-draft-not-design','two-indicator-cap','assumption-persists','goals-before-blueprint','scaffold-fading-visible','immutable-design-revision','pre-only-capability','post-three-parts','option-supports-limits','original-snapshot-prompt','prompt-download','backup-download-import-reload','incompatible-backup-preserves-data','goal-and-scaffold-revision-keep-item-snapshot']});
    await context.close();
  }
  // Corrupt existing storage: app must expose the original bytes and keep the key untouched.
  const context=await browser.newContext();const page=await context.newPage();await page.goto(url.href);
  const key=await page.evaluate(()=>{const round=location.pathname.match(/^\/(R\d{2}(?:-[a-z0-9]+)?)\//)?.[1];const key='npdl_next_workspace_v1'+(round?`:preview:${round}`:'');localStorage.setItem(key,'{broken');return key;});
  await page.reload();assert(await page.getByRole('button',{name:'下載原儲存內容',exact:true}).isVisible());assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),'{broken');await context.close();
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const result={status:'passed',url:url.href,round,browser:'isolated Google Chrome',realAI:false,externalRequests:external,pageErrors:errors,viewports:reports,corruptStorageProtected:true};await writeFile(resolve(output,'smoke.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch(error){await writeFile(resolve(output,'smoke-failure.json'),JSON.stringify({status:'failed',message:error.message,pageErrors:errors,externalRequests:external},null,2)+'\n');throw error;}
finally{await browser.close();}
