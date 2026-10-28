import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseTourPackage } from '../../src/features/tour3d/package.js';
import { exportTourHtml } from '../../src/features/tour3d/export.js';

// Server-only: callers supply JSON, never a template, script or uploaded HTML.
// Explicit includeFiles in vercel.json preserves these paths when this module
// is relocated into the Function bundle. No user-controlled file paths.
const template=readFileSync(join(process.cwd(),'src/features/tour3d/tour-template.html'),'utf8');
const three=readFileSync(join(process.cwd(),'node_modules/three/build/three.min.js'),'utf8');
const scripts=[...template.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1].replace('__THREE__',()=>three.replace(/<\/script/gi,'<\\/script')));
const hashes=scripts.map(s=>"'sha256-"+createHash('sha256').update(s).digest('base64')+"'");
const policy=[
  "default-src 'none'",'script-src '+hashes.join(' '),"style-src 'unsafe-inline'",
  'img-src https://s3.amazonaws.com https://server.arcgisonline.com',
  "connect-src 'none'","object-src 'none'","base-uri 'none'","form-action 'none'",
  'sandbox allow-scripts','frame-ancestors https:',
].join('; ');

export function renderHostedTour(json: string) {
  const pkg=parseTourPackage(json);
  const html=exportTourHtml(pkg,template,three);
  // JSON escaping can expand text substantially. Bound the actual response,
  // not only its input; local HTML download remains available for larger tours.
  if (Buffer.byteLength(html,'utf8')>4000000) throw new Error('Tour HTML is too large for hosted sharing. Download the HTML instead.');
  return {
    html,
    headers:{
      'Content-Type':'text/html; charset=utf-8',
      'Content-Security-Policy':policy,
      'Cache-Control':'no-store', // revocation and republish must take effect immediately
      'X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'no-referrer',
    },
  };
}
