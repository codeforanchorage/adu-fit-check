// ui.js: the page. Canvas drawing, tracing tools, controls, address lookup, sample survey.
// Geometry is in geometry.js, zoning numbers and the plan check in rules.js, map services in data.js.
//
// Results are screening only. Zoning staff make the determination. Keep that statement in
// the page notice, on the drawn sheet and in the copied summary.

import {area,inside,ptSeg,cen,rectPoly,clean,openRing,classifyEdges,sweep,f1,traceDiff} from "./geometry.js";
import {sunPosition,zonedToUtc,todayIn,shadowOffset,compass} from "./sun.js";
import {SURVEY_READER,EXAMPLE_ADDRESS} from "./config.js";
import {DIST,TYPES,TNAME,L,check,margin,maxAduArea,autoTypes,typesFromEdges,typesFromTrace,normZone,flagResults} from "./rules.js";

const $=id=>document.getElementById(id);
const cv=$("cv"),cx=cv.getContext("2d");
const S={img:null,iw:760,ih:1000,ftPerPx:null,lot:[],lotClosed:false,types:[],bldgs:[],nb:[],draft:[],mode:"place",
  adu:{w:20,d:30,x:0,y:0,rot:0},scalePts:[],map:null,mapDirty:true,v:1,ox:0,view:"drawing",three:false};

function aduPoly(x,y){return rectPoly(S.adu,x,y,S.ftPerPx)}
function rules(){const n=id=>Math.max(0,parseFloat($(id).value)||0);const h=n("house");return {front:n("rFront"),side:n("rSide"),rear:n("rRear"),cov:n("rCov"),sep:n("rSep"),tall:$("tall").checked&&aduHeight()>15,maxA:maxAduArea(h),house:h}}
// No result may be shown while an AI tracing is unchecked, or while the page has no rules for
// the lot's zoning district. Everything that shows or implies a verdict asks this first.
const blocked=()=>!!(S.unconfirmed||S.needRules);
let loadSeq=0;   // goes up whenever a new lot or survey replaces the drawing, so late answers for the old one are dropped
function ready(){return S.ftPerPx&&S.lotClosed&&S.lot.length>=3}

// Points to try the ADU's centre at: a grid over the lot, at least minFt feet apart.
function gridPts(minFt,about){const xs=S.lot.map(p=>p.x),ys=S.lot.map(p=>p.y),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
  const stepFt=Math.max(minFt||2,Math.sqrt(area(S.lot)*S.ftPerPx*S.ftPerPx/(about||5000))),st=stepFt/S.ftPerPx,pts=[];
  for(let y=y0+st/2;y<y1;y+=st)for(let x=x0+st/2;x<x1;x+=st)if(inside({x,y},S.lot))pts.push({x,y});return {pts,st}}
function globalOk(R){const g=check(S,aduPoly(S.adu.x,S.adu.y),R,false);return !g.rows.slice(-2).some(r=>!r.ok)}
function buildMap(){
  S.mapDirty=false;S.map=null;if(!ready()||blocked())return;
  const R=rules(),g=gridPts(),gl=globalOk(R);
  S.map={cells:g.pts.map(p=>({x:p.x,y:p.y,ok:gl&&check(S,aduPoly(p.x,p.y),R,true).ok})),st:g.st};
}
// Best position for the current footprint: the spot with the most room to spare.
// It first tries a coarse grid at the current turn and a quarter turn from it. If nothing
// fits it looks harder before saying so: a 1 ft grid, and the ADU turned to line up with the
// longest lot line. A spot with less than about a foot to spare can still be missed, which is
// why the page says "No room found" and not "does not fit".
function bestSpot(){if(!ready()||blocked())return null;const R=rules();if(!globalOk(R))return null;const keep=S.adu.rot,n=S.lot.length;let best=null;
  const scan=(g,rots)=>{for(const rot of rots){S.adu.rot=rot;for(const p of g.pts){const poly=aduPoly(p.x,p.y);if(!check(S,poly,R,true).ok)continue;const m=margin(S,poly,R);if(!best||m>best.m+(rot===keep?0:0.5))best={m,x:p.x,y:p.y,rot}}}};
  const quarter=[keep,(keep+90)%180];scan(gridPts(),quarter);
  if(!best){let li=0,ll=0;for(let i=0;i<n;i++){const a=S.lot[i],b=S.lot[(i+1)%n],l=Math.hypot(b.x-a.x,b.y-a.y);if(l>ll){ll=l;li=i}}
    const a=S.lot[li],b=S.lot[(li+1)%n],e=((Math.round(Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI/5)*5)%180+180)%180;
    scan(gridPts(1,8000),[...new Set(quarter.concat([e,(e+90)%180]))])}
  S.adu.rot=keep;return best}
// The Municipality's pre-approved plans, from plans.json (loadPlans below). Empty until it
// loads, and it stays empty if it cannot be read: "Custom size" still works without it.
let PLANS=[];
function computeFits(){const box=$("fits"),had=document.activeElement&&box.contains(document.activeElement)?document.activeElement.dataset.plan:null;box.innerHTML="";if(!ready()||blocked()){return}const keep={...S.adu};
  PLANS.forEach(p=>{S.adu.w=p.w;S.adu.d=p.d;S.adu.floorArea=p.floorArea;const b=bestSpot();const btn=document.createElement("button");btn.type="button";btn.className="fitbtn";btn.dataset.plan=p.id;
    const t=document.createElement("span");t.textContent=p.name;const g=document.createElement("span");g.className="tag "+(b?"ok":"bad");g.textContent=b?"Could fit":"No room found";btn.append(t,g);
    btn.addEventListener("click",()=>{$("design").value=p.id;design();goBest()});box.appendChild(btn)});
  Object.assign(S.adu,keep);
  // the buttons were rebuilt: put keyboard focus back on the one that had it
  if(had){const again=[...box.children].find(x=>x.dataset.plan===had);if(again)again.focus()}}
// move the ADU to the spot with the most room to spare, if there is one. Returns that spot or null.
function setRot(r){S.adu.rot=r;$("rot").value=r;$("rotv").textContent=r+"°";$("rot").setAttribute("aria-valuetext",r+" degrees")}
function placeBest(){const b=bestSpot();if(b){S.adu.x=b.x;S.adu.y=b.y;setRot(b.rot);S.mapDirty=true;update()}return b}
function goBest(){if(S.mode!=="place")setMode("place");if(blocked()){update();return}const b=placeBest();
  $("bestMsg").textContent=b?"Placed with "+f1(Math.max(0,b.m))+" ft to spare.":"No room was found for this design on the lot. Try a smaller one, or turn it."}

