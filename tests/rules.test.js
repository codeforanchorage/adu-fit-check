import {describe,it,expect} from "vitest";
import {rectPoly} from "../geometry.js";
import {DIST,check,margin,reqFor,maxAduArea,normZone,autoTypes,typesFromEdges} from "../rules.js";

const P=(x,y)=>({x,y});
const box=(x0,y0,x1,y1)=>[P(x0,y0),P(x1,y0),P(x1,y1),P(x0,y1)];

// A 60 x 125 ft lot (7,500 sq ft), in feet, y down. Edge A is the top (rear), B the right
// side, C the bottom (front, on the street), D the left side.
function scene(over){
  const lot=box(0,0,60,125);
  return {ftPerPx:1,lot,types:autoTypes(lot),bldgs:[],nb:[],bldgArea:null,adu:{w:20,d:30,rot:0},...over};
}
// R-1 values from AMC 21.06.020 Table 21.06-1, as held in DIST
const R1=(over)=>({front:DIST["R-1"][0],side:DIST["R-1"][1],rear:DIST["R-1"][2],cov:DIST["R-1"][3],sep:0,tall:false,maxA:maxAduArea(0),house:0,...over});
const at=(S,x,y)=>rectPoly(S.adu,x,y,S.ftPerPx);
const row=(r,name)=>r.rows.find(o=>o.name.startsWith(name));

describe("lot line labels",()=>{
  it("autoTypes: lowest line is the front, the parallel line is the rear",()=>{
    expect(scene().types).toEqual(["rear","side","front","side"]);
  });
  it("autoTypes takes a given front line",()=>{
    expect(autoTypes(box(0,0,60,125),1)).toEqual(["side","front","side","rear"]);
  });
  it("typesFromEdges: one street and an alley",()=>{
    const lot=box(0,0,60,125),k=(kind,label="")=>({kind,label});
    const r=typesFromEdges(lot,[k("alley","alley"),k("interior"),k("street","W Example Ave"),k("interior")]);
    expect(r.types).toEqual(["alley","side","front","side"]);expect(r.streets).toEqual(["W Example Ave"]);expect(r.multi).toBe(false);
    const one=typesFromEdges(lot,[k("interior"),k("interior"),k("street","W Example Ave"),k("interior")]);
    expect(one.types).toEqual(["rear","side","front","side"]);   // an interior lot still has a rear
  });
  it("typesFromEdges: corner lot has fronts and sides only, no rear (AMC 21.06.030C.4, illustration note 3)",()=>{
    const lot=box(0,0,60,125),k=(kind,label="")=>({kind,label});
    const r=typesFromEdges(lot,[k("interior"),k("street","Example Pl"),k("street","W Example Ave"),k("interior")]);
    expect(r.types).toEqual(["side","front","front","side"]);expect(r.multi).toBe(true);
    expect(r.streets).toEqual(["Example Pl","W Example Ave"]);   // longest frontage first
  });
  it("typesFromEdges: corner lot with an alley keeps the alley",()=>{
    const lot=box(0,0,60,125),k=(kind,label="")=>({kind,label});
    const r=typesFromEdges(lot,[k("interior"),k("alley","alley"),k("street","W Example Ave"),k("street","Example St")]);
    expect(r.types).toEqual(["side","alley","front","front"]);
  });
  it("typesFromEdges: double-frontage lot has no rear either",()=>{
    const lot=box(0,0,60,125),k=(kind,label="")=>({kind,label});
    const r=typesFromEdges(lot,[k("street","North St"),k("interior"),k("street","South St"),k("interior")]);
    expect(r.types).toEqual(["front","side","front","side"]);
  });
  it("corner lot: full front setback on both streets, side setback on the rest",()=>{
    const lot=box(0,0,60,125),k=(kind,label="")=>({kind,label});
    const types=typesFromEdges(lot,[k("interior"),k("street","Example Pl"),k("street","W Example Ave"),k("interior")]).types;
    const S=scene({types});
    expect(check(S,at(S,30,90),R1(),false).ok).toBe(true);     // 20.0 ft from both street lines
    expect(check(S,at(S,31,90),R1(),false).ok).toBe(false);    // 19.0 ft from the Example Pl line
    expect(check(S,at(S,30,91),R1(),false).ok).toBe(false);    // 19.0 ft from the W Example Ave line
    expect(check(S,at(S,15,20),R1(),false).ok).toBe(true);     // 5.0 ft from the top and left lines: sides, not a rear
    expect(check(S,at(S,15,19),R1(),false).ok).toBe(false);    // 4.0 ft
  });
  it("typesFromEdges: no street found falls back to the placeholder front",()=>{
    const lot=box(0,0,60,125),k=(kind)=>({kind,label:""});
    const r=typesFromEdges(lot,[k("alley"),k("interior"),k("open"),k("interior")]);
    expect(r.front).toBe(null);expect(r.types).toEqual(["alley","side","front","side"]);
  });
});

