import { readFile, writeFile, mkdir, cp, access, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { root, listFiles, sourceManifest, sha256 } from './files.mjs';

const args=process.argv.slice(2); const index=args.indexOf('--round');
if(args.length!==2 || index!==0 || !/^R\d{2}(?:-[a-z0-9]+)?$/.test(args[1]))throw new Error('使用 --round R01 或 --round R01-r2。');
const round=args[1], folder=resolve(root,'previews',round);
try { if ((await readdir(folder)).length) throw new Error(`${round} 已存在。保留既有預覽，請改用修正版名稱。`); } catch(error) { if(error.code!=='ENOENT')throw error; }
const zip=resolve(root,'previews',`${round}.zip`);
try{await access(zip);throw new Error('ZIP已存在，不覆寫。');}catch(error){if(error.code!=='ENOENT')throw error;}
// Check a completed build before creating a release directory.
await import('./check-build.mjs');
const sources=await sourceManifest();
await mkdir(folder,{recursive:true});
for (const name of await readdir(resolve(root,'dist'))) await cp(resolve(root,'dist',name),resolve(folder,name),{recursive:true,errorOnExist:true,force:false});
await writeFile(resolve(folder,'source-manifest.json'),JSON.stringify(sources,null,2)+'\n');
await writeFile(resolve(folder,'PREVIEW.txt'),`${round}・深學備課室獨立新版\n教師工作台，課程設計與未施測題組待核對。\n以 HTTP 伺服器提供本資料夾，不使用 file:// 開啟。來源專案執行 npm run preview:releases -- --host 127.0.0.1 --port 5192 --strictPort，前往 http://127.0.0.1:5192/${round}/ 。\nZIP 解壓後也可在解壓父目錄執行 python3 -m http.server 5192 --bind 127.0.0.1。\n工作區與原工具隔離。以 /${round}/ 提供時另有當輪儲存 key，跨輪以備份副本轉入。\nAI 每次預覽資料並同意；BYOK 只在頁面記憶體。沒有使用真實 API 金鑰、學生資料或真實 AI 驗收。\n來源指紋：${sources.fingerprint}\n`);
const records=[];
for(const file of await listFiles(folder)){const raw=await readFile(file);records.push({path:file.slice(folder.length+1),bytes:raw.length,sha256:sha256(raw)});}
await writeFile(resolve(folder,'release-manifest.json'),JSON.stringify({round,createdAt:new Date().toISOString(),sourceFingerprint:sources.fingerprint,files:records},null,2)+'\n');
execFileSync('python3',['-c','import pathlib,sys,zipfile; p=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],"x",zipfile.ZIP_DEFLATED); [z.write(f,str(f.relative_to(p.parent))) for f in sorted(p.rglob("*")) if f.is_file()]; z.close()',folder,zip]);
await mkdir(resolve(root,'verification',round),{recursive:true});
await writeFile(resolve(root,'verification',round,'release.json'),JSON.stringify({round,sourceFingerprint:sources.fingerprint,zip,zipSHA256:sha256(await readFile(zip)),previewPath:folder},null,2)+'\n');
console.log(JSON.stringify({round,sourceFingerprint:sources.fingerprint,zip}));
