// data.js: Municipality of Anchorage public ArcGIS REST services. No DOM.
//
// Privacy: this file never requests owner names or mailing addresses. Every query lists its
// outFields; none uses "*". Keep it that way.
//
// Layers, fields and the projection were checked against the live services on 2026-11-23.

import {intersect} from "@turf/intersect";
import {polygon,featureCollection} from "@turf/helpers";
import {inside,polySeg} from "./geometry.js";

const ROOT="https://services2.arcgis.com/Ce3DhLRthdwbHlfF/arcgis/rest/services/";
export const LAYERS={
  parcels:ROOT+"PropertyInformation_Hosted/FeatureServer/0",   // polygons; Parcel_ID, Parcel_Address, Zoning_District, Lot_Size, GIS_Category
  buildings:ROOT+"Buildings_Hosted/FeatureServer/0",           // polygons; ArcGIS Online item 56d274594cbc4aa8bac4257edd06d6cf
  streets:ROOT+"Streets_Hosted/FeatureServer/0",               // centrelines; Street_Label, STREET_SEGMENT_TYPE (Street, Alley, Driveway, ...)
  alleys:ROOT+"Maintained_Alleys/FeatureServer/0",             // centrelines; Alley_Label. Maintained alleys only.
  // Phase 2, property flags. Checked against the live services on 2026-11-23.
  seismic:ROOT+"Seismic/FeatureServer/0",                      // 5 polygons; SEISMIC_CODE 1-5, SEISMIC_TYPE. Titled "Historical Seismic Zones".
  flood:ROOT+"FEMA_FloodAreas/FeatureServer/0",                // polygons; Zone (Floodway, 100 Year Floodplain, 500 Year Floodplain, None), DataDownloadDate
  awwu:ROOT+"AWWU_Infill_Properties_Hosted/FeatureServer/0"    // one row per parcel; Tax_Lot_ID = Parcel_ID, Service_Type.
                                                               // This layer also holds owner names and mailing addresses. Request Service_Type only.
};

// Phase 3, aerial photos. The Municipality's own ArcGIS Server, one map service per photo
// year. Checked against the live services on 2026-11-24: they export in WKID 102634 and
// allow cross-origin requests. The page tries these in order and uses the first that loads.
//
// Only photos the Municipality has published as a public catalog item are listed. A 2026
// photo ("Photo_2026_Temp") also answers without a login, but on 2026-11-24 it had no
// public catalog item, so it is left out until MOA GIS confirms it is meant to be public.
// To add it then, put this line first:
//   {url:IMG+"Photo_2026_Temp/MapServer",year:"2026",flown:"in 2026"},
const IMG="https://www.ancgis.com/arcgis/rest/services/imagery_public/";
export const AERIALS=[
  {url:IMG+"Photo_2024/MapServer",year:"2024",flown:"20 May to 15 June 2024"}
];

// The ground a drawn sheet covers, for asking for a photo of exactly that area.
// frame: {x0, y0, k, mx, my, W, H}. The sheet is W x H pixels at k pixels per foot; the
// sheet pixel (mx, my) is the point (x0, y0) in feet, with y pointing down (y = minus northing).
// Returns {xmin, ymin, xmax, ymax} in the units of SR, northing up.
export function sheetBox(fr){
  const u=FT_PER_UNIT;
  return {xmin:(fr.x0-fr.mx/fr.k)/u,xmax:(fr.x0+(fr.W-fr.mx)/fr.k)/u,ymax:-(fr.y0-fr.my/fr.k)/u,ymin:-(fr.y0+(fr.H-fr.my)/fr.k)/u};
}

// Address of one aerial photo image: the box, north up, w x h pixels (the service allows up
// to 4096 each way). Layer 0 is the photo; the newer services also hold index layers.
export function aerialUrl(base,box,w,h){
  return base+"/export?"+new URLSearchParams({bbox:[box.xmin,box.ymin,box.xmax,box.ymax].join(","),bboxSR:String(SR),imageSR:String(SR),
    size:Math.round(w)+","+Math.round(h),format:"jpg",layers:"show:0",f:"image"});
}

// Projection for all geometry: NAD 1983 StatePlane Alaska 4 FIPS 5004 (US feet), Esri WKID 102634.
// It is conformal and Anchorage lies close to its central meridian, so distances and areas
// are true to well under 0.1%. Coordinates arrive in feet, so no unit conversion is needed.
// The services store Web Mercator, where areas are about 4.26 times too large at this
// latitude; never use Shape__Area.
// To change the projection (for example on advice from MOA GIS), change these two lines.
export const SR=102634;
export const FT_PER_UNIT=1;

