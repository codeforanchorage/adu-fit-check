// @vitest-environment happy-dom
// The page itself (index.html and ui.js) in a simulated browser. Nothing is drawn: the canvas
// is a stand-in that accepts every call. No network: fetch is replaced, and every call is kept
// so the tests can see what the page would send. A real browser is still the test of the picture.
import {describe,it,expect,beforeAll,beforeEach,vi} from "vitest";
import {readFileSync} from "node:fs";

const file=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const $=id=>document.getElementById(id);
const tick=(ms=15)=>new Promise(r=>setTimeout(r,ms));
const until=async(f,what)=>{for(let i=0;i<200;i++){if(f())return;await tick(5)}throw new Error("never happened: "+what)};
const key=(k,o)=>$("cv").dispatchEvent(new KeyboardEvent("keydown",{key:k,bubbles:true,cancelable:true,...o}));
const keys=(k,n,o)=>{for(let i=0;i<n;i++)key(k,o)};
const click=el=>el.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true}));
const mode=m=>click(document.querySelector('[data-mode="'+m+'"]'));
const status=()=>$("statusText").textContent;
const rows=()=>[...$("checks").querySelectorAll("tbody tr")].map(r=>[...r.querySelectorAll("td")].map(c=>c.textContent));

// The corner-lot sample (samples/answers.json), as the survey reader would return it.
const TRACING=()=>({lot:[[172.7,135.7],[713.6,135.7],[713.6,803.6],[172.7,803.6]],
  street_edges:[{edge:2,street:"W. EXAMPLE AVENUE"},{edge:1,street:"SAMPLE STREET"}],front_edge:2,alley_edges:[],
  buildings:[{label:"House",pts:[[265.5,451.4],[559.1,451.4],[559.1,682.1],[265.5,682.1]]}],
  no_build:[{label:"Utility easement",pts:[[172.7,135.7],[713.6,135.7],[713.6,172.1],[172.7,172.1]]}],
  scale:{p1:[172.7,135.7],p2:[713.6,135.7],feet:70},zoning:"ZONING: R-2M",notes:""});

let calls=[],reader=()=>({status:200,body:TRACING()});
const sent=part=>calls.filter(c=>c.url.includes(part));
const json=(status,body)=>({ok:status>=200&&status<300,status,json:async()=>body,blob:async()=>new Blob(["x"])});

beforeAll(async()=>{
  const html=file("index.html");
  document.body.innerHTML=html.slice(html.indexOf("<body"),html.lastIndexOf("</body>")).replace(/^<body[^>]*>/,"").replace(/<script[\s\S]*?<\/script>/g,"");
  // a canvas that accepts everything and draws nothing
  const ctx=()=>new Proxy({},{get:(t,k)=>k in t?t[k]:k==="measureText"?()=>({width:40}):()=>{},set:(t,k,v)=>{t[k]=v;return true}});
  HTMLCanvasElement.prototype.getContext=function(){return this._ctx||(this._ctx=ctx())};
  HTMLCanvasElement.prototype.toBlob=function(cb){cb(new Blob(["0".repeat(2000)],{type:"image/jpeg"}))};
  Object.defineProperty(HTMLCanvasElement.prototype,"clientWidth",{get(){return 800}});
  HTMLElement.prototype.setPointerCapture=()=>{};
  // an image that "loads" at once, the size of the corner-lot sample
  vi.stubGlobal("Image",class{set src(v){this.naturalWidth=1100;this.naturalHeight=1400;queueMicrotask(()=>this.onload&&this.onload())}});
  URL.createObjectURL=()=>"blob:test";URL.revokeObjectURL=()=>{};
  vi.stubGlobal("fetch",async(url,opt)=>{url=String(url);calls.push({url,opt});
    if(url.includes("plans.json"))return json(200,JSON.parse(file("plans.json")));
    if(url.includes("read-survey")){const r=reader();return json(r.status,r.body)}
    if(url.includes("tracing-checked"))return json(200,{ok:true});
    if(url.includes("samples/"))return json(200,{});
    throw new Error("unexpected request: "+url)});
  await import("../ui.js");
  await until(()=>$("fits").children.length===2,"the plan catalog loading");
});
beforeEach(()=>{calls=[];reader=()=>({status:200,body:TRACING()})});

