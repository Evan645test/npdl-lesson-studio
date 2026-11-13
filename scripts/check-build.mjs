import { readFile, access, lstat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { root, publicRoot, publicFiles, localPath } from './files.mjs';

const index=await readFile(resolve(root,'dist/index.html'),'utf8');
const links=[...index.matchAll(/(?:src|href)="([^"]+)"/g)].map(m=>m[1]);
if(!links.length)throw new Error('建置缺少資源。');
for(const link of links){
  if(!link.startsWith('./') || link.includes('..'))throw new Error(`資源必須是相對路徑：${link}`);
  await access(resolve(root,'dist',link));
}
const publicSources = await publicFiles();
for (const source of publicSources) {
  const target = resolve(root, 'dist', relative(publicRoot, source));
  const targetStat = await lstat(target).catch(error => {
    if (error.code === 'ENOENT') throw new Error(`建置缺少公開資源：${localPath(target)}（來源：${localPath(source)}）`, { cause: error });
    throw error;
  });
  if (!targetStat.isFile()) throw new Error(`建置公開資源必須是一般檔案：${localPath(target)}`);
  const [original, built] = await Promise.all([readFile(source), readFile(target)]);
  if (!original.equals(built)) throw new Error(`建置公開資源與來源不一致：${localPath(target)}（來源：${localPath(source)}）`);
}
console.log(`passed: ${links.length} 個相對資源均存在，${publicSources.length} 個公開資源與來源一致`);
