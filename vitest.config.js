// The page loads three.js from a CDN through the import map in index.html. The unit tests
// cannot (no network, no WebGL), so "three" points at a stand-in that records what view3d.js
// asks for. Order matters: the longer name first.
import {fileURLToPath} from "node:url";
const here=p=>fileURLToPath(new URL(p,import.meta.url));

export default {
  resolve:{alias:[
    {find:"three/addons/controls/OrbitControls.js",replacement:here("./tests/fakes/OrbitControls.js")},
    {find:/^three$/,replacement:here("./tests/fakes/three.js")},
  ]},
};
