// Would each catalog plan fit on a traced lot? The same answer the page gives under "Which
// designs fit on this lot", worked out with the page's own code (rules.js sceneFromTrace and
// findSpot), for the survey reader's evaluation (lambda/score_samples.py).
//
//   node tools/verdict.mjs < tracings.json
//
// In:  [{w, h, tracing}]   image size in pixels and a tracing in the survey reader's format
// Out: [{district, known, plans:[{id, name, fits, spare}]}]  or  [{error}] for a tracing the
//      page could not use. district is the one the page would apply: the one read from the
//      survey when the page has its rules, otherwise R-1, where the page starts (known:false).
// As on the page after an upload: no gap to existing buildings, no house size given, and the
// 10 ft side setback for an ADU over 15 ft applied in R-1 and R-1A.
//
// Results are screening only. Zoning staff make the determination.
import {readFileSync} from "node:fs";
import {cen} from "../geometry.js";
import {DIST,maxAduArea,findSpot,sceneFromTrace} from "../rules.js";

const PLANS=JSON.parse(readFileSync(new URL("../plans.json",import.meta.url),"utf8")).plans;

export function verdict({w,h,tracing}){
  let s;try{s=sceneFromTrace(tracing,w,h)}catch(e){return {error:"no usable lot"}}
  if(!s.ftPerPx)return {error:"no scale read"};
  const district=s.zone||"R-1",d=DIST[district],c=cen(s.lot);
  return {district,known:!!s.zone,plans:PLANS.map(p=>{
    const R={front:d[0],side:d[1],rear:d[2],cov:d[3],sep:0,tall:(district==="R-1"||district==="R-1A")&&p.heightGuess>15,maxA:maxAduArea(0),house:0};
    const b=findSpot({ftPerPx:s.ftPerPx,lot:s.lot,types:s.types,bldgs:s.bldgs,nb:s.nb,bldgArea:null,adu:{w:p.w,d:p.d,floorArea:p.floorArea,x:c.x,y:c.y,rot:0}},R);
    return {id:p.id,name:p.name,fits:!!b,spare:b?Math.round(b.m*10)/10:null}})};
}

if(process.argv[1]&&import.meta.url.endsWith(process.argv[1].replace(/\\/g,"/").split("/").pop())){
  let text="";process.stdin.setEncoding("utf8");
  for await(const chunk of process.stdin)text+=chunk;
  process.stdout.write(JSON.stringify(JSON.parse(text).map(verdict)));
}