/* ---------- drawing ---------- */
function layout(){
  // On a wide screen the drawing's panel stays in view while the sections beside it scroll,
  // so the drawing is sized to fit the window under whatever sits above it in the panel.
  const w=cv.clientWidth,wide=window.matchMedia("(min-width:901px)").matches,above=cv.getBoundingClientRect().top-cv.closest(".stage").getBoundingClientRect().top;
  const maxH=wide?Math.max(340,Math.min(window.innerHeight-above-95,900)):Math.max(420,Math.min(window.innerHeight*0.82,900));
  S.v=Math.min(w/S.iw,maxH/S.ih);const h=S.ih*S.v;S.ox=(w-S.iw*S.v)/2;
  const dpr=window.devicePixelRatio||1;cv.style.height=h+"px";cv.width=Math.round(w*dpr);cv.height=Math.round(h*dpr);
  cx.setTransform(dpr,0,0,dpr,0,0);
}
const X=p=>S.ox+p.x*S.v,Y=p=>p.y*S.v;
function path(p,close){cx.beginPath();p.forEach((q,i)=>i?cx.lineTo(X(q),Y(q)):cx.moveTo(X(q),Y(q)));if(close)cx.closePath()}
function draw(){
  const w=cv.clientWidth,h=parseFloat(cv.style.height)||0;cx.clearRect(0,0,w,h);cx.fillStyle="#fff";cx.fillRect(0,0,w,h);
  // On the aerial photo, lines get a white casing and buildings are outlines only, so the roofs show.
  const A=S.view==="aerial"&&S.site&&S.site.aerial,bg=A||S.img;
  const stroke=(c,lw)=>{if(A){cx.strokeStyle="#fff";cx.lineWidth=lw+2.5;cx.stroke()}cx.strokeStyle=c;cx.lineWidth=lw;cx.stroke()};
  if(bg)cx.drawImage(bg,S.ox,0,S.iw*S.v,S.ih*S.v);
  // shadows (see the shadows section below): nearby buildings as flat-topped blocks, and the ADU
  if(shadowsOn()){
    cx.save();cx.beginPath();cx.rect(S.ox,0,S.iw*S.v,S.ih*S.v);cx.clip();   // keep to the sheet
    if(!A)S.site.around.forEach(b=>{path(b.pts,true);cx.fillStyle="rgba(90,110,135,.12)";cx.fill();cx.strokeStyle="#9aa7b5";cx.lineWidth=1;cx.stroke()});
    const sun=sunNow();
    if(sun&&sun.alt>=SUN_MIN_ALT){
      // painted solid on a spare canvas and laid down once, so overlapping shadows do not darken
      const sc=shadowCanvas||(shadowCanvas=document.createElement("canvas")),k=1/S.ftPerPx,dpr=cv.width/(cv.clientWidth||1);
      sc.width=cv.width;sc.height=cv.height;const g=sc.getContext("2d");g.setTransform(dpr,0,0,dpr,0,0);g.fillStyle="#1b2430";
      const cast=(p,ht)=>{const o=shadowOffset(ht,sun.alt,sun.az,SHADOW_MAX_FT);sweep(p,o.dx*k,o.dy*k).forEach(q=>{g.beginPath();q.forEach((pt,i)=>i?g.lineTo(X(pt),Y(pt)):g.moveTo(X(pt),Y(pt)));g.closePath();g.fill()})};
      S.site.around.forEach(b=>{if(b.h)cast(b.pts,b.h)});
      if(ready()&&S.mode==="place")cast(aduPoly(S.adu.x,S.adu.y),aduHeight());
      cx.save();cx.setTransform(1,0,0,1,0,0);cx.globalAlpha=A?0.5:0.3;cx.drawImage(sc,0,0);cx.restore();
    }
    cx.restore();
  }
  if(S.mapDirty)buildMap();
  if(S.map&&$("showMap").checked&&S.mode==="place"){const s=S.map.st*S.v;
    for(const c of S.map.cells){cx.fillStyle=c.ok?"rgba(23,140,80,.30)":A?"rgba(200,45,35,.13)":"rgba(200,45,35,.22)";cx.fillRect(X(c)-s/2,Y(c)-s/2,s+0.5,s+0.5)}}
  // no-build
  S.nb.forEach(z=>{path(z.pts,true);cx.fillStyle="rgba(217,138,0,.18)";cx.fill();cx.setLineDash([6,4]);cx.strokeStyle="#b36f00";cx.lineWidth=1.5;cx.stroke();cx.setLineDash([])});
  // buildings
  S.bldgs.forEach((b,i)=>{path(b,true);if(!A){cx.fillStyle="rgba(90,110,135,.35)";cx.fill()}stroke("#3d5068",1.5);badge(String(i+1),b[0])});
  // lot
  if(S.lot.length){path(S.lot,S.lotClosed);stroke("#1f5fa8",2.5);
    if(S.lotClosed)for(let i=0;i<S.lot.length;i++){const a=S.lot[i],b=S.lot[(i+1)%S.lot.length];chip(L(i)+" · "+TNAME[S.types[i]],{x:(a.x+b.x)/2,y:(a.y+b.y)/2})}}
  // draft
  if(S.draft.length){path(S.draft,false);cx.strokeStyle="#111";cx.lineWidth=1.5;cx.setLineDash([4,3]);cx.stroke();cx.setLineDash([]);
    S.draft.forEach((p,i)=>{cx.beginPath();cx.arc(X(p),Y(p),i?4:6,0,7);cx.fillStyle=i?"#111":"#1f5fa8";cx.fill()})}
  S.scalePts.forEach(p=>{cx.beginPath();cx.arc(X(p),Y(p),6,0,7);cx.fillStyle="#b3261e";cx.fill()});
  if(S.scalePts.length===2){path(S.scalePts,false);cx.strokeStyle="#b3261e";cx.lineWidth=2;cx.stroke()}
  // distances to lot lines
  if(ready()&&S.mode==="place"&&S.result&&$("showDim").checked)S.result.rows.forEach(o=>{if(!o.seg||!isFinite(o.seg.d))return;const a=o.seg.p,b=o.seg.q,c=o.ok?"#0e5a35":"#b3261e";
    cx.beginPath();cx.moveTo(X(a),Y(a));cx.lineTo(X(b),Y(b));cx.strokeStyle=c;cx.lineWidth=o.ok?1.2:2.2;cx.setLineDash(o.ok?[5,4]:[]);cx.stroke();cx.setLineDash([]);
    const t=o.m,mx=(X(a)+X(b))/2,my=(Y(a)+Y(b))/2;cx.font="600 11px 'IBM Plex Mono',monospace";const w=cx.measureText(t).width+8;cx.fillStyle="#fff";cx.fillRect(mx-w/2,my-8,w,16);cx.strokeStyle=c;cx.lineWidth=1;cx.strokeRect(mx-w/2,my-8,w,16);cx.fillStyle=c;cx.textAlign="center";cx.textBaseline="middle";cx.fillText(t,mx,my+0.5)});
  // ADU
  if(ready()&&S.mode==="place"&&!blocked()){const p=aduPoly(S.adu.x,S.adu.y),r=S.result;const ok=r&&r.ok;
    path(p,true);cx.fillStyle=ok?"rgba(23,140,80,.55)":"rgba(200,45,35,.55)";cx.fill();cx.strokeStyle=ok?"#0e5a35":"#8c1c16";cx.lineWidth=2.5;cx.stroke();
    cx.fillStyle="#fff";cx.font="600 13px 'IBM Plex Sans',sans-serif";cx.textAlign="center";cx.textBaseline="middle";
    cx.fillText((S.adu.plan?S.adu.plan.name.replace(/^The /,""):"ADU")+" "+S.adu.w+" × "+S.adu.d,X(S.adu),Y(S.adu)-8);cx.fillText(ok?"Fits":"Does not fit",X(S.adu),Y(S.adu)+9)}
  if(S.three)sync3d();
}
function badge(t,p){cx.beginPath();cx.arc(X(p),Y(p),9,0,7);cx.fillStyle="#3d5068";cx.fill();cx.font="600 11px 'IBM Plex Sans',sans-serif";cx.fillStyle="#fff";cx.textAlign="center";cx.textBaseline="middle";cx.fillText(t,X(p),Y(p)+0.5)}
function chip(t,p){cx.font="600 11px 'IBM Plex Sans',sans-serif";const w=cx.measureText(t).width+10;cx.fillStyle="#1f5fa8";cx.fillRect(X(p)-w/2,Y(p)-9,w,18);cx.fillStyle="#fff";cx.textAlign="center";cx.textBaseline="middle";cx.fillText(t,X(p),Y(p)+0.5)}

/* ---------- results panel ---------- */
function update(){
  const needFits=S.mapDirty;
  const st=$("status"),tx=$("statusText"),why=$("why"),tb=$("checks").tBodies[0];why.innerHTML="";tb.innerHTML="";
  const tag=$("fitTag"),hint=$("nextHint");
  $("bestMsg").textContent="";   // it described the last "Find the best spot", not what is drawn now
  // an AI tracing is only a first guess: no result is shown until the person has checked it
  if(S.unconfirmed&&ready()){S.result=null;st.className="status idle";tx.textContent="Check the tracing first";tag.className="tag";tag.textContent="";
    hint.textContent="Compare the tracing with your survey, fix anything that is off, then press \"This tracing looks right\".";draw();$("fits").innerHTML="";return}
  // a zoning district this page has no rules for: say so, and show no result worked out with another district's numbers
  if(S.needRules&&ready()){S.result=null;st.className="status idle";tx.textContent="This page does not have the rules for this lot";tag.className="tag";tag.textContent="";
    hint.textContent="Its zoning district, "+S.needRules+", is not in this page's list, so the page cannot say whether an ADU fits. Zoning staff can tell you the setbacks for this lot. If you know them, open \"The rules used for this lot\" and enter them.";draw();$("fits").innerHTML="";return}
  if(!ready()){S.result=null;st.className="status idle";tx.textContent=!S.ftPerPx?"Set the scale first (step 1).":"Trace the lot lines (step 2).";tag.className="tag";tag.textContent="";hint.textContent="";draw();$("fits").innerHTML="";return}
  const r=check(S,aduPoly(S.adu.x,S.adu.y),rules(),false);S.result=r;
  st.className="status "+(r.ok?"ok":"bad");tx.textContent=r.ok?"This ADU could fit here":"It does not fit at this spot";
  tag.className="tag "+(r.ok?"ok":"bad");tag.textContent=r.ok?"Could fit":"Does not fit";
  hint.textContent=r.ok?"That is a good sign. The next step is a free zoning review meeting with the Municipality: open \"What it takes to build one\" below."
    :"Drag it to a green area, turn it, or press \"Find the best spot\". The buttons under \"Which designs fit on this lot\" show which designs have room.";
  r.why.forEach(w=>{const li=document.createElement("li");li.textContent=w;why.appendChild(li)});
  r.rows.forEach(o=>{const tr=document.createElement("tr");
    [[o.name,""],[o.m,"num"],[o.r,"num"]].forEach(([t,c])=>{const td=document.createElement("td");td.textContent=t;td.className=c;tr.appendChild(td)});
    const td=document.createElement("td");const s=document.createElement("span");s.className="tag "+(o.ok?"ok":"bad");s.textContent=o.ok?"OK":"No";td.appendChild(s);tr.appendChild(td);tb.appendChild(tr)});
  draw();
  if(needFits||!$("fits").children.length)computeFits();
}
const NEED={row:"Right of Way permit, for the new driveway or utility extension.",
  seis:"Geotechnical report. Call 907-343-8301.",
  septic:"On-site well and septic review. The septic system may need an upgrade for the added bedrooms. On-Site Section: 907-343-7904.",
  flood:"Flood zone review. In a mapped floodplain you also need a Flood Hazard Permit and Elevation Certificate. Call 907-343-8023.",
  slope:"Steep slope information for permitting. Ask the zoning plan review team."};
