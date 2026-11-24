import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {addressWhere,ringsToPolygons,clipToLot,distToPolygons,sheetBox,aerialUrl,AERIALS,SR} from "../data.js";

// Esri rings: outer clockwise (with y up), holes counter-clockwise, closed.
const cw=(x0,y0,x1,y1)=>[[x0,y0],[x0,y1],[x1,y1],[x1,y0],[x0,y0]];
const ccw=(x0,y0,x1,y1)=>cw(x0,y0,x1,y1).slice().reverse();

describe("addressWhere",()=>{
  it("uppercases and keeps to parcels",()=>{
    expect(addressWhere(" 1400 w  23rd ave ")).toBe("Parcel_Address LIKE '%1400 W 23RD AVE%' AND GIS_Category='Parcel' AND Parcel_ID IS NOT NULL");
  });
  it("doubles quotes and removes LIKE wildcards",()=>{
    const w=addressWhere("1 O'MALLEY RD%' OR 1=1 --_");
    expect(w).toContain("O''MALLEY");expect(w.match(/%/g)).toHaveLength(2);expect(w).not.toContain("_'");
    expect(w.replace(/''/g,"").match(/'/g)).toHaveLength(4);   // only the two literals' own quotes
  });
});

describe("aerial photo request",()=>{
  // a 50 x 140 ft lot whose north-west corner is at easting 1000, northing 5000 (y = -5000), 5 px per foot
  const fr={x0:1000,y0:-5000,k:5,mx:150,my:130,W:550,H:940};
  it("sheetBox covers the whole sheet, northing up",()=>{
    const b=sheetBox(fr);
    expect(b.xmin).toBeCloseTo(970);expect(b.xmax).toBeCloseTo(1080);
    expect(b.ymax).toBeCloseTo(5026);expect(b.ymin).toBeCloseTo(4838);
    // same feet per pixel both ways, so the photo is not stretched
    expect((b.xmax-b.xmin)/fr.W).toBeCloseTo((b.ymax-b.ymin)/fr.H);
  });
  it("the lot's corner lands on its sheet pixel",()=>{
    const b=sheetBox(fr);
    expect((1000-b.xmin)*fr.k).toBeCloseTo(fr.mx);expect((b.ymax-5000)*fr.k).toBeCloseTo(fr.my);
  });
  it("aerialUrl asks for that box in the page's projection",()=>{
    const u=new URL(aerialUrl(AERIALS[0].url,sheetBox(fr),1100,1880)),q=u.searchParams;
    expect(u.pathname.endsWith("/MapServer/export")).toBe(true);
    expect(q.get("bbox")).toBe("970,4838,1080,5026");
    expect(q.get("bboxSR")).toBe(String(SR));expect(q.get("imageSR")).toBe(String(SR));
    expect(q.get("size")).toBe("1100,1880");expect(q.get("f")).toBe("image");expect(q.get("layers")).toBe("show:0");
  });
  it("newest photo first, all on the Municipality's server, none that is not published",()=>{
    expect(AERIALS.length).toBeGreaterThan(0);
    AERIALS.forEach(a=>expect(a.url.startsWith("https://www.ancgis.com/arcgis/rest/services/imagery_public/")).toBe(true));
    for(let i=1;i<AERIALS.length;i++)expect(Number(AERIALS[i-1].year)).toBeGreaterThan(Number(AERIALS[i].year));
    // left out until MOA GIS confirms it is meant to be public (see data.js)
    AERIALS.forEach(a=>expect(a.url).not.toContain("Photo_2026_Temp"));
  });

});

describe("privacy",()=>{
  it("data.js never asks for owner or mailing fields, and never asks for all fields",()=>{
    const src=readFileSync(new URL("../data.js",import.meta.url),"utf8").split("\n").filter(l=>!l.trim().startsWith("//")).join("\n");
    expect(src).not.toMatch(/Owner_|Mailing/i);
    expect(src).not.toMatch(/outFields:\s*"\*"/);
    // the AWWU layer holds owner names and mailing addresses: only Service_Type may be asked for
    const awwu=[...src.matchAll(/query\(LAYERS\.awwu,\{[^}]*outFields:"([^"]*)"/g)].map(m=>m[1]);
    expect(awwu).toEqual(["Service_Type"]);
  });
  it("uses a projected system, not Web Mercator",()=>{
    expect([3857,102100,4326]).not.toContain(SR);
  });
});

describe("ringsToPolygons",()=>{
  it("groups holes with their outer ring, largest polygon first",()=>{
    const p=ringsToPolygons([cw(100,0,110,10),cw(0,0,50,50),ccw(10,10,20,20)]);
    expect(p).toHaveLength(2);expect(p[0]).toHaveLength(2);expect(p[0][0][0]).toEqual([0,0]);expect(p[1]).toHaveLength(1);
  });
  it("closes open rings",()=>{
    const p=ringsToPolygons([cw(0,0,10,10).slice(0,4)]);
    expect(p[0][0]).toHaveLength(5);
  });
});

describe("clipToLot",()=>{
  const lot=[cw(0,0,60,125)];
  it("a building wholly on the lot keeps its exact outline and area",()=>{
    const L=[[10,10],[10,40],[30,40],[30,30],[50,30],[50,10],[10,10]];   // L-shaped, 6 corners, 1,000 sq ft
    const r=clipToLot(lot,[[L]]);
    expect(r).toHaveLength(1);expect(r[0].area).toBeCloseTo(1000,6);expect(r[0].outer).toHaveLength(7);
  });
  it("a building shared across the lot line is cut at the line",()=>{
    const r=clipToLot(lot,[[cw(40,50,100,90)]]);   // 60 x 40 duplex, 20 ft of it on this lot
    expect(r).toHaveLength(1);expect(r[0].area).toBeCloseTo(800,6);
    expect(Math.max(...r[0].outer.map(p=>p[0]))).toBe(60);
  });
  it("a neighbour's building that only touches or barely crosses the line is dropped",()=>{
    expect(clipToLot(lot,[[cw(60,50,100,90)]])).toHaveLength(0);
    expect(clipToLot(lot,[[cw(59.8,50,100,90)]])).toHaveLength(0);   // 8 sq ft sliver
    expect(clipToLot(lot,[[cw(200,200,220,220)]])).toHaveLength(0);
  });
  it("a courtyard is taken out of the area",()=>{
    const r=clipToLot(lot,[[cw(10,10,50,50),ccw(20,20,30,30)]]);
    expect(r[0].area).toBeCloseTo(1600-100,6);
  });
  it("largest first",()=>{
    const r=clipToLot(lot,[[cw(0,0,10,10)],[cw(20,20,50,60)]]);
    expect(r.map(x=>Math.round(x.area))).toEqual([1200,100]);
  });
});

describe("distToPolygons (flood zone distance)",()=>{
  const B=(x0,y0,x1,y1)=>[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
  const lot=B(0,0,60,125);
  it("distance to a polygon that is apart",()=>{
    expect(distToPolygons(lot,[[B(360,0,500,125)]])).toBe(300);
    expect(distToPolygons(lot,[[B(361,0,500,125)]])).toBe(301);
    expect(distToPolygons(lot,[[B(900,0,950,10)],[B(100,0,200,10)]])).toBe(40);   // nearest of several
  });
  it("0 when the zone crosses the lot, covers it, or sits inside it",()=>{
    expect(distToPolygons(lot,[[B(50,50,200,60)]])).toBe(0);
    expect(distToPolygons(lot,[[B(-100,-100,300,300)]])).toBe(0);
    expect(distToPolygons(lot,[[B(20,20,30,30)]])).toBe(0);
  });
  it("a lot inside a hole in the zone is outside the zone",()=>{
    expect(distToPolygons(lot,[[B(-500,-500,600,600),B(-50,-40,110,165)]])).toBe(40);
  });
  it("no polygons",()=>{
    expect(distToPolygons(lot,[])).toBe(Infinity);
  });
});