const NEAR_PARCELS_FT=40,NEAR_STREETS_FT=150,MIN_PIECE_SQFT=20;
// How far out to fetch buildings for shadows. At noon on 21 December the Anchorage sun is
// about 5 degrees up, and a 25 ft building's shadow is about 270 ft long.
const SHADOW_REACH_FT=300;
// Pre-Approved ADU Plans permit checklist (March 2026): flood review when in or within 300 ft of a flood zone.
// Keep in step with FLAG_RULES.floodBufferFt in rules.js.
const FLOOD_NEAR_FT=300;

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
  const d=await query(LAYERS.parcels,{where:addressWhere(address),outFields:"Parcel_ID,Parcel_Address,Zoning_District,Lot_Size,GIS_MeanPercentSlope",returnGeometry:"true",orderByFields:"Parcel_Address,Parcel_ID",resultRecordCount:"25"});
  const q=String(address||"").toUpperCase().replace(/\s+/g," ").trim();
  const list=(d.features||[]).map(f=>{const polys=ringsToPolygons(f.geometry&&f.geometry.rings),a=f.attributes;
    return {pid:String(a.Parcel_ID),addr:String(a.Parcel_Address||"").trim(),zone:String(a.Zoning_District||"").trim(),lotSize:a.Lot_Size,slope:typeof a.GIS_MeanPercentSlope==="number"?a.GIS_MeanPercentSlope:null,parts:polys.length,lot:polys[0]||null}}).filter(p=>p.lot);
  list.sort((a,b)=>(b.addr===q)-(a.addr===q));
  list.more=!!d.exceededTransferLimit;
  return list;
}

// Everything else needed to draw one parcel. Coordinates come back as {x, y} in feet with
// y pointing down the screen (y = minus northing), so north is up when drawn.
// Returns {lot, bldgs:[{pts, area}], bldgArea, neighbors:[polygon], lines:[{type,label,pts}], center:{lat,lon}|null,
//          around:[{pts, h (feet, or null when not mapped)}]|null}
export async function loadSite(parcel){
  const P=([x,y])=>({x:x*FT_PER_UNIT,y:-y*FT_PER_UNIT});
  const outer=parcel.lot[0],xs=outer.map(p=>p[0]),ys=outer.map(p=>p[1]);
  const env=m=>[Math.min(...xs)-m,Math.min(...ys)-m,Math.max(...xs)+m,Math.max(...ys)+m].join(",");
  const box=m=>({geometry:env(m/FT_PER_UNIT),geometryType:"esriGeometryEnvelope",inSR:String(SR),spatialRel:"esriSpatialRelIntersects"});
  // Middle of the parcel in latitude and longitude, only for the "See street view" link.
  const where=query(LAYERS.parcels,{where:"Parcel_ID='"+String(parcel.pid).replace(/[^0-9A-Za-z]/g,"")+"' AND GIS_Category='Parcel'",returnExtentOnly:"true",outSR:"4326"})
    .then(d=>{const e=d.extent;return e&&isFinite(e.xmin+e.ymin+e.xmax+e.ymax)?{lat:(e.ymin+e.ymax)/2,lon:(e.xmin+e.xmax)/2}:null}).catch(()=>null);
  // Every building near the lot, with its mapped height, for drawing shadows. ELEVATION is
  // not documented by the layer; across the whole layer (checked 2026-11-24) it runs from 8
  // to 316 with a median of 21, and the named towers match, so it is read as height above
  // ground in feet, probably to the highest point of the roof. About one building in five has
  // no value. If this lookup fails the lot still loads, without shadows.
  const around=query(LAYERS.buildings,{...box(SHADOW_REACH_FT),where:"1=1",outFields:"ELEVATION",returnGeometry:"true"})
    .then(d=>(d.features||[]).flatMap(f=>ringsToPolygons(f.geometry&&f.geometry.rings).map(p=>({pts:p[0].map(P),h:typeof f.attributes.ELEVATION==="number"&&f.attributes.ELEVATION>0?f.attributes.ELEVATION:null})))).catch(()=>null);
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
    lines,
    center:await where,
    around:await around
  };
}

// Shortest distance from a lot to a set of polygons, 0 when they touch or overlap.
// lot: [{x,y}]. polys: array of [outer, ...holes], each a list of {x,y}. A lot that sits
// wholly inside a hole is outside the polygon, and its distance is to the hole's edge.
export function distToPolygons(lot,polys){
  let m=Infinity;
  for(const p of polys){
    const outer=p[0],holes=p.slice(1);let d=Infinity;
    for(const r of p)for(let i=0;i<r.length;i++)d=Math.min(d,polySeg(lot,r[i],r[(i+1)%r.length]));
    if((inside(lot[0],outer)&&!holes.some(h=>inside(lot[0],h)))||inside(outer[0],lot))d=0;
    m=Math.min(m,d);
  }
  return m;
}