describe("the page starts on the made-up example",()=>{
  it("shows a result in words, with the plan check table",()=>{
    expect(status()).toBe("This ADU could fit here");
    expect(rows().length).toBeGreaterThan(6);expect(rows().every(r=>r[3]==="OK")).toBe(true);
  });
  it("says which catalog designs have room",()=>{
    expect([...$("fits").children].map(b=>b.textContent)).toEqual(["The Near PointCould fit","The WilliwawNo room found"].map(t=>expect.stringContaining(t.slice(0,8))));
  });
  it("in step 5 an arrow key moves the ADU one foot",()=>{
    const before=rows()[1][1];key("ArrowRight");const after=rows()[1][1];
    expect(parseFloat(before)-parseFloat(after)).toBeCloseTo(1,1);   // one foot nearer the east side lot line
    key("ArrowLeft");expect(rows()[1][1]).toBe(before);
  });
});

describe("tracing by keyboard",()=>{
  it("step 1: two points and a length set the scale",()=>{
    mode("scale");expect($("guide").textContent).toContain("By keyboard");
    key("Enter");expect($("kbdMsg").textContent).toContain("Crosshair shown");
    key("Enter");expect($("kbdMsg").textContent).toBe("First point placed.");
    keys("ArrowRight",8);key(" ");expect($("kbdMsg").textContent).toContain("Second point placed");
    expect($("scaleBox").classList.contains("on")).toBe(true);
    key("Backspace");expect($("kbdMsg").textContent).toBe("Point removed.");expect($("scaleBox").classList.contains("on")).toBe(false);
    key("Enter");$("scaleFt").value="20";click($("scaleApply"));
    expect(document.querySelector('[data-mode="place"]').getAttribute("aria-pressed")).toBe("true");   // the lot was already traced, so on to step 5
  });
  it("step 2: corners, Home and Enter trace and close the lot",()=>{
    mode("lot");click($("clear"));expect(status()).toBe("Trace the lot lines (step 2).");
    expect($("lineTypes").classList.contains("on")).toBe(false);
    key("ArrowDown");key("Enter");expect($("kbdMsg").textContent).toBe("Corner 1 placed.");
    keys("ArrowRight",12);key("Enter");keys("ArrowDown",12);key("Enter");
    key("Home");expect($("kbdMsg").textContent).toContain("Enter closes the shape");
    key("Enter");expect($("kbdMsg").textContent).toBe("Shape closed.");
    expect(status()).not.toBe("Trace the lot lines (step 2).");
    expect($("lineTypes").querySelectorAll("select").length).toBe(3);
  });
  it("step 2: Backspace takes back a corner, and two corners cannot close a shape",()=>{
    mode("lot");click($("clear"));
    key("Enter");key("Enter");keys("ArrowRight",5);key("Enter");
    key("Backspace");expect($("kbdMsg").textContent).toBe("Corner removed. 1 left.");
    key("Home");expect($("kbdMsg").textContent).toContain("at least three corners");
    key("Enter");expect($("kbdMsg").textContent).toBe("Corner 2 placed.");   // not closed: placed as a corner
    key("Backspace");key("Backspace");key("Backspace");expect($("kbdMsg").textContent).toContain("No corner to remove");
  });
  it("small steps with Shift: ten of them go as far as one plain step",()=>{
    mode("lot");click($("clear"));
    key("Enter");key("Enter");keys("ArrowRight",10,{shiftKey:true});keys("ArrowLeft",1);
    keys("ArrowDown",9);key("Enter");keys("ArrowRight",9);key("Enter");
    // back on the first corner exactly: left 9, up 9
    keys("ArrowLeft",9);keys("ArrowUp",9);expect($("kbdMsg").textContent).toContain("On the first corner");
    key("Enter");expect($("kbdMsg").textContent).toBe("Shape closed.");
  });
  it("a line's label can be changed from the list, and the plan check follows",()=>{
    click($("sample"));mode("lot");
    const sel=[...$("lineTypes").querySelectorAll("select")];expect(sel.map(s=>s.value)).toEqual(["rear","side","front","side"]);
    sel[0].value="alley";sel[0].dispatchEvent(new Event("change",{bubbles:true}));
    mode("place");expect(rows()[0][0]).toBe("Alley lot line A");expect(rows()[0][2]).toBe("none");
  });
  it("keys with Ctrl or Alt held are left for the browser",()=>{
    mode("bldg");const e=new KeyboardEvent("keydown",{key:"ArrowLeft",ctrlKey:true,bubbles:true,cancelable:true});
    $("cv").dispatchEvent(e);expect(e.defaultPrevented).toBe(false);
  });
});

