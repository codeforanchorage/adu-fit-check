// sun.js: where the sun is, and the shadow a flat-topped block casts on flat ground.
// Pure functions. No DOM, no network, no zoning numbers.
//
// Shadows on this page are an aid for thinking and discussion. No shadow rule is applied,
// and nothing here is part of the plan check.

const RAD=Math.PI/180,clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),mod=(v,n)=>((v%n)+n)%n;

// Sun position for an instant and a place, from the NOAA Solar Calculator equations
// (after Jean Meeus, Astronomical Algorithms). Good to a small fraction of a degree.
//   ms   time in milliseconds since 1970 (UTC), as Date.getTime() gives
//   lat  degrees north.  lon  degrees east (Anchorage is about 61.2, -149.9)
// Returns {alt, az} in degrees: alt is height above the horizon (negative when the sun is
// down), az is the compass direction of the sun, clockwise from north (90 east, 180 south).
// The bending of light near the horizon is left out; it lifts a low sun by under half a degree.
export function sunPosition(ms,lat,lon){
  const T=(ms/86400000+2440587.5-2451545)/36525;
  const L0=mod(280.46646+T*(36000.76983+T*0.0003032),360);
  const M=357.52911+T*(35999.05029-0.0001537*T);
  const e=0.016708634-T*(0.000042037+0.0000001267*T);
  const C=Math.sin(M*RAD)*(1.914602-T*(0.004817+0.000014*T))+Math.sin(2*M*RAD)*(0.019993-0.000101*T)+Math.sin(3*M*RAD)*0.000289;
  const om=125.04-1934.136*T,lam=L0+C-0.00569-0.00478*Math.sin(om*RAD);
  const eps=23+(26+(21.448-T*(46.815+T*(0.00059-T*0.001813)))/60)/60+0.00256*Math.cos(om*RAD);
  const decl=Math.asin(Math.sin(eps*RAD)*Math.sin(lam*RAD))/RAD;
  const y=Math.tan(eps*RAD/2)**2;
  // equation of time, minutes
  const eqt=4/RAD*(y*Math.sin(2*L0*RAD)-2*e*Math.sin(M*RAD)+4*e*y*Math.sin(M*RAD)*Math.cos(2*L0*RAD)-0.5*y*y*Math.sin(4*L0*RAD)-1.25*e*e*Math.sin(2*M*RAD));
  const solarMin=mod(mod(ms/60000,1440)+eqt+4*lon,1440),ha=solarMin/4-180;   // hour angle, degrees; 0 at solar noon
  const zen=Math.acos(clamp(Math.sin(lat*RAD)*Math.sin(decl*RAD)+Math.cos(lat*RAD)*Math.cos(decl*RAD)*Math.cos(ha*RAD),-1,1))/RAD;
  const den=Math.cos(lat*RAD)*Math.sin(zen*RAD);let az=lat>=0?180:0;
  if(Math.abs(den)>1e-6){const a=Math.acos(clamp((Math.sin(lat*RAD)*Math.cos(zen*RAD)-Math.sin(decl*RAD))/den,-1,1))/RAD;az=ha>0?mod(a+180,360):mod(540-a,360)}
  return {alt:90-zen,az};
}

// The instant (ms, UTC) of a clock time in a time zone, such as "America/Anchorage".
// y, mo (1-12), d are the calendar date there; min is minutes after midnight on the clock.
export function zonedToUtc(y,mo,d,min,tz){
  const want=Date.UTC(y,mo-1,d,0,min),f=new Intl.DateTimeFormat("en-US",{timeZone:tz,hourCycle:"h23",year:"numeric",month:"numeric",day:"numeric",hour:"numeric",minute:"numeric"});
  const shown=ms=>{const p={};f.formatToParts(new Date(ms)).forEach(x=>{p[x.type]=+x.value});return Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute)};
  let ms=want;for(let i=0;i<3;i++)ms+=want-shown(ms);
  return ms;
}

// Today's calendar date in a time zone, as "YYYY-MM-DD".
export function todayIn(tz,now){
  const p={};new Intl.DateTimeFormat("en-US",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(now==null?Date.now():now)).forEach(x=>{p[x.type]=x.value});
  return p.year+"-"+p.month+"-"+p.day;
}

// How far, and which way, the shadow of a point `h` feet up falls on flat ground.
//   alt, az  sun position from sunPosition()
//   maxLen   longest shadow to report, in feet (a sun on the horizon throws an endless one)
// Returns null when the sun is down. Otherwise {dx, dy, len, capped}: dx is feet east, dy is
// feet SOUTH (y points down the drawing, north is up), len is the length in feet.
// Length is h / tan(alt); the shadow points directly away from the sun.
export function shadowOffset(h,alt,az,maxLen){
  if(!(alt>0)||!(h>0))return null;
  const full=h/Math.tan(alt*RAD),len=maxLen!=null?Math.min(full,maxLen):full,a=(az+180)*RAD;
  return {dx:len*Math.sin(a),dy:-len*Math.cos(a),len,capped:len<full};
}

// Compass word for a direction in degrees clockwise from north.
export function compass(deg){return ["north","north-east","east","south-east","south","south-west","west","north-west"][Math.round(mod(deg,360)/45)%8]}
