// data.js: Municipality of Anchorage public ArcGIS REST services. No DOM.
//
// Privacy: this file never requests owner names or mailing addresses. Every query lists its
// outFields; none uses "*". Keep it that way.
//
// Layers, fields and the projection were checked against the live services on 2026-11-23.

import {intersect} from "@turf/intersect";
import {polygon,featureCollection} from "@turf/helpers";

const ROOT="https://services2.arcgis.com/Ce3DhLRthdwbHlfF/arcgis/rest/services/";
export const LAYERS={
  parcels:ROOT+"PropertyInformation_Hosted/FeatureServer/0",   // polygons; Parcel_ID, Parcel_Address, Zoning_District, Lot_Size, GIS_Category
  buildings:ROOT+"Buildings_Hosted/FeatureServer/0",           // polygons; ArcGIS Online item 56d274594cbc4aa8bac4257edd06d6cf
  streets:ROOT+"Streets_Hosted/FeatureServer/0",               // centrelines; Street_Label, STREET_SEGMENT_TYPE (Street, Alley, Driveway, ...)
  alleys:ROOT+"Maintained_Alleys/FeatureServer/0"              // centrelines; Alley_Label. Maintained alleys only.
};

// Projection for all geometry: NAD 1983 StatePlane Alaska 4 FIPS 5004 (US feet), Esri WKID 102634.
// It is conformal and Anchorage lies close to its central meridian, so distances and areas
// are true to well under 0.1%. Coordinates arrive in feet, so no unit conversion is needed.
// The services store Web Mercator, where areas are about 4.26 times too large at this
// latitude; never use Shape__Area.
// To change the projection (for example on advice from MOA GIS), change these two lines.
export const SR=102634;
export const FT_PER_UNIT=1;

const NEAR_PARCELS_FT=40,NEAR_STREETS_FT=150,MIN_PIECE_SQFT=20;

async function query(layer,params){
  const body=new URLSearchParams({f:"json",outSR:String(SR),...params});
  const r=await fetch(layer+"/query",{method:"POST",body});
  if(!r.ok)throw new Error("HTTP "+r.status);
  const d=await r.json();
  if(d.error)throw new Error(d.error.message||"service error");
  return d;
}

// Build the WHERE clause for an address search. Quotes are doubled and LIKE wildcards removed.
export function addressWhere(q){
  const a=String(q||"").toUpperCase().replace(/[%_\[\]\\]/g," ").replace(/\s+/g," ").trim().replace(/'/g,"''");
  return "Parcel_Address LIKE '%"+a+"%' AND GIS_Category='Parcel' AND Parcel_ID IS NOT NULL";
}

const signed=r=>{let s=0;for(let i=0;i+1<r.length;i++)s+=r[i][0]*r[i+1][1]-r[i+1][0]*r[i][1];return s/2};
const ringIn=(pt,r)=>{let c=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>pt[1])!==(b[1]>pt[1])&&pt[0]<(b[0]-a[0])*(pt[1]-a[1])/(b[1]-a[1])+a[0])c=!c}return c};
const closed=r=>{const a=r[0],z=r[r.length-1];return a[0]===z[0]&&a[1]===z[1]?r:r.concat([a])};

// Esri JSON rings (outer rings clockwise, holes counter-clockwise) to a list of polygons,
// each [outer, hole, hole, ...], largest first.
export function ringsToPolygons(rings){
  const rs=(rings||[]).filter(r=>r&&r.length>=4).map(closed),outer=rs.filter(r=>signed(r)<0),holes=rs.filter(r=>signed(r)>0);
  if(!outer.length&&holes.length)return holes.map(r=>[r]);
  const polys=outer.map(r=>[r]);
  holes.forEach(h=>{const p=polys.find(p=>ringIn(h[0],p[0]));if(p)p.push(h)});
  return polys.sort((a,b)=>Math.abs(signed(b[0]))-Math.abs(signed(a[0])));
}

// Clip building polygons to the lot. Attached and zero-lot-line housing shares one footprint
// across several lots, so only the part inside this lot counts.
// lot: [outer, ...holes]. buildings: array of [outer, ...holes]. Coordinates in feet.
// Returns [{outer:[[x,y],...], area: sq ft with holes taken out}], largest first.
// Pieces under 20 sq ft are dropped: they are a neighbour's wall drawn a few inches over the line.
export function clipToLot(lot,buildings){
  const out=[],L=polygon(lot);
  for(const b of buildings){
    let g=null;try{g=intersect(featureCollection([L,polygon(b)]))}catch(e){g=null}
    if(!g)continue;
    const parts=g.geometry.type==="Polygon"?[g.geometry.coordinates]:g.geometry.coordinates;
    for(const p of parts){const a=(Math.abs(signed(p[0]))-p.slice(1).reduce((s,h)=>s+Math.abs(signed(h)),0))*FT_PER_UNIT*FT_PER_UNIT;if(a>=MIN_PIECE_SQFT)out.push({outer:p[0],area:a})}
  }
  return out.sort((a,b)=>b.area-a.area);
}

