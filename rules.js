// rules.js: zoning numbers and the plan check. No DOM, no network.
// Every number here carries its Anchorage Municipal Code (AMC) citation. When the code
// changes, the citation is how you find what to update. Do not change a number without
// reading the current section.
//
// Results are screening only. Zoning staff make the determination.

import {area,inside,polySeg,polyPoly,crosses,closest,f1} from "./geometry.js";

export const TYPES=["front","side","rear","alley"];
export const TNAME={front:"Front",side:"Side",rear:"Rear",alley:"Alley"};
export const L=i=>String.fromCharCode(65+i%26);

// AMC 21.06.020, Table 21.06-1,
// rows for a single-family detached dwelling, Anchorage Bowl only.
// [front setback ft, side setback ft, rear setback ft, max lot coverage %]
// Not included: Chugiak-Eagle River (AMC 21.10), Girdwood (AMC 21.09), Downtown.
export const DIST={"R-1":[20,5,10,40],"R-1A":[20,5,10,40],"R-2A":[20,5,10,40],"R-2D":[20,5,10,40],"R-2M":[20,5,10,40],"R-3":[20,5,10,40],"R-5":[20,5,10,30],"R-6":[25,15,25,30],"R-7":[25,10,20,30],"R-8":[25,15,25,5],"R-9":[25,15,25,10]};

// The assessor's Zoning_District field is not normalised: "R1" and "R-1" both occur.
export function normZone(z){return String(z||"").trim().toUpperCase().replace(/^R-?(\d+)([A-Z]?)$/,"R-$1$2")}

// AMC 21.05.070D.1 (accessory dwelling units): floor area up to 900 sq ft or 40% of the
// main house, whichever is greater, never over 1,200 sq ft. With no house size given,
// only the 1,200 sq ft ceiling is applied.
export function maxAduArea(house){return house?Math.min(1200,Math.max(900,0.4*house)):1200}

// Setback required from one lot line.
// AMC 21.05.070D.1: an ADU has the same setbacks as the district (Table 21.06-1), no setback
// on a side or rear line next to an alley, and a 10 ft side setback when the ADU is taller
// than 15 ft and next to an R-1 or R-1A lot.
export function reqFor(t,R){return t==="front"?R.front:t==="rear"?R.rear:t==="alley"?0:(R.tall?Math.max(R.side,10):R.side)}

// Label lot lines from one front line: the front, the line most parallel to it as rear,
// the rest as side. With no front given, the line lowest on the drawing is the front.
// AMC 21.15.040: the rear lot line is the boundary most parallel to the front lot line
// that does not intersect it.
export function autoTypes(lot,front){const n=lot.length,mid=i=>({x:(lot[i].x+lot[(i+1)%n].x)/2,y:(lot[i].y+lot[(i+1)%n].y)/2});
  let fi=0;for(let i=1;i<n;i++)if(mid(i).y>mid(fi).y)fi=i;if(Number.isInteger(front)&&front>=0&&front<n)fi=front;
  const ang=i=>{const a=lot[i],b=lot[(i+1)%n];return Math.atan2(b.y-a.y,b.x-a.x)};
  return lot.map((_,i)=>{if(i===fi)return "front";let d=Math.abs(ang(i)-ang(fi))%Math.PI;d=Math.min(d,Math.PI-d);return d<Math.PI/4?"rear":"side"})}

