import { readdir, lstat, readFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

export const root = resolve(import.meta.dirname, '..');
export const publicRoot = resolve(root, 'public');
// These files are requested by the competency cards at runtime, not by dist/index.html.
const competencyIcons = ['character', 'citizenship', 'collaboration', 'communication', 'creativity', 'critical']
  .map(name => `public/competencies/${name}.svg`);
export async function listFiles(directory) {
  const result = [];
  for (const name of (await readdir(directory)).sort()) {
    const path = resolve(directory, name), stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error(`不允許符號連結：${path}`);
    if (stat.isDirectory()) result.push(...await listFiles(path));
    else if (stat.isFile()) result.push(path);
  }
  return result;
}
export const localPath = path => relative(root, path).split(sep).join('/');
export const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
export async function publicFiles() {
  const directory = await lstat(publicRoot).catch(error => {
    if (error.code === 'ENOENT') throw new Error('缺少公開資源目錄：public/；請將公開資源一併複製到建置來源。', { cause: error });
    throw error;
  });
  if (!directory.isDirectory()) throw new Error('公開資源必須位於實體目錄：public/。');
  const files = await listFiles(publicRoot);
  const names = new Set(files.map(localPath));
  for (const icon of competencyIcons) {
    if (!names.has(icon)) throw new Error(`缺少 NPDL 能力圖卡來源：${icon}`);
  }
  return files;
}
export async function sourceFiles() {
  // 公開版不含開發筆記（AGENTS.md、docs/plans）；有才納入。
  const exists = path => lstat(path).then(() => true, () => false);
  const roots = ['src','scripts','docs/contracts','docs/references','docs/plans'];
  const paths = await publicFiles();
  for (const folder of roots) if (await exists(resolve(root,folder))) paths.push(...await listFiles(resolve(root,folder)));
  for (const name of ['package.json','package-lock.json','tsconfig.json','vite.config.ts','index.html','.gitignore','AGENTS.md','README.md']) if (await exists(resolve(root,name))) paths.push(resolve(root,name));
  return paths.sort();
}
export async function sourceManifest() {
  const records = [];
  for (const path of await sourceFiles()) { const bytes=await readFile(path);records.push({ path:localPath(path),bytes:bytes.length,sha256:sha256(bytes) }); }
  return { algorithm:'SHA-256',files:records, fingerprint:sha256(JSON.stringify(records)) };
}
