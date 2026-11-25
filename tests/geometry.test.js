import {describe,it,expect} from "vitest";
import {area,inside,ptSeg,segX,segSeg,polySeg,polyPoly,crosses,closest,cen,rectPoly,openRing,clean,classifyEdges,traceDiff} from "../geometry.js";

const P=(x,y)=>({x,y});
const box=(x0,y0,x1,y1)=>[P(x0,y0),P(x1,y0),P(x1,y1),P(x0,y1)];

describe("area and inside",()=>{
  it("area of a rectangle, either winding",()=>{
    expect(area(box(0,0,60,125))).toBe(7500);
    expect(area(box(0,0,60,125).reverse())).toBe(7500);
  });
  it("area of a concave L",()=>{
    expect(area([P(0,0),P(100,0),P(100,100),P(60,100),P(60,40),P(0,40)])).toBe(100*40+40*60);
  });
  it("inside a concave lot",()=>{
    const L=[P(0,0),P(100,0),P(100,100),P(60,100),P(60,40),P(0,40)];
    expect(inside(P(80,80),L)).toBe(true);
    expect(inside(P(30,70),L)).toBe(false);   // in the notch
    expect(inside(P(30,20),L)).toBe(true);
  });
});

describe("distances",()=>{
  it("point to segment, including past the ends",()=>{
    expect(ptSeg(P(5,3),P(0,0),P(10,0))).toBe(3);
    expect(ptSeg(P(13,4),P(0,0),P(10,0))).toBe(5);
  });
  it("segments that cross are 0 apart; touching ends do not count as crossing",()=>{
    expect(segX(P(0,0),P(10,10),P(0,10),P(10,0))).toBe(true);
    expect(segSeg(P(0,0),P(10,10),P(0,10),P(10,0))).toBe(0);
    expect(segX(P(0,0),P(10,0),P(10,0),P(10,10))).toBe(false);
  });
  it("polygon to segment",()=>{
    expect(polySeg(box(10,10,20,20),P(0,0),P(0,100))).toBe(10);
  });
  it("polygon to polygon: apart, overlapping, contained",()=>{
    expect(polyPoly(box(0,0,10,10),box(14,0,20,10))).toBe(4);
    expect(polyPoly(box(0,0,10,10),box(5,5,20,20))).toBe(0);
    expect(polyPoly(box(2,2,4,4),box(0,0,10,10))).toBe(0);
    expect(polyPoly(box(0,0,10,10),box(2,2,4,4))).toBe(0);
  });
  it("crosses",()=>{
    expect(crosses(box(0,0,10,10),box(5,5,20,20))).toBe(true);
    expect(crosses(box(2,2,4,4),box(0,0,10,10))).toBe(false);
  });
  it("closest gives the distance and both end points",()=>{
    const c=closest(box(10,10,20,20),P(0,0),P(0,100));
    expect(c.d).toBe(10);expect(c.p.x).toBe(10);expect(c.q.x).toBe(0);
  });
});

describe("rectPoly",()=>{
  it("unrotated footprint in feet",()=>{
    const r=rectPoly({w:20,d:30,rot:0},100,100,1);
    expect(area(r)).toBeCloseTo(600,9);
    expect(Math.min(...r.map(p=>p.x))).toBe(90);expect(Math.max(...r.map(p=>p.y))).toBe(115);
  });
  it("rotation keeps the area and the centre",()=>{
    const r=rectPoly({w:20,d:30,rot:35},100,100,1);
    expect(area(r)).toBeCloseTo(600,9);expect(cen(r).x).toBeCloseTo(100,9);expect(cen(r).y).toBeCloseTo(100,9);
  });
  it("a quarter turn swaps width and depth",()=>{
    const r=rectPoly({w:20,d:30,rot:90},0,0,1);
    expect(Math.max(...r.map(p=>p.x))).toBeCloseTo(15,9);expect(Math.max(...r.map(p=>p.y))).toBeCloseTo(10,9);
  });
  it("scales to drawing units",()=>{
    expect(area(rectPoly({w:20,d:30,rot:0},0,0,1/6))).toBeCloseTo(600*36,6);   // 6 px per foot
  });
});

describe("outline tidying",()=>{
  it("openRing drops only the repeated closing point",()=>{
    expect(openRing([P(0,0),P(10,0),P(10,10),P(0,0)])).toHaveLength(3);
    expect(openRing([P(0,0),P(5,0),P(10,0),P(10,10)])).toHaveLength(4);
  });
  it("clean merges points on a straight lot line",()=>{
    const r=clean([P(0,0),P(30,0),P(60,0),P(60,125),P(0,125),P(0,0)]);
    expect(r).toHaveLength(4);expect(area(r)).toBe(7500);
  });
});