function flags(){const ul=$("need");ul.innerHTML="";const on=[...document.querySelectorAll(".flag:checked")];
  if(!on.length){const li=document.createElement("li");li.textContent="None checked.";li.style.listStyle="none";li.style.marginLeft="-18px";li.style.color="var(--muted)";ul.appendChild(li)}
  on.forEach(c=>{const li=document.createElement("li");li.textContent=NEED[c.dataset.k];ul.appendChild(li)});return on.map(c=>NEED[c.dataset.k])}

/* ---------- modes ---------- */
const GUIDE={
  scale:"<b>Step 1.</b> Click the two ends of a line whose length is printed on the survey, such as a lot line. Then type its length.",
  lot:"<b>Step 2.</b> Click each corner of the lot in order. Click the first corner again to close it. Then click a line's label to change it between Front, Side, Rear and Alley.",
  bldg:"<b>Step 3.</b> Click the corners of each existing building. Click the first corner again to close each one.",
  nobuild:"<b>Step 4.</b> Pick a type, then click the corners of any area you cannot build on, such as an easement or septic field.",
  place:"<b>Step 5.</b> Drag the ADU around the lot, or click a spot to move it there. Arrow keys nudge it one foot."};
function setMode(m){S.mode=m;S.draft=[];if(m!=="scale")S.scalePts=[];if(S.three&&m!=="place")show3d(false);if(m!=="place")$("tools").open=true;
  document.querySelectorAll("[data-mode]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.mode===m));
  $("guide").innerHTML=GUIDE[m];$("scaleBox").classList.toggle("on",m==="scale"&&S.scalePts.length===2);
  $("shapeBox").classList.toggle("on",m==="lot"||m==="bldg"||m==="nobuild");$("nbLabel").style.display=m==="nobuild"?"":"none";
  cv.style.cursor=m==="place"?"grab":"crosshair";layout();update();if(S.three&&v3)v3.resize()}
function finish(){if(S.draft.length<3)return;const p=S.draft;S.draft=[];
  if(S.mode==="lot"){S.lot=p;S.lotClosed=true;S.types=autoTypes(S.lot);const c=cen(p);S.adu.x=c.x;S.adu.y=c.y}
  else if(S.mode==="bldg"){S.bldgs.push(p);S.bldgArea=null}else if(S.mode==="nobuild")S.nb.push({pts:p,label:$("nbLabel").value});
  S.mapDirty=true;update()}
function toImg(e){const r=cv.getBoundingClientRect();return {x:(e.clientX-r.left-S.ox)/S.v,y:(e.clientY-r.top)/S.v}}
let drag=null;
cv.addEventListener("pointerdown",e=>{const p=toImg(e),tol=12/S.v;cv.focus({preventScroll:true});
  if(S.mode==="scale"){if(S.scalePts.length>=2)S.scalePts=[];S.scalePts.push(p);$("scaleBox").classList.toggle("on",S.scalePts.length===2);if(S.scalePts.length===2)$("scaleFt").focus();draw();return}
  if(S.mode==="place"){if(!ready())return;const poly=aduPoly(S.adu.x,S.adu.y);
    if(!inside(p,poly)){S.adu.x=p.x;S.adu.y=p.y}drag={dx:S.adu.x-p.x,dy:S.adu.y-p.y};cv.setPointerCapture(e.pointerId);cv.style.cursor="grabbing";update();return}
  if(S.mode==="lot"&&S.lotClosed&&!S.draft.length){for(let i=0;i<S.lot.length;i++){const a=S.lot[i],b=S.lot[(i+1)%S.lot.length];
      if(ptSeg(p,a,b)<tol){S.types[i]=TYPES[(TYPES.indexOf(S.types[i])+1)%4];S.mapDirty=true;update();return}}return}
  if(S.draft.length>=3&&Math.hypot(p.x-S.draft[0].x,p.y-S.draft[0].y)<tol){finish();return}
  S.draft.push(p);draw()});
cv.addEventListener("pointermove",e=>{if(!drag)return;const p=toImg(e);S.adu.x=p.x+drag.dx;S.adu.y=p.y+drag.dy;update()});
const endDrag=()=>{if(drag){drag=null;cv.style.cursor="grab"}};
cv.addEventListener("pointerup",endDrag);cv.addEventListener("pointercancel",endDrag);
cv.addEventListener("keydown",e=>{if(S.mode!=="place"||!ready())return;const k={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];if(!k)return;e.preventDefault();
  S.adu.x+=k[0]/S.ftPerPx;S.adu.y+=k[1]/S.ftPerPx;update()});
document.querySelectorAll("[data-mode]").forEach(b=>b.addEventListener("click",()=>setMode(b.dataset.mode)));
$("finish").addEventListener("click",finish);
$("undo").addEventListener("click",()=>{if(S.draft.length)S.draft.pop();else if(S.mode==="bldg"){S.bldgs.pop();S.bldgArea=null}else if(S.mode==="nobuild")S.nb.pop();S.mapDirty=true;update()});
$("clear").addEventListener("click",()=>{S.draft=[];if(S.mode==="lot"){S.lot=[];S.lotClosed=false;S.types=[]}else if(S.mode==="bldg"){S.bldgs=[];S.bldgArea=null}else S.nb=[];S.mapDirty=true;update()});
$("scaleApply").addEventListener("click",()=>{const ft=parseFloat($("scaleFt").value);if(!(ft>0)||S.scalePts.length<2)return;
  const d=Math.hypot(S.scalePts[0].x-S.scalePts[1].x,S.scalePts[0].y-S.scalePts[1].y);if(d<2)return;S.ftPerPx=ft/d;S.mapDirty=true;
  // a looked-up lot came with its own scale. Once the scale is set by hand, the building areas, nearby buildings and
  // photo that came from the map no longer match the drawing, so they are dropped and the lot is treated as hand-traced.
  if(S.site){S.site=null;S.info=null;S.bldgArea=null;S.view="drawing";$("viewBox").classList.remove("on");$("sunOn").checked=false;$("sunOn").disabled=true;show3d(false);clearFlagNotes();sunUpdate()}
  setMode(S.lotClosed?"place":"lot")});

/* ---------- controls ---------- */
function design(){const p=PLANS.find(p=>p.id===$("design").value)||null;if(p){$("aw").value=p.w;$("ad").value=p.d}
  S.adu.w=Math.max(8,Math.min(60,parseFloat($("aw").value)||20));S.adu.d=Math.max(8,Math.min(60,parseFloat($("ad").value)||30));
  S.adu.plan=p;S.adu.floorArea=p?p.floorArea:null;planNote(p);if(p&&p.heightGuess>0)$("aduH").value=p.heightGuess;S.mapDirty=true;update();sunUpdate()}
// Choose a zoning district the page has rules for, and fill in its numbers.
function setDistrict(z){const d=DIST[z];if(!d)return;$("dist").value=z;$("rFront").value=d[0];$("rSide").value=d[1];$("rRear").value=d[2];$("rCov").value=d[3];S.needRules="";syncTall()}
// AMC 21.05.070D.1: a detached ADU taller than 15 ft keeps 10 ft from a side line next to an
// R-1 or R-1A lot. The page cannot see the neighbours' zoning, so it assumes they match this
// lot's district: the box starts ticked in R-1 and R-1A, and the person can change it.
function syncTall(){$("tall").checked=$("dist").value==="R-1"||$("dist").value==="R-1A"}
// What the page says about the chosen plan: plain words first, and the numbers and where
// they come from in a note that opens.
function planNote(p){const el=$("planNote");el.textContent="";if(!p)return;
  const top=document.createElement("p");top.style.margin="0";
  top.appendChild(document.createTextNode(p.kind+", designed by "+p.designer+". "+p.floorArea.toLocaleString()+" sq ft of living space"+(p.overGarage?", not counting the garage":"")+"."
    +(p.approx?" Its size on the ground here is an estimate.":"")+" "));
  const a=document.createElement("a");a.href=p.sheet;a.target="_blank";a.rel="noopener noreferrer";a.textContent="See the plan sheet (PDF, new tab)";top.appendChild(a);el.appendChild(top);
  const d=document.createElement("details"),sm=document.createElement("summary"),t=document.createElement("p");sm.textContent="About this design's size, for builders and reviewers";t.style.margin="4px 0 0";
  t.textContent=(p.approx?"The footprint, about "+p.w+" × "+p.d+" ft, is scaled from the drawing on the Municipality's plan sheet, which prints no dimensions. Distances shown here may be off by a foot or two. ":"The footprint is "+p.w+" × "+p.d+" ft. ")
    +"Floor area is from the plan sheet. "
    +(p.stories>1?"This plan is "+(p.stories===2?"two":p.stories)+" stories, so it is taller than 15 ft: next to an R-1 or R-1A lot it must stay 10 ft from the side lot lines (see the box about neighbouring lots below). ":"")
    +"The sheet says: suited for use in "+p.areas+".";
  d.append(sm,t);el.appendChild(d)}
async function loadPlans(){
  try{const r=await fetch("./plans.json");if(!r.ok)throw new Error("HTTP "+r.status);const j=await r.json();
    PLANS=(j.plans||[]).filter(p=>p&&p.id&&p.name&&p.w>0&&p.d>0&&p.floorArea>0);
  }catch(e){console.error(e);PLANS=[]}
  if(!PLANS.length){$("planNote").textContent="The list of pre-approved designs could not be loaded. Type a width and depth instead.";return}
  const sel=$("design"),custom=sel.querySelector('option[value="custom"]');
  PLANS.forEach(p=>{const o=document.createElement("option");o.value=p.id;o.textContent=p.name+" ("+p.floorArea.toLocaleString()+" sq ft of living space)";sel.insertBefore(o,custom)});
  // start on the first plan unless a size has already been typed
  if($("aw").value==="20"&&$("ad").value==="30"){sel.value=PLANS[0].id;design();if(ready()&&!S.info){placeBest();}}
  else{S.mapDirty=true;update()}
}
$("design").addEventListener("change",design);
["aw","ad"].forEach(id=>$(id).addEventListener("input",()=>{$("design").value="custom";design()}));
$("rot").addEventListener("input",()=>{setRot(+$("rot").value);S.mapDirty=true;update()});
Object.keys(DIST).concat(["Custom"]).forEach(k=>{const o=document.createElement("option");o.value=k;o.textContent=k==="Custom"?"Custom values":k+"  (front "+DIST[k][0]+", side "+DIST[k][1]+", rear "+DIST[k][2]+" ft, "+DIST[k][3]+"% coverage)";$("dist").appendChild(o)});
$("dist").addEventListener("change",()=>{if(DIST[$("dist").value])setDistrict($("dist").value);S.needRules="";S.mapDirty=true;update()});
["rFront","rSide","rRear","rCov"].forEach(id=>$(id).addEventListener("input",()=>{$("dist").value="Custom";S.needRules=""}));
["rFront","rSide","rRear","rCov","rSep","tall","house","aduH"].forEach(id=>$(id).addEventListener("input",()=>{S.mapDirty=true;update()}));
$("best").addEventListener("click",goBest);$("showDim").addEventListener("change",draw);
$("showMap").addEventListener("change",draw);
document.querySelectorAll(".flag").forEach(c=>c.addEventListener("change",flags));
$("copy").addEventListener("click",async()=>{const r=S.result;if(!r)return;
  const t=["ADU Fit Check (screening only, not a zoning determination)","Prototype, for ideas and discussion only. Permitting and zoning staff must review any real project.",...(S.info?["Parcel "+S.info.pid+", "+S.info.addr+". Lot lines and buildings from Municipality of Anchorage GIS, not a survey."]:[]),...(S.adu.plan?["Plan: "+S.adu.plan.name+", from the Municipality's pre-approved ADU catalog (www.muni.org/ADU)."+(S.adu.plan.approx?" Its footprint here is an estimate scaled from the plan sheet, which prints no dimensions.":"")]:[]),
    "ADU footprint: "+(S.adu.plan&&S.adu.plan.approx?"about ":"")+S.adu.w+" x "+S.adu.d+" ft, rotated "+S.adu.rot+" degrees","Result: "+(r.ok?"Fits here":"Does not fit here"),
    ...r.why.map(w=>"- "+w),"","Checks:",...r.rows.map(o=>(o.ok?"OK  ":"NO  ")+o.name+": "+o.m+" (required "+o.r+")"),"","Other reviews:",...(flags().length?flags().map(x=>"- "+x):["- none checked"]),...(S.flagNotes?["","From the map layers (check these; the layers may be out of date):",...S.flagNotes.map(x=>"- "+x)]:[])].join("\n");
  try{await navigator.clipboard.writeText(t);$("copied").textContent="Copied."}catch(err){$("copied").textContent="Copy was blocked by the browser."}
  setTimeout(()=>$("copied").textContent="",2500)});

/* ---------- loading a survey ---------- */
function setImage(c){loadSeq++;S.uploaded=false;S.unconfirmed=false;S.ai=null;S.sample=false;$("aiOk").hidden=true;showAi();
  // a new lot starts from the page's defaults, not the last lot's district, house size or ticked boxes
  setDistrict("R-1");$("house").value="";$("rSep").value=0;document.querySelectorAll(".flag").forEach(b=>{b.checked=false});flags();setRot(0);$("addrMsg").textContent="";
  S.img=c;S.iw=c.width;S.ih=c.height;S.ftPerPx=null;S.lot=[];S.lotClosed=false;S.types=[];S.bldgs=[];S.nb=[];S.draft=[];S.scalePts=[];S.bldgArea=null;S.info=null;S.site=null;clearFlagNotes();
  S.view="drawing";$("viewBox").classList.remove("on");$("viewDrawing").setAttribute("aria-pressed","true");$("viewAerial").setAttribute("aria-pressed","false");$("viewMsg").textContent="";
  $("sunOn").checked=false;$("sunOn").disabled=true;sunUpdate();show3d(false);
  S.mapDirty=true;layout()}
function toCanvas(src,w,h){const m=1600/Math.max(w,h),k=Math.min(1,m),c=document.createElement("canvas");c.width=Math.round(w*k);c.height=Math.round(h*k);c.getContext("2d").drawImage(src,0,0,c.width,c.height);return c}
function loadScript(u){return new Promise((res,rej)=>{const s=document.createElement("script");s.src=u;s.onload=res;s.onerror=rej;document.head.appendChild(s)})}
// Take a survey file, from the upload button or one of the made-up samples.
async function useFile(f,sample){
  // images and PDFs only, 10 MB at most. Nothing is uploaded here: the file is read in the browser.
  if(f.size>10*1024*1024||!(/^image\//.test(f.type)||f.type==="application/pdf"||/\.(pdf|png|jpe?g|gif|webp|bmp)$/i.test(f.name))){
    $("tools").open=true;$("guide").innerHTML="<b>That file cannot be used.</b> Choose a photo, a scan or a PDF of the survey, 10 MB or smaller.";return}
  try{
    if(f.type==="application/pdf"||/\.pdf$/i.test(f.name)){
      const base="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
      if(!window.pdfjsLib){await loadScript(base+"pdf.min.js");window.pdfjsLib.GlobalWorkerOptions.workerSrc=base+"pdf.worker.min.js"}
      const pdf=await window.pdfjsLib.getDocument({data:await f.arrayBuffer(),isEvalSupported:false}).promise,pg=await pdf.getPage(1),v0=pg.getViewport({scale:1});
      const vp=pg.getViewport({scale:1600/Math.max(v0.width,v0.height)}),c=document.createElement("canvas");c.width=Math.round(vp.width);c.height=Math.round(vp.height);
      const g=c.getContext("2d");g.fillStyle="#fff";g.fillRect(0,0,c.width,c.height);await pg.render({canvasContext:g,viewport:vp}).promise;setImage(c);
    }else{
      const url=URL.createObjectURL(f),im=new Image();
      try{await new Promise((res,rej)=>{im.onload=res;im.onerror=rej;im.src=url});setImage(toCanvas(im,im.naturalWidth,im.naturalHeight))}finally{URL.revokeObjectURL(url)}
    }
    S.uploaded=true;S.sample=!!sample;showAi();setMode("scale");
    $("guide").appendChild(document.createTextNode(" This page starts with the rules for the R-1 zoning district. If your lot is in another one, choose it under \"The rules used for this lot\"."));
    if(aiOn())$("guide").appendChild(document.createTextNode(" Or press \"Read survey with AI\" for a first tracing to check. That sends the survey image to an AI service to be read. When you accept the tracing, the page reports which parts you changed, and nothing else."));
  }catch(err){$("guide").innerHTML="<b>That file could not be read here.</b> Try a photo or screenshot of the survey (PNG or JPG).";}
}
$("file").addEventListener("change",e=>{const f=e.target.files[0];e.target.value="";if(f)useFile(f)});
// Made-up as-built surveys for trying the upload and AI steps (samples/, drawn by tools/make_samples.py).
document.querySelectorAll("[data-sample]").forEach(b=>b.addEventListener("click",async()=>{
  try{const r=await fetch(b.dataset.sample);if(!r.ok)throw new Error("HTTP "+r.status);
    await useFile(new File([await r.blob()],b.dataset.sample.split("/").pop(),{type:"image/jpeg"}),true)}
  catch(e){console.error(e);$("tools").open=true;$("guide").innerHTML="<b>That sample could not be loaded.</b> Try again in a minute."}}));

/* ---------- AI reads the survey ---------- */
// "Read survey with AI" sends the survey image to the survey reader (lambda/handler.py),
// which asks Claude for a first tracing. The prompt and the model key live on the server.
// The tracing is never shown as a result until the person presses "This tracing looks right".
// The button appears only when a reader is set in config.js and a survey has been uploaded.
const aiOn=()=>!!SURVEY_READER.url;
function showAi(){$("ai").hidden=!(aiOn()&&S.uploaded)}
const AI_MAX_BYTES=1400000;   // the reader refuses more than 1.5 MB
function applyAI(o){
  const P=q=>({x:Math.max(0,Math.min(1000,+q[0]))*S.iw/1000,y:Math.max(0,Math.min(1000,+q[1]))*S.ih/1000}),poly=a=>Array.isArray(a)&&a.length>=3&&a.every(q=>Array.isArray(q)&&isFinite(q[0])&&isFinite(q[1]))?a.map(P):null;
  const shapes=a=>(Array.isArray(a)?a:[]).filter(x=>x&&typeof x==="object");
  // read the whole answer before changing anything, so a bad one leaves the drawing as it was
  if(!o||typeof o!=="object")throw new Error("no answer");
  const lot=poly(o.lot);if(!lot)throw new Error("no lot");
  const bldgs=shapes(o.buildings).map(b=>poly(b.pts)).filter(Boolean),nb=shapes(o.no_build).map(z=>({pts:poly(z.pts),label:String(z.label||"No-build area").slice(0,40)})).filter(z=>z.pts);
  // the gate goes down first: nothing below may show a result for a tracing nobody has checked
  S.unconfirmed=true;$("aiOk").hidden=false;
  S.lot=lot;S.lotClosed=true;S.draft=[];S.bldgs=bldgs;S.nb=nb;S.bldgArea=null;
  // Every line on a street is a front lot line, so a corner lot gets a front setback on both streets:
  // the same labelling an address lookup gets (rules.js typesFromEdges).
  const tr=typesFromTrace(S.lot,o.street_edges,o.alley_edges,o.front_edge);S.types=tr.types;
  const sc=o.scale;let scaled=false;if(sc&&Array.isArray(sc.p1)&&Array.isArray(sc.p2)&&sc.feet>0){const a=P(sc.p1),b=P(sc.p2),d=Math.hypot(a.x-b.x,a.y-b.y);if(d>5){S.ftPerPx=sc.feet/d;scaled=true}}
  // surveys print the district in many ways ("R-6", "R6", "ZONING: R-6 (example)"): take the district out of it
  const z=typeof o.zoning==="string"?normZone((o.zoning.toUpperCase().match(/[A-Z]+-?\d+[A-Z]?/)||[""])[0]):"";
  if(DIST[z])setDistrict(z);
  // kept so the page can say what the person changed before accepting it (reportChecked)
  S.ai={lot:lot.slice(),bldgs:bldgs.slice(),nb:nb.map(q=>q.pts),types:S.types.slice(),ftPerPx:S.ftPerPx,dist:$("dist").value};
  const c=cen(lot);S.adu.x=c.x;S.adu.y=c.y;S.mapDirty=true;
  if(!scaled){setMode("scale");$("guide").innerHTML="<b>The AI traced the lot but could not read a length.</b> Click the two ends of a line with a printed length, then type it. Then check the tracing and press \"This tracing looks right\"."}
  else{setMode("place");
    $("guide").innerHTML="<b>The AI made a first tracing. Check it before anything else.</b> Compare the blue lot lines, the numbered buildings and the orange areas with your survey. Fix anything that is off with steps 1 to 4, then press \"This tracing looks right\"."}
  if(tr.multi)$("guide").appendChild(document.createTextNode(" The AI found more than one street beside this lot, so each street side is checked as a front."));
  if(o.notes)$("guide").appendChild(document.createTextNode(" Note from the AI: "+String(o.notes).slice(0,300)))}
// The pilot's accuracy measure: how often people correct an AI tracing. When one is accepted the
// page tells the reader which parts were changed first, yes or no for each, and how far the
// furthest lot corner moved in whole feet (geometry.js traceDiff). No image, no coordinates and no
// address are sent. It is sent as plain text so the browser makes one request, not two, and
// a failure is ignored: the person's result never waits on it.
function reportChecked(){const a=S.ai;S.ai=null;if(!a||!SURVEY_READER.checked)return;
  try{const d=traceDiff(a,{lot:S.lotClosed?S.lot:[],bldgs:S.bldgs,nb:S.nb.map(q=>q.pts),types:S.types,ftPerPx:S.ftPerPx,dist:$("dist").value});
    fetch(SURVEY_READER.checked,{method:"POST",headers:{"content-type":"text/plain"},body:JSON.stringify({...d,sample:!!S.sample}),keepalive:true}).catch(()=>{})}
  catch(e){console.error(e)}}
$("aiOk").addEventListener("click",()=>{reportChecked();S.unconfirmed=false;$("aiOk").hidden=true;S.mapDirty=true;setMode("place");placeBest();cv.focus({preventScroll:true})});
$("ai").addEventListener("click",async()=>{if(!aiOn()||!S.img||!S.uploaded)return;const btn=$("ai"),img=S.img;btn.disabled=true;btn.textContent="Reading the survey… this can take half a minute";
  const by="trace the survey by hand with steps 1 to 4.";
  try{let blob=null;for(const q of [0.9,0.75,0.6]){blob=await new Promise(r=>S.img.toBlob(r,"image/jpeg",q));if(blob&&blob.size<=AI_MAX_BYTES)break}
    if(!blob||blob.size>AI_MAX_BYTES)throw {code:"too_large"};
    const b64=await new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(String(fr.result).split(",")[1]);fr.onerror=rej;fr.readAsDataURL(blob)});
    const r=await fetch(SURVEY_READER.url,{method:"POST",headers:{"content-type":"application/json","x-api-key":SURVEY_READER.key},body:JSON.stringify(S.sample?{image:b64,sample:true}:{image:b64})});
    const d=await r.json().catch(()=>({}));
    // errors raised by the gateway itself carry no code of ours: over quota or throttled is 429, timed out is 504
    if(!r.ok)throw {code:d.error||(r.status===429?"limit":r.status===504?"slow":"failed")};
    if(S.img!==img)return;   // another survey or an address was loaded while this one was being read
    applyAI(d)}
  catch(e){const c=e&&e.code;console.error(e);if(S.img!==img)return;
    $("guide").innerHTML=c==="limit"||c==="busy"?"<b>The AI reader has reached its limit for now.</b> Try again later, or "+by
      :c==="slow"?"<b>Reading the survey took too long.</b> Try once more, or "+by
      :"<b>The AI could not read this survey.</b> You can "+by}
  finally{btn.disabled=false;btn.textContent="Read survey with AI"}});