// Label lot lines from what the map says is outside each one (geometry.js classifyEdges).
//
// AMC 21.15.040 "Lot line, front": any boundary line of a lot along the edge of a
// right-of-way of a dedicated street, private street or road easement. So every edge on a
// street is a front lot line.
//
// One street: the line most parallel to the front is the rear, the rest are sides.
//
// Two or more streets (corner and double-frontage lots):
//   AMC 21.06.030C.4.a: the director determines the setbacks. At least one front setback
//   has the full depth required in the district, and no other front setback is less than
//   half that depth.
//   AMC 21.06 setback illustration, note 7: "Until such determination, full-depth setbacks
//   apply on all frontages." So every street line gets the full front setback here.
//   AMC 21.06 setback illustration, note 3: "On corner, double-frontage, and three-sided
//   lots, there are no rear setbacks, but only front and side setbacks." So every line that
//   is not on a street or alley is a side.
// Streets are told apart by name, so a lot with two frontages on one looping street is
// treated as having one.
//
// Returns {types, streets:[labels, longest frontage first], multi:boolean, front:index|null}
export function typesFromEdges(lot,edges){
  const n=lot.length,len=i=>Math.hypot(lot[(i+1)%n].x-lot[i].x,lot[(i+1)%n].y-lot[i].y);
  const tot={};edges.forEach((e,i)=>{if(e.kind==="street")tot[e.label]=(tot[e.label]||0)+len(i)});
  const streets=Object.keys(tot).sort((a,b)=>tot[b]-tot[a]),multi=streets.length>1;
  if(!streets.length){const types=autoTypes(lot);edges.forEach((e,i)=>{if(e.kind==="alley"&&types[i]!=="front")types[i]="alley"});return {types,streets,multi,front:null}}
  let fi=-1;edges.forEach((e,i)=>{if(e.kind==="street"&&e.label===streets[0]&&(fi<0||len(i)>len(fi)))fi=i});
  const types=multi?lot.map(()=>"side"):autoTypes(lot,fi);
  edges.forEach((e,i)=>{if(e.kind==="street")types[i]="front";else if(e.kind==="alley")types[i]="alley";else if(types[i]==="front")types[i]="side"});
  return {types,streets,multi,front:fi};
}

