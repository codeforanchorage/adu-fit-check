// geometry.js: pure 2D geometry. No DOM, no network, no zoning numbers.
// Points are {x, y}. Polygons are arrays of points without a repeated closing point.
// Units are whatever the caller uses (image pixels in the UI, feet in the tests).

export function area(p){let s=0;for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];s+=a.x*b.y-b.x*a.y}return Math.abs(s)/2}
export function inside(pt,p){let c=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if((a.y>pt.y)!==(b.y>pt.y)&&pt.x<(b.x-a.x)*(pt.y-a.y)/(b.y-a.y)+a.x)c=!c}return c}
export function ptSeg(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy;let t=l?((p.x-a.x)*dx+(p.y-a.y)*dy)/l:0;t=Math.max(0,Math.min(1,t));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)}
export function crs(a,b,c){return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)}
// true when the two segments properly cross (touching at an end point does not count)
export function segX(a,b,c,d){const d1=crs(c,d,a),d2=crs(c,d,b),d3=crs(a,b,c),d4=crs(a,b,d);return ((d1>0&&d2<0)||(d1<0&&d2>0))&&((d3>0&&d4<0)||(d3<0&&d4>0))}
export function segSeg(a,b,c,d){if(segX(a,b,c,d))return 0;return Math.min(ptSeg(a,c,d),ptSeg(b,c,d),ptSeg(c,a,b),ptSeg(d,a,b))}
export function polySeg(p,c,d){let m=Infinity;for(let i=0;i<p.length;i++)m=Math.min(m,segSeg(p[i],p[(i+1)%p.length],c,d));return m}
// shortest distance between two polygons, 0 when they overlap or one contains the other
export function polyPoly(p,q){if(inside(p[0],q)||inside(q[0],p))return 0;let m=Infinity;for(let i=0;i<q.length;i++)m=Math.min(m,polySeg(p,q[i],q[(i+1)%q.length]));return m}
export function crosses(p,q){for(let i=0;i<p.length;i++)for(let j=0;j<q.length;j++)if(segX(p[i],p[(i+1)%p.length],q[j],q[(j+1)%q.length]))return true;return false}
export function proj(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy;let t=l?((p.x-a.x)*dx+(p.y-a.y)*dy)/l:0;t=Math.max(0,Math.min(1,t));return {x:a.x+t*dx,y:a.y+t*dy}}
// closest pair of points between a polygon and the segment c-d: {d, p (on polygon), q (on segment)}
export function closest(poly,c,d){let best={d:Infinity};const t=(p,q)=>{const dd=Math.hypot(p.x-q.x,p.y-q.y);if(dd<best.d)best={d:dd,p,q}};
  for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];t(a,proj(a,c,d));t(proj(c,a,b),c);t(proj(d,a,b),d)}return best}
export function cen(p){return {x:p.reduce((s,q)=>s+q.x,0)/p.length,y:p.reduce((s,q)=>s+q.y,0)/p.length}}

// Rectangle of w x d feet centred on (x, y), rotated rot degrees, in units of 1/ftPerUnit.
export function rectPoly(adu,x,y,ftPerUnit){const k=1/ftPerUnit,hw=adu.w*k/2,hd=adu.d*k/2,r=adu.rot*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
  return [[-hw,-hd],[hw,-hd],[hw,hd],[-hw,hd]].map(([u,w])=>({x:x+u*c-w*s,y:y+u*s+w*c}))}

// The ground covered when a polygon slides by (dx, dy): the shadow of a flat-topped block
// whose top edge is the polygon. Returned as a list of polygons whose union is that ground
// (the polygon, the moved polygon, and one four-sided piece per edge), ready to be filled.
export function sweep(p,dx,dy){const m=q=>({x:q.x+dx,y:q.y+dy}),out=[p,p.map(m)];
  for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];out.push([a,b,m(b),m(a)])}return out}

// Drop a repeated closing point. Changes nothing else.
export function openRing(p){p=p.slice();if(p.length>1){const a=p[0],z=p[p.length-1];if(Math.hypot(a.x-z.x,a.y-z.y)<0.05)p.pop()}return p}

// Tidy a lot outline so each straight lot line is one edge: drop the closing point, points
// closer than 0.3 units, and points that sit within `tol` units of the straight line between
// their neighbours. The outline never moves by more than the larger of tol and 0.3: every
// point that has been dropped must still lie that close to the line that replaced it, so a
// curved lot line (a cul-de-sac) keeps its shape instead of being cut straight across.
export function clean(p,tol){tol=tol==null?0.25:tol;const lim=Math.max(tol,0.3),len=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y);
  // each kept corner remembers the original points dropped between it and the next kept corner
  const v=openRing(p).map(q=>({q,gone:[]}));let ch=true;
  while(ch&&v.length>3){ch=false;for(let i=0;i<v.length;i++){const n=v.length,A=v[(i+n-1)%n],B=v[i],C=v[(i+1)%n];
    if(!(len(A.q,B.q)<0.3||len(B.q,C.q)<0.3||ptSeg(B.q,A.q,C.q)<tol))continue;
    const moved=A.gone.concat([B.q],B.gone);
    if(moved.some(m=>ptSeg(m,A.q,C.q)>=lim))continue;
    A.gone=moved;v.splice(i,1);ch=true;break}}
  return v.map(x=>x.q)}

// What lies outside each lot edge. All inputs in feet, same coordinate system.
//   lot      polygon
//   parcels  array of polygons: every parcel near the lot (the lot itself may be included)
//   lines    array of {type:"street"|"alley", label, pts:[...]} centrelines
// Returns one entry per lot edge: {kind, label}
//   "interior"  another parcel is on the other side
//   "street"    open ground outside, and the nearest centreline beyond it is a street
//   "alley"     open ground outside, and the nearest centreline beyond it is an alley
//   "open"      open ground outside but no centreline found; needs a person to look
// Method: step `probe` feet straight out from three points on the edge. If at least two of
// them land in no parcel, the edge faces right-of-way. Then take the nearest centreline that
// is in front of the edge (not off to one side) and within `reach` feet.
export function classifyEdges(lot,parcels,lines,opt){
  const probe=(opt&&opt.probe)||8,reach=(opt&&opt.reach)||130,n=lot.length;
  return lot.map((a,i)=>{
    const b=lot[(i+1)%n],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
    if(!len)return {kind:"interior",label:""};
    let nx=-dy/len,ny=dx/len;const m={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    if(inside({x:m.x+nx*0.5,y:m.y+ny*0.5},lot)){nx=-nx;ny=-ny}
    let open=0;
    for(const t of [0.25,0.5,0.75]){const p={x:a.x+dx*t+nx*probe,y:a.y+dy*t+ny*probe};if(!inside(p,lot)&&!parcels.some(r=>inside(p,r)))open++}
    if(open<2)return {kind:"interior",label:""};
    let best=null;
    for(const ln of lines)for(let j=0;j+1<ln.pts.length;j++){
      const q=proj(m,ln.pts[j],ln.pts[j+1]),vx=q.x-m.x,vy=q.y-m.y,d=Math.hypot(vx,vy),out=vx*nx+vy*ny;
      if(d>reach||out<=0||out<d*0.5)continue;
      if(!best||d<best.d)best={d,kind:ln.type,label:ln.label||""};
    }
    return best?{kind:best.kind,label:best.label}:{kind:"open",label:""};
  });
}

export const f1=n=>(Math.round(n*10)/10).toFixed(1);