describe("normZone",()=>{
  it("normalises the assessor's spellings",()=>{
    expect(normZone("R1")).toBe("R-1");expect(normZone("R-1")).toBe("R-1");expect(normZone(" r1a ")).toBe("R-1A");
    expect(normZone("R2M")).toBe("R-2M");expect(normZone("B3")).toBe("B3");expect(normZone(null)).toBe("");
    expect(DIST[normZone("R1")]).toBeDefined();
  });
});

describe("setbacks (AMC 21.06.020 Table 21.06-1, AMC 21.05.070D.1)",()=>{
  it("fits in the middle of the lot",()=>{
    const S=scene(),r=check(S,at(S,30,50),R1(),false);
    expect(r.ok).toBe(true);expect(r.why).toEqual([]);
    expect(row(r,"Side lot line D").m).toBe("20.0 ft");expect(row(r,"Rear lot line A").m).toBe("35.0 ft");
  });
  it("exactly on the side setback line passes",()=>{
    const S=scene(),r=check(S,at(S,15,50),R1(),false);   // left wall 5.0 ft from line D
    expect(row(r,"Side lot line D").m).toBe("5.0 ft");expect(r.ok).toBe(true);
  });
  it("just inside the side setback fails and says why",()=>{
    const S=scene(),r=check(S,at(S,14.5,50),R1(),false);
    expect(r.ok).toBe(false);expect(row(r,"Side lot line D").ok).toBe(false);
    expect(r.why[0]).toBe("4.5 ft from side lot line D. 5 ft required.");
  });
  it("ADU touching a lot line fails",()=>{
    const S=scene(),r=check(S,at(S,10,50),R1(),false);   // left wall on line D
    expect(r.ok).toBe(false);
    expect(check(S,at(S,10,50),R1(),true).ok).toBe(false);
  });
  it("ADU over a lot line is outside the lot",()=>{
    const S=scene(),r=check(S,at(S,5,50),R1(),false);
    expect(r.ok).toBe(false);expect(r.why[0]).toBe("Part of the ADU is outside the lot lines.");
    expect(row(r,"Side lot line D").m).toBe("outside");
  });
  it("front and rear setbacks",()=>{
    const S=scene();
    expect(check(S,at(S,30,90),R1(),false).ok).toBe(true);    // 20.0 ft from the front line
    expect(check(S,at(S,30,91),R1(),false).ok).toBe(false);   // 19.0 ft
    expect(check(S,at(S,30,25),R1(),false).ok).toBe(true);    // 10.0 ft from the rear line
    expect(check(S,at(S,30,24),R1(),false).ok).toBe(false);   // 9.0 ft
  });
  it("alley edge: no setback on a side or rear line next to an alley",()=>{
    const S=scene(),near=at(S,30,15.5);                       // 0.5 ft from the top line
    expect(check(S,near,R1(),false).ok).toBe(false);          // as a rear line: 10 ft required
    S.types[0]="alley";
    const r=check(S,near,R1(),false);
    expect(r.ok).toBe(true);expect(row(r,"Alley lot line A").r).toBe("none");expect(row(r,"Alley lot line A").m).toBe("0.5 ft");
    expect(reqFor("alley",R1())).toBe(0);
  });
  it("taller than 15 ft next to R-1 or R-1A: 10 ft side setback",()=>{
    const S=scene(),p=at(S,17,50);                            // 7.0 ft from line D
    expect(check(S,p,R1(),false).ok).toBe(true);
    const r=check(S,p,R1({tall:true}),false);
    expect(r.ok).toBe(false);expect(r.why[0]).toContain("10 ft required for an ADU taller than 15 ft");
    expect(reqFor("side",R1({tall:true}))).toBe(10);expect(reqFor("rear",R1({tall:true}))).toBe(10);expect(reqFor("front",R1({tall:true}))).toBe(20);
  });
  it("rotated ADU: corners reach further than the walls",()=>{
    const S=scene();
    expect(check(S,at(S,22,50),R1(),false).ok).toBe(true);    // square to the lot: 12.0 ft from line D
    S.adu.rot=45;
    const r=check(S,at(S,22,50),R1(),false);                  // corner now 17.68 ft out: 4.3 ft from line D
    expect(r.ok).toBe(false);expect(row(r,"Side lot line D").m).toBe("4.3 ft");
    expect(check(S,at(S,30,50),R1(),false).ok).toBe(true);    // 12.3 ft each side
  });
  it("margin is the smallest room to spare",()=>{
    const S=scene();
    expect(margin(S,at(S,30,50),R1())).toBeCloseTo(15,9);     // 20 ft from each side line, less 5
  });
});

