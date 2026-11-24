// view3d.js: a rough 3D view of the lot, for thinking about shadows and sight lines.
// Loaded only when "3D view" is first pressed. Needs three.js from a CDN (see the import map
// in index.html). No zoning numbers and no network calls of its own.
//
// It is a block model: flat ground, every building a flat-topped block, no trees or fences.
// Nothing here is part of the plan check.
//
// Coordinates are feet. x runs east, z runs south (the same way y runs down the drawn sheet,
// whose top-left corner is the origin), and y is up.

import * as THREE from "three";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";
import {sunVector} from "./sun.js";

const NO_HEIGHT_FT=12;   // how tall to draw a building whose height is not mapped (drawn paler, casts no shadow)
const RAD=Math.PI/180;

// container: an element to fill.
// Throws if the browser cannot make a WebGL canvas.
export function createView(container){
  const renderer=new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);renderer.domElement.style.display="block";renderer.domElement.setAttribute("aria-hidden","true");

  const scene=new THREE.Scene();scene.background=new THREE.Color(0xdfe7ee);
  const camera=new THREE.PerspectiveCamera(50,1,0.5,6000);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.screenSpacePanning=false;
  const sky=new THREE.HemisphereLight(0xffffff,0x8a8f96,1.1);scene.add(sky);
  const sun=new THREE.DirectionalLight(0xffffff,2.2);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.bias=-0.0004;sun.shadow.normalBias=0.4;
  scene.add(sun);scene.add(sun.target);

  let site=null,group=null,aduMesh=null,texture=null,adu=null,mode="overview";
  const render=()=>renderer.render(scene,camera);
  controls.addEventListener("change",render);

  function clear(obj){obj.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose())}});scene.remove(obj)}

  // s: {w, h (sheet size, feet), ground (canvas drawn on the sheet area), lot:[{x,z}],
  //     front:{x,z,nx,nz}|null (middle of the front lot line and the way out to the street),
  //     buildings:[{pts:[{x,z}], h (feet or null)}]}
  function setSite(s,keepCamera){
    site=s;if(group)clear(group);if(texture)texture.dispose();
    group=new THREE.Group();scene.add(group);
    const cx=s.lot.reduce((a,p)=>a+p.x,0)/s.lot.length,cz=s.lot.reduce((a,p)=>a+p.z,0)/s.lot.length;
    site.c={x:cx,z:cz};site.r=Math.max(40,...s.lot.map(p=>Math.hypot(p.x-cx,p.z-cz)));
    // the land beyond the sheet, then the sheet itself (drawing or aerial photo) just above it
    const far=new THREE.Mesh(new THREE.PlaneGeometry(2400,2400),new THREE.MeshLambertMaterial({color:0xc9cfc4}));
    far.rotation.x=-Math.PI/2;far.position.set(cx,-0.15,cz);far.receiveShadow=true;group.add(far);
    texture=new THREE.CanvasTexture(s.ground);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=renderer.capabilities.getMaxAnisotropy();
    const sheet=new THREE.Mesh(new THREE.PlaneGeometry(s.w,s.h),new THREE.MeshLambertMaterial({map:texture}));
    sheet.rotation.x=-Math.PI/2;sheet.position.set(s.w/2,0,s.h/2);sheet.receiveShadow=true;group.add(sheet);
    const solid=new THREE.MeshLambertMaterial({color:0x8794a6}),pale=new THREE.MeshLambertMaterial({color:0xc3ccd6,transparent:true,opacity:0.75});
    for(const b of s.buildings){if(b.pts.length<3)continue;
      const sh=new THREE.Shape();b.pts.forEach((p,i)=>i?sh.lineTo(p.x,-p.z):sh.moveTo(p.x,-p.z));
      const m=new THREE.Mesh(new THREE.ExtrudeGeometry(sh,{depth:b.h||NO_HEIGHT_FT,bevelEnabled:false}),b.h?solid:pale);
      m.rotation.x=-Math.PI/2;m.castShadow=!!b.h;m.receiveShadow=true;group.add(m)}
    // the sun's shadow box has to take in everything that can throw a shadow onto the sheet
    const d=sun.shadow.camera,R=Math.max(s.w,s.h)/2+320;d.left=-R;d.right=R;d.top=R;d.bottom=-R;d.near=1;d.far=4000;d.updateProjectionMatrix();
    sun.target.position.set(cx,0,cz);
    if(!keepCamera)setView(mode);
  }

  // a: {x, z (centre), w, d, h (feet), rot (degrees, as on the drawing), ok} or null for no ADU
  function setAdu(a){
    adu=a;if(aduMesh){clear(aduMesh);aduMesh=null}
    if(!a)return;
    aduMesh=new THREE.Mesh(new THREE.BoxGeometry(a.w,a.h,a.d),new THREE.MeshLambertMaterial({color:a.ok?0x2f9e63:0xc8463c}));
    aduMesh.position.set(a.x,a.h/2,a.z);aduMesh.rotation.y=-a.rot*RAD;aduMesh.castShadow=true;aduMesh.receiveShadow=true;scene.add(aduMesh);
  }

  // p: {alt, az} for a sun that throws shadows; null for plain even light with no shadows
  function setSun(p){
    if(!site)return;
    if(p&&p.alt>0){const v=sunVector(p.alt,p.az);sun.visible=true;sun.castShadow=true;sun.position.set(site.c.x+v.x*1500,v.y*1500,site.c.z+v.z*1500);
      sun.intensity=0.6+1.8*Math.min(1,p.alt/30);sky.intensity=0.75}
    else if(p){sun.visible=false;sky.intensity=0.45}                       // sun below the horizon
    else{sun.visible=true;sun.castShadow=false;sun.position.set(site.c.x-500,1200,site.c.z+700);sun.intensity=1.6;sky.intensity=1.0}
  }

  // "overview": above the lot, seen from the street side.
  // "street":   standing in the street at eye height, looking at the lot.
  // "adu":      standing in the ADU at window height, looking toward `look` ({x,z}); drag to look around.
  function setView(name,opt){
    if(!site)return;mode=name;const c=site.c,r=site.r,f=site.front||{x:c.x,z:c.z+r,nx:0,nz:1};
    controls.enableZoom=true;controls.enablePan=true;controls.minDistance=5;controls.maxDistance=2500;controls.maxPolarAngle=Math.PI/2-0.03;
    if(name==="street"){camera.position.set(f.x+f.nx*45,5.5,f.z+f.nz*45);controls.target.set(c.x,7,c.z)}
    else if(name==="adu"&&adu){const eye=(opt&&opt.eye)||5.5,l=(opt&&opt.look)||{x:adu.x,z:adu.z-1};let dx=l.x-adu.x,dz=l.z-adu.z;const n=Math.hypot(dx,dz)||1;dx/=n;dz/=n;
      // the camera sits half a foot behind the point it turns about, so dragging looks around from one spot
      controls.target.set(adu.x,eye,adu.z);camera.position.set(adu.x-dx*0.5,eye,adu.z-dz*0.5);
      controls.enableZoom=false;controls.enablePan=false;controls.maxPolarAngle=Math.PI*0.62}
    else{mode="overview";camera.position.set(c.x+f.nx*r*1.9+f.nz*r*0.6,r*2.1,c.z+f.nz*r*1.9-f.nx*r*0.6);controls.target.set(c.x,0,c.z)}
    controls.update();render();
  }

  function resize(){const w=container.clientWidth,h=container.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);
    renderer.domElement.style.width=w+"px";renderer.domElement.style.height=h+"px";camera.aspect=w/h;camera.updateProjectionMatrix();render()}

  // keyboard: arrows turn, + and - zoom
  function key(e){const step=6*RAD,k=e.key;
    if(k==="ArrowLeft")controls.rotateLeft(step);else if(k==="ArrowRight")controls.rotateLeft(-step);
    else if(k==="ArrowUp")controls.rotateUp(step);else if(k==="ArrowDown")controls.rotateUp(-step);
    else if((k==="+"||k==="=")&&controls.enableZoom)controls.dollyIn(1.15);else if((k==="-"||k==="_")&&controls.enableZoom)controls.dollyOut(1.15);
    else return false;
    e.preventDefault();controls.update();render();return true}

  return {setSite,setAdu,setSun,setView,resize,render,key,get mode(){return mode},noHeightFt:NO_HEIGHT_FT};
}
