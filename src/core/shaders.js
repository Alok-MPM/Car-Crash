// GLSL sources. One uber shader for all lit geometry, plus sky, shadow, particle and decal programs.

export const COMMON_ENV = /* glsl */ `
uniform vec3 uSunDir, uSunCol, uSkyTop, uSkyHor, uGroundCol, uFogCol;
uniform float uSkyI, uFogD, uNight, uTime;

float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float fbm2(vec2 p){ float a=.5, s=0.; for(int i=0;i<5;i++){ s+=a*vn2(p); p=p*2.03+17.1; a*=.5; } return s; }

vec3 skyAvg(vec3 d){
  float t = clamp(d.y*.5+.5,0.,1.);
  return mix(uGroundCol*0.8, mix(uSkyHor, uSkyTop, 0.55), smoothstep(0.,1.,t));
}
// analytic environment used for reflections and the visible sky
vec3 skyEnv(vec3 d, float rough){
  if (rough >= 0.75) return skyAvg(d) * uSkyI;   // from rough 0.7407 up the last line replaces the whole colour by skyAvg: skip the band / sun / atan work
  float h = d.y;
  vec3 col = mix(uSkyHor, uSkyTop, pow(clamp(h,0.,1.), 0.42));
  float az = atan(d.z, d.x);
  float sk = 0.018 + 0.035*(sin(az*5.+1.3)*.5+.5) + 0.03*(sin(az*17.+.4)*.5+.5);
  float band = smoothstep(sk+0.012, sk-0.004, h) * smoothstep(-0.06, 0.0, h);
  col = mix(col, uGroundCol*0.5, band*(1.-rough*0.7));
  col = mix(col, uGroundCol, smoothstep(0.0, -0.06, h));
  float sd = max(dot(d, uSunDir), 0.);
  float ex = mix(3000., 14., rough);
  float sun = pow(sd, ex) * (ex*0.0008 + 0.02) * 4.0 + pow(sd, 6.) * 0.12;
  col += uSunCol * sun * step(-0.02, uSunDir.y + 0.12);
  col = mix(col, skyAvg(d), clamp(rough*1.35, 0., 1.));
  return col * uSkyI;
}
vec3 fogApply(vec3 c, float dist, vec3 dir){
  float f = 1. - exp(-dist * uFogD);
  float sun = pow(max(dot(dir, uSunDir), 0.), 6.);
  vec3 fc = uFogCol + uSunCol * sun * 0.25;
  return mix(c, fc, clamp(f, 0., 1.));
}
vec3 aces(vec3 x){
  const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0., 1.);
}
vec3 finish(vec3 c){
  c = aces(c * 0.62);
  return pow(c, vec3(1./2.2));
}
`;

export const VS_MAIN = /* glsl */ `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec3 aCol;
layout(location=3) in vec2 aUv;
layout(location=4) in float aTile;
uniform mat4 uVP, uModel, uLightVP;
uniform vec3 uEyeMod;
uniform float uNBias, uTime, uSway, uTerr;
uniform highp sampler2D uSoil;   // deformable soil field: R = dug depth, A = spoil heap (the terrain patch is displaced by them)
uniform vec4 uSoilO;
uniform vec2 uEyeXZ;
out vec3 vPosRel, vNrm, vCol, vWorldMod, vLocal;
out vec2 vUv;
flat out float vTile;
out vec4 vShadow;
void main(){
  vec4 p = uModel * vec4(aPos, 1.);
  if (uTerr > 0.5 && uSoilO.w > 0.5) {
    // terrain patch: a camera-following grid of the soft ground. Its heights come straight from the soil field, so a pit is a real hollow (silhouette, depth, wheels hide behind the rim)
    vec4 sv = textureLod(uSoil, (p.xz + uEyeXZ) / uSoilO.z, 0.);
    float ef = 1. - smoothstep(0.8, 1., max(abs(aPos.x), abs(aPos.z)) / 17.9);
    p.y += (sv.a * 0.2 - sv.r * 0.6) * ef;
  }
  vec3 n = normalize(mat3(uModel) * aNrm);
  if (uSway > 0.) {
    // wind, all in the vertex shader. One gust per tree (phase from where the tree stands, so a gust travels through a row of trees), then three layers:
    //  1) the whole tree leans downwind, more with height (trunk, branches, leaves and fruit all get the same lean, nothing tears apart)
    //  2) every branch swings on its own: a smooth field of the position inside the crown, so a twig and its leaves move together and neighbours differ
    //  3) every leaf flutters by itself: its own speed and phase come from its seed (aTile = type*4096 + seed + weight, weight 0 at the stalk, up to ~1 at the tip)
    float t = uTime;
    vec3 org = uModel[3].xyz + uEyeMod;
    float hh = min(max(aPos.y, 0.), 16.);
    vec2 wd = vec2(0.87, 0.49);
    float ph = dot(org.xz, wd) * 0.13;
    float gust = 0.55 * sin(t * 0.9 - ph) + 0.3 * sin(t * 1.9 - ph * 1.7 + 1.3) + 0.15 * sin(t * 3.4 - ph * 2.3);
    float push = 0.62 + 0.38 * gust;
    float lean = 0.0015 * hh * hh * push, side = 0.0005 * hh * hh * sin(t * 1.3 - ph * 1.2 + 0.7);
    p.x += wd.x * lean - wd.y * side; p.z += wd.y * lean + wd.x * side;
    float hf = smoothstep(0.8, 3., hh), rad = length(aPos.xz) * 0.8 + hh * 0.12;
    vec3 q = aPos * 1.7;
    float b1 = sin(t * 2.1 + q.x * 1.3 + q.y * 0.9 + q.z * 1.1 + ph * 3.), b2 = sin(t * 3.1 + q.z * 1.7 - q.x * 1.1 + q.y * 1.4 + 1.7 + ph * 2.);
    float ba = (0.012 + 0.03 * push) * hf * rad;
    p.x += (b1 * 0.8 + b2 * 0.5) * ba; p.z += (b2 * 0.8 - b1 * 0.3) * ba; p.y += b1 * b2 * ba * 0.15;
    if (uSway < 1.5 || uSway > 2.5) {
      float ty = floor(aTile / 4096.), r0 = aTile - ty * 4096., sd = floor(r0), w = r0 - sd;
      if (uSway < 1.5) {
        float f1 = sin(t * (6. + fract(sd * 0.137) * 4.) + sd * 2.399 + gust * 1.5), f2 = sin(t * (8.3 + fract(sd * 0.291) * 3.) + sd * 1.13);
        float la = (0.4 + 0.6 * push) * w * 0.12;
        p.xyz += n * f1 * la + vec3(f2 * 0.6, f1 * f2 * 0.3, f2 * 0.4) * la * 0.5;
      } else {
        // hanging fruit: swings from its stalk like a pendulum, heavier fruit more slowly
        float big = ty > 4.5 && ty < 5.5 ? 3.2 : (ty > 3.5 && ty < 4.5 ? 2.2 : 1.), sw = w * (0.012 + 0.02 * push) * big;
        float s1 = sin(t * (2.6 / sqrt(big)) + sd * 0.77 - ph), s2 = sin(t * (3.1 / sqrt(big)) + sd * 1.31);
        p.x += sw * (wd.x * (0.6 + 0.4 * s1) - wd.y * 0.5 * s2); p.z += sw * (wd.y * (0.6 + 0.4 * s1) + wd.x * 0.5 * s2);
      }
    }
  }
  vPosRel = p.xyz; vNrm = n; vCol = aCol; vUv = aUv; vLocal = aPos; vTile = aTile;
  vWorldMod = p.xyz + uEyeMod;
  vShadow = uLightVP * vec4(p.xyz + n * uNBias, 1.);
  gl_Position = uVP * p;
}`;

export const FS_MAIN = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vPosRel, vNrm, vCol, vWorldMod, vLocal;
in vec2 vUv;
flat in float vTile;
in vec4 vShadow;
out vec4 outCol;
uniform sampler2DShadow uShadowMap;
uniform sampler2D uTex;
uniform float uShadowTexel, uShadowOn;
uniform int uKind;
uniform vec3 uBase, uEmis;
uniform float uMetal, uRough, uCoat, uAlpha, uTexOn, uTexScale, uFlake;
uniform float uPixA;
uniform highp sampler2D uSoil;   // deformable soil field (toroidal, 0.125 m cells): R = dug depth, G = grass torn off, B = tyre compaction, A = loose spoil heap
uniform vec4 uSoilO;       // window origin x, z (m), window size (m), 1 = on
uniform sampler2D uMeta;   // same window: 255 where the ground is deformable lawn (drawn by the terrain patch), 0 elsewhere
uniform vec4 uTerrC;       // terrain patch: centre x, z, half size (m), 1 = on
uniform float uTerr, uUnder; // this draw IS the patch / is a flat ground sheet that must give way to the patch where it is drawn
uniform vec2 uEyeXZ;       // true eye position (the fragment position is eye-relative)
uniform float uNear2;   // kind 11 (tree pictures): squared radius around the eye inside which pictures are hidden because the real 3D tree is drawn
uniform vec4 uLP[4], uLD[4], uLC[4];
uniform int uNL;
uniform float uDbg;
${COMMON_ENV}

