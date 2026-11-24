import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {addressWhere,ringsToPolygons,clipToLot,SR} from "../data.js";

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

describe("privacy",()=>{
  it("data.js never asks for owner or mailing fields, and never asks for all fields",()=>{
    const src=readFileSync(new URL("../data.js",import.meta.url),"utf8").split("\n").filter(l=>!l.trim().startsWith("//")).join("\n");
    expect(src).not.toMatch(/Owner_|Mailing/i);
    expect(src).not.toMatch(/outFields:\s*"\*"/);
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
