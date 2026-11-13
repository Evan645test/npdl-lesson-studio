import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { root, sourceFiles, sourceManifest } from './files.mjs';

for (const path of await sourceFiles()) {
  if (!/\.(ts|tsx|mjs)$/.test(path)) continue;
  const source = await readFile(path,'utf8');
  for (const match of source.matchAll(/(?:from\s*|import\s*\(|import\s+)["']([^"']+)["']/g)) {
    const spec = match[1].split('?')[0];
    if (spec.startsWith('/') || spec.startsWith('file:')) throw new Error(`外部絕對路徑：${path}`);
    if (spec.startsWith('.') && relative(root,resolve(dirname(path),spec)).startsWith('..')) throw new Error(`跨專案引用：${path}`);
  }
}
const manifest=await sourceManifest();
await mkdir(resolve(root,'verification'),{recursive:true});
await writeFile(resolve(root,'verification/source-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({result:'passed',sourceFiles:manifest.files.length,fingerprint:manifest.fingerprint}));