// When a layer's data was last edited (milliseconds), or null. Asked once per layer per page load.
const dates={};
function layerDate(layer){
  return dates[layer]||(dates[layer]=fetch(layer+"?f=json").then(r=>r.json()).then(m=>(m.editingInfo&&m.editingInfo.dataLastEditDate)||null).catch(()=>null));
}

// The date MOA downloaded the flood areas from FEMA, taken from any one record.
let floodDated=null;
function floodDate(){
  return floodDated||(floodDated=query(LAYERS.flood,{where:"Zone<>'None'",outFields:"DataDownloadDate",returnGeometry:"false",resultRecordCount:"1"}).then(q=>q.features[0].attributes.DataDownloadDate).catch(()=>null));
}

// Map lookups for the "other reviews" flags. Each part is looked up on its own; a part that
// fails comes back as {error:true} so the others still show. What the values mean for the
// checkboxes is decided in rules.js flagResults().
// Returns {seis:{code,type,date}, flood:{onLot:[zones],near:[zones],date}, slope:{pct}, awwu:{service,date}}
export async function loadFlags(parcel){
  const g={geometry:JSON.stringify({rings:[parcel.lot[0]],spatialReference:{wkid:SR}}),geometryType:"esriGeometryPolygon",inSR:String(SR),spatialRel:"esriSpatialRelIntersects",returnGeometry:"false"};
  const part=async fn=>{try{return await fn()}catch(e){return {error:true}}};
  const [seis,flood,slope,awwu]=await Promise.all([
    part(async()=>{const [q,date]=await Promise.all([query(LAYERS.seismic,{...g,outFields:"SEISMIC_CODE,SEISMIC_TYPE"}),layerDate(LAYERS.seismic)]);
      // a lot that straddles two zones is reported in the higher one
      const f=(q.features||[]).map(x=>x.attributes).sort((a,b)=>b.SEISMIC_CODE-a.SEISMIC_CODE)[0];
      return {code:f?f.SEISMIC_CODE:null,type:f?f.SEISMIC_TYPE:null,date}}),
    part(async()=>{
      // The distance is measured here, not by the service. Its distance parameter was tested
      // on 2026-11-23 and is not reliable when outSR is also sent: it reported flood zones
      // "within 300 ft" of a lot that is 850 ft from the nearest one.
      const o=parcel.lot[0],xs=o.map(p=>p[0]),ys=o.map(p=>p[1]),m=(FLOOD_NEAR_FT+10)/FT_PER_UNIT;
      const q=await query(LAYERS.flood,{geometry:[Math.min(...xs)-m,Math.min(...ys)-m,Math.max(...xs)+m,Math.max(...ys)+m].join(","),geometryType:"esriGeometryEnvelope",inSR:String(SR),spatialRel:"esriSpatialRelIntersects",where:"Zone<>'None'",outFields:"Zone,DataDownloadDate",returnGeometry:"true"});
      const P=([x,y])=>({x:x*FT_PER_UNIT,y:y*FT_PER_UNIT}),lot=o.slice(0,-1).map(P),dist={};let date=null;
      for(const f of q.features||[]){const z=f.attributes.Zone,dd=distToPolygons(lot,ringsToPolygons(f.geometry&&f.geometry.rings).map(p=>p.map(r=>r.slice(0,-1).map(P))));
        if(dist[z]==null||dd<dist[z])dist[z]=dd;if(dd<=FLOOD_NEAR_FT&&date==null)date=f.attributes.DataDownloadDate}
      const zs=Object.keys(dist);
      return {onLot:zs.filter(z=>dist[z]===0),near:zs.filter(z=>dist[z]<=FLOOD_NEAR_FT),dist,date:date!=null?date:await floodDate()}}),
    part(async()=>({pct:parcel.slope==null?null:parcel.slope})),
    part(async()=>{const pid=String(parcel.pid).replace(/[^0-9A-Za-z]/g,"");
      const [q,date]=await Promise.all([query(LAYERS.awwu,{where:"Tax_Lot_ID='"+pid+"'",outFields:"Service_Type",returnGeometry:"false"}),layerDate(LAYERS.awwu)]);
      const f=(q.features||[])[0];return {service:f?f.attributes.Service_Type:null,date}})
  ]);
  return {seis,flood,slope,awwu};
}