// band limit: an octave of f cycles per metre fades out once one pixel (pw metres) can no longer resolve it, so fine grain never aliases into shimmer while driving
float bl(float f, float pw){ return 1. - smoothstep(0.12, 0.42, f * pw); }
// ground surface relief (height of the tiny 3D detail): class 1 lawn (blades, tufts), 2 soil / mud (clods, furrows), 3 pavers (joints). pw = pixel size in the same units as gp
float relief(vec2 gp, float cls, float pw){
  // every octave is isotropic (no stretched terms, so no directional streaks); a gentle domain warp keeps the value-noise grid from showing
  vec2 q = gp + vec2(vn2(gp * 2.7 + 7.), vn2(gp * 2.7 + 19.)) * 0.3;
  if (cls < 1.5) return 0.5 + (vn2(q * 52.) - .5) * 0.4 * bl(52., pw) + (vn2(q * 23. + 3.) - .5) * 0.3 * bl(23., pw) + (vn2(q * 9.) - .5) * 0.2 * bl(9., pw) + (vn2(gp * 2.3) - .5) * 0.1;   // grass: tufts and blades in every direction
  if (cls < 2.5) {                                                                                                          // soil / mud: clods, crumbs, small stones
    float stones = smoothstep(.8, .9, vn2(gp * 27. + 11.)) * 0.4 * bl(27., pw);
    return 0.5 + (vn2(q * 3.4) - .5) * 0.42 + (vn2(q * 8.1 + 5.) - .5) * 0.28 * bl(8.1, pw) + (vn2(q * 19.) - .5) * 0.15 * bl(19., pw) + stones;
  }
  vec2 pj = abs(fract(gp * 0.8) - .5);
  float jw = max(0.05, pw * 1.2);
  return -smoothstep(.5 - jw, .5, max(pj.x, pj.y)) * (0.05 / jw) + (vn2(gp * 24.) - .5) * 0.12 * bl(24., pw) + 0.06;
}
// value noise with analytic gradient (xyz = value, d/dx, d/dy)
vec3 vn2d(vec2 p){
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f), du = 6. * f * (1. - f);
  float a = h21(i), b = h21(i + vec2(1, 0)), c = h21(i + vec2(0, 1)), d = h21(i + vec2(1, 1));
  return vec3(a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y, du * (vec2(b - a, c - a) + (a - b - c + d) * u.yx));
}
// crumbly soil: noise sharpened into rounded lumps with dark gaps, four octaves (17 cm, 6 cm, 2 cm, 9 mm), each fading out when a pixel can no longer resolve it.
// returns the lump height 0..1; slope = height gradient (metres per metre) for the normal
float lump(vec3 v, float f, out vec2 g){ float t = clamp((v.x - .3) / .4, 0., 1.), s = t * t * (3. - 2. * t), ds = (t > 0. && t < 1.) ? 6. * t * (1. - t) / .4 : 0.; g = v.yz * ds * f; return s; }
float soilH(vec2 gp, float pw, out vec2 slope){
  vec2 q = gp + (vec2(vn2(gp * 1.7 + 3.), vn2(gp * 1.7 + 17.)) - .5) * 0.4, g1 = vec2(0.), g2 = vec2(0.), g3 = vec2(0.), g4 = vec2(0.);
  float w2 = bl(17., pw), w3 = bl(44., pw), w4 = bl(110., pw);
  float h1 = lump(vn2d(q * 6.), 6., g1), h2 = lump(vn2d(q * 17. + 5.), 17., g2), h3 = 0.5, h4 = 0.5;
  if (w3 > .01) h3 = lump(vn2d(q * 44. + 11.), 44., g3);
  if (w4 > .01) h4 = lump(vn2d(q * 110. + 23.), 110., g4);
  slope = g1 * 0.03 + g2 * 0.011 * w2 + g3 * 0.004 * w3 + g4 * 0.0016 * w4;
  return h1 * 0.5 + mix(0.5, h2, w2) * 0.3 + mix(0.5, h3, w3) * 0.15 + mix(0.5, h4, w4) * 0.05;
}
// small stones in the soil: sparse, 3-7 mm; returns coverage, shade 0 (dark) .. 1 (pale)
float pebbles(vec2 gp, float pw, out float shade){
  vec2 c = gp * 38., i = floor(c), f = fract(c) - .5; shade = 0.;
  if (h21(i + 3.7) < 0.9) return 0.;
  vec2 o = (vec2(h21(i + 1.1), h21(i + 5.3)) - .5) * .5; float rad = 0.12 + 0.14 * h21(i + 9.1);
  shade = h21(i + 2.2);
  return (1. - smoothstep(rad * .75, rad, length(f - o))) * bl(38., pw);
}
float shadowPCF(vec4 sc, float dist){
  vec3 p = sc.xyz / sc.w * 0.5 + 0.5;
  if (p.z >= 1. || p.x <= 0. || p.x >= 1. || p.y <= 0. || p.y >= 1.) return 1.;
  float s = 0.;
  float t = uShadowTexel;
  if (dist > 22.) {
    // beyond 22 m four taps are enough (each tap is already a 2x2 hardware comparison): the shadow edge is below a pixel's resolving power there
    float o = t * 0.9, z = p.z - 0.00012;
    s = 0.25 * (texture(uShadowMap, vec3(p.xy + vec2(-o, -o), z)) + texture(uShadowMap, vec3(p.xy + vec2(o, -o), z)) + texture(uShadowMap, vec3(p.xy + vec2(-o, o), z)) + texture(uShadowMap, vec3(p.xy + vec2(o, o), z)));
  } else {
    for (int i=-1;i<=1;i++) for (int j=-1;j<=1;j++)
      s += texture(uShadowMap, vec3(p.xy + vec2(float(i), float(j)) * t * 1.25, p.z - 0.00012));
    s /= 9.;
  }
  vec2 e = min(p.xy, 1.-p.xy);
  float edge = smoothstep(0., 0.08, min(e.x, e.y));
  return mix(1., s, edge);
}
float ggxD(float NdH, float a){ float a2=a*a; float d=NdH*NdH*(a2-1.)+1.; return a2/(3.14159*d*d+1e-5); }
float smithV(float NdL, float NdV, float a){ float k=a*.5; return 1./((NdL*(1.-k)+k)*(NdV*(1.-k)+k)+1e-4)*.25; }
vec3 fresnel(vec3 F0, float c){ return F0 + (1.-F0) * pow(1.-c, 5.); }
vec3 fresnelR(vec3 F0, float c, float r){ return F0 + (max(vec3(1.-r), F0) - F0) * pow(1.-c, 5.); }

float vor(vec3 p, out float cellId){
  vec3 i = floor(p), f = fract(p);
  float d1 = 9., d2 = 9.; cellId = 0.;
  for (int x=-1;x<=1;x++) for (int y=-1;y<=1;y++) for (int z=-1;z<=1;z++){
    vec3 g = vec3(float(x),float(y),float(z));
    vec3 o = vec3(h21(i.xy+g.xy+g.z*7.1), h21(i.yz+g.yz+g.x*3.7+1.3), h21(i.zx+g.zx+g.y*5.3+2.1));
    vec3 r = g + o - f;
    float d = dot(r,r);
    if (d < d1){ d2 = d1; d1 = d; cellId = o.x; } else if (d < d2) d2 = d;
  }
  return sqrt(d2) - sqrt(d1);
}

vec3 asphalt(vec3 wp, float dist, float pw, out float rough){
  vec2 p = wp.xz;
  float b2 = bl(3.1,pw), b3 = bl(13.,pw), b4 = bl(41.,pw);
  float n1 = vn2(p*0.7), n2 = .5, n3 = .5, n4 = .5;      // an octave a pixel cannot resolve has weight 0: it is not evaluated
  if (b2 > 0.003) n2 = vn2(p*3.1);
  if (b3 > 0.003) n3 = vn2(p*13.);
  if (b4 > 0.003) n4 = vn2(p*41.);
  float g = 0.30 + 0.07*(n1-.5) + 0.05*(n2-.5)*b2 + 0.07*(n3-.5)*b3 + 0.09*(n4-.5)*b4;
  float pch = smoothstep(.55,.7,vn2(p*0.09));
  g += pch*0.03;
  rough = 0.82 - 0.1*pch;
  return vec3(g*0.95, g*0.96, g*1.0) * 0.36;
}

