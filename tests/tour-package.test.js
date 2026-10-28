// @vitest-environment node
import { describe,it,expect } from 'vitest';
import { buildTourPackage } from '../src/features/tour3d/build';
import { parseTourPackage,MAX_TOUR_BYTES } from '../src/features/tour3d/package';
import { renderHostedTour } from '../api/_lib/tour-render';
import { createHash } from 'node:crypto';

const fixture=()=>buildTourPackage({
  title:'</script><script>alert(1)</script>',crs:'EPSG:4326',
  claims:{type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Polygon',coordinates:[[
    [-129.01,55],[-129,55],[-129,55.01],[-129.01,55.01],[-129.01,55],
  ]]}}]},
  collars:[{holeId:'H1',x:-129.005,y:55.005,z:1000,azimuth:0,dip:-60,depth:100}],
  assays:[{holeId:'H1',from:0,to:10,values:{Cu:0.5}}],grade:{field:'Cu',unit:'%',bins:[0.1,0.2,0.5,1]},
});
describe('hosted tour package boundary',()=>{
  it('accepts actual builder output without altering positions, labels or metadata',()=>{
    const p=fixture();expect(parseTourPackage(JSON.stringify(p))).toEqual(p);
    p.claims=[];expect(parseTourPackage(JSON.stringify(p)).claims).toEqual([]);
  });
  it('bounds rendered bytes after script-safe JSON escaping',()=>{
    const p=fixture();p.meta.warnings=Array(1200).fill('<'.repeat(600));
    const json=JSON.stringify(p);expect(Buffer.byteLength(json)).toBeLessThan(MAX_TOUR_BYTES);
    expect(()=>renderHostedTour(json)).toThrow('HTML is too large');
  });
  it('bounds bytes before JSON parsing, including multibyte input',()=>{
    expect(()=>parseTourPackage(' '.repeat(MAX_TOUR_BYTES+1))).toThrow('size');
    expect(()=>parseTourPackage('é'.repeat(MAX_TOUR_BYTES/2+1))).toThrow('size');
    expect(()=>parseTourPackage('<html>uploaded code</html>')).toThrow('JSON');
  });
  it('renders only repository-owned executable scripts, escaping package strings',()=>{
    const {html,headers}=renderHostedTour(JSON.stringify(fixture()));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('\\u003c/script>');
    expect(headers['Cache-Control']).toBe('no-store');
    expect(headers['Content-Security-Policy']).toContain('sandbox allow-scripts;');
    expect(headers['Content-Security-Policy']).not.toContain('allow-same-origin');
    expect(headers['Content-Security-Policy']).not.toContain("script-src 'unsafe-inline'");
    const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(2);
    for (const [,script] of scripts) expect(headers['Content-Security-Policy']).toContain("'sha256-"+createHash('sha256').update(script).digest('base64')+"'");
    expect(()=>renderHostedTour('<html>untrusted</html>')).toThrow('JSON');
  });
  it.each([
    p=>{p.v=2;},p=>{p.html='<script>bad()</script>';},p=>{p.config.script='bad()';},
    p=>{p.holes[0].p[0]=null;},p=>{p.holes[0].p.pop();},p=>{p.runs[0][0]=1;},p=>{p.runs[0][2]=8;},
    p=>{p.config.imagery='http://127.0.0.1/private/{z}/{x}/{y}';},
    p=>{p.config.bins[0][1]='url(https://example.test)';},p=>{p.config.labels[0].views=[99];},
    p=>{p.terrain.step=0;},p=>{p.terrain.step=1;p.terrain.utm=[0,0,200000,200000];},
    p=>{p.terrain.corners[0][1]=90;},p=>{p.terrain.imgZoom=30;},p=>{p.meta.holes=100;},
    p=>{p.terrain.corners=[[-170,-70],[170,-70],[-170,70],[170,70]];},
    p=>{p.terrain.corners=p.terrain.corners.map(c=>[c[0],84]);p.terrain.detailR=2500;p.terrain.detailZoom=16;},
    p=>{p.collars[0][3]=0;},p=>{p.terrain.step=10000;},
    p=>{p.terrain.utm=[0,0,1,10000];},p=>{p.collars[0][0]=999999;},
  ])('rejects malformed, executable or excessive inputs (%#)', mutate=>{
    const p=fixture();mutate(p);expect(()=>parseTourPackage(JSON.stringify(p))).toThrow('Invalid tour package');
  });
});