// The plan check.
//   scene  {ftPerPx, lot, types, bldgs, nb:[{pts,label}], bldgArea (sq ft or null),
//           adu:{w,d, floorArea (sq ft, only for a catalog plan)}}
//   poly   the ADU outline in scene units
//   R      {front, side, rear, cov, sep, tall, maxA, house}
//   quick  stop at the first failure and return {ok:false} (used for the fit map)
// Checks, in order:
//   inside the lot lines
//   setback from each lot line                 AMC 21.06.020 Table 21.06-1, 21.05.070D.1
//   no overlap with existing buildings         (the gap, R.sep, is not a zoning rule)
//   no overlap with no-build areas
//   lot coverage, house plus all accessory buildings   AMC 21.05.070D.1, Table 21.06-1
//   ADU floor area                             AMC 21.05.070D.1
export function check(scene,poly,R,quick){
  const S=scene,f=S.ftPerPx,rows=[],why=[];let ok=true;
  const fail=(msg)=>{ok=false;if(!quick)why.push(msg)};
  const inLot=poly.every(p=>inside(p,S.lot))&&!crosses(poly,S.lot);
  if(!inLot){fail("Part of the ADU is outside the lot lines.");if(quick)return {ok:false}}
  for(let i=0;i<S.lot.length;i++){
    // a line with no label yet is checked as a side
    const t=S.types[i]||"side",req=reqFor(t,R),d=inLot?polySeg(poly,S.lot[i],S.lot[(i+1)%S.lot.length])*f:0;
    const pass=inLot&&d>=req-0.05;
    if(!pass&&inLot)fail(f1(d)+" ft from "+TNAME[t].toLowerCase()+" lot line "+L(i)+". "+req+" ft required"+(t==="side"&&R.tall&&R.side<10?" for an ADU taller than 15 ft next to an R-1 or R-1A lot":"")+".");
    if(quick&&!pass)return {ok:false};
    rows.push({name:TNAME[t]+" lot line "+L(i),m:inLot?f1(d)+" ft":"outside",r:t==="alley"?"none":"≥ "+req+" ft",ok:pass,seg:inLot?closest(poly,S.lot[i],S.lot[(i+1)%S.lot.length]):null});
  }
  S.bldgs.forEach((b,i)=>{const d=polyPoly(poly,b)*f,pass=d>0&&d>=R.sep-0.05;
    if(!pass)fail(d===0?"Overlaps existing building "+(i+1)+".":f1(d)+" ft from existing building "+(i+1)+". "+R.sep+" ft gap set.");
    rows.push({name:"Existing building "+(i+1),m:d===0?"overlaps":f1(d)+" ft",r:R.sep>0?"≥ "+R.sep+" ft":"no overlap",ok:pass})});
  if(quick&&!ok)return {ok:false};
  S.nb.forEach(z=>{const hit=polyPoly(poly,z.pts)===0;if(hit)fail("Sits on a "+z.label.toLowerCase()+".");
    rows.push({name:z.label,m:hit?"overlaps":"clear",r:"no overlap",ok:!hit})});
  let aA=S.adu.w*S.adu.d;
  const lotA=area(S.lot)*f*f,bA=S.bldgArea!=null?S.bldgArea:S.bldgs.reduce((s,b)=>s+area(b),0)*f*f,cov=(bA+aA)/lotA*100,covOk=cov<=R.cov+0.05;
  if(!covOk)fail("Lot coverage would be "+f1(cov)+"%. The limit is "+R.cov+"%. A smaller footprint could fit.");
  rows.push({name:"Lot coverage with ADU",m:f1(cov)+"%",r:"≤ "+R.cov+"%",ok:covOk});
  // AMC 21.05.070D.1.b.iii(B)(4): the size limit is on the gross floor area of the ADU, "not
  // including any related garage". A catalog plan gives its own floor area (plans.json), which
  // can differ from its footprint: a unit over a garage, or two stories. A hand-entered size
  // is taken as one story, so its floor area is its footprint.
  const own=S.adu.floorArea!=null;if(own)aA=S.adu.floorArea;
  const szOk=aA<=R.maxA+0.5;if(!szOk)fail("Floor area is "+aA+" sq ft. The limit for this lot is "+Math.round(R.maxA).toLocaleString()+" sq ft"+(R.house?" (900 sq ft or 40% of the main house, whichever is greater, up to 1,200)":"")+".");
  rows.push({name:own?"ADU floor area (from the plan sheet)":"ADU floor area (one story)",m:aA+" sq ft",r:"≤ "+Math.round(R.maxA).toLocaleString()+" sq ft",ok:szOk});
  return {ok,rows,why,lotA,cov};
}

// Smallest amount of room to spare, in feet, across lot lines, buildings and no-build areas.
export function margin(scene,poly,R){const S=scene,f=S.ftPerPx;let m=Infinity;
  for(let i=0;i<S.lot.length;i++)m=Math.min(m,polySeg(poly,S.lot[i],S.lot[(i+1)%S.lot.length])*f-reqFor(S.types[i],R));
  S.bldgs.forEach(b=>m=Math.min(m,polyPoly(poly,b)*f-R.sep));S.nb.forEach(z=>m=Math.min(m,polyPoly(poly,z.pts)*f));return m}

// ---------- other reviews this lot may need ----------
// Source for every threshold below: Municipality of Anchorage, Pre-Approved ADU Plans permit
// checklist (March 2026), www.muni.org/ADU.
//   Geotechnical report: seismic hazard zone 4 or 5
//   Flood review: in a flood zone or within 300 ft of one
//   Steep slope: average lot slope over 20%
//   Well and septic review: lot on a well or septic system
export const FLAG_RULES={seismicCodes:[4,5],floodBufferFt:300,slopeOverPct:20};

const MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export function fmtDate(ms){if(typeof ms!=="number"||!isFinite(ms))return "date not given";const d=new Date(ms);return d.getUTCDate()+" "+MON[d.getUTCMonth()]+" "+d.getUTCFullYear()}

