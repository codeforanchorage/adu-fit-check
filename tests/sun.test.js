import {describe,it,expect} from "vitest";
import {sunPosition,zonedToUtc,todayIn,shadowOffset,compass} from "../sun.js";
import {sweep,inside} from "../geometry.js";

// Anchorage, near the middle of the Bowl
const LAT=61.2181,LON=-149.9003,TZ="America/Anchorage";
// highest sun of a calendar day there, scanned minute by minute
function noon(y,mo,d){let best={alt:-99};for(let m=0;m<1440;m++){const p=sunPosition(zonedToUtc(y,mo,d,m,TZ),LAT,LON);if(p.alt>best.alt)best={...p,m}}return best}

describe("sunPosition at Anchorage",()=>{
  // At solar noon the sun stands 90 - latitude + declination above the horizon, due south.
  // The declination is +23.44 at the June solstice, -23.44 in December and 0 at the equinox.
  it("June solstice noon: about 52.2 degrees, due south",()=>{
    const n=noon(2026,6,21);expect(n.alt).toBeCloseTo(90-LAT+23.44,1);expect(Math.abs(n.az-180)).toBeLessThan(1);
  });
  it("December solstice noon: about 5.3 degrees, due south",()=>{
    const n=noon(2026,12,21);expect(n.alt).toBeCloseTo(90-LAT-23.44,1);expect(Math.abs(n.az-180)).toBeLessThan(1);
  });
  it("March equinox noon: about 28.8 degrees",()=>{
    expect(Math.abs(noon(2026,3,20).alt-(90-LAT))).toBeLessThan(0.3);
  });
  it("solar noon is near 2 pm on the clock in summer and 1 pm in winter",()=>{
    // Anchorage sits far west in its time zone, and summer is on daylight time
    expect(Math.abs(noon(2026,6,21).m-14*60)).toBeLessThan(15);expect(Math.abs(noon(2026,12,21).m-13*60)).toBeLessThan(15);
  });
  it("the sun is in the east before noon and the west after, and down at midnight in December",()=>{
    const at=m=>sunPosition(zonedToUtc(2026,6,21,m,TZ),LAT,LON);
    expect(at(8*60).az).toBeGreaterThan(45);expect(at(8*60).az).toBeLessThan(180);
    expect(at(19*60).az).toBeGreaterThan(180);expect(at(19*60).az).toBeLessThan(330);
    expect(sunPosition(zonedToUtc(2026,12,21,0,TZ),LAT,LON).alt).toBeLessThan(0);
  });
});

describe("clock time in Alaska",()=>{
  it("standard time is 9 hours behind UTC, daylight time 8",()=>{
    expect(zonedToUtc(2026,12,21,12*60,TZ)).toBe(Date.UTC(2026,11,21,21,0));
    expect(zonedToUtc(2026,6,21,12*60,TZ)).toBe(Date.UTC(2026,5,21,20,0));
  });
  it("todayIn gives the Alaska date, which can be a day behind UTC",()=>{
    expect(todayIn(TZ,Date.UTC(2026,10,24,3,0))).toBe("2026-11-23");
    expect(todayIn(TZ,Date.UTC(2026,10,24,12,0))).toBe("2026-11-24");
  });
});

describe("shadowOffset: length is height / tan(sun angle), pointing away from the sun",()=>{
  it("sun in the south at 45 degrees: shadow as long as the height, to the north (up the drawing)",()=>{
    const o=shadowOffset(10,45,180);expect(o.len).toBeCloseTo(10);expect(o.dx).toBeCloseTo(0);expect(o.dy).toBeCloseTo(-10);
  });
  it("sun in the east: shadow to the west",()=>{
    const o=shadowOffset(10,45,90);expect(o.dx).toBeCloseTo(-10);expect(o.dy).toBeCloseTo(0);
  });
  it("a 20 ft building at the December noon sun casts well over 200 ft",()=>{
    expect(shadowOffset(20,5.34,180).len).toBeCloseTo(214,0);
  });
  it("capped at the longest length asked for; nothing when the sun is down",()=>{
    const o=shadowOffset(20,2,180,400);expect(o.len).toBe(400);expect(o.capped).toBe(true);expect(shadowOffset(20,5.34,180,600).capped).toBe(false);
    expect(shadowOffset(20,0,180)).toBe(null);expect(shadowOffset(20,-3,180)).toBe(null);
  });
  it("compass words",()=>{
    expect(compass(0)).toBe("north");expect(compass(182)).toBe("south");expect(compass(225)).toBe("south-west");expect(compass(359)).toBe("north");
  });
});

describe("sweep: ground covered by a block's shadow",()=>{
  const sq=[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}],parts=sweep(sq,0,-30),hit=p=>parts.some(q=>inside(p,q));
  it("covers the footprint, the far end and everything between",()=>{
    expect(parts).toHaveLength(2+sq.length);
    expect(hit({x:5,y:5})).toBe(true);expect(hit({x:5,y:-25})).toBe(true);expect(hit({x:5,y:-12})).toBe(true);
  });
  it("covers nothing beside or beyond it",()=>{
    expect(hit({x:12,y:-12})).toBe(false);expect(hit({x:5,y:-31})).toBe(false);expect(hit({x:5,y:11})).toBe(false);
  });
});