describe("an AI tracing",()=>{
  // load the made-up corner lot, press "Read survey with AI" and wait for the answer to be drawn
  const read=async()=>{click(document.querySelector('[data-sample="samples/sample-corner-lot.jpg"]'));
    await until(()=>sent("samples/").length>0,"the sample being asked for");await tick(20);
    click($("ai"));await until(()=>sent("read-survey").length>0&&!$("ai").disabled,"the reader answering");await tick()};
  it("the button is hidden until a survey is uploaded",()=>{
    click($("sample"));expect($("ai").hidden).toBe(true);
  });
  it("shows no result until the person accepts the tracing",async()=>{
    await read();
    expect(status()).toBe("Check the tracing first");expect(rows().length).toBe(0);expect($("fits").children.length).toBe(0);
    expect($("aiOk").hidden).toBe(false);expect($("dist").value).toBe("R-2M");
    expect($("guide").textContent).toContain("more than one street");
    expect(sent("tracing-checked").length).toBe(0);
    click($("aiOk"));
    expect($("aiOk").hidden).toBe(true);expect(status()).toMatch(/could fit|does not fit/);expect(rows().length).toBeGreaterThan(5);
    expect(rows().filter(r=>r[0].startsWith("Front lot line")).length).toBe(2);   // a corner lot: both streets are fronts
  });
  it("sends the image with the page's key, and marks a made-up sample",async()=>{
    await read();const [c]=sent("read-survey"),body=JSON.parse(c.opt.body);
    expect(c.opt.headers["x-api-key"]).toBeTruthy();expect(body.sample).toBe(true);expect(typeof body.image).toBe("string");
    expect(Object.keys(body).sort()).toEqual(["image","sample"]);
  });
  it("accepting it unchanged reports that nothing was changed, and nothing else",async()=>{
    await read();click($("aiOk"));const [c]=sent("tracing-checked");
    expect(c.opt.headers["content-type"]).toBe("text/plain");   // one request, no preflight
    expect(JSON.parse(c.opt.body)).toEqual({lot:false,lot_move_ft:0,buildings:false,no_build:false,scale:false,scale_read:true,streets:false,district:false,sample:true});
    click($("sample"));expect(sent("tracing-checked").length).toBe(1);   // once only
  });
  it("reports what was changed first: a building added by keyboard, and another district",async()=>{
    await read();
    mode("bldg");key("Enter");key("Enter");keys("ArrowRight",4);key("Enter");keys("ArrowDown",4);key("Enter");key("Home");key("Enter");
    $("dist").value="R-1";$("dist").dispatchEvent(new Event("change",{bubbles:true}));
    expect(status()).toBe("Check the tracing first");   // still gated while it is being fixed
    click($("aiOk"));
    expect(JSON.parse(sent("tracing-checked")[0].opt.body)).toMatchObject({lot:false,buildings:true,no_build:false,district:true,streets:false});
  });
  it("a tracing that was replaced by another lot is never reported",async()=>{
    await read();click($("sample"));expect($("aiOk").hidden).toBe(true);expect(sent("tracing-checked").length).toBe(0);
    expect(status()).toBe("This ADU could fit here");
  });
  it("with no length read, it asks for the scale and still holds the result back",async()=>{
    reader=()=>({status:200,body:{...TRACING(),scale:{p1:[0,0],p2:[0,0],feet:0}}});await read();
    expect($("guide").textContent).toContain("could not read a length");
    expect(document.querySelector('[data-mode="scale"]').getAttribute("aria-pressed")).toBe("true");expect(rows().length).toBe(0);
  });
  it("an answer with no lot leaves the drawing as it was",async()=>{
    reader=()=>({status:200,body:{...TRACING(),lot:[]}});await read();
    expect($("guide").textContent).toContain("could not read this survey");expect($("aiOk").hidden).toBe(true);
  });
  it("says so when the reader is over its limit or too slow",async()=>{
    reader=()=>({status:429,body:{message:"Limit Exceeded"}});await read();expect($("guide").textContent).toContain("reached its limit");
    reader=()=>({status:504,body:{}});await read();expect($("guide").textContent).toContain("took too long");
    expect($("aiOk").hidden).toBe(true);
  });
});
