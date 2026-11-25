// @vitest-environment happy-dom
// view3d.js against a stand-in for three.js (tests/fakes/). These check what is built and
// where, not how it looks: a real browser is still the only test of the picture.
import {describe,it,expect,beforeEach} from "vitest";
import {made} from "./fakes/three.js";
import {createView} from "../view3d.js";

const box=(x0,z0,x1,z1)=>[{x:x0,z:z0},{x:x1,z:z0},{x:x1,z:z1},{x:x0,z:z1}];
const SITE=()=>({w:120,h:200,ground:document.createElement("canvas"),lot:box(30,40,90,165),front:{x:60,z:165,nx:0,nz:1},
  buildings:[{pts:box(40,100,80,128),h:18},{pts:box(35,60,55,82),h:null},{pts:[{x:0,z:0},{x:1,z:1}],h:10}]});

let el,v,r,c;
const meshes=()=>{const out=[];r.scene.traverse(o=>{if(o.geometry)out.push(o)});return out};
const kind=k=>meshes().filter(m=>m.geometry.kind===k);
beforeEach(()=>{made.renderers.length=0;made.controls.length=0;el=document.createElement("div");
  Object.defineProperty(el,"clientWidth",{value:600});Object.defineProperty(el,"clientHeight",{value:400});
  v=createView(el);r=made.renderers[0];c=made.controls[0];v.setSite(SITE())});

describe("the 3D view: what is built",()=>{
  it("puts its canvas in the container, hidden from screen readers",()=>{
    expect(el.firstChild).toBe(r.domElement);expect(r.domElement.getAttribute("aria-hidden")).toBe("true");
  });
  it("one block for each building with at least three corners",()=>{
    expect(kind("extrude").length).toBe(2);
  });
  it("a building is as tall as its mapped height and throws a shadow",()=>{
    const [a]=kind("extrude");expect(a.geometry.args[1].depth).toBe(18);expect(a.castShadow).toBe(true);expect(a.material.transparent).toBeFalsy();
  });
  it("a building with no mapped height is drawn 12 ft tall, paler, and throws no shadow",()=>{
    const b=kind("extrude")[1];expect(v.noHeightFt).toBe(12);expect(b.geometry.args[1].depth).toBe(12);expect(b.castShadow).toBe(false);expect(b.material.transparent).toBe(true);
  });
  it("the sheet lies on the ground at its own size, with its corner at the origin",()=>{
    const sheet=kind("plane").find(m=>m.material.map);expect(sheet.geometry.args).toEqual([120,200]);
    expect([sheet.position.x,sheet.position.y,sheet.position.z]).toEqual([60,0,100]);expect(sheet.receiveShadow).toBe(true);
  });
  it("a new site replaces the old one and frees it",()=>{
    const old=kind("extrude");v.setSite({...SITE(),buildings:[]});
    expect(kind("extrude").length).toBe(0);old.forEach(m=>expect(m.geometry.disposed).toBe(true));
  });
});

describe("the 3D view: the ADU",()=>{
  const ADU={x:60,z:70,w:28,d:17,h:15,rot:30,ok:true};
  it("is a box of its width, height and depth, standing on the ground",()=>{
    v.setAdu(ADU);const [m]=kind("box");expect(m.geometry.args).toEqual([28,15,17]);
    expect([m.position.x,m.position.y,m.position.z]).toEqual([60,7.5,70]);expect(m.castShadow).toBe(true);
  });
  it("turns the same way as on the drawing",()=>{
    v.setAdu(ADU);expect(kind("box")[0].rotation.y).toBeCloseTo(-30*Math.PI/180,10);
  });
  it("is green when it fits and red when it does not",()=>{
    v.setAdu(ADU);const ok=kind("box")[0].material.color;v.setAdu({...ADU,ok:false});const bad=kind("box")[0].material.color;
    expect(ok).toBe(0x2f9e63);expect(bad).toBe(0xc8463c);
  });
  it("moving it leaves one box, and null takes it away",()=>{
    v.setAdu(ADU);v.setAdu({...ADU,x:70});expect(kind("box").length).toBe(1);v.setAdu(null);expect(kind("box").length).toBe(0);
  });
});

