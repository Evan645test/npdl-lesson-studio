import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';
import { root } from './files.mjs';

const args=process.argv.slice(2);
let host='127.0.0.1',port=5192;
for(let i=0;i<args.length;i++){if(args[i]==='--host')host=args[++i];else if(args[i]==='--port')port=Number(args[++i]);else if(args[i]!=='--strictPort')throw new Error('不支援的參數。');}
if(host!=='127.0.0.1'||!Number.isInteger(port)||port<1024||port>65535)throw new Error('限本機127.0.0.1，埠1024–65535。');
const directory=resolve(root,'previews');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8','.zip':'application/zip','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.woff2':'font/woff2','.pdf':'application/pdf','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
const server=createServer(async(req,res)=>{
  try {
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
    const url=new URL(req.url,`http://${host}:${port}`);const decoded=decodeURIComponent(url.pathname);
    if(decoded.includes('\0')||decoded.includes('\\')||decoded.split('/').includes('..')){res.writeHead(400);res.end();return;}
    if(decoded==='/'){const names=(await readdir(directory)).filter(name=>/^R\d{2}/.test(name)).sort();const links=names.map(name=>name.endsWith('.zip')?`<li><a href="./${name}">下載 ${name}</a></li>`:`<li><a href="./${name}/">開啟 ${name}</a></li>`).join('');res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>深學備課室預覽</title><body><h1>深學備課室預覽</h1><ul>${links}</ul></body></html>`);return;}
    let target=resolve(directory,'.'+decoded);
    if(relative(directory,target).startsWith('..')){res.writeHead(403);res.end();return;}
    const info=await stat(target);
    if(info.isDirectory()){if(!decoded.endsWith('/')){res.writeHead(308,{'Location':decoded+'/'});res.end();return;}target=resolve(target,'index.html');}
    const data=await readFile(target);
    const isR03 = /^\/R(?:0[3-9]|[1-9][0-9])(?:-[a-z0-9]+)?\//.test(decoded);
    const policy = isR03 ? "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self' https://api.openai.com https://generativelanguage.googleapis.com; object-src 'none'; base-uri 'self'; form-action 'none'" : "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'";
    res.writeHead(200,{'Content-Type':mime[extname(target)]??'application/octet-stream','Content-Length':data.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':policy});res.end(req.method==='HEAD'?undefined:data);
  }catch(error){res.writeHead(error.code==='ENOENT'?404:400);res.end('預覽檔案無法讀取。');}
});
server.on('error',error=>{console.error(`預覽未啟動：${error.message}。不停止既有服務。`);process.exitCode=1;});
server.listen(port,host,()=>console.log(`預覽已啟動 http://${host}:${port}/`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close());
