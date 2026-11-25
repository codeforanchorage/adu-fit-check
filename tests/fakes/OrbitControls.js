// A stand-in for three.js OrbitControls in the unit tests (see three.js beside this file).
import {made} from "./three.js";

export class OrbitControls{
  constructor(camera,el){this.camera=camera;this.el=el;this.target={x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z}};
    this.enableZoom=true;this.enablePan=true;this.calls=[];this.listeners={};made.controls.push(this)}
  addEventListener(name,f){this.listeners[name]=f}
  update(){this.calls.push(["update"])}
  rotateLeft(a){this.calls.push(["rotateLeft",a])}
  rotateUp(a){this.calls.push(["rotateUp",a])}
  dollyIn(s){this.calls.push(["dollyIn",s])}
  dollyOut(s){this.calls.push(["dollyOut",s])}
}
