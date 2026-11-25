// The search for a spot (rules.js findSpot) and the conversion of the survey reader's answer
// into the page's shapes (rules.js sceneFromTrace). The page and the reader's evaluation
// (tools/verdict.mjs) both use these, so a "could fit" means the same thing in each.
import {describe,it,expect} from "vitest";
import {rectPoly} from "../geometry.js";
import {DIST,check,maxAduArea,autoTypes,gridPts,sizeOk,findSpot,sceneFromTrace} from "../rules.js";

const P=(x,y)=>({x,y});
const box=(x0,y0,x1,y1)=>[P(x0,y0),P(x1,y0),P(x1,y1),P(x0,y1)];
// A 60 x 125 ft lot in feet, y down: A top (rear), B right side, C bottom (front), D left side.
function scene(over){const lot=box(0,0,60,125);return {ftPerPx:1,lot,types:autoTypes(lot),bldgs:[],nb:[],bldgArea:null,adu:{w:20,d:30,x:30,y:60,rot:0},...over}}
const R1=over=>({front:DIST["R-1"][0],side:DIST["R-1"][1],rear:DIST["R-1"][2],cov:DIST["R-1"][3],sep:0,tall:false,maxA:maxAduArea(0),house:0,...over});

describe("findSpot: the spot with the most room to spare",()=>{
  it("finds a spot that passes the full plan check, and leaves the scene alone",()=>{
    const S=scene(),before=JSON.stringify(S),b=findSpot(S,R1());
    expect(b).not.toBe(null);expect(JSON.stringify(S)).toBe(before);
    expect(check(S,rectPoly({...S.adu,rot:b.rot},b.x,b.y,1),R1(),false).ok).toBe(true);
    expect(b.m).toBeGreaterThan(5);   // an empty 60 x 125 ft lot has plenty of room
  });
  it("keeps clear of a house in the middle of the lot",()=>{
    const S=scene({bldgs:[box(10,50,50,90)]}),b=findSpot(S,R1({sep:10}));
    expect(b).not.toBe(null);expect(b.y).toBeLessThan(50);   // the room is behind the house, not in the front setback
  });
  it("turns the ADU a quarter turn when only that fits",()=>{
    // a 28 ft wide strip between the side setbacks is left by a no-build area: 40 x 20 fits only turned
    const S=scene({adu:{w:40,d:20,x:30,y:60,rot:0},nb:[{label:"Easement",pts:box(33,0,60,125)}]});
    const b=findSpot(S,R1());expect(b).not.toBe(null);expect(b.rot).toBe(90);
  });
  it("no spot when the lot is too full for the coverage limit, wherever the ADU goes",()=>{
    const S=scene({bldgArea:2900});expect(sizeOk(S,R1())).toBe(false);expect(findSpot(S,R1())).toBe(null);
  });
  it("no spot when the floor area is over the limit",()=>{
    expect(findSpot(scene({adu:{w:20,d:30,x:30,y:60,rot:0,floorArea:1300}}),R1())).toBe(null);
  });
  it("no spot on a lot too narrow for the setbacks",()=>{
    const lot=box(0,0,28,125);expect(findSpot(scene({lot,types:autoTypes(lot)}),R1())).toBe(null);
  });
  it("looks harder before giving up: a slanted lot where only a turned ADU fits",()=>{
    // a 34 ft wide strip running at 30 degrees: 20 x 30 fits only lined up with it
    const c=Math.cos(Math.PI/6),s=Math.sin(Math.PI/6),T=(x,y)=>P(100+x*c-y*s,x*s+y*c),lot=[T(0,0),T(34,0),T(34,140),T(0,140)];
    const S=scene({lot,types:["side","side","side","side"],adu:{w:20,d:30,x:100,y:60,rot:0}}),b=findSpot(S,R1());
    expect(b).not.toBe(null);expect([30,120]).toContain(b.rot);
  });
  it("gridPts: every point is inside the lot, about 5,000 of them at most",()=>{
    const g=gridPts(scene());expect(g.pts.length).toBeGreaterThan(1000);expect(g.pts.length).toBeLessThan(5200);
    expect(g.pts.every(p=>p.x>0&&p.x<60&&p.y>0&&p.y<125)).toBe(true);expect(g.st).toBeGreaterThanOrEqual(1);
  });
});