/* ---------- address lookup from Municipality of Anchorage GIS (public ArcGIS REST, see data.js) ---------- */
// data.js needs Turf.js from a CDN. It is loaded on first use so the rest of the page works without it.
let dataMod=null;const data=()=>dataMod||(dataMod=import("./data.js"));
const amsg=t=>{$("addrMsg").textContent=t};
const btnEl=(text,fn,cls)=>{const b=document.createElement("button");b.type="button";b.textContent=text;if(cls)b.className=cls;b.addEventListener("click",fn);return b};
// Label the lot lines from the streets and alleys around the lot (rules.js typesFromEdges).
function applyFrontage(){const s=S.site;if(!s)return;const r=typesFromEdges(S.lot,s.edges);S.types=r.types;s.frontage=r}
function frontageNote(){const s=S.site,r=s.frontage,ix=k=>s.edges.map((e,i)=>e.kind===k?L(i):null).filter(Boolean),ls=a=>a.length>1?"Lines "+a.join(", "):"Line "+a[0];
  const out=[];
  if(!r.streets.length)out.push("No street was found next to this lot on the map, so line "+L(S.types.indexOf("front"))+" is only a placeholder for the front. Open step 2 and click the line labels to set them.");
  else if(r.streets.length===1)out.push(ls(ix("street"))+" along "+r.streets[0]+(ix("street").length>1?" are":" is")+" the front.");
  else out.push("This lot has more than one street side: "+r.streets.join(" and ")+". Each street line gets the full front setback here, and there is no rear setback: the other lines are sides (AMC 21.06.030C.4). The zoning director decides the setbacks on a lot like this and may reduce one front setback to no less than half.");
  if(ix("alley").length)out.push(ls(ix("alley"))+" along an alley: no setback there.");
  if(ix("open").length)out.push(ls(ix("open"))+" faces land with no parcel and no mapped street or alley. Check how it should be labelled.");
  return out.join(" ")}
