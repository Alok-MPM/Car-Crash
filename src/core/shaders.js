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
uniform mat4 uVP, uModel, uLightVP;
uniform vec3 uEyeMod;
uniform float uNBias;
out vec3 vPosRel, vNrm, vCol, vWorldMod, vLocal;
out vec2 vUv;
out vec4 vShadow;
void main(){
  vec4 p = uModel * vec4(aPos, 1.);
  vec3 n = normalize(mat3(uModel) * aNrm);
  vPosRel = p.xyz; vNrm = n; vCol = aCol; vUv = aUv; vLocal = aPos;
  vWorldMod = p.xyz + uEyeMod;
  vShadow = uLightVP * vec4(p.xyz + n * uNBias, 1.);
  gl_Position = uVP * p;
}`;

export const FS_MAIN = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vPosRel, vNrm, vCol, vWorldMod, vLocal;
in vec2 vUv;
in vec4 vShadow;
out vec4 outCol;
uniform sampler2DShadow uShadowMap;
uniform sampler2D uTex;
uniform float uShadowTexel, uShadowOn;
uniform int uKind;
uniform vec3 uBase, uEmis;
uniform float uMetal, uRough, uCoat, uAlpha, uTexOn, uTexScale, uFlake;
uniform vec4 uLP[4], uLD[4], uLC[4];
uniform int uNL;
uniform float uDbg;
${COMMON_ENV}

float shadowPCF(vec4 sc){
  vec3 p = sc.xyz / sc.w * 0.5 + 0.5;
  if (p.z >= 1. || p.x <= 0. || p.x >= 1. || p.y <= 0. || p.y >= 1.) return 1.;
  float s = 0.;
  float t = uShadowTexel;
  for (int i=-1;i<=1;i++) for (int j=-1;j<=1;j++)
    s += texture(uShadowMap, vec3(p.xy + vec2(float(i), float(j)) * t * 1.25, p.z - 0.00012));
  s /= 9.;
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

vec3 asphalt(vec3 wp, float dist, out float rough){
  vec2 p = wp.xz;
  float n1 = vn2(p*0.7), n2 = vn2(p*3.1), n3 = vn2(p*13.), n4 = vn2(p*41.);
  float g = 0.30 + 0.07*(n1-.5) + 0.05*(n2-.5)*(1.-smoothstep(60.,220.,dist)) + 0.07*(n3-.5)*(1.-smoothstep(12.,60.,dist)) + 0.09*(n4-.5)*(1.-smoothstep(4.,22.,dist));
  float pch = smoothstep(.55,.7,vn2(p*0.09));
  g += pch*0.03;
  rough = 0.82 - 0.1*pch;
  return vec3(g*0.95, g*0.96, g*1.0) * 0.36;
}

void main(){
  vec3 N = normalize(vNrm);
  bool front = gl_FrontFacing;
  if (!front) N = -N;
  vec3 Vv = normalize(-vPosRel);
  float dist = length(vPosRel);
  vec3 viewDir = -Vv;
  vec3 albedo = uBase * vCol;
  float metal = uMetal, rough = uRough, coat = uCoat;
  vec3 emis = uEmis;
  float alpha = 1.;
  float ao = 1.;
  vec4 tx = vec4(0.);
  if (uTexOn > 0.5) tx = texture(uTex, vUv);

  if (uKind == 4) {
    float r; albedo = asphalt(vWorldMod * uTexScale, dist, r) * uBase; rough = r; metal = 0.; coat = 0.;
    if (uTexOn > 0.5) { albedo = mix(albedo, tx.rgb * uBase, tx.a); }
  } else if (uKind == 1) {
    // car paint: tinted base with metallic flake + clear coat; decals/panel lines from texture
    float dmg = 1. - vCol.r;
    albedo = uBase * mix(vCol, vec3(0.16,0.13,0.11), clamp(dmg*1.2,0.,1.));
    if (uTexOn > 0.5) { albedo = mix(albedo, tx.rgb, tx.a); rough = mix(rough, 0.55, tx.a); coat *= (1.-tx.a); }
    rough = clamp(rough + dmg * 0.5, 0., 1.);
    coat *= (1. - clamp(dmg*1.5, 0., 1.));
    metal = metal * (1. - dmg);
    float fl = vn2(vLocal.xy*700.+vLocal.z*400.) * vn2(vLocal.zy*600.+7.);
    albedo *= 1. + (fl-.25) * uFlake * 0.35 * (1.-smoothstep(3.,12.,dist));
  } else if (uKind == 2) {
    albedo = uBase; alpha = uAlpha;
  } else if (uKind == 3) {
    albedo = vec3(0.); emis = uEmis * vCol;
  } else if (uKind == 5) {
    albedo = uBase * vCol; ao = 0.8 + 0.2 * smoothstep(0.,0.4,abs(vNrm.y));
  } else if (uKind == 6) {
    // textured standard
    albedo = tx.rgb * uBase * vCol;
  }

  float NdV = max(dot(N, Vv), 1e-3);
  vec3 F0 = mix(vec3(0.04), albedo, metal);
  vec3 diffCol = albedo * (1. - metal);
  float a = max(rough*rough, 0.002);
  float NdL = max(dot(N, uSunDir), 0.);
  float sh = 1.;
  if (uShadowOn > 0.5) sh = shadowPCF(vShadow);
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
    vec3 cenv = skyEnv(R, 0.03);
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
  } else {
    a = step(r, 0.95) * vCol.a;
    float lit = 0.5 + 0.5 * max(dot(normalize(vec3(p, 0.7)), uSunDir), 0.);
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