describe("concave lot",()=>{
  // U-shaped lot: two 30 ft legs joined along the top, a 40 ft wide notch between them
  const U=[P(0,0),P(100,0),P(100,100),P(70,100),P(70,40),P(30,40),P(30,100),P(0,100)];
  const R={front:0,side:0,rear:0,cov:100,sep:0,tall:false,maxA:1200,house:0};
  const S=()=>({ftPerPx:1,lot:U,types:U.map(()=>"side"),bldgs:[],nb:[],bldgArea:null,adu:{w:20,d:20,rot:0}});
  it("fits in the solid part",()=>{
    const s=S();expect(check(s,at(s,50,20),R,false).ok).toBe(true);
  });
  it("in the notch is outside the lot",()=>{
    const s=S(),r=check(s,at(s,50,70),R,false);
    expect(r.ok).toBe(false);expect(r.why[0]).toBe("Part of the ADU is outside the lot lines.");
  });
  it("bridging the notch with every corner inside the lot is still outside",()=>{
    const s=S();s.adu={w:60,d:10,rot:0};                       // corners in the two legs, middle over the notch
    const r=check(s,at(s,50,70),R,false);
    expect(r.ok).toBe(false);expect(r.why[0]).toBe("Part of the ADU is outside the lot lines.");
  });
  it("setback is measured to the notch walls too",()=>{
    const s=S(),r=check(s,at(s,13,70),{...R,side:5},false);    // 3 ft from the outer line, 7 ft from the notch wall
    expect(r.ok).toBe(false);expect(r.why).toHaveLength(1);
    expect(check(s,at(s,15,70),{...R,side:5},false).ok).toBe(true);
  });
});

describe("existing buildings and no-build areas",()=>{
  it("overlap with a building fails; clear of it passes",()=>{
    const S=scene({bldgs:[box(10,60,50,100)]});
    const hit=check(S,at(S,30,50),R1(),false);                // ADU y 35..65 overlaps the house
    expect(hit.ok).toBe(false);expect(hit.why).toContain("Overlaps existing building 1.");
    expect(check(S,at(S,30,40),R1(),false).ok).toBe(true);    // 5 ft clear
  });
  it("ADU wholly inside a building counts as overlap",()=>{
    const S=scene({bldgs:[box(5,20,55,110)],bldgArea:0});
    expect(row(check(S,at(S,30,60),R1(),false),"Existing building 1").m).toBe("overlaps");
  });
  it("the gap from buildings is applied when set",()=>{
    const S=scene({bldgs:[box(10,60,50,100)]}),p=at(S,30,40);
    expect(check(S,p,R1({sep:6}),false).ok).toBe(false);
    expect(check(S,p,R1({sep:5}),false).ok).toBe(true);
  });
  it("no-build area",()=>{
    const S=scene({nb:[{label:"Utility easement",pts:box(0,0,60,12)}]});
    const r=check(S,at(S,30,25),R1(),false);                  // ADU y 10..40 sits on the easement
    expect(r.ok).toBe(false);expect(r.why).toContain("Sits on a utility easement.");
    expect(check(S,at(S,30,30),R1(),false).ok).toBe(true);
  });
});