// The sheet for a looked-up parcel: title, notice, north arrow and scale bar, drawn on plain
// paper or over an aerial photo. fr is the sheet frame (data.js sheetBox). The photo sheet is
// made m times larger than the drawing so the photo stays sharp; draw() scales both alike.
function paintSheet(info,lotA,fr,photo,m){
  m=m||1;const {k,my,W,H}=fr,c=document.createElement("canvas");c.width=Math.round(W*m);c.height=Math.round(H*m);const g=c.getContext("2d");g.scale(m,m);
  if(photo){g.drawImage(photo,0,0,W,H);g.fillStyle="rgba(255,255,255,.9)";g.fillRect(12,12,W-24,102);g.fillRect(W-82,my-16,44,92);g.fillRect(30,H-66,20*k+20,36)}
  else{g.fillStyle="#fbfbf8";g.fillRect(0,0,W,H)}
  g.strokeStyle="#222";g.lineWidth=2;g.strokeRect(12,12,W-24,H-24);
  g.fillStyle="#222";g.textAlign="center";g.font="700 20px Archivo,Arial,sans-serif";g.fillText(info.addr||"Parcel "+info.pid,W/2,48);
  g.font="12px 'IBM Plex Mono',monospace";g.fillText("Parcel "+info.pid+(info.zone?"   Zoning "+info.zone:"")+"   Lot "+Math.round(lotA).toLocaleString()+" sq ft as mapped",W/2,70);
  g.fillText("Lot lines and buildings from Municipality of Anchorage GIS.",W/2,88);g.fillText("Prototype. Not a survey. Screening only.",W/2,104);
  g.strokeStyle="#222";g.lineWidth=1;g.beginPath();g.moveTo(W-60,my+70);g.lineTo(W-60,my+10);g.lineTo(W-70,my+30);g.moveTo(W-60,my+10);g.lineTo(W-50,my+30);g.stroke();g.font="700 14px Archivo,Arial,sans-serif";g.fillText("N",W-60,my);
  const bar=20*k;g.lineWidth=3;g.beginPath();g.moveTo(40,H-40);g.lineTo(40+bar,H-40);g.stroke();g.font="11px 'IBM Plex Mono',monospace";g.textAlign="left";g.fillText("20 ft",40,H-48);
  return c;
}

