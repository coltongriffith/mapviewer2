import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname,join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseTourPackage } from '../../src/features/tour3d/package';
import { exportTourHtml } from '../../src/features/tour3d/export';

// Server-only: callers supply JSON, never a template, script or uploaded HTML.
// Future endpoints must authorize access before calling this renderer.
const template=readFileSync(new URL('../../src/features/tour3d/tour-template.html',import.meta.url),'utf8');
const require=createRequire(import.meta.url);
const three=readFileSync(join(dirname(require.resolve('three')),'three.min.js'),'utf8');
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
  return {
    html:exportTourHtml(pkg,template,three),
    headers:{
      'Content-Type':'text/html; charset=utf-8',
      'Content-Security-Policy':policy,
      'Cache-Control':'no-store', // revocation and republish must take effect immediately
      'X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'no-referrer',
    },
  };
}