describe("sceneFromTrace: the survey reader's answer as the page's shapes",()=>{
  // a 1000 x 2000 pixel image; the reader's grid is 0 to 1000 each way
  const T=over=>({lot:[[100,100],[700,100],[700,725],[100,725]],street_edges:[{edge:2,street:"A ST"}],alley_edges:[0],
    buildings:[{label:"House",pts:[[200,400],[600,400],[600,600],[200,600]]}],no_build:[{label:"Septic field",pts:[[150,150],[300,150],[300,250]]}],
    scale:{p1:[100,100],p2:[700,100],feet:60},zoning:"R-1",notes:"",...over});
  it("scales the grid to the image",()=>{
    const s=sceneFromTrace(T(),1000,2000);expect(s.lot).toEqual([P(100,200),P(700,200),P(700,1450),P(100,1450)]);
    expect(s.bldgs[0][2]).toEqual(P(600,1200));expect(s.nb[0]).toEqual({label:"Septic field",pts:[P(150,300),P(300,300),P(300,500)]});
  });
  it("works out feet per pixel from the scale line",()=>{
    expect(sceneFromTrace(T(),1000,2000).ftPerPx).toBeCloseTo(0.1,10);   // 60 ft across 600 pixels
  });
  it("no scale when no length was read, or the two ends are the same point",()=>{
    expect(sceneFromTrace(T({scale:{p1:[100,100],p2:[700,100],feet:0}}),1000,2000).ftPerPx).toBe(null);
    expect(sceneFromTrace(T({scale:{p1:[100,100],p2:[100,100],feet:60}}),1000,2000).ftPerPx).toBe(null);
    expect(sceneFromTrace(T({scale:null}),1000,2000).ftPerPx).toBe(null);
  });
  it("labels the lot lines from the streets and alleys",()=>{
    expect(sceneFromTrace(T(),1000,2000).types).toEqual(["alley","side","front","side"]);
    const c=sceneFromTrace(T({street_edges:[{edge:2,street:"A ST"},{edge:1,street:"B AVE"}],alley_edges:[]}),1000,2000);
    expect(c.types).toEqual(["side","front","front","side"]);expect(c.multi).toBe(true);
  });
  it("reads the district out of whatever the survey prints, and only if the page has its rules",()=>{
    const z=t=>sceneFromTrace(T({zoning:t}),1000,2000).zone;
    expect(z("R-6")).toBe("R-6");expect(z("r1a")).toBe("R-1A");expect(z("ZONING: R-2M (example)")).toBe("R-2M");
    expect(z("B-3")).toBe("");expect(z("")).toBe("");expect(z(undefined)).toBe("");
  });
  it("keeps points on the image",()=>{
    expect(sceneFromTrace(T({lot:[[-50,100],[1200,100],[700,2000],[100,725]]}),1000,2000).lot.slice(0,3)).toEqual([P(0,200),P(1000,200),P(700,2000)]);
  });
  it("drops shapes that are not shapes and keeps the rest",()=>{
    const s=sceneFromTrace(T({buildings:[{label:"Shed",pts:[[1,1],[2,2]]},null,{label:"House",pts:[[200,400],[600,400],[600,600]]},{label:"Bad",pts:[[1,1],["x",2],[3,3]]}],no_build:"none"}),1000,2000);
    expect(s.bldgs.length).toBe(1);expect(s.nb).toEqual([]);
  });
  it("a missing label gets a plain one, and a long one is cut",()=>{
    const s=sceneFromTrace(T({no_build:[{pts:[[1,1],[9,1],[9,9]]},{label:"x".repeat(90),pts:[[1,1],[9,1],[9,9]]}]}),1000,2000);
    expect(s.nb.map(z=>z.label)).toEqual(["No-build area","x".repeat(40)]);
  });
  it("throws, changing nothing, when there is no usable lot",()=>{
    for(const bad of [null,"text",{},T({lot:[]}),T({lot:[[1,1],[2,2]]}),T({lot:[[1,1],[2,2],["a",3]]}),T({lot:"lot"})])expect(()=>sceneFromTrace(bad,1000,2000)).toThrow();
  });
});