/* ---------- shadows ---------- */
// An aid for thinking and discussion, never a pass or fail check: no shadow rule is applied.
// Only after an address lookup, because an uploaded survey has no known north or location.
// Flat ground, every building a flat-topped block at its mapped height, no trees or fences.
const TZ="America/Anchorage",SHADOW_MAX_FT=600,SUN_MIN_ALT=1;
const MONTH=["January","February","March","April","May","June","July","August","September","October","November","December"];
let shadowCanvas=null;
const clock=m=>{const h=Math.floor(m/60),mm=String(m%60).padStart(2,"0");return (h%12||12)+":"+mm+(h<12?" am":" pm")};
function aduHeight(){return Math.max(6,Math.min(60,parseFloat($("aduH").value)||15))}
function shadowsOn(){return !!(S.site&&S.site.around&&$("sunOn").checked)}
// The sun for the chosen date and clock time at this lot. The middle of Anchorage stands in
// when the lot's own latitude and longitude did not load; across the Municipality that
// moves the sun by well under one degree.
function sunNow(){const [y,mo,d]=$("sunDate").value.split("-").map(Number);if(!y||!mo||!d)return null;
  const c=(S.site&&S.site.center)||{lat:61.19,lon:-149.9};
  return {...sunPosition(zonedToUtc(y,mo,d,+$("sunTime").value,TZ),c.lat,c.lon),mo,d}}
// The same thing the drawing shows, in words.
function sunText(){const s=S.site;
  if(!s)return "Shadows are available after an address lookup. An uploaded survey has no known north or location.";
  if(!s.around)return "The buildings around this lot could not be loaded, so shadows are not available for it.";
  if(!$("sunOn").checked)return "";
  const sun=sunNow();if(!sun)return "Pick a date.";
  const when=clock(+$("sunTime").value)+" Alaska time on "+sun.d+" "+MONTH[sun.mo-1];
  if(sun.alt<=0)return "At "+when+" the sun is below the horizon.";
  if(sun.alt<SUN_MIN_ALT)return "At "+when+" the sun is on the horizon, too low to draw shadows.";
  const ht=aduHeight(),o=shadowOffset(ht,sun.alt,sun.az),miss=s.around.filter(b=>!b.h).length;
  return "At "+when+" the sun is "+f1(sun.alt)+"° above the horizon, to the "+compass(sun.az)+". A "+ht+" ft tall ADU casts a shadow about "+Math.round(o.len).toLocaleString()+" ft long, toward the "+compass(sun.az+180)+"."
    +(o.len>SHADOW_MAX_FT?" Shadows are drawn no longer than "+SHADOW_MAX_FT+" ft.":"")
    +(miss?" "+miss+" of the "+s.around.length+" buildings within 300 ft have no mapped height, so they cast no shadow here.":"")}
function sunUpdate(){$("sunTimeV").textContent=clock(+$("sunTime").value);$("sunTime").setAttribute("aria-valuetext",clock(+$("sunTime").value));$("sunMsg").textContent=sunText();draw()}
$("sunDate").value=todayIn(TZ);
["sunOn","sunDate","sunTime","aduH"].forEach(id=>$(id).addEventListener("input",sunUpdate));
document.querySelectorAll("[data-sunday]").forEach(b=>b.addEventListener("click",()=>{const t=todayIn(TZ);$("sunDate").value=b.dataset.sunday==="today"?t:t.slice(0,4)+"-"+b.dataset.sunday;sunUpdate()}));

/* ---------- sections on the right ---------- */
// Each section opens and closes, so the one in use can sit beside the drawing on a small screen.
const cards=()=>[...document.querySelectorAll("#cards>details")];
$("openAll").addEventListener("click",()=>cards().forEach(d=>{d.open=true}));
$("closeAll").addEventListener("click",()=>cards().forEach(d=>{d.open=false}));

/* ---------- 3D view ---------- */
// A rough block model for thinking about shadows and sight lines (view3d.js, which loads
// three.js from a CDN the first time "3D view" is pressed). Only after an address lookup.
// It shows what the drawing shows: the same buildings, heights, sun and ADU. The ADU is
// moved on the flat drawing, not here. Nothing in it is part of the plan check.
let v3=null,v3busy=false;
const EYE_FT=5.5,UPPER_EYE_FT=15.5;   // eye height standing on the ground floor, and on an upper floor
const tmsg=t=>{$("threeMsg").textContent=t};
const V3TEXT={overview:"From above.",street:"From the street, at eye height.",adu:""};
// the sheet (drawing or aerial photo) with the lot lines painted on, to lay on the ground
// (plain paper or the bare photo: the sheet's title and north arrow would lie on the ground upside down)
function groundCanvas(){const photo=S.view==="aerial"&&S.site.aerialPhoto,fr=S.site.frame,m=Math.min(2,4096/Math.max(fr.W,fr.H)),c=document.createElement("canvas");c.width=Math.round(fr.W*m);c.height=Math.round(fr.H*m);
  const g=c.getContext("2d");g.scale(m,m);if(photo)g.drawImage(photo,0,0,fr.W,fr.H);else{g.fillStyle="#eeece4";g.fillRect(0,0,fr.W,fr.H)}
  g.beginPath();S.lot.forEach((p,i)=>i?g.lineTo(p.x,p.y):g.moveTo(p.x,p.y));g.closePath();g.lineJoin="round";g.strokeStyle="#fff";g.lineWidth=5;g.stroke();g.strokeStyle="#1f5fa8";g.lineWidth=2.5;g.stroke();
  return c}
function build3d(keepCamera){if(!v3||!S.site||!S.site.around)return;const k=S.ftPerPx,F=p=>({x:p.x*k,z:p.y*k}),n=S.lot.length;
  // the way out to the street: the middle of the first front lot line, pointing away from the lot
  let front=null;const fi=S.types.indexOf("front");
  if(fi>=0){const a=F(S.lot[fi]),b=F(S.lot[(fi+1)%n]),c=F(cen(S.lot)),mx=(a.x+b.x)/2,mz=(a.z+b.z)/2,len=Math.hypot(b.x-a.x,b.z-a.z)||1;let nx=-(b.z-a.z)/len,nz=(b.x-a.x)/len;
    if((c.x-mx)*nx+(c.z-mz)*nz>0){nx=-nx;nz=-nz}front={x:mx,z:mz,nx,nz}}
  v3.setSite({w:S.iw*k,h:S.ih*k,ground:groundCanvas(),lot:S.lot.map(F),front,buildings:S.site.around.map(b=>({pts:b.pts.map(F),h:b.h}))},keepCamera);
  sync3d()}
