// A stand-in for three.js in the unit tests (vitest.config.js points "three" here).
// The real library needs WebGL. This one only records what view3d.js asks it to build,
// so the tests can check sizes, positions, colours and shadows without drawing anything.

class V3{constructor(){this.x=0;this.y=0;this.z=0}set(x,y,z){this.x=x;this.y=y;this.z=z;return this}}
class Obj{
  constructor(){this.children=[];this.position=new V3();this.rotation={x:0,y:0,z:0};this.visible=true;this.castShadow=false;this.receiveShadow=false}
  add(o){this.children.push(o);return this}
  remove(o){this.children=this.children.filter(c=>c!==o);return this}
  traverse(f){f(this);this.children.forEach(c=>c.traverse(f))}
}
const geom=kind=>class{constructor(...a){this.kind=kind;this.args=a;this.disposed=false}dispose(){this.disposed=true}};
const mat=kind=>class{constructor(o){this.kind=kind;Object.assign(this,o);this.disposed=false}dispose(){this.disposed=true}};

export const made={renderers:[],controls:[]};   // what the last createView made, for the tests to look at

export class Scene extends Obj{}
export class Group extends Obj{}
export class Mesh extends Obj{constructor(g,m){super();this.geometry=g;this.material=m}}
export class Color{constructor(v){this.v=v}}
export class PerspectiveCamera extends Obj{constructor(fov,aspect){super();this.fov=fov;this.aspect=aspect}updateProjectionMatrix(){}}
export class HemisphereLight extends Obj{constructor(a,b,i){super();this.intensity=i}}
export class DirectionalLight extends Obj{constructor(c,i){super();this.intensity=i;this.target=new Obj();
  this.shadow={mapSize:new V3(),bias:0,normalBias:0,camera:{updateProjectionMatrix(){}}}}}
export const PlaneGeometry=geom("plane"),BoxGeometry=geom("box"),ExtrudeGeometry=geom("extrude");
export const MeshLambertMaterial=mat("lambert");
export class Shape{constructor(){this.pts=[]}moveTo(x,y){this.pts.push([x,y])}lineTo(x,y){this.pts.push([x,y])}}
export class CanvasTexture{constructor(c){this.image=c;this.disposed=false}dispose(){this.disposed=true}}
export const SRGBColorSpace="srgb",PCFSoftShadowMap="pcfsoft";
export class WebGLRenderer{
  constructor(){this.domElement=document.createElement("canvas");this.shadowMap={};this.capabilities={getMaxAnisotropy:()=>4};this.renders=0;this.size=null;made.renderers.push(this)}
  setPixelRatio(){}
  setSize(w,h){this.size=[w,h]}
  render(scene,camera){this.renders++;this.scene=scene;this.camera=camera}
}