// Turn the map lookups (data.js loadFlags) into what each checkbox should do.
// For each of seis, flood, slope, septic: {tick, text, source}
//   tick true   the map says this review applies: tick the box
//   tick false  the map says it does not: untick the box
//   tick null   the map cannot tell: leave the box as the person set it
// Choices made here, pending word from Development Services:
//   Flood: the floodway and the 100 Year Floodplain tick the box. The 500 Year Floodplain
//   is reported but does not tick it; the checklist says "flood zone" without defining it.
//   Well and septic: never ticked from the map. The AWWU layer records access to and use
//   of public water and sewer, not whether a lot has a well or septic system.
export function flagResults(f){
  const out={},src=(name,date)=>name+", data dated "+fmtDate(date);
  // seismic
  const s=f.seis||{error:true};
  if(s.error)out.seis={tick:null,text:"The seismic zone map could not be read. Tick this yourself if it applies.",source:""};
  else if(s.code==null)out.seis={tick:null,text:"The seismic zone map shows no zone for this lot.",source:src("MOA Seismic Zones map layer (titled historical)",s.date)};
  else{const yes=FLAG_RULES.seismicCodes.includes(s.code);
    out.seis={tick:yes,text:"Map: seismic zone "+s.code+(s.type?" ("+String(s.type).toLowerCase().replace(/-/g," ")+")":"")+"."+(yes?"":" Only zones 4 and 5 need the report."),source:src("MOA Seismic Zones map layer (titled historical)",s.date)}}
  // flood
  const fl=f.flood||{error:true},strong=z=>z==="Floodway"||z==="100 Year Floodplain",list=a=>a.slice().sort().join(" and ");
  if(fl.error)out.flood={tick:null,text:"The flood map could not be read. Tick this yourself if it applies.",source:""};
  else{const fsrc=src("FEMA flood hazard areas as held by MOA",fl.date),on=fl.onLot.filter(strong),near=fl.near.filter(strong),has500=fl.near.includes("500 Year Floodplain");
    if(on.length)out.flood={tick:true,text:"Map: part of this lot is in the "+list(on)+".",source:fsrc};
    else if(near.length)out.flood={tick:true,text:"Map: this lot is within "+FLAG_RULES.floodBufferFt+" ft of the "+list(near)+".",source:fsrc};
    else if(has500)out.flood={tick:false,text:"Map: the 500 Year Floodplain is on or within "+FLAG_RULES.floodBufferFt+" ft of this lot. This page does not tick the box for the 500 year area; ask the flood reviewer whether it counts.",source:fsrc};
    else out.flood={tick:false,text:"Map: no mapped flood zone on or within "+FLAG_RULES.floodBufferFt+" ft of this lot.",source:fsrc}}
  // slope
  const sl=f.slope||{error:true};
  if(sl.error||sl.pct==null)out.slope={tick:null,text:"The parcel record has no average slope for this lot. Tick this yourself if it applies.",source:""};
  else out.slope={tick:sl.pct>FLAG_RULES.slopeOverPct,text:"Map: average slope "+f1(sl.pct)+"%.",source:"MOA parcel record, mean percent slope. The record does not say when or how the slope was worked out"};
  // well and septic
  const a=f.awwu||{error:true};
  if(a.error)out.septic={tick:null,text:"The water and sewer record could not be read. Tick this yourself if the lot is on a well or septic system.",source:""};
  else if(!a.service)out.septic={tick:null,text:"AWWU has no record for this lot. Tick this yourself if the lot is on a well or septic system.",source:src("AWWU properties map layer",a.date)};
  else if(a.service==="Has Active Water and Sewer Service")out.septic={tick:null,text:"AWWU lists active water and sewer service for this lot. Not ticked from the map.",source:src("AWWU properties map layer",a.date)};
  else out.septic={tick:null,text:"AWWU lists this lot as \""+a.service+"\". That does not say whether there is a well or septic system. Confirm with AWWU and tick this yourself if it applies.",source:src("AWWU properties map layer",a.date)};
  return out;
}