describe("the 3D view: the sun",()=>{
  const sun=()=>r.scene.children.find(o=>o.shadow);
  it("a sun in the south-west sits south-west of the lot and throws shadows",()=>{
    v.setSun({alt:30,az:225});const s=sun(),ctr={x:60,z:102.5};
    expect(s.visible).toBe(true);expect(s.castShadow).toBe(true);
    expect(s.position.x).toBeLessThan(ctr.x);      // west is -x
    expect(s.position.z).toBeGreaterThan(ctr.z);   // south is +z
    expect(s.position.y).toBeCloseTo(1500*Math.sin(30*Math.PI/180),6);
  });
  it("a sun below the horizon is switched off",()=>{
    v.setSun({alt:-5,az:10});expect(sun().visible).toBe(false);
  });
  it("no sun chosen: plain light and no shadows",()=>{
    v.setSun({alt:30,az:225});v.setSun(null);expect(sun().visible).toBe(true);expect(sun().castShadow).toBe(false);
  });
});

describe("the 3D view: where it is seen from",()=>{
  it("starts from above, looking at the middle of the lot",()=>{
    expect(v.mode).toBe("overview");expect([c.target.x,c.target.y,c.target.z]).toEqual([60,0,102.5]);expect(r.camera.position.y).toBeGreaterThan(50);
  });
  it("from the street: at eye height, 45 ft out from the front lot line",()=>{
    v.setView("street");expect(v.mode).toBe("street");
    expect([r.camera.position.x,r.camera.position.y,r.camera.position.z]).toEqual([60,5.5,210]);
  });
  it("from the ADU: at the eye height given, looking toward the house, with no zoom",()=>{
    v.setAdu({x:60,z:70,w:28,d:17,h:15,rot:0,ok:true});v.setView("adu",{eye:15.5,look:{x:60,z:114}});
    expect(v.mode).toBe("adu");expect([c.target.x,c.target.y,c.target.z]).toEqual([60,15.5,70]);
    expect(r.camera.position.z).toBeCloseTo(69.5,6);   // half a foot behind, so the house is ahead
    expect(c.enableZoom).toBe(false);expect(c.enablePan).toBe(false);
  });
  it("from the ADU with no ADU placed falls back to the view from above",()=>{
    v.setView("adu");expect(v.mode).toBe("overview");expect(c.enableZoom).toBe(true);
  });
  it("fills its container",()=>{
    v.resize();expect(r.size).toEqual([600,400]);expect(r.camera.aspect).toBe(1.5);
  });
});

describe("the 3D view: keys",()=>{
  const press=key=>{const e={key,prevented:false,preventDefault(){this.prevented=true}};return [v.key(e),e.prevented]};
  it("arrow keys turn the view",()=>{
    c.calls.length=0;expect(press("ArrowLeft")).toEqual([true,true]);expect(c.calls[0][0]).toBe("rotateLeft");expect(c.calls[0][1]).toBeGreaterThan(0);
    press("ArrowRight");expect(c.calls.filter(x=>x[0]==="rotateLeft")[1][1]).toBeLessThan(0);
    press("ArrowUp");expect(c.calls.some(x=>x[0]==="rotateUp")).toBe(true);
  });
  it("plus and minus zoom",()=>{
    c.calls.length=0;press("+");press("-");expect(c.calls.map(x=>x[0]).filter(n=>n.startsWith("dolly"))).toEqual(["dollyIn","dollyOut"]);
  });
  it("standing in the ADU, plus and minus do nothing and are left for the browser",()=>{
    v.setAdu({x:60,z:70,w:28,d:17,h:15,rot:0,ok:true});v.setView("adu");c.calls.length=0;
    expect(press("+")).toEqual([false,false]);expect(c.calls.length).toBe(0);
  });
  it("other keys are left alone",()=>{
    expect(press("Tab")).toEqual([false,false]);
  });
});