// the ADU and the sun, which change as the controls are moved
function sync3d(){if(!v3||!S.three||!S.site)return;const k=S.ftPerPx;
  v3.setAdu(ready()?{x:S.adu.x*k,z:S.adu.y*k,w:S.adu.w,d:S.adu.d,h:aduHeight(),rot:S.adu.rot,ok:!!(S.result&&S.result.ok)}:null);
  v3.setSun(shadowsOn()?sunNow():null);v3.render()}
function view3d(name){if(!v3)return;const k=S.ftPerPx;
  document.querySelectorAll("[data-v3]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.v3===name)));
  if(name==="adu"){const eye=aduHeight()>=20?UPPER_EYE_FT:EYE_FT,t=S.bldgs.length?cen(S.bldgs[0]):null;
    v3.setView("adu",{eye,look:t?{x:t.x*k,z:t.y*k}:null});
    tmsg("Standing in the ADU, eyes "+eye+" ft above the ground"+(eye>EYE_FT?" (upper floor)":"")+", looking toward "+(t?"the main building":"the north")+". Drag or use the arrow keys to look around. "+V3NOTE)}
  else{v3.setView(name);tmsg(V3TEXT[name]+" Drag to turn, scroll or pinch to zoom; the arrow keys and + and - also work. "+V3NOTE)}}
const V3NOTE="Blocks only: flat ground, flat roofs, no trees or fences. Paler buildings have no mapped height and are drawn 12 ft tall. Tick \"Show shadows\" to see the sun. To move the ADU, switch 3D view off.";
async function show3d(on){const btn=$("view3d"),box=$("three");
  if(!on||!S.site||!S.site.around){S.three=false;box.hidden=true;btn.setAttribute("aria-pressed","false");$("v3kinds").hidden=true;tmsg(on&&S.site?"The buildings around this lot could not be loaded, so the 3D view is not available for it.":"");return}
  if(!v3){if(v3busy)return;v3busy=true;tmsg("Getting the 3D view…");const s=S.site;
    try{const m=await import("./view3d.js");box.hidden=false;v3=m.createView(box)}
    catch(e){console.error(e);box.hidden=true;tmsg("The 3D view could not start in this browser. The drawing and the shadows still work.");return}
    finally{v3busy=false}
    if(S.site!==s){box.hidden=true;tmsg("");return}}   // another address or survey was loaded meanwhile
  S.three=true;box.hidden=false;btn.setAttribute("aria-pressed","true");$("v3kinds").hidden=false;
  // bring the sun controls up beside the model: close the other sections on the right
  cards().forEach(d=>{d.open=d.id==="card-sun"});
  if(S.mode!=="place")setMode("place");
  v3.resize();build3d(false);view3d("overview")}
$("view3d").addEventListener("click",()=>show3d(!S.three));
document.querySelectorAll("[data-v3]").forEach(b=>b.addEventListener("click",()=>view3d(b.dataset.v3)));
$("three").addEventListener("keydown",e=>{if(v3&&S.three)v3.key(e)});

/* ---------- aerial photo under the drawing ---------- */
// The Municipality's own aerial photos (data.js AERIALS), asked for only when "Aerial photo"
// is pressed. No Google imagery is drawn here: its terms do not allow it. The street view
// link opens Google Maps in a new tab instead.
const vmsg=t=>{$("viewMsg").textContent=t};
function setView(v){S.view=v;$("viewDrawing").setAttribute("aria-pressed",String(v==="drawing"));$("viewAerial").setAttribute("aria-pressed",String(v==="aerial"));if(S.three)build3d(true);draw()}
function loadImg(url){return new Promise((res,rej)=>{const im=new Image();im.crossOrigin="anonymous";im.onload=()=>res(im);im.onerror=rej;im.src=url})}
async function showAerial(){const s=S.site;if(!s||!s.frame||s.aerialBusy)return;
  if(s.aerial){setView("aerial");vmsg(s.aerialNote);return}
  s.aerialBusy=true;vmsg("Getting the aerial photo…");
  try{const d=await data(),fr=s.frame,box=d.sheetBox(fr),m=Math.min(2,4096/Math.max(fr.W,fr.H));let got=null;
    for(const a of d.AERIALS){try{got={a,im:await loadImg(d.aerialUrl(a.url,box,fr.W*m,fr.H*m))};break}catch(e){}}
    if(S.site!==s)return;   // another address or survey was loaded meanwhile
    if(!got){vmsg("The aerial photo could not be loaded. Try again in a minute. The drawing still works without it.");return}
    s.aerial=paintSheet(S.info,s.lotA,fr,got.im,m);s.aerialPhoto=got.im;
    s.aerialNote=(got.a!==d.AERIALS[0]?"The "+d.AERIALS[0].year+" photo could not be loaded, so this is the "+got.a.year+" one. ":"")
      +"Aerial photo: Municipality of Anchorage, flown by EagleView "+got.a.flown+". The photo is for orientation. The mapped lot lines can sit a few feet off it, and it may not show recent construction. Screening only.";
    setView("aerial");vmsg(s.aerialNote);
  }catch(e){console.error(e);if(S.site===s)vmsg("The aerial photo could not be loaded. Try again in a minute. The drawing still works without it.")}
  finally{s.aerialBusy=false}}
$("viewAerial").addEventListener("click",showAerial);
$("viewDrawing").addEventListener("click",()=>{setView("drawing");vmsg("")});

function sceneFromGIS(info,site){
  // site coordinates are feet, y down (north up). Lot lines are tidied so each straight line is one edge; buildings are drawn exactly as mapped.
  const lot=clean(site.lot);if(lot.length<3)throw new Error("lot");
  const xs=lot.map(p=>p.x),ys=lot.map(p=>p.y),x0=Math.min(...xs),y0=Math.min(...ys),w=Math.max(...xs)-x0,h=Math.max(...ys)-y0,k=Math.min(8,640/w,760/h),mx=150,my=130;
  const px=p=>({x:(p.x-x0)*k+mx,y:(p.y-y0)*k+my});
  const lotA=area(lot);
  const frame={x0,y0,k,mx,my,W:Math.round(w*k+2*mx),H:Math.round(h*k+my+110)};
  const c=paintSheet(info,lotA,frame);
  const edges=classifyEdges(lot,site.neighbors,site.lines);
  setImage(c);S.ftPerPx=1/k;S.lot=lot.map(px);S.lotClosed=true;S.info=info;
  S.bldgs=site.bldgs.map(b=>openRing(b.pts).map(px));
  S.bldgArea=site.bldgArea;   // clipped to the lot, holes taken out, in sq ft
  S.site={edges,lotA,frame,center:site.center||null,around:site.around?site.around.map(b=>({pts:openRing(b.pts).map(px),h:b.h})):null};
  $("sunOn").disabled=!S.site.around;
  $("viewBox").classList.add("on");
  $("street").href=site.center?"https://www.google.com/maps/@?api=1&map_action=pano&viewpoint="+site.center.lat.toFixed(6)+","+site.center.lon.toFixed(6)
    :"https://www.google.com/maps/search/?api=1&query="+encodeURIComponent((info.addr||"")+", Anchorage, AK");
  applyFrontage();
  // a district this page has no rules for must not be checked with another district's numbers
  const z=normZone(info.zone);if(DIST[z])setDistrict(z);else{$("dist").value="Custom";S.needRules=info.zone||"(blank)"}
  const ce=cen(S.lot);S.adu.x=ce.x;S.adu.y=ce.y;S.mapDirty=true;setMode("place");
  placeBest();
  const gd=$("guide");gd.innerHTML="<b>This is your lot from the Municipality's map.</b> ";
  gd.appendChild(document.createTextNode(frontageNote()+" If a label is wrong, open \"Have a survey of your lot?\" above, press 2 Lot lines and click the label. The building outlines come from the map and may not show recent work. Drag the ADU to try other spots."+(DIST[z]?"":" Zoning district "+(info.zone||"(blank)")+" is not in the list, so set the setbacks by hand.")));
  sunUpdate();
}
// Fill the "other reviews" boxes from map layers (data.js loadFlags, rules.js flagResults).
// Every box stays editable. A lookup that cannot tell leaves the box alone and says so.
const FLAGKEYS=["seis","septic","flood","slope"],FLAGNAME={seis:"Seismic",septic:"Well and septic",flood:"Flood",slope:"Slope"};
function clearFlagNotes(){FLAGKEYS.forEach(k=>{const e=$("src-"+k);if(e)e.textContent=""});S.flagNotes=null}
async function lookupFlags(p){
  // a new lot starts with every box clear, including ones ticked by hand for the last lot
  document.querySelectorAll(".flag").forEach(b=>{b.checked=false});flags();
  FLAGKEYS.forEach(k=>{$("src-"+k).textContent="Checking the map…"});
  let res=null;try{const d=await data();res=flagResults(await d.loadFlags(p))}catch(e){console.error(e)}
  if(!S.info||S.info.pid!==p.pid)return;   // another address or survey was loaded meanwhile
  if(!res){FLAGKEYS.forEach(k=>{$("src-"+k).textContent="The map lookup did not finish. Tick this yourself if it applies."});return}
  S.flagNotes=[];
  FLAGKEYS.forEach(k=>{const r=res[k],box=document.querySelector('.flag[data-k="'+k+'"]');
    if(r.tick===true)box.checked=true;else if(r.tick===false)box.checked=false;
    const t=r.text+(r.source?" Source: "+r.source+".":"");$("src-"+k).textContent=t;S.flagNotes.push(FLAGNAME[k]+": "+t)});
  flags()}
async function loadParcel(p){const btn=$("addrGo"),seq=++loadSeq;btn.disabled=true;$("addrPick").innerHTML="";amsg("Found "+p.addr+". Getting the lot lines, buildings and streets…");
  try{const d=await data(),site=await d.loadSite(p);
    if(seq!==loadSeq)return;   // a survey or another address was loaded while this one was on its way
    sceneFromGIS({pid:p.pid,addr:p.addr,zone:p.zone,lotSize:p.lotSize},site);lookupFlags(p);
    const n=S.bldgs.length,lotA=S.site.lotA;
    amsg("Found "+p.addr+". The map shows "+n+" building"+(n===1?"":"s")+" covering about "+Math.round(site.bldgArea/lotA*100)+"% of the lot ("+Math.round(site.bldgArea).toLocaleString()+" sq ft of buildings on a "+Math.round(lotA).toLocaleString()+" sq ft lot)."
      +(p.lotSize>0&&Math.abs(p.lotSize-lotA)/lotA>0.01?" The assessor lists the lot as "+Number(p.lotSize).toLocaleString()+" sq ft; this page uses the mapped outline.":"")
      +(p.parts>1?" This parcel has "+p.parts+" separate pieces; only the largest is drawn.":""));
    cv.focus({preventScroll:true});
  }catch(e){console.error(e);if(seq===loadSeq)amsg("Your lot was found but the map data did not load. Try again in a minute, or upload a survey.")}
  finally{btn.disabled=false}}
async function lookup(){const q=$("addr").value.trim(),btn=$("addrGo"),pick=$("addrPick");if(!q||btn.disabled)return;const seq=++loadSeq;btn.disabled=true;pick.innerHTML="";amsg("Looking up your lot…");
  let list;
  try{const d=await data();list=await d.findParcels(q)}
  catch(e){console.error(e);if(seq===loadSeq)amsg("Address lookup could not reach the Municipality's map service. Try again in a minute, or upload a survey.");btn.disabled=false;return}
  btn.disabled=false;
  if(seq!==loadSeq){amsg("");return}   // a survey was loaded while the address was being looked up
  if(!list.length){amsg("No lot found at that address. Try the short street type, like 123 W 10TH AVE.");return}
  const Q=q.toUpperCase().replace(/\s+/g," "),exact=list.filter(p=>p.addr===Q);
  if(list.length===1||exact.length===1){loadParcel(exact[0]||list[0]);return}
  amsg(list.length+(list.more?" or more":"")+" lots match. Pick yours"+(list.more?", or type more of the address":"")+".");
  list.forEach(p=>pick.appendChild(btnEl(p.addr+"  (parcel "+p.pid+")",()=>loadParcel(p))));
}
$("addrGo").addEventListener("click",lookup);
// "Try an example" fills in the address from config.js and looks it up
if(EXAMPLE_ADDRESS){const b=$("addrEx");b.hidden=false;b.textContent="Try an example: "+EXAMPLE_ADDRESS;b.addEventListener("click",()=>{$("addr").value=EXAMPLE_ADDRESS;lookup()})}$("addr").addEventListener("keydown",e=>{if(e.key==="Enter")lookup()});

/* ---------- sample survey (made up) ---------- */
function sample(){
  const c=document.createElement("canvas");c.width=760;c.height=1000;const g=c.getContext("2d"),k=6; // 6 px per foot
  g.fillStyle="#fbfbf8";g.fillRect(0,0,760,1000);g.strokeStyle="#222";g.lineWidth=2;g.strokeRect(14,14,732,972);
  const T=(t,x,y,f,a,rot)=>{g.save();g.translate(x,y);if(rot)g.rotate(rot);g.font=f||"12px 'IBM Plex Mono',monospace";g.fillStyle="#222";g.textAlign=a||"center";g.fillText(t,0,0);g.restore()};
  T("AS-BUILT SURVEY",380,50,"700 20px Archivo,Arial,sans-serif");T("LOT 7, BLOCK 3, EXAMPLE SUBDIVISION",380,72);T("SAMPLE ONLY. NOT A REAL SURVEY.",380,92,"600 12px 'IBM Plex Mono',monospace");
  const x0=200,y0=130,x1=560,y1=880;
  g.lineWidth=3;g.strokeRect(x0,y0,360,750);
  T("N 89°58' E   60.00'",380,y0-8);T("60.00'",380,y1+18);T("125.00'",x0-10,505,null,"center",-Math.PI/2);T("125.00'",x1+16,505,null,"center",-Math.PI/2);
  g.setLineDash([8,5]);g.lineWidth=1;g.beginPath();g.moveTo(x0,y0+10*k);g.lineTo(x1,y0+10*k);g.stroke();g.setLineDash([]);T("10' UTILITY EASEMENT",380,y0+34,"11px 'IBM Plex Mono',monospace");
  const hatch=(x,y,w,h)=>{g.save();g.beginPath();g.rect(x,y,w,h);g.clip();g.strokeStyle="#999";g.lineWidth=1;for(let i=-h;i<w;i+=9){g.beginPath();g.moveTo(x+i,y+h);g.lineTo(x+i+h,y);g.stroke()}g.restore();g.lineWidth=2;g.strokeStyle="#222";g.strokeRect(x,y,w,h)};
  hatch(260,592,240,168);g.fillStyle="#fbfbf8";g.fillRect(310,660,140,34);T("EXISTING HOUSE",380,675);T("40.0' x 28.0'",380,689,"11px 'IBM Plex Mono',monospace");
  hatch(230,400,120,132);g.fillStyle="#fbfbf8";g.fillRect(250,452,80,30);T("GARAGE",290,466);T("20.0' x 22.0'",290,479,"10px 'IBM Plex Mono',monospace");
  g.setLineDash([4,4]);g.lineWidth=1;g.strokeRect(232,532,60,348);g.setLineDash([]);T("DRIVEWAY",262,820,"10px 'IBM Plex Mono',monospace","center",-Math.PI/2);
  g.lineWidth=1;g.beginPath();g.moveTo(40,900);g.lineTo(720,900);g.moveTo(40,950);g.lineTo(720,950);g.stroke();T("W. EXAMPLE AVENUE  (60' R.O.W.)",380,930);
  g.beginPath();g.moveTo(660,200);g.lineTo(660,140);g.lineTo(650,160);g.moveTo(660,140);g.lineTo(670,160);g.stroke();T("N",660,132,"700 14px Archivo,Arial,sans-serif");
  T("SCALE: 1 in = 20 ft",640,975,"11px 'IBM Plex Mono',monospace");T("ZONING: R-1 (example)",120,975,"11px 'IBM Plex Mono',monospace");
  setImage(c);S.ftPerPx=1/k;
  S.lot=[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];S.lotClosed=true;S.types=autoTypes(S.lot);
  S.bldgs=[[{x:260,y:592},{x:500,y:592},{x:500,y:760},{x:260,y:760}],[{x:230,y:400},{x:350,y:400},{x:350,y:532},{x:230,y:532}]];
  S.nb=[{label:"Utility easement",pts:[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y0+60},{x:x0,y:y0+60}]}];
  S.adu.x=455;S.adu.y=310;setMode("place");
  // the chosen plan may not fit at that spot, so start it where it fits best
  placeBest();
}
$("sample").addEventListener("click",sample);
window.addEventListener("resize",()=>{layout();draw();if(S.three&&v3)v3.resize()});
flags();sample();loadPlans();
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>{if(S.ftPerPx===1/6&&S.bldgs.length===2&&S.img&&S.img.width===760){const a={...S.adu},m=S.mode;sample();Object.assign(S.adu,a);setMode(m)}});
