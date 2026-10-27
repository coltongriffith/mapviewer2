// Exact hashes for the two trusted inline scripts in the sandboxed tour
// preview. No unsafe-inline/eval and no permission for user-supplied scripts.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function tourScriptHashes() {
  const template = readFileSync(resolve('src/features/tour3d/tour-template.html'),'utf8');
  const three = readFileSync(resolve('node_modules/three/build/three.min.js'),'utf8');
  return [...template.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => {
    const source = m[1].replace('__THREE__',()=>three.replace(/<\/script/gi,'<\\/script'));
    return "'sha256-"+createHash('sha256').update(source).digest('base64')+"'";
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--write')) {
  const path = new URL('../vercel.json',import.meta.url), config = JSON.parse(readFileSync(path,'utf8'));
  const base = config.headers.flatMap(r=>r.headers).find(h=>h.key==='Content-Security-Policy').value;
  const hashes = tourScriptHashes();
  for (const source of ['/3d','/3d/','/3d/index.html']) {
    config.headers = config.headers.filter(r=>r.source!==source || !r.headers.some(h=>h.key==='Content-Security-Policy'));
    config.headers.push({source,headers:[{key:'Content-Security-Policy',value:base.replace("script-src 'self'","script-src 'self' "+hashes.join(' '))}]});
  }
  writeFileSync(path,JSON.stringify(config,null,2)+'\n');
}
