import { describe,it,expect } from 'vitest';
import { buildTourPackage } from '../src/features/tour3d/build';
import { parseTourPackage,MAX_TOUR_BYTES } from '../src/features/tour3d/package';

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
  });
  it('bounds bytes before JSON parsing, including multibyte input',()=>{
    expect(()=>parseTourPackage(' '.repeat(MAX_TOUR_BYTES+1))).toThrow('size');
    expect(()=>parseTourPackage('é'.repeat(MAX_TOUR_BYTES/2+1))).toThrow('size');
    expect(()=>parseTourPackage('<html>uploaded code</html>')).toThrow('JSON');
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
  ])('rejects malformed, executable or excessive inputs (%#)', mutate=>{
    const p=fixture();mutate(p);expect(()=>parseTourPackage(JSON.stringify(p))).toThrow('Invalid tour package');
  });
});