describe("lot coverage (AMC 21.05.070D.1: house plus all accessory buildings)",()=>{
  it("exactly at the cap passes",()=>{
    // 7,500 sq ft lot, 40% cap = 3,000 sq ft. House 2,400 + ADU 600 = 3,000.
    const S=scene({bldgs:[box(10,60,50,120)]}),r=check(S,at(S,30,30),R1(),false);
    expect(r.cov).toBeCloseTo(40,9);expect(row(r,"Lot coverage").m).toBe("40.0%");expect(row(r,"Lot coverage").ok).toBe(true);expect(r.ok).toBe(true);
  });
  it("just over the cap fails",()=>{
    const S=scene({bldgs:[box(10,60,50,120)],adu:{w:20,d:31,rot:0}}),r=check(S,at(S,30,30),R1(),false);   // 3,020 sq ft = 40.3%
    expect(row(r,"Lot coverage").ok).toBe(false);expect(r.ok).toBe(false);
    expect(r.why[0]).toBe("Lot coverage would be 40.3%. The limit is 40%. A smaller footprint could fit.");
  });
  it("a measured footprint replaces the traced outlines",()=>{
    const S=scene({bldgs:[box(10,60,50,120)],bldgArea:1200}),r=check(S,at(S,30,30),R1(),false);
    expect(r.cov).toBeCloseTo((1200+600)/7500*100,9);
  });
  it("the district cap is used: R-5 is 30%",()=>{
    const S=scene({bldgs:[box(10,60,50,120)]});
    expect(check(S,at(S,30,30),R1({cov:DIST["R-5"][3]}),false).ok).toBe(false);
  });
});

describe("ADU floor area (AMC 21.05.070D.1: 900 sq ft or 40% of the house, whichever is greater, never over 1,200)",()=>{
  it("the cap by house size",()=>{
    expect(maxAduArea(1000)).toBe(900);     // 40% is 400, so 900
    expect(maxAduArea(2250)).toBe(900);     // 40% is exactly 900
    expect(maxAduArea(2500)).toBe(1000);    // 40% is 1,000
    expect(maxAduArea(3000)).toBe(1200);    // 40% is exactly 1,200
    expect(maxAduArea(4000)).toBe(1200);    // 40% is 1,600, held to 1,200
    expect(maxAduArea(0)).toBe(1200);       // house size not given: only the ceiling applies
  });
  it("check applies it",()=>{
    const big={front:0,side:0,rear:0,cov:100,sep:0,tall:false};
    const S={ftPerPx:1,lot:box(0,0,200,200),types:["rear","side","front","side"],bldgs:[],nb:[],bldgArea:null,adu:{w:30,d:31,rot:0}};   // 930 sq ft
    const p=at(S,100,100);
    const no=check(S,p,{...big,house:2000,maxA:maxAduArea(2000)},false);
    expect(no.ok).toBe(false);expect(row(no,"ADU floor area").r).toBe("≤ 900 sq ft");
    expect(check(S,p,{...big,house:2500,maxA:maxAduArea(2500)},false).ok).toBe(true);
    S.adu={w:30,d:30,rot:0};
    expect(check(S,at(S,100,100),{...big,house:2000,maxA:maxAduArea(2000)},false).ok).toBe(true);   // exactly 900
    S.adu={w:30,d:41,rot:0};                                                                         // 1,230
    expect(check(S,at(S,100,100),{...big,house:5000,maxA:maxAduArea(5000)},false).ok).toBe(false);
  });
});

describe("quick mode (the fit map)",()=>{
  it("agrees with the full check",()=>{
    const S=scene({bldgs:[box(10,60,50,100)],nb:[{label:"Utility easement",pts:box(0,0,60,12)}]});
    for(let y=10;y<120;y+=7)for(let x=5;x<60;x+=6){const p=at(S,x,y);expect(check(S,p,R1(),true).ok).toBe(check(S,p,R1(),false).ok)}
  });
});

describe("DIST: every district has four numbers",()=>{
  it("front, side, rear, coverage",()=>{
    for(const k of Object.keys(DIST)){expect(DIST[k]).toHaveLength(4);DIST[k].forEach(n=>expect(n).toBeGreaterThan(0))}
  });
});
