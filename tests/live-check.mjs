// Live check against the Municipality's services, using the same code the page runs.
// Not part of `npm test` (it needs the network). Usage:
//   node tests/live-check.mjs "1400 W 23RD AVE" ["another address" ...]
// Prints what the page would draw and the plan-check table for a 20 x 30 ft ADU at the best spot.
import {findParcels,loadSite,loadFlags,sheetBox,aerialUrl,AERIALS} from "../data.js";
import {area,clean,openRing,classifyEdges,rectPoly,inside,f1} from "../geometry.js";
import {DIST,L,check,margin,maxAduArea,typesFromEdges,normZone,flagResults} from "../rules.js";

for(const q of process.argv.slice(2)){
  console.log("\n=== "+q);
  const list=await findParcels(q),Q=q.toUpperCase(),exact=list.filter(p=>p.addr===Q);
  if(!list.length){console.log("no parcel found");continue}
  if(list.length>1&&exact.length!==1){console.log("pick list ("+list.length+(list.more?"+":"")+"):");list.forEach(p=>console.log("   "+p.addr+"  parcel "+p.pid));continue}
  const p=exact[0]||list[0],site=await loadSite(p),lot=clean(site.lot),lotA=area(lot);
  console.log("parcel "+p.pid+"  "+p.addr+"  zoning "+p.zone+" -> "+normZone(p.zone)+(DIST[normZone(p.zone)]?"":" (not in DIST)")+"  parts "+p.parts);
  console.log("lot: "+site.lot.length+" points as served, "+lot.length+" lot lines, "+f1(lotA)+" sq ft mapped, assessor Lot_Size "+p.lotSize);
  console.log("buildings: "+site.bldgs.length+"  "+site.bldgs.map(b=>openRing(b.pts).length+" corners "+f1(b.area)+" sq ft").join("; "));
  console.log("footprint "+f1(site.bldgArea)+" sq ft, coverage "+f1(site.bldgArea/lotA*100)+"% of mapped lot"+(p.lotSize?", "+f1(site.bldgArea/p.lotSize*100)+"% of Lot_Size":""));
  console.log("nearby: "+site.neighbors.length+" parcels, centrelines "+[...new Set(site.lines.map(l=>l.type+":"+l.label))].join(", "));
  {const xs=lot.map(p=>p.x),ys=lot.map(p=>p.y),x0=Math.min(...xs),y0=Math.min(...ys),w=Math.max(...xs)-x0,h=Math.max(...ys)-y0,k=Math.min(8,640/w,760/h);
    const sheet={x0,y0,k,mx:150,my:130,W:Math.round(w*k+300),H:Math.round(h*k+240)};   // the same sheet ui.js sceneFromGIS draws
    console.log("street view point: "+(site.center?site.center.lat.toFixed(6)+","+site.center.lon.toFixed(6):"not found"));
    for(const a of AERIALS){let s="";try{const r=await fetch(aerialUrl(a.url,sheetBox(sheet),sheet.W,sheet.H));s=r.status+" "+r.headers.get("content-type")+" "+(await r.arrayBuffer()).byteLength+" bytes"}catch(e){s="FAILED "+e.message}
      console.log("aerial "+a.year+": "+s+"\n   "+aerialUrl(a.url,sheetBox(sheet),sheet.W,sheet.H))}}
  const edges=classifyEdges(lot,site.neighbors,site.lines);
  const fr=typesFromEdges(lot,edges),n=lot.length;
  lot.forEach((a,i)=>{const b=lot[(i+1)%n];console.log("  line "+L(i)+"  "+f1(Math.hypot(b.x-a.x,b.y-a.y)).padStart(6)+" ft  "+edges[i].kind.padEnd(8)+" "+(edges[i].label||"").padEnd(16)+" -> "+fr.types[i])});
  console.log("streets: "+(fr.streets.join(", ")||"none")+(fr.multi?"  MORE THAN ONE STREET SIDE: full front setback on each, no rear (AMC 21.06.030C.4)":""));
  const fl=flagResults(await loadFlags(p));
  for(const k of ["seis","flood","slope","septic"])console.log("  flag "+k.padEnd(7)+(fl[k].tick===true?"TICK ":fl[k].tick===false?"clear":"?    ")+" "+fl[k].text+(fl[k].source?" ["+fl[k].source+"]":""));
  const d=DIST[normZone(p.zone)];if(!d){console.log("district not in DIST: setbacks by hand");continue}
  const S={ftPerPx:1,lot,types:fr.types,bldgs:site.bldgs.map(b=>openRing(b.pts)),nb:[],bldgArea:site.bldgArea,adu:{w:20,d:30,rot:0}};
  const R={front:d[0],side:d[1],rear:d[2],cov:d[3],sep:0,tall:false,maxA:maxAduArea(0),house:0};
  const xs=lot.map(p=>p.x),ys=lot.map(p=>p.y);let best=null;
  for(const rot of [0,90])for(let y=Math.min(...ys);y<Math.max(...ys);y+=2)for(let x=Math.min(...xs);x<Math.max(...xs);x+=2){
    if(!inside({x,y},lot))continue;S.adu.rot=rot;const poly=rectPoly(S.adu,x,y,1);if(!check(S,poly,R,true).ok)continue;const m=margin(S,poly,R);if(!best||m>best.m)best={m,x,y,rot}}
  if(!best){S.adu.rot=0;const c=check(S,rectPoly(S.adu,(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2,1),R,false);console.log("20 x 30 ADU: no spot fits (2 ft grid, 0 and 90 degrees). At the lot centre: "+c.why.join(" "));continue}
  S.adu.rot=best.rot;const r=check(S,rectPoly(S.adu,best.x,best.y,1),R,false);
  console.log("20 x 30 ADU, best spot (rot "+best.rot+", "+f1(best.m)+" ft to spare): "+(r.ok?"FITS":"DOES NOT FIT"));
  r.rows.forEach(o=>console.log("   "+(o.ok?"OK ":"NO ")+o.name.padEnd(28)+o.m.padStart(10)+"   required "+o.r));
}