describe("classifyEdges: what is outside each lot line",()=>{
  // 60 x 125 ft lot, y down. Street to the south, alley to the north, neighbours east and west.
  const lot=box(0,0,60,125);
  const parcels=[lot,box(-60,0,0,125),box(60,0,120,125),box(0,-145,60,-20)];
  const street={type:"street",label:"W Example Ave",pts:[P(-200,155),P(200,155)]};
  const alley={type:"alley",label:"alley",pts:[P(-200,-10),P(200,-10)]};
  it("interior lot with a rear alley",()=>{
    const e=classifyEdges(lot,parcels,[street,alley]);
    expect(e.map(x=>x.kind)).toEqual(["alley","interior","street","interior"]);
    expect(e[2].label).toBe("W Example Ave");
  });
  it("corner lot: two street edges with different names",()=>{
    const side={type:"street",label:"Example Pl",pts:[P(90,-200),P(90,300)]};
    const e=classifyEdges(lot,[lot,box(-60,0,0,125)],[street,side,alley]);
    expect(e.map(x=>x.kind)).toEqual(["alley","street","street","interior"]);
    expect(e[1].label).toBe("Example Pl");expect(e[2].label).toBe("W Example Ave");
  });
  it("a street off to one side of an edge is not its frontage",()=>{
    // nothing mapped north of the lot; the only centreline is the street to the south
    const e=classifyEdges(lot,[lot,box(-60,0,0,125),box(60,0,120,125)],[street]);
    expect(e[0].kind).toBe("open");expect(e[2].kind).toBe("street");
  });
  it("works whichever way round the lot is listed",()=>{
    const r=lot.slice().reverse(),e=classifyEdges(r,parcels,[street,alley]);
    expect(e.filter(x=>x.kind==="street")).toHaveLength(1);expect(e.filter(x=>x.kind==="alley")).toHaveLength(1);
  });
});

describe("clean on a curved lot line (a cul-de-sac)",()=>{
  // a lot whose street side is an arc of radius 50 ft, digitised every `step` feet along the arc
  const arcLot=step=>{const pts=[],n=Math.round(Math.PI*50/2/step);for(let i=0;i<=n;i++){const t=Math.PI/2*i/n;pts.push(P(50*Math.cos(t),50*Math.sin(t)))}return pts.concat([P(0,120),P(120,120),P(120,0)])};
  const off=(orig,out)=>Math.max(...orig.map(p=>Math.min(...out.map((a,i)=>ptSeg(p,a,out[(i+1)%out.length])))));
  for(const step of [2,1,0.5,0.25]){
    it("never moves the outline by more than 0.3 ft, with a point every "+step+" ft",()=>{
      const lot=arcLot(step),out=clean(lot);
      expect(off(lot,out)).toBeLessThan(0.3);
      expect(Math.abs(area(out)-area(lot))/area(lot)).toBeLessThan(0.005);   // lot area, and so lot coverage, barely changes
      expect(out.length).toBeLessThan(lot.length+1);expect(out.length).toBeGreaterThan(6);       // still a curve, not three points
    });
  }
  it("still makes one edge of a straight line drawn with many points",()=>{
    const line=[];for(let x=0;x<=60;x+=0.5)line.push(P(x,0));
    expect(clean(line.concat([P(60,125),P(0,125)]))).toHaveLength(4);
  });
});

describe("traceDiff: what a person changed in an AI tracing",()=>{
  const ai=()=>({lot:box(0,0,360,750),bldgs:[box(60,400,300,600)],nb:[box(0,0,360,60)],types:["front","side","rear","side"],ftPerPx:1/6,dist:"R-1"});
  it("nothing changed",()=>{
    expect(traceDiff(ai(),ai())).toEqual({lot:false,lot_move_ft:0,buildings:false,no_build:false,scale:false,scale_read:true,streets:false,district:false});
  });
  it("a lot corner moved 30 px at 6 px a foot is 5 ft",()=>{
    const b=ai();b.lot=[P(0,0),P(360,0),P(390,750),P(0,750)];
    const d=traceDiff(ai(),b);expect(d.lot).toBe(true);expect(d.lot_move_ft).toBe(5);expect(d.buildings).toBe(false);
  });
  it("a lot redrawn from another corner, the same shape, has moved 0 ft",()=>{
    const b=ai();b.lot=[...b.lot.slice(2),...b.lot.slice(0,2)];expect(traceDiff(ai(),b).lot_move_ft).toBe(0);
  });
  it("no distance when the number of corners changed or there is no scale",()=>{
    const b=ai();b.lot=[...b.lot,P(-20,300)];expect(traceDiff(ai(),b).lot_move_ft).toBe(null);
    const c=ai();c.ftPerPx=null;expect(traceDiff(ai(),c).lot_move_ft).toBe(null);
    const e=ai();e.lot=[];expect(traceDiff(ai(),e)).toMatchObject({lot:true,lot_move_ft:null});
  });
  it("each other part on its own",()=>{
    let b=ai();b.bldgs.push(box(10,10,50,50));expect(traceDiff(ai(),b)).toMatchObject({lot:false,buildings:true,no_build:false});
    b=ai();b.nb=[];expect(traceDiff(ai(),b)).toMatchObject({buildings:false,no_build:true});
    b=ai();b.types[1]="front";expect(traceDiff(ai(),b)).toMatchObject({streets:true,district:false});
    b=ai();b.dist="Custom";expect(traceDiff(ai(),b)).toMatchObject({streets:false,district:true});
    b=ai();b.ftPerPx=1/5;expect(traceDiff(ai(),b)).toMatchObject({scale:true,scale_read:true});
  });
  it("a scale the AI could not read: setting it is flagged as not read",()=>{
    const a=ai();a.ftPerPx=null;expect(traceDiff(a,ai())).toMatchObject({scale:true,scale_read:false});
  });
});