void main(){
  if ((uTerr > 0.5 || uUnder > 0.5) && uTerrC.w > 0.5) {
    // the patch draws the deformable lawn; every flat ground sheet underneath (world, tarmac, lawn slabs) steps aside there, so a pit is never hidden by a sheet at y = 0
    vec2 axz = vPosRel.xz + uEyeXZ, dd = abs(axz - uTerrC.xy);
    if (dd.x < uTerrC.z && dd.y < uTerrC.z) {
      float mt = textureLod(uMeta, axz / uSoilO.z, 0.).r;
      if (uTerr > 0.5 ? mt < 0.5 : mt > 0.5) discard;
    }
  }
  vec3 N = normalize(vNrm);
  bool front = gl_FrontFacing;
  if (!front) N = -N;
  vec3 Vv = normalize(-vPosRel);
  float dist = length(vPosRel);
  float ddt = dist * clamp(uPixA * 935., 0.85, 2.0);   // detail distance: a coarser pixel (lower resolution, wider lens) loses fine detail earlier instead of shimmering
  vec3 viewDir = -Vv;
  vec3 albedo = uBase * vCol;
  float metal = uMetal, rough = uRough, coat = uCoat;
  vec3 emis = uEmis;
  float alpha = 1.;
  float ao = 1.;
  vec4 tx = vec4(0.);
  // building surfaces: one quad per face, the atlas tile repeats here (vTile = cell + 1, vUv = tile-space coordinate). Gradients are taken from the
  // unwrapped coordinate so mip level and anisotropy are the same as if the face had been cut into 1.2 m quads.
  vec2 dUx = dFdx(vUv), dUy = dFdy(vUv);
  float pw = max(length(dFdx(vWorldMod.xz)), length(dFdy(vWorldMod.xz))) + 1e-5;   // metres per pixel on the ground
  bool tiled = vTile > 0.5 && uKind != 10 && uKind != 11 && uKind != 12;
  vec2 acell = vec2(0.);
  if (uTexOn > 0.5) {
    if (tiled) {
      float ti = vTile - 1.;
      acell = vec2(mod(ti, 4.), floor(ti / 4.));
      vec2 fr = fract(vUv);
      vec2 auv = (acell + vec2(0.012 + 0.976 * fr.x, 1. - 0.012 - 0.976 * fr.y)) * 0.25;
      tx = textureGrad(uTex, auv, dUx * vec2(0.244, -0.244), dUy * vec2(0.244, -0.244));
    } else tx = texture(uTex, vUv);
  }
  if (uKind == 10) {
    // every leaf is cut out: sky shows through the canopy. Far away the mip chain thins the alpha of narrow leaflets, so the cut-off relaxes with the mip level and they do not melt away.
    vec2 ts = vec2(textureSize(uTex, 0)), gx = dUx * ts, gy = dUy * ts;
    float lod = 0.5 * log2(max(max(dot(gx, gx), dot(gy, gy)), 1.));
    if (tx.a < 0.42 - 0.045 * clamp(lod, 0., 4.)) discard;
  }
  if (uKind == 11) {
    // tree picture: vCol.xy = the tree's anchor in the same local frame as aPos; the anchor relative to the eye is then fragment-eye + (anchor - fragment-local)
    vec2 anc = vPosRel.xz + (vCol.xy - vLocal.xz);
    // a picture seen nearly edge-on would show as a bright streak: its cut-off rises as it turns away (the second, crossed picture of the tree always faces us)
    vec3 pn = normalize(vec3(vNrm.x, 0., vNrm.z) + vec3(1e-5)), vh = normalize(vec3(vPosRel.x, 0., vPosRel.z) + vec3(1e-5));
    if (dot(anc, anc) < uNear2 || tx.a * smoothstep(0.1, 0.4, abs(dot(pn, vh))) < 0.42) discard;
  }

  if (uKind == 4) {
    float r; albedo = asphalt(vWorldMod * uTexScale, ddt, pw * uTexScale, r) * uBase; rough = r; metal = 0.; coat = 0.;
    if (uTexOn > 0.5) { albedo = mix(albedo, tx.rgb * uBase, tx.a); }
    float nrr = 1. - smoothstep(8., 38., ddt);
    vec2 rp = vWorldMod.xz;
    float w65 = bl(65., pw), w180 = bl(180., pw);
    if (nrr > 0.01 && w65 > 0.01) {
      // stone aggregate grain: the sun catches individual chippings and bitumen between them. Only as fine as the pixels can show (w65, w180), otherwise it shimmers.
      float ge = 0.005, g0 = vn2(rp * 65.), g1 = vn2(rp * 180.);
      float gx = vn2((rp + vec2(ge, 0.)) * 65.) , gz = vn2((rp + vec2(0., ge)) * 65.), hx1 = vn2((rp + vec2(ge * 0.4, 0.)) * 180.), hz1 = vn2((rp + vec2(0., ge * 0.4)) * 180.);
      N = normalize(N + vec3((g0 - gx) * 1.1 * w65 + (g1 - hx1) * 0.6 * w180, 0., (g0 - gz) * 1.1 * w65 + (g1 - hz1) * 0.6 * w180) * 1.7 * nrr);
      albedo *= 1. + (g0 - .5) * 0.16 * nrr * w65 + (g1 - .5) * 0.1 * nrr * w180;
    }
    float conc = step(1.1, uTexScale);
    if (vCol.b > 1.5) {
      // lane structure from the road mesh: uv.x = metres from the centre line, uv.y = metres along the road, vCol.xy = lane width, median half-width
      float lw = vCol.r, a = abs(vUv.x) - vCol.g;
      if (a > 0.) {
        float lp = mod(a, lw) - 0.5 * lw;
        float tr = smoothstep(0.4, 0.16, abs(abs(lp) - 0.82));            // wheel tracks, 1.64 m apart
        rough = mix(max(rough, 0.86), 0.58, tr * (1. - 0.4 * conc));
        albedo *= 1. - 0.17 * tr * (1. - 0.5 * conc);
        if (conc > 0.5) {
          // concrete slab roads: transverse expansion joint every 4.5 m, longitudinal joint at every lane edge, brushed grain
          float jt = abs(fract(vUv.y / 4.5 + 0.5) - 0.5) * 4.5, lj = abs(abs(lp) - 0.5 * lw);
          float jw = 0.034 + 1.5 * pw;
          float jn = (1. - smoothstep(0.012, jw, min(jt, lj))) * (0.034 / jw);
          albedo *= 1. - 0.5 * jn; rough = mix(rough, 0.95, jn);
          float br = vn2(vec2(vUv.x * 130., vUv.y * 2.6));
          albedo *= 1. + (br - .5) * 0.07 * nrr * bl(130., pw);
        }
      }
    }
    // tar-sealed hairline cracks in patches (dark, a touch glossier)
    float cvis = 0., cfd = 1. - smoothstep(10., 60., ddt);
    if (cfd > 0.004) {
      float cm = smoothstep(.58, .72, vn2(rp * 0.045 + 3.)), cw = 0.014 + 0.5 * pw, ck = (1. - smoothstep(0., cw, abs(vn2(rp * 0.42 + 9.) - .5))) * (0.014 / cw);
      cvis = cm * ck * cfd;
    }
    albedo *= 1. - 0.55 * cvis; rough = mix(rough, 0.42, cvis);
  } else if (uKind == 1) {
    // car paint: tinted base with metallic flake + clear coat; decals/panel lines from texture
    float dmg = 1. - vCol.r;
    albedo = uBase * mix(vec3(vCol.r * vCol.g, vCol.g, vCol.b), vec3(0.16,0.13,0.11), clamp(dmg*1.2,0.,1.));   // g/b = baked sill occlusion (neutral darkening), r = 1 - damage
    if (uTexOn > 0.5) { albedo = mix(albedo, tx.rgb, tx.a); rough = mix(rough, 0.55, tx.a); coat *= (1.-tx.a); }
    rough = clamp(rough + dmg * 0.5, 0., 1.);
    coat *= (1. - clamp(dmg*1.5, 0., 1.));
    metal = metal * (1. - dmg);
    float ff = 1. - smoothstep(0.0012, 0.0030, dist * uPixA);   // glitter exists only while a pixel is finer than a flake (a pixel wider than that would alias into moire bands)
    if (ff > 0.004) { float fl = vn2(vLocal.xy*700.+vLocal.z*400.) * vn2(vLocal.zy*600.+7.); albedo *= 1. + (fl-.25) * uFlake * 0.35 * ff; }

  } else if (uKind == 2) {
    albedo = uBase; alpha = uAlpha;
  } else if (uKind == 8) {
    albedo = vCol;
  } else if (uKind == 3) {
    albedo = vec3(0.); emis = uEmis * vCol;
  } else if (uKind == 5) {
    albedo = uBase * vCol; ao = 0.8 + 0.2 * smoothstep(0.,0.4,abs(vNrm.y));
  } else if (uKind == 7) {
    // natural ground: soil / grass / dry grass. Patchy at large scale, clods and blades up close, no repeating texture
    vec2 gp = vWorldMod.xz * uTexScale;
    float pwg = pw * uTexScale;
    float f1 = 1.-smoothstep(40.,260.,ddt), f2 = 1.-smoothstep(6.,45.,ddt), f3 = 1.-smoothstep(1.5,16.,ddt);
    // the fine octaves only where their weight is not zero: beyond 16 m / 45 m / 260 m they are not evaluated at all
    float n0 = vn2(gp*0.011), n1 = .5, n2 = .5, n3 = .5, n4 = .5, n5 = .5;
    if (f1 > 0.003) { n1 = vn2(gp*0.07); n2 = vn2(gp*0.45); }
    if (f2 > 0.003) n3 = vn2(gp*2.4);
    if (f3 > 0.003) { n4 = vn2(gp*13.); n5 = vn2(gp*21. + 5.); }
    float v = 1. + 0.30*(n0-.5) + 0.22*(n1-.5)*f1 + 0.16*(n2-.5)*f1 + 0.22*(n3-.5)*f2 + 0.26*(n4-.5)*f3*bl(13., pwg) + 0.12*(n5-.5)*f3*bl(21., pwg);
    albedo = uBase * vCol * v * mix(vec3(1.), vec3(1.10,1.0,0.78), smoothstep(.35,.7,n0));
    if (uFlake > 0.5 && uFlake < 1.5) albedo *= vec3(0.84, 0.76, 0.82) * mix(0.68, 1., smoothstep(1., 30., dist));   // real turf is darker and more olive than candy green, and darkest close up where blades shade the ground between them
    rough = 0.97; metal = 0.; coat = 0.;
    // ---- soil field: tyre prints, torn grass, pits, spoil heaps and the bare root zones round trees (lawns and soil only, never pavers)
    float sMix = 0., comp = 0., dep = 0., bare = 0.;
    if (uSoilO.w > 0.5 && uFlake > 0.5 && uFlake < 2.5) {
      vec2 wxz = vPosRel.xz + uEyeXZ, lcw = wxz - uSoilO.xy;
      vec2 ed = min(lcw, vec2(uSoilO.z) - lcw);
      float sf = smoothstep(1., 9., min(ed.x, ed.y)) * (1. - smoothstep(70., 105., dist));
      if (sf > 0.002) {
        vec2 tc = wxz / uSoilO.z + (vec2(vn2(gp * 6.), vn2(gp * 6. + 9.)) - .5) * 0.0004;   // a little noise on the lookup: ragged, natural edges
        float hf = 0.5 / 1024.;
        vec4 sxp = textureLod(uSoil, tc + vec2(hf, 0.), 0.), sxm = textureLod(uSoil, tc - vec2(hf, 0.), 0.), szp = textureLod(uSoil, tc + vec2(0., hf), 0.), szm = textureLod(uSoil, tc - vec2(0., hf), 0.);
        vec4 s0 = (sxp + sxm + szp + szm) * 0.25;
        if (s0.r + s0.g + s0.b + s0.a > 0.001) {
          dep = s0.r * 0.6 * sf; comp = s0.b * sf;
          float mnd = s0.a * 0.2 * sf;
          vec2 sgr = vec2((sxp.a - sxm.a) * 0.2 - (sxp.r - sxm.r) * 0.6, (szp.a - szm.a) * 0.2 - (szp.r - szm.r) * 0.6) / (uSoilO.z / 1024.) * sf;
          float torn = smoothstep(0.3, 0.7, s0.g + (vn2(gp * 5.) - .5) * 0.45 + (vn2(gp * 21.) - .5) * 0.25 * bl(21., pwg));
          bare = (uFlake < 1.5 ? torn : 0.) * sf;
          // real soil profile: dry crust, dark moist topsoil, ochre clay subsoil, pale parent material with grit. Wavy boundaries, so a pit wall shows strata.
          float sMixE = clamp(max(bare, uFlake < 1.5 ? smoothstep(0.03, 0.075, dep) : smoothstep(0.004, 0.02, dep)) + smoothstep(0.004, 0.025, mnd), 0., 1.);   // a rolling rut on grass stays grass (pressed); only a real hollow shows soil
          float dd = dep + (vn2(gp * 9. + 3.) - .5) * 0.03 + (vn2(gp * 2.) - .5) * 0.04;
          vec3 sc = mix(vec3(0.150, 0.104, 0.068), vec3(0.052, 0.034, 0.022), smoothstep(0., 0.05, dd));
          sc = mix(sc, vec3(0.205, 0.128, 0.066), smoothstep(0.13, 0.19, dd));
          sc = mix(sc, vec3(0.30, 0.235, 0.15), smoothstep(0.32, 0.4, dd));
          sc *= 0.88 + 0.24 * vn2(gp * 0.35 + 41.);                                                  // patchy: the soil is never one colour
          vec2 lsl; float lh = soilH(gp, pwg, lsl);
          float nrs = 1. - smoothstep(10., 60., ddt);                                               // lumps and grit fade with distance (they average out, no shimmer)
          float fresh = smoothstep(0.004, 0.025, mnd);                                               // spoil thrown out of the pit: loose, dark, damp lumps
          float wet = clamp(smoothstep(0.03, 0.2, dep) * 0.75 + fresh * 0.55 + smoothstep(0.1, 0.35, dep) * 0.2, 0., 1.);
          sc *= mix(0.62, 1.38, lh);                                                                 // crevices dark, lump tops light
          sc = mix(sc, sc * vec3(1.3, 1.22, 1.1), smoothstep(0.55, 0.9, lh) * (1. - wet) * 0.5);     // dried crumb tops
          sc = mix(sc, vec3(0.058, 0.038, 0.026) * (0.65 + 0.7 * lh), fresh * 0.65);
          sc *= 1. - 0.38 * wet;                                                                     // damp soil is darker
          float pshade; float pc = pebbles(gp, pwg, pshade) * nrs * (1. - smoothstep(0.1, 0.3, mnd));
          sc = mix(sc, mix(vec3(0.085, 0.075, 0.065), vec3(0.34, 0.29, 0.22), pshade), pc);
          N = normalize(N + vec3(-lsl.x, 0., -lsl.y) * (1.9 * nrs) * sMixE);
          sc *= 1. - 0.35 * 4. * sMixE * (1. - sMixE);                                               // torn sod edge: dark wet roots where the turf ends
          sMix = sMixE;
          albedo = mix(albedo, sc, sMix);
          albedo *= 1. - 0.2 * comp * (1. - sMix) - 0.16 * comp * sMix;                              // pressed grass / pressed soil is a little darker
          albedo = mix(albedo, albedo * vec3(0.86, 0.96, 0.72), comp * 0.5 * (1. - sMix));
          N = normalize(N + vec3(-sgr.x, 0., -sgr.y));
          ao *= 1. - 0.6 * smoothstep(0.015, 0.3, dep);
          rough = mix(rough, mix(0.92, 0.6, wet * (1. - pc)), sMix);
        }
      }
    }
    // real 3D relief up close (fades out with distance): lawn blades and tufts, soil clods and furrows with damp glossy patches, paver joints
    float rl = (1. - smoothstep(4., 45., ddt)) * (1. - 0.8 * comp);
    if (uFlake > 0.5 && rl > 0.01) {
      float h0 = relief(gp, uFlake, pwg), e = 0.004;
      float hx = relief(gp + vec2(e, 0.), uFlake, pwg), hz = relief(gp + vec2(0., e), uFlake, pwg);
      float amp = uFlake < 1.5 ? 0.9 : uFlake < 2.5 ? 1.5 : 1.2;
      N = normalize(N + vec3(h0 - hx, 0., h0 - hz) * amp * rl * 3. * (1. - sMix));
      if (uFlake < 1.5) {
        // meadow: rich emerald, clover patches and sun-dried blade tips, tuft by tuft
        float dry = smoothstep(.55, .8, vn2(gp * 0.9 + 3.)), clov = smoothstep(.6, .75, vn2(gp * 1.6 + 11.)), tuft = vn2(gp * 5.3);
        vec3 gA = albedo * (1. + (h0 - .5) * 0.34 * rl) * mix(vec3(0.9, 1.1, 0.84), vec3(1.2, 1.04, 0.62), dry * (0.35 + 0.65 * h0));
        gA = mix(gA, gA * vec3(0.8, 1.2, 0.9), clov * 0.5 * rl);
        gA *= 0.88 + 0.24 * tuft * rl + 0.12 * (1. - rl);
        albedo = mix(gA, albedo, sMix);
        // wildflowers: sparse little blossoms in patches (white, yellow, pink, violet, orange), only where the pixels can resolve them
        float wfp = smoothstep(.62, .8, vn2(gp * 0.05 + 31.)) * bl(24., pwg) * (1. - sMix);
        if (wfp > 0.01) {
          vec2 fcl = gp * 8., fi = floor(fcl), ff = fract(fcl) - .5;
          if (h21(fi + 7.) > 0.86) {
            vec2 fo = (vec2(h21(fi + 1.3), h21(fi + 5.7)) - .5) * 0.5;
            float fm = (1. - smoothstep(0.035, 0.07, length(ff - fo))) * wfp, ci = h21(fi + 11.);
            vec3 fcol = ci < 0.3 ? vec3(0.85, 0.83, 0.74) : ci < 0.55 ? vec3(0.9, 0.62, 0.04) : ci < 0.75 ? vec3(0.8, 0.18, 0.35) : ci < 0.9 ? vec3(0.3, 0.15, 0.6) : vec3(0.9, 0.3, 0.03);
            albedo = mix(albedo, fcol, fm);
          }
        }
      }
      else if (uFlake < 2.5) {
        float damp = smoothstep(.5, .75, vn2(gp * 0.16 + 4.));
        albedo *= (0.82 + 0.36 * h0) * mix(1., 0.72, damp * rl);
        rough = mix(0.9, 0.68, damp);
      } else { albedo *= 1. - 0.3 * smoothstep(.45, .5, max(abs(fract(gp * 0.8).x - .5), abs(fract(gp * 0.8).y - .5))) * rl; }
    }
  } else if (uKind == 9) {
    // bark: vertical fissures and ridges, a little darker in the cracks
    vec3 wb = vWorldMod; float bu = (wb.x + wb.z) * 38.;
    float b0 = vn2(vec2(bu, wb.y * 3.2)) * 0.6 + vn2(vec2(bu * 2.3, wb.y * 7.)) * 0.4;
    float nb = 1. - smoothstep(6., 50., ddt);
    albedo = uBase * vCol * (0.7 + 0.6 * b0 * (0.4 + 0.6 * nb) + 0.3 * (1. - nb) * 0.5);
    vec3 tB = normalize(vec3(vNrm.z, 0., -vNrm.x) + vec3(1e-4, 0., 0.));
    float bx = vn2(vec2(bu + 0.02 * 38., wb.y * 3.2)) * 0.6 + vn2(vec2((bu + 0.02 * 38.) * 2.3, wb.y * 7.)) * 0.4;
    N = normalize(N + tB * (b0 - bx) * 2.2 * nb);
    rough = 0.95; metal = 0.; coat = 0.;
  } else if (uKind == 10 || uKind == 11) {
    // foliage: alpha-cut leaf cards from the atlas. Double-sided; crown-outward normals light the whole canopy softly; vertex colour carries the canopy
    // ambient occlusion (dark inside, bright tips); sunlight glows through the leaves (translucency) and the shaded side still gets some transmitted light.
    N = normalize(vNrm);
    vec3 wl = vWorldMod;
    float lf = vn2(wl.xz * 7. + wl.y * 5.) * 0.6 + vn2(wl.xy * 15. + wl.z * 9.) * 0.4;
    float nl = 1. - smoothstep(10., 70., ddt);
    vec3 tint = vCol;
    if (uKind == 11) tint = vec3(1.0 * (0.88 + 0.24 * fract(sin(dot(vCol.xy, vec2(12.9898, 78.233))) * 43758.5453)));   // pictures: painted shading is already in the texture, only a per-tree brightness varies
    albedo = tx.rgb * uBase * tint * (1. + (lf - .5) * 0.3 * nl);
    ao = mix(0.55, 1., smoothstep(-0.7, 0.45, N.y));
    float dayL = smoothstep(0., 0.18, uSunDir.y);
    float back = pow(max(dot(viewDir, uSunDir), 0.), 2.5);
    float thru = max(-dot(N, uSunDir), 0.);
    emis += albedo * (vec3(0.78, 0.7, 0.16) * back * 0.45 + vec3(0.5, 0.62, 0.14) * thru * 0.2) * dayL;
    N = normalize(N + vec3(lf - .5, 0., (lf - .5) * 0.7) * 0.18 * nl);
    rough = 0.82; metal = 0.; coat = 0.;
  } else if (uKind == 12) {
    // fruit skin, drawn on the fly from the lathe coordinates: vUv.x = around, vUv.y = along the axis; vTile = type*4096 + seed + weight; vCol = the base skin colour (ripeness already in it)
    float ft = floor(vTile / 4096. + 0.001), sd = floor(vTile - ft * 4096.) * 0.731;
    float fw = max(length(dUx), length(dUy)) + 1e-5;
    float fa = 1. - smoothstep(0.25, 0.7, 40. * fw), fb = 1. - smoothstep(0.25, 0.7, 12. * fw), fc = 1. - smoothstep(0.25, 0.7, 90. * fw);
    vec3 sk = vCol;
    N = normalize(vNrm); if (!front) N = -N;
    rough = 0.5; metal = 0.; coat = 0.;
    if (ft < 3.5) {
      // apple: long vertical streaks of red over yellow-green, pale lenticel dots, waxy sheen
      float st = vn2(vec2(vUv.x * 46., vUv.y * 2.6 + sd)) * 0.6 + vn2(vec2(vUv.x * 120., vUv.y * 5. + sd * 2.)) * 0.4;
      sk *= 1. + (st - 0.5) * 0.55 * fa;
      float ld = vn2(vec2(vUv.x * 90., vUv.y * 60. + sd));
      sk = mix(sk, vec3(0.86, 0.78, 0.5) * dot(sk, vec3(0.5)) * 1.9, smoothstep(0.86, 0.95, ld) * 0.45 * fc);
      sk *= 0.92 + 0.12 * smoothstep(0.0, 0.12, vUv.y) ;
      rough = 0.28 + 0.08 * st;
    } else if (ft < 4.5) {
      // mango: smooth, a faint powdery bloom, tiny pale speckles, blush and green streaks from the base colour
      float st = vn2(vec2(vUv.x * 30., vUv.y * 4. + sd));
      sk *= 1. + (st - 0.5) * 0.22 * fa;
      float ld = vn2(vec2(vUv.x * 110., vUv.y * 70. + sd));
      sk = mix(sk, sk * 1.25 + vec3(0.04, 0.035, 0.0), smoothstep(0.84, 0.95, ld) * 0.5 * fc);
      rough = 0.38;
    } else if (ft < 5.5) {
      // coconut: green husk with long fibres, dull
      float fb2 = vn2(vec2(vUv.x * 70., vUv.y * 5. + sd)) * 0.55 + vn2(vec2(vUv.x * 190., vUv.y * 11.)) * 0.45;
      sk *= 0.78 + 0.5 * mix(0.5, fb2, fa);
      rough = 0.88;
    } else {
      float st = vn2(vec2(vUv.x * 40., vUv.y * 30. + sd));
      sk *= 1. + (st - 0.5) * 0.3 * fa;
      rough = ft < 6.5 ? 0.36 : 0.5;
    }
    albedo = uBase * sk;
    ao = mix(0.7, 1., smoothstep(-0.8, 0.4, N.y));
  } else if (uKind == 6) {
    // textured standard
    albedo = tx.rgb * uBase * vCol;
    // atlas cells with real surface physics: glass (2,1), brushed metal (1,2), marble (0,3), brass (3,3), fluted panel (2,3)
    vec2 cell = tiled ? acell : floor(vUv * 4.);
    if (cell.x == 2. && cell.y == 1.) { albedo = vCol * 0.62; metal = 0.9; rough = 0.02; }
    else if (cell.x == 1. && cell.y == 2.) { metal = 0.85; rough = 0.3; }
    else if (cell.x == 3. && cell.y == 3.) { metal = 0.9; rough = 0.25; }
    else if (cell.x == 0. && cell.y == 3.) { metal = 0.0; rough = 0.16; coat = 0.0; }
    else if (cell.x == 2. && cell.y == 3.) { rough = 0.45; }
    else if (cell.x == 3. && cell.y == 2.) {
      // clean modern finish (painted white / smooth render): satin, almost no bump, no grime streaks, only a very faint tonal breath
      rough = 0.35;
      float nr2 = 1. - smoothstep(4., 28., ddt);
      vec3 wp2 = vWorldMod;
      vec2 sp2 = abs(vNrm.y) > 0.7 ? wp2.xz : vec2(wp2.x * abs(vNrm.z) + wp2.z * abs(vNrm.x), wp2.y);
      float h1 = vn2(sp2 * 46.);
      albedo *= 1. + 0.008 * (h1 - .5) * nr2;
      float e2 = 0.0035, hx2 = vn2((sp2 + vec2(e2, 0.)) * 46.), hy2 = vn2((sp2 + vec2(0., e2)) * 46.);
      vec3 tN2 = normalize(vec3(vNrm.z, 0., -vNrm.x) + vec3(1e-4, 0., 0.));
      N = normalize(N + (tN2 * (h1 - hx2) + vec3(0., 1., 0.) * (h1 - hy2)) * 0.03 * nr2);
    }
    else {
      // paint / plaster / brick / concrete: real surface character. Roller-coat grain and roughcast bumps close up, soft blotches and long vertical
      // weathering streaks at mid range, so a wall never looks like a flat colour fill.
      vec3 wp = vWorldMod;
      vec2 sp = abs(vNrm.y) > 0.7 ? wp.xz : vec2(wp.x * abs(vNrm.z) + wp.z * abs(vNrm.x), wp.y);
      float nr = 1. - smoothstep(4., 28., ddt), md = 1. - smoothstep(25., 130., ddt);
      float wad = 0.;
      // each layer only where it is visible: grain and roughcast bumps inside 28 m, blotches and streaks inside 130 m (the noise is not even evaluated outside)
      if (md > 0.004) {
        float g2 = vn2(sp * 9.), g3 = vn2(vec2(sp.x * 1.6, sp.y * 0.2));
        // old walls are not all equally grimy: a slow patchwork (per ~9 m of wall) decides how much staining a stretch carries
        float wv = mix(0.3, 1., smoothstep(.3, .7, vn2(vec2(wp.x * 0.11 + wp.z * 0.17, wp.y * 0.07 + 3.1))));
        wad = (0.06 * (g2 - .5) * md - 0.12 * (g3 - .45) * md) * wv;
      }
      if (nr > 0.004) {
        float g1 = vn2(sp * 46.);
        wad += 0.02 * (g1 - .5) * nr;
        vec3 tN = normalize(vec3(vNrm.z, 0., -vNrm.x) + vec3(1e-4, 0., 0.));
        float e = 0.0035, hx = vn2((sp + vec2(e, 0.)) * 46.), hy = vn2((sp + vec2(0., e)) * 46.);
        N = normalize(N + (tN * (g1 - hx) + vec3(0., 1., 0.) * (g1 - hy)) * 0.45 * nr);
      }
      albedo *= 1. + wad;
    }
  }

  float NdV = max(dot(N, Vv), 1e-3);
  vec3 F0 = mix(vec3(0.04), albedo, metal);
  vec3 diffCol = albedo * (1. - metal);
  float a = max(rough*rough, 0.002);
  float NdL = max(dot(N, uSunDir), 0.);
  float sh = 1.;
  if (uShadowOn > 0.5) sh = shadowPCF(vShadow, dist);
  float sunVis = NdL * sh;
  vec3 H = normalize(uSunDir + Vv);
  float NdH = max(dot(N, H), 0.), VdH = max(dot(Vv, H), 0.);
  vec3 sunSpec = ggxD(NdH, a) * smithV(max(NdL,1e-3), NdV, a) * fresnel(F0, VdH) * NdL * sh;
  vec3 amb = mix(uGroundCol * 0.9, mix(uSkyHor, uSkyTop, 0.5), clamp(N.y*.5+.5, 0., 1.)) * uSkyI;
  amb *= ao;
  // soft ground bounce & skylight occlusion near the floor for cars
  vec3 col = diffCol * (uSunCol * sunVis / 3.14159 * 3.0 + amb * 0.95);
  col += uSunCol * sunSpec * 3.0;

  // dynamic lights (headlights, fire)
  for (int i=0;i<4;i++){
    if (i >= uNL) break;
    vec3 L = uLP[i].xyz - vPosRel;
    float d2 = dot(L,L), d = sqrt(d2);
    L /= max(d, 1e-3);
    float att = 1. / (1. + d2 / (uLP[i].w*uLP[i].w)) ;
    att *= att;
    float cone = uLD[i].w > -1.5 ? smoothstep(uLD[i].w, uLD[i].w + 0.12, dot(-L, uLD[i].xyz)) : 1.;
    float nl = max(dot(N, L), 0.);
    vec3 Hh = normalize(L + Vv);
    vec3 sp = ggxD(max(dot(N,Hh),0.), a) * smithV(max(nl,1e-3), NdV, a) * fresnel(F0, max(dot(Vv,Hh),0.)) * nl;
    col += (diffCol / 3.14159 * nl + sp) * uLC[i].rgb * att * cone * 8.;
  }

  vec3 R = reflect(viewDir, N);
  vec3 envF = fresnelR(F0, NdV, rough);
  vec3 env = skyEnv(R, rough);
  // horizon occlusion for downward-facing reflections on ground-hugging surfaces
  float so = clamp(0.35 + 0.65 * smoothstep(-0.25, 0.25, N.y + 0.5), 0., 1.);
  if (uKind == 4) so = 1.;
  col += env * envF * so * (uKind == 4 ? 0.35 : 1.0);

  if (uKind == 1 && coat > 0.0) {
    float cf = 0.04 + 0.96 * pow(1.-NdV, 5.);
    vec3 cenv = skyEnv(R, 0.11);   // a mirror-sharp horizon line bends with every triangle of the body mesh (wavy bands); a little blur keeps it a smooth curve
    vec3 cH = H;
    float cs = ggxD(NdH, 0.045) * smithV(max(NdL,1e-3), NdV, 0.045) * cf * NdL * sh;
    col = col * (1. - cf*coat) + (cenv * cf * so + uSunCol * cs * 3.) * coat;
  }

  if (uKind == 2) {
    // glass: tinted, reflective, cracked
    float dmg = 1. - vCol.r;
    float cf = 0.04 + 0.96 * pow(1.-NdV, 4.);
    vec3 cenv = skyEnv(R, 0.01);
    float sp2 = ggxD(NdH, 0.02) * smithV(max(NdL,1e-3), NdV, 0.02) * 0.04 * NdL * sh;
    float crack = 0.;
    if (dmg > 0.03) {
      float cid;
      float e = vor(vLocal * 14., cid);
      float line = 1. - smoothstep(0.0, 0.07 + 0.05*(1.-dmg), e);
      float cells = vor(vLocal * (3. + dmg*5.), cid);
      float line2 = 1. - smoothstep(0.0, 0.035, cells);
      crack = clamp(line * dmg * 1.6 + line2 * dmg, 0., 1.) * smoothstep(0.03, 0.3, dmg);
      crack = max(crack, dmg * 0.25);
    }
    vec3 base = uBase + vec3(0.7) * crack;
    float al = clamp(alpha + cf*(1.-alpha) + crack*0.85, 0., 1.);
    vec3 refl = cenv * (cf + 0.05) + uSunCol * sp2 * 3.;
    vec3 c = base * al * (amb * 0.8 + uSunCol * sunVis * 0.25) * (crack > 0. ? 1.5 : 0.) + refl * (1. + crack);
    c = fogApply(c, dist, viewDir);
    outCol = vec4(finish(c), al);
    // premultiplied: color already mixes; scale by alpha
    outCol.rgb *= 1.0;
    return;
  }

  if (uKind == 8) {
    // window glass: clear and lightly tinted, only a faint sky reflection (more at grazing angles), a small sun glint. The room behind shows through.
    float cf = pow(1. - NdV, 4.);
    float al = clamp(uAlpha + cf * 0.35, 0., 0.8);
    vec3 tintLit = albedo * 0.55 * (amb * 0.9 + uSunCol * sunVis * 0.06);
    vec3 tintD = pow(aces(tintLit * 0.62), vec3(1. / 2.2));
    vec3 skyD = pow(aces(skyEnv(R, 0.2) * 0.62), vec3(1. / 2.2));
    vec3 reflD = skyD * (0.045 + 0.40 * cf);
    float glint = ggxD(NdH, 0.05) * smithV(max(NdL,1e-3), NdV, 0.05) * 0.04 * NdL * sh;
    // evenings: some windows glow warm from inside
    float lit = step(0.62, h21(floor(vWorldMod.xz * 0.35) + floor(vWorldMod.y / 3.2) * 7.3));
    vec3 glow = vec3(1.0, 0.78, 0.5) * lit * uNight * 0.55;
    // curtain-wall / ribbon glazing (the heavier 'glass' tint): slim dark aluminium mullions every 1.5 m so a long band reads as real glazing, not one slab
    if (uAlpha > 0.4) {
      vec3 wq = vWorldMod; float tq = wq.x * abs(vNrm.z) + wq.z * abs(vNrm.x);
      float mq = 1. - smoothstep(0.02, 0.05, abs(fract(tq / 1.5 + 0.5) - 0.5) * 1.5);
      reflD *= 0.75 + 0.5 * fract(wq.y / 3.2);
      vec3 c0 = tintD * al + reflD + glint * uSunCol * 3. + glow * al;
      c0 = mix(c0, vec3(0.06, 0.065, 0.07), mq * 0.92); al = mix(al, 0.97, mq);
      vec3 c = c0;
      float dd2 = 1. - exp(-dist * uFogD);
      c = c * (1. - dd2) + pow(aces(uFogCol * 0.62), vec3(1. / 2.2)) * dd2 * al;
      outCol = vec4(c, al);
    } else {
    vec3 c = tintD * al + reflD + glint * uSunCol * 3. + glow * al;
    float dd = 1. - exp(-dist * uFogD);                       // distant glass fades into the haze together with the wall around it
    c = c * (1. - dd) + pow(aces(uFogCol * 0.62), vec3(1. / 2.2)) * dd * al;
    outCol = vec4(c, al);
    }
    return;
  }

  if (uDbg > 0.5) { outCol = vec4(vec3(sh), 1.); if (uDbg > 1.5) { vec3 pp = vShadow.xyz/vShadow.w*0.5+0.5; outCol = vec4(pp, 1.);} return; }
  col += emis;
  col = fogApply(col, dist, viewDir);
  outCol = vec4(finish(col), 1.);
}`;

export const VS_SHADOW = /* glsl */ `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uLightVP, uModel;
void main(){ gl_Position = uLightVP * (uModel * vec4(aPos, 1.)); }`;
export const FS_SHADOW = /* glsl */ `#version 300 es
precision mediump float;
void main(){}`;
// alpha-tested shadow for leaf cards: the shadow has the leaf shapes in it
export const VS_SHADOW_A = /* glsl */ `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=3) in vec2 aUv;
uniform mat4 uLightVP, uModel;
out vec2 vUv;
void main(){ vUv = aUv; gl_Position = uLightVP * (uModel * vec4(aPos, 1.)); }`;
export const FS_SHADOW_A = /* glsl */ `#version 300 es
precision mediump float;
uniform sampler2D uTex;
in vec2 vUv;
void main(){ if (texture(uTex, vUv).a < 0.42) discard; }`;

export const VS_SKY = /* glsl */ `#version 300 es
uniform mat4 uInvVP;
out vec3 vDir;
void main(){
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vec2 ndc = p * 2. - 1.;
  vec4 w = uInvVP * vec4(ndc, 1., 1.);
  vDir = w.xyz / w.w;
  gl_Position = vec4(ndc, 1., 1.);
}`;
export const FS_SKY = /* glsl */ `#version 300 es
precision highp float;
in vec3 vDir;
out vec4 outCol;
uniform float uCloud;
${COMMON_ENV}
void main(){
  vec3 d = normalize(vDir);
  vec3 c = skyEnv(d, 0.);
  // sun disc
  float sd = dot(d, uSunDir);
  c += uSunCol * smoothstep(0.99955, 0.99985, sd) * 40. * uSkyI * step(0., d.y + 0.02);
  // clouds
  if (d.y > 0.0) {
    vec2 cp = d.xz / (d.y + 0.12) * 0.55 + vec2(uTime * 0.004, 0.);
    float cl = fbm2(cp * 1.3);
    float cov = smoothstep(0.62 - uCloud*0.25, 0.95, cl);
    float shade = 0.55 + 0.45 * smoothstep(0.4, 0.9, fbm2(cp*1.3 + vec2(sd*0.3)));
    vec3 cc = mix(uSkyHor*1.05, uSunCol*0.9 + uSkyHor*0.3, 0.45) * shade * uSkyI;
    float fade = smoothstep(0., 0.2, d.y);
    c = mix(c, cc, cov * fade * (0.55 + uCloud*0.35));
  }
  // stars at night
  if (uNight > 0.01 && d.y > 0.) {
    vec2 sp = d.xz / (d.y + 0.3) * 60.;
    vec2 g = floor(sp);
    float r = h21(g);
    vec2 f = fract(sp) - 0.5;
    float star = step(0.985, r) * smoothstep(0.35, 0., length(f));
    c += vec3(star) * uNight * 1.2 * smoothstep(0., 0.25, d.y);
  }
  // distance fog haze at horizon
  float hz = exp(-max(d.y, 0.) * 14.);
  c = mix(c, uFogCol, hz * 0.55);
  outCol = vec4(finish(c), 1.);
}`;

// billboards / sparks: premultiplied alpha, soft circular sprites computed procedurally
export const VS_PART = /* glsl */ `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUv;
layout(location=2) in vec4 aCol;
layout(location=3) in vec2 aSeed;
uniform mat4 uVP;
out vec2 vUv; out vec4 vCol; out vec2 vSeed; out float vDist;
void main(){ vUv = aUv; vCol = aCol; vSeed = aSeed; vDist = length(aPos); gl_Position = uVP * vec4(aPos, 1.); }`;
export const FS_PART = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv; in vec4 vCol; in vec2 vSeed; in float vDist;
out vec4 outCol;
uniform float uMode; // 0 smoke, 1 fire/glow(additive), 2 spark(streak), 3 solid chip
uniform vec3 uLightCol;
${COMMON_ENV}
void main(){
  vec2 p = vUv * 2. - 1.;
  float r = length(p);
  float a;
  vec3 c = vCol.rgb;
  if (uMode < 0.5) {
    float n = vn2(p * 2.2 + vSeed * 17.);
    float n2 = vn2(p * 5. + vSeed * 31.);
    a = smoothstep(1., 0.15, r + (n - .5) * 0.55 + (n2 - .5) * 0.2);
    a *= vCol.a;
    c *= (0.75 + 0.5 * n) * (uSkyI * 0.4 + 0.28) * (uSunCol * 0.4 + 0.6);
    c = pow(c / (1. + c * 0.25), vec3(1./2.2));   // gamma on the straight colour, then premultiply (low alpha stays dark, not glowing)
    outCol = vec4(c * a, a);
  } else if (uMode < 1.5) {
    float n = vn2(p * 2.5 + vSeed * 13. + uTime * 4.);
    a = smoothstep(1., 0., r + (n - .5) * 0.5);
    a = a * a * vCol.a;
    outCol = vec4(c * a * 2.0, 0.);
  } else if (uMode < 2.5) {
    float u = abs(p.x);
    a = smoothstep(1., 0.2, abs(p.y)) * smoothstep(1., 0.0, u);
    a *= vCol.a;
    outCol = vec4(c * a * 3., 0.);
  } else if (uMode < 3.5) {
    a = step(r, 0.95) * vCol.a;
    float lit = 0.5 + 0.5 * max(dot(normalize(vec3(p, 0.7)), uSunDir), 0.);
    c = c * lit * (uSkyI * 0.5 + uSunCol.r * 0.5);
    c = pow(c / (1. + c * 0.25), vec3(1./2.2));
    outCol = vec4(c * a, a);
  } else {
    // falling leaf: a pointed oval that tumbles (one axis squashes and flips with time), midrib darker, lit like the chips
    float fl = 0.3 + 0.7 * abs(cos(uTime * 3.1 + vSeed.x * 40.));
    vec2 q = vec2(p.x, p.y / fl);
    float w = 0.46 * (1. - q.y * q.y);
    a = step(abs(q.x), w) * step(abs(q.y), 1.) * vCol.a;
    c *= 1. - 0.3 * smoothstep(0.1, 0., abs(q.x));
    float lit = 0.55 + 0.6 * max(dot(normalize(vec3(0., 0.6, 0.8)), uSunDir), 0.) * (0.6 + 0.4 * fl);
    c = c * lit * (uSkyI * 0.5 + uSunCol.r * 0.5);
    c = pow(c / (1. + c * 0.25), vec3(1./2.2));
    outCol = vec4(c * a, a);
  }
  if (uMode > 0.5 && uMode < 2.5) outCol.rgb = pow(outCol.rgb / (1. + outCol.rgb * 0.25), vec3(1./2.2));
  float f = 1. - exp(-vDist * uFogD);
  if (uMode < 0.5) outCol = mix(outCol, vec4(uFogCol * outCol.a, outCol.a), clamp(f, 0., 1.) * 0.7);
}`;