// Parcels whose address contains the text. Returns up to 25:
// [{pid, addr, zone, lotSize, parts, lot:[outer,...holes]}], exact address matches first.
export async function findParcels(address){
  const d=await query(LAYERS.parcels,{where:addressWhere(address),outFields:"Parcel_ID,Parcel_Address,Zoning_District,Lot_Size",returnGeometry:"true",orderByFields:"Parcel_Address,Parcel_ID",resultRecordCount:"25"});
  const q=String(address||"").toUpperCase().replace(/\s+/g," ").trim();
  const list=(d.features||[]).map(f=>{const polys=ringsToPolygons(f.geometry&&f.geometry.rings),a=f.attributes;
    return {pid:String(a.Parcel_ID),addr:String(a.Parcel_Address||"").trim(),zone:String(a.Zoning_District||"").trim(),lotSize:a.Lot_Size,parts:polys.length,lot:polys[0]||null}}).filter(p=>p.lot);
  list.sort((a,b)=>(b.addr===q)-(a.addr===q));
  list.more=!!d.exceededTransferLimit;
  return list;
}

// Everything else needed to draw one parcel. Coordinates come back as {x, y} in feet with
// y pointing down the screen (y = minus northing), so north is up when drawn.
// Returns {lot, bldgs:[{pts, area}], bldgArea, neighbors:[polygon], lines:[{type,label,pts}]}
export async function loadSite(parcel){
  const P=([x,y])=>({x:x*FT_PER_UNIT,y:-y*FT_PER_UNIT});
  const outer=parcel.lot[0],xs=outer.map(p=>p[0]),ys=outer.map(p=>p[1]);
  const env=m=>[Math.min(...xs)-m,Math.min(...ys)-m,Math.max(...xs)+m,Math.max(...ys)+m].join(",");
  const box=m=>({geometry:env(m/FT_PER_UNIT),geometryType:"esriGeometryEnvelope",inSR:String(SR),spatialRel:"esriSpatialRelIntersects"});
  const [b,nb,st,al]=await Promise.all([
    // exact outlines: no maxAllowableOffset, no geometry simplification
    query(LAYERS.buildings,{geometry:JSON.stringify({rings:[outer],spatialReference:{wkid:SR}}),geometryType:"esriGeometryPolygon",inSR:String(SR),spatialRel:"esriSpatialRelIntersects",outFields:"OBJECTID",returnGeometry:"true"}),
    // every category, not only 'Parcel': some neighbouring lots are held as 'Economic' or 'Lease' records
    query(LAYERS.parcels,{...box(NEAR_PARCELS_FT),where:"1=1",outFields:"Parcel_ID",returnGeometry:"true"}),
    query(LAYERS.streets,{...box(NEAR_STREETS_FT),where:"STREET_SEGMENT_TYPE IN ('Street','Alley')",outFields:"Street_Label,STREET_SEGMENT_TYPE",returnGeometry:"true"}),
    query(LAYERS.alleys,{...box(NEAR_STREETS_FT),where:"1=1",outFields:"Alley_Label",returnGeometry:"true"})
  ]);
  const pieces=clipToLot(parcel.lot,(b.features||[]).flatMap(f=>ringsToPolygons(f.geometry&&f.geometry.rings)));
  const lines=[];
  (st.features||[]).forEach(f=>((f.geometry&&f.geometry.paths)||[]).forEach(p=>lines.push({type:f.attributes.STREET_SEGMENT_TYPE==="Alley"?"alley":"street",label:String(f.attributes.Street_Label||"").trim()||"unnamed street",pts:p.map(P)})));
  (al.features||[]).forEach(f=>((f.geometry&&f.geometry.paths)||[]).forEach(p=>lines.push({type:"alley",label:String(f.attributes.Alley_Label||"").trim()||"alley",pts:p.map(P)})));
  return {
    lot:outer.map(P),
    bldgs:pieces.map(p=>({pts:p.outer.map(P),area:p.area})),
    bldgArea:pieces.reduce((s,p)=>s+p.area,0),
    neighbors:(nb.features||[]).flatMap(f=>ringsToPolygons(f.geometry&&f.geometry.rings)).map(p=>p[0].map(P)),
    lines
  };
}