export const VS_DECAL = /* glsl */ `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUv;
layout(location=2) in vec4 aCol;
uniform mat4 uVP;
out vec2 vUv; out vec4 vCol; out float vDist;
void main(){ vUv = aUv; vCol = aCol; vDist = length(aPos); gl_Position = uVP * vec4(aPos, 1.); }`;
export const FS_DECAL = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv; in vec4 vCol; in float vDist;
out vec4 outCol;
uniform float uMode; // 0 skid strip, 1 soft blob, 2 light pool, 3 tread/grime
void main(){
  float a;
  if (uMode < 0.5) {
    a = smoothstep(0., 0.25, vUv.x) * smoothstep(1., 0.75, vUv.x);
    float s = fract(sin(dot(floor(vUv * vec2(1., 40.)), vec2(12.9898,78.233))) * 43758.5453);
    a *= 0.8 + 0.2 * s;
  } else if (uMode < 1.5) {
    float r = length(vUv * 2. - 1.);
    a = pow(smoothstep(1., 0., r), 1.6);
  } else {
    vec2 p = vUv * 2. - 1.;
    float r = length(p);
    a = smoothstep(1., 0., r); a *= a;
  }
  a *= vCol.a * (1. - smoothstep(300., 900., vDist));
  if (uMode > 1.5 && uMode < 2.5) outCol = vec4(vCol.rgb * a, 0.);
  else outCol = vec4(vCol.rgb * a, a);
}`;

// ---------------------------------------------------------------- real grass: instanced tufts rooted in the soil
// One draw call per layer. Nothing is stored per tuft: instance id -> an absolute 2D cell index -> hashes give position, height class, blade fan and colour, so the same tuft is
// always at the same place however the camera moves. The soil field decides what is left of it: gone where the grass is torn off, in a pit, under spoil or outside the deformable
// lawn; flattened and leaning where the tyres pressed it; the ground height (pits, heaps) lifts and sinks the root. Blades are 5-vertex strips (base, middle, tip), wind-bent.
export const VS_GRASS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;
layout(location=0) in vec4 aB;           // x, y = blade root in the tuft disc, z = blade index, w = vertex 0..4 (baseL, baseR, midL, midR, tip)
uniform mat4 uVP, uLightVP;
uniform vec3 uEye;                       // true eye position
uniform vec4 uG;                         // cell size, cells per side, origin cell x, origin cell z
uniform vec4 uC;                         // window centre x, z, half size, layer (0 = near, 1 = far ring)
uniform vec4 uC0;                        // near window centre x, z, half size, blade count
uniform vec4 uP;                         // density, height scale, pixel size per metre of distance, bend
uniform vec4 uSoilO;
uniform vec4 uCarA[6], uCarB[6];         // cars near the eye: centre x, z, forward x, z / half length, half width (tufts under a body are pressed flat)
uniform float uNCars;
uniform sampler2D uSoil, uMeta;
${COMMON_ENV}
out vec3 vCol; out vec3 vPosRel; out vec3 vN; out vec4 vShadow; out float vT;
void collapse(){ gl_Position = vec4(2., 2., 2., 1.); vCol = vec3(0.); vPosRel = vec3(0.); vN = vec3(0., 1., 0.); vShadow = vec4(0.); vT = 0.; }
void main(){
  // instance id -> cell through a multiplicative permutation, so drawing only the first k instances thins the grass evenly everywhere (the density governor)
  float n = uG.y;
  uint pid = (uint(gl_InstanceID) * 2531u) % uint(n * n);
  float id = float(pid);
  vec2 cell = vec2(uG.z + mod(id, n), uG.w + floor(id / n));
  float h1 = h21(cell * 0.731 + 1.7), h2 = h21(cell * 1.371 + 5.3), h3 = h21(cell * 2.113 + 9.1), h4 = h21(cell * 0.337 + 13.7), h5 = h21(cell * 1.913 + 21.3);
  vec2 pos = (cell + vec2(h1, h2)) * uG.x;
  // window weights: the near grid fades out toward its border, the far ring fades in there (and out at its own border), so layers cross-fade without a seam
  vec2 d0 = abs(pos - uC0.xy) / uC0.z, d1 = abs(pos - uC.xy) / uC.z;
  float c0 = max(d0.x, d0.y), c1 = max(d1.x, d1.y);
  float lay = uC.w;                                                                      // 0 near, 1 far ring, 2 dense short turf right round the eye
  float w = lay < 0.5 ? 1. - smoothstep(0.76, 1., c0) : lay < 1.5 ? smoothstep(0.76, 1., c0) * (1. - smoothstep(0.8, 1., c1)) : 1. - smoothstep(0.7, 1., c1);
  float dens = 0.62 + 0.38 * vn2(pos * 0.35 + 7.);                    // bald-ish and thick patches
  float bi = aB.z;
  if (w < 0.01 || h5 > dens || bi >= uC0.w) { collapse(); return; }
  vec2 tc = pos / uSoilO.z;
  vec4 sv = textureLod(uSoil, tc, 0.);
  float meta = textureLod(uMeta, tc, 0.).r;
  float dep = sv.r * 0.6, mound = sv.a * 0.2, torn = sv.g, comp = sv.b;
  float vis = step(0.5, meta) * (1. - smoothstep(0.22, 0.62, torn)) * (1. - smoothstep(0.01, 0.032, dep)) * (1. - smoothstep(0.008, 0.026, mound));
  // height classes: mostly short (3-8 cm), some medium, a few tall tufts (16-30 cm)
  float hgt = h3 < 0.7 ? 0.035 + 0.045 * h4 : h3 < 0.93 ? 0.08 + 0.07 * h4 : 0.16 + 0.14 * h4;
  if (lay > 1.5) hgt = h3 < 0.88 ? 0.02 + 0.03 * h4 : 0.05 + 0.05 * h4;               // the carpet: short turf, mostly 2-5 cm
  hgt *= uP.y * (lay > 0.5 && lay < 1.5 ? 1.35 : 1.);
  float pressed = clamp(comp * 1.25, 0., 1.);
  for (int ci = 0; ci < 6; ci++) {
    if (float(ci) >= uNCars) break;
    vec2 dc = pos - uCarA[ci].xy; float al = dot(dc, uCarA[ci].zw), ac = dot(dc, vec2(-uCarA[ci].w, uCarA[ci].z));
    vec2 ex = vec2(uCarB[ci].x + 0.04, uCarB[ci].y + 0.04) - abs(vec2(al, ac));
    pressed = max(pressed, smoothstep(-0.1, 0.12, min(ex.x, ex.y)) * 0.95);        // under the body the blades are held down
  }
  float H = hgt * w * vis * (1. - 0.78 * pressed);
  if (H < 0.004) { collapse(); return; }
  float gy = 0.0045 + mound - dep - 0.012;               // rooted a little below the surface
  float k = bi + 1.;
  float bs = h21(vec2(k * 3.17 + h1 * 11., h2 * 7. + k));                 // per blade
  float bs2 = h21(vec2(k * 1.91 + h3 * 13., h4 * 5. + k * 2.3));
  float a = (bi + bs * 0.8) / uC0.w * 6.28318 + h1 * 6.28318;
  vec2 dir = vec2(cos(a), sin(a));
  float rt = (lay < 0.5 ? 0.04 : lay < 1.5 ? 0.06 : 0.022) * (0.5 + h4) * (0.35 + 0.65 * fract(bs * 5.7 + 0.3));
  vec3 root = vec3(pos.x + dir.x * rt, gy, pos.y + dir.y * rt);
  float bh = H * (0.55 + 0.45 * bs2);
  float lean = (0.18 + 0.5 * bs) * bh + pressed * 0.55 * bh;           // blades splay outward; pressed grass lies down
  float gust = sin(uTime * 1.6 + pos.x * 0.31 + pos.y * 0.23) * 0.5 + sin(uTime * 3.4 + pos.x * 0.9 + h1 * 40.) * 0.18;
  vec2 wind = vec2(0.9, 0.5) * gust * bh * 0.32;
  float dist = length(root - vec3(uEye.x, root.y, uEye.z)) + 0.3;
  float pix = dist * uP.z;
  float bw = max((lay > 1.5 ? 0.0011 : 0.0016) + 0.011 * bh, 0.55 * pix); bw = min(bw, 0.03);
  vec2 side = vec2(-dir.y, dir.x);
  float t = aB.w < 1.5 ? 0. : aB.w < 3.5 ? 0.5 : 1.;
  float taper = t < 0.1 ? 1. : t < 0.9 ? 0.72 : 0.;
  vec2 off = (dir * lean + wind) * t * t;                            // bend grows with height squared
  float ty = bh * (t < 0.1 ? 0. : t < 0.9 ? 0.55 : 0.96);
  float sd = (mod(aB.w, 2.) < 0.5 ? -1. : 1.) * bw * taper * (aB.w > 3.5 ? 0. : 1.);
  vec3 pw = root + vec3(off.x + side.x * sd, ty, off.y + side.y * sd);
  vec3 rel = pw - vec3(uEye.x, 0., uEye.z); rel.y = pw.y - uEye.y;
  vPosRel = rel;
  vT = t;
  vN = normalize(mix(vec3(0., 1., 0.), normalize(vec3(dir.x, 0.35, dir.y)), 0.5));
  // colour: dark root to bright tip, per-tuft hue; follows the ground's dry patches
  float dry = smoothstep(.55, .8, vn2(pos * 0.9 + 3.));
  vec3 green = mix(vec3(0.045, 0.095, 0.026), vec3(0.075, 0.15, 0.04), h4);
  vec3 tipG = mix(vec3(0.13, 0.28, 0.06), vec3(0.19, 0.35, 0.07), h1);
  vec3 tipD = vec3(0.34, 0.30, 0.10);
  vec3 tip = mix(tipG, tipD, clamp(dry * (0.35 + 0.65 * h2) + smoothstep(0.7, 1., hgt * 3.2) * 0.25, 0., 0.9));
  vCol = mix(green, tip, smoothstep(0.0, 1.0, t)) * (0.85 + 0.3 * bs);
  vShadow = uLightVP * vec4(rel + vec3(0., 0.03, 0.), 1.);
  gl_Position = uVP * vec4(rel, 1.);
}`;
export const FS_GRASS = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vCol; in vec3 vPosRel; in vec3 vN; in vec4 vShadow; in float vT;
out vec4 outCol;
uniform sampler2DShadow uShadowMap;
uniform float uShadowOn;
${COMMON_ENV}
void main(){
  vec3 Vv = normalize(-vPosRel);
  float dist = length(vPosRel);
  vec3 N = normalize(vN);
  float sh = 1.;
  if (uShadowOn > 0.5) {
    vec3 p = vShadow.xyz / vShadow.w * 0.5 + 0.5;
    if (p.z < 1. && p.x > 0. && p.x < 1. && p.y > 0. && p.y < 1.) {
      vec2 e = min(p.xy, 1. - p.xy);
      sh = mix(1., texture(uShadowMap, vec3(p.xy, p.z - 0.0004)), smoothstep(0., 0.08, min(e.x, e.y)));
    }
  }
  float ndl = max(dot(N, uSunDir), 0.);
  float ao = 0.42 + 0.58 * vT;                                    // the base of the tuft is shaded by its own blades
  vec3 amb = mix(uGroundCol * 0.9, mix(uSkyHor, uSkyTop, 0.5), clamp(N.y * .5 + .5, 0., 1.)) * uSkyI * ao;
  float back = pow(max(dot(-Vv, uSunDir), 0.), 2.5) * vT * 0.55;    // sun shining through thin blades toward the eye
  vec3 col = vCol * (uSunCol * (ndl * 0.8 + 0.2) * sh / 3.14159 * 3.0 + amb * 0.95) + vCol * vec3(0.8, 0.78, 0.2) * uSunCol * back * sh * 0.5;
  col = fogApply(col, dist, -Vv);
  outCol = vec4(finish(col), 1.);
}`;

// ---------- resolve pass: the scene is rendered into an offscreen texture at the governor's resolution, then drawn to the screen here.
// FXAA (edge-only: flat areas and textures are left alone) + a light sharpen that wins back the crispness lost in upscaling. uReg = used part of the texture (w/alloc), uPx = 1 texel.
export const VS_POST = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
export const FS_POST = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform vec2 uReg;
uniform vec2 uPx;
uniform float uAA;
uniform float uSharp;
out vec4 oColor;
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec2 lo = uPx * 0.5, hi = uReg - uPx * 0.5;
  vec2 uv = clamp(vUv * uReg, lo, hi);
  vec3 cM = texture(uScene, uv).rgb;
  if (uAA < 0.5 && uSharp < 0.001) { oColor = vec4(cM, 1.0); return; }
  vec3 cNW = texture(uScene, clamp(uv + vec2(-1.0, -1.0) * uPx, lo, hi)).rgb;
  vec3 cNE = texture(uScene, clamp(uv + vec2( 1.0, -1.0) * uPx, lo, hi)).rgb;
  vec3 cSW = texture(uScene, clamp(uv + vec2(-1.0,  1.0) * uPx, lo, hi)).rgb;
  vec3 cSE = texture(uScene, clamp(uv + vec2( 1.0,  1.0) * uPx, lo, hi)).rgb;
  float lM = lum(cM), lNW = lum(cNW), lNE = lum(cNE), lSW = lum(cSW), lSE = lum(cSE);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  float rng = lMax - lMin;
  if (uAA > 0.5 && rng >= max(0.0312, lMax * 0.125)) {
    vec2 dir;
    dir.x = -((lNW + lNE) - (lSW + lSE));
    dir.y =  ((lNW + lSW) - (lNE + lSE));
    float dirReduce = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
    float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
    dir = clamp(dir * rcpDirMin, vec2(-8.0), vec2(8.0)) * uPx;
    vec3 rgbA = 0.5 * (texture(uScene, clamp(uv + dir * (1.0 / 3.0 - 0.5), lo, hi)).rgb + texture(uScene, clamp(uv + dir * (2.0 / 3.0 - 0.5), lo, hi)).rgb);
    vec3 rgbB = rgbA * 0.5 + 0.25 * (texture(uScene, clamp(uv - dir * 0.5, lo, hi)).rgb + texture(uScene, clamp(uv + dir * 0.5, lo, hi)).rgb);
    float lB = lum(rgbB);
    oColor = vec4((lB < lMin || lB > lMax) ? rgbA : rgbB, 1.0);
    return;
  }
  // flat area / texture: a light unsharp mask against the four diagonal neighbours, clamped to their range so it can never ring
  vec3 avg = 0.25 * (cNW + cNE + cSW + cSE);
  vec3 mn = min(cM, min(min(cNW, cNE), min(cSW, cSE))), mx = max(cM, max(max(cNW, cNE), max(cSW, cSE)));
  oColor = vec4(clamp(cM + (cM - avg) * uSharp, mn, mx), 1.0);
}`;
