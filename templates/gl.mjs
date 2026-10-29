// WebGL layers for the kit page (brand.backdrop, brand.wipe): a moving backdrop behind every scene and a wipe over
// every cut, in the brand colours. Each layer is its own canvas and context; every frame is a pure function of
// seek(t) (no clock, seeded noise), and engine/media.mjs opens such a page on SwiftShader, so a render gives the same
// pixels on every machine. A page without these brand fields gets none of this code.
import { BACKDROPS, WIPES } from '../engine/brand.mjs';

// Soft layers draw at a fraction of the frame and are scaled up: a gradient loses nothing and SwiftShader draws
// a quarter of the pixels. Lit shapes keep the full size so their edges stay sharp. engine/banner.mjs draws at the same fractions.
export const SCALE = { mesh: 0.5, aurora: 0.5, flow: 0.75, shapes: 1, liquid: 0.5, iris: 0.5, burn: 0.5, glitch: 0.5, flash: 0.5 };

/** The WebGL layers a page draws, or null: none on a transparent overlay, and a wipe only where there is a cut. */
export function glLayers(brand, transparent, sceneCount) {
  if (transparent) return null;
  const backdrop = BACKDROPS.includes(brand.backdrop) ? brand.backdrop : null;
  const wipe = WIPES.includes(brand.wipe) && sceneCount > 1 ? brand.wipe : null;
  return backdrop || wipe ? { backdrop, wipe } : null;
}

const size = (W, H, k) => `width="${Math.round(W * k)}" height="${Math.round(H * k)}"`;

/** The backdrop canvas (behind the scenes) and the wipe canvas (over them, under the subtitles and corner logo). */
export const glBackdropHtml = (L, W, H) => (L.backdrop ? `\n  <canvas id="glb" data-gl ${size(W, H, SCALE[L.backdrop])}></canvas>` : '');
export const glWipeHtml = (L, W, H) => (L.wipe ? `\n  <canvas id="glw" data-gl ${size(W, H, SCALE[L.wipe])}></canvas>` : '');

export const glCss = (L, W, H) => `
#glb,#glw{position:absolute;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none}${L.wipe ? '\n#glw{z-index:22}' : ''}`;

const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255); };
const ms = (x) => Math.round(x * 1000) / 1000;

/**
 * Each cut's effect window as [cut, before, after]: at most `before` seconds ahead of the cut and `after` past it,
 * and never past the midpoint to a neighbouring cut, so the effects of two close cuts never overlap.
 */
export const cutWindows = (cuts, before, after) => cuts.map((c, k) => [c,
  ms(Math.min(before, k ? (c - cuts[k - 1]) / 2 : before)),
  ms(Math.min(after, k + 1 < cuts.length ? (cuts[k + 1] - c) / 2 : after))]);

// Each wipe covers the frame by the cut and is gone this long after it, as [before, after] seconds, cuts far
// enough apart. A glitch snaps and a flash blinks, so theirs are short.
export const WIPE_WINDOW = { liquid: [0.5, 0.5], iris: [0.45, 0.45], burn: [0.6, 0.5], glitch: [0.3, 0.3], flash: [0.2, 0.35] };

/**
 * Page data: the colours each shader reads (bg, primary2, secondary, primary), how strongly a backdrop tints and,
 * with a wipe, each cut's window (`cuts` are the scene starts after the first).
 */
export const glData = (L, c, cuts = []) => ({
  ...L, colors: [c.bg, c.primary2, c.secondary, c.primary], strength: lum(c.bg) > 150 ? 0.55 : 0.75,
  ...(L.wipe ? { cuts: cutWindows(cuts, ...WIPE_WINDOW[L.wipe]) } : {}),
});

const NOISE = `
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}`;

const HEAD = `precision highp float;uniform vec2 R;uniform float T,S;uniform vec3 C0,C1,C2,C3;${NOISE}`;
// A wipe reads P0 (covering, 0 to 1 by the cut) and P1 (uncovering, from the cut), K the cut's index, and BH/BT how
// far each edge travels in a quarter frame; on(p) is 1 only while that half moves. Output is premultiplied.
const WIPE_HEAD = `precision highp float;uniform vec2 R;uniform vec3 C1,C2,C3;uniform float P0,P1,K,BH,BT;${NOISE}
float on(float p){return step(.001,p)*(1.-step(.999,p));}`;

// Fragment shaders. C0 is the brand background, C1 primary2, C2 the accent, C3 primary; S is the tint strength.
const FRAG = {
  // Three soft colour fields drifting through a slowly warped plane.
  mesh: `${HEAD}
void main(){vec2 u=gl_FragCoord.xy/R;float ar=R.x/R.y;vec2 p=vec2(u.x*ar,u.y);float t=T*.05;
vec2 q=p+.4*vec2(fbm(p*1.2+vec2(t,0.)),fbm(p*1.2+vec2(5.2,-t)))-.2;
vec2 a=vec2(ar*(.2+.15*sin(t*2.1)),.75+.12*cos(t*1.7)),b=vec2(ar*(.8+.12*cos(t*1.3)),.25+.15*sin(t*2.6)),c=vec2(ar*(.55+.2*sin(t*1.1+2.)),.55+.2*cos(t*1.9+1.));
float wa=exp(-dot(q-a,q-a)*2.2),wb=exp(-dot(q-b,q-b)*2.4),wc=exp(-dot(q-c,q-c)*3.);
vec3 col=mix(C0,C1,wa*S);col=mix(col,C2,wb*S*.85);col=mix(col,C3,wc*S*.25);gl_FragColor=vec4(col,1.);}`,
  // Curtains of light in the upper half, each with fine vertical rays.
  aurora: `${HEAD}
void main(){vec2 u=gl_FragCoord.xy/R;float ar=R.x/R.y;vec2 p=vec2(u.x*ar,u.y);
vec3 col=mix(C0,C1,S*(.06+.1*u.y));
for(int k=0;k<3;k++){float fk=float(k),x=p.x*.9+fk*1.3;
float ctr=.62+.12*sin(x*1.4+T*.12+fk*2.1)+.1*(fbm(vec2(x*1.2,T*.04+fk))-.5),d=u.y-ctr;
float band=exp(-d*d*(30.+fk*12.))*(.55+.45*n(vec2(x*14.,T*.25+fk*9.)));
col=mix(col,k==1?C2:C1,band*S*.8);}
gl_FragColor=vec4(col,1.);}`,
  // Topographic contour lines over a faint tint, the terrain shifting slowly.
  // fwidth keeps every line the same width however steep the terrain is.
  flow: `#extension GL_OES_standard_derivatives : enable
${HEAD}
void main(){vec2 u=gl_FragCoord.xy/R;vec2 p=vec2(u.x*R.x/R.y,u.y);
float v=fbm(p*.9+vec2(T*.02,-T*.015))*7.,d=abs(fract(v-.5)-.5);
float line=1.-smoothstep(.4*fwidth(v),1.6*fwidth(v),d);
vec3 col=mix(C0,C1,.1*S);col=mix(col,C2,line*.45*S);gl_FragColor=vec4(col,1.);}`,
  // A brand-colour band sweeps across and off again; its leading and trailing edges carry the accent.
  // BH and BT smear each edge by how far it travels in half a frame, so a fast edge is a blur, not a step.
  liquid: `precision highp float;uniform vec2 R;uniform vec3 C2,C3;uniform float P0,P1,K,BH,BT;${NOISE}
void main(){vec2 u=gl_FragCoord.xy/R;if(mod(K,2.)>.5)u.x=1.-u.x;
float x=u.x+(fbm(vec2(u.y*2.5+K*3.1,K*1.7))-.5)*.22+(u.y-.5)*.12,head=mix(-.2,1.2,P0),tail=mix(-.2,1.2,P1),bh=.006+BH,bt=.006+BT;
float body=(1.-smoothstep(head-bh,head+bh,x))*smoothstep(tail-bt,tail+bt,x);
float edge=max(smoothstep(head-.04,head-.012,x),1.-smoothstep(tail+.012,tail+.04,x));
vec3 col=mix(C3,C2,edge);gl_FragColor=vec4(col*body,body);}`,
  // The wipes below follow HyperFrames' shader transitions (github.com/heygen-com/hyperframes, Apache-2.0), redrawn
  // as brand-colour layers over the cut: a page cannot sample its own DOM, so nothing here reads the scenes.
  // A primary disc closes on the middle of the frame and a hole opens from it, an accent ring on each moving edge.
  iris: `${WIPE_HEAD}
void main(){vec2 u=gl_FragCoord.xy/R;float ar=R.x/R.y,d=length(vec2((u.x-.5)*ar,u.y-.5)),M=.5*sqrt(ar*ar+1.)+.06;
float rc=mix(M,-.06,P0),ro=mix(-.06,M,P1),wc=.006+.8*BH,wo=.006+.8*BT;
float body=smoothstep(rc-wc,rc+wc,d)*smoothstep(ro-wo,ro+wo,d);
float ring=max(on(P0)*exp(-pow((d-rc)/.025,2.)),on(P1)*exp(-pow((d-ro)/.025,2.)));
float a=max(body,ring*.85);gl_FragColor=vec4(mix(C3,C2,ring)*a,a);}`,
  // Ridged noise burns in across the frame and burns away again; the burning edge glows accent to white with sparks.
  burn: `${WIPE_HEAD}
float rg(vec2 p){float v=0.,a=.5;mat2 Q=mat2(.8,.6,-.6,.8);for(int i=0;i<5;i++){v+=a*abs(n(p)*2.-1.);p=Q*p*2.02;a*=.5;}return v;}
void main(){vec2 u=gl_FragCoord.xy/R;if(mod(K,2.)>.5)u.x=1.-u.x;
float v=mix(rg(vec2(u.x*R.x/R.y,u.y)*2.2+vec2(K*3.7,K*1.3)),u.x,.45),t0=mix(-.08,1.08,P0),t1=mix(-.08,1.08,P1),e0=.01+BH,e1=.01+BT;
float body=(1.-smoothstep(t0-e0,t0+e0,v))*smoothstep(t1-e1,t1+e1,v);
float heat=max(on(P0)*smoothstep(.07,0.,abs(v-t0)),on(P1)*smoothstep(.07,0.,abs(v-t1)));
float spark=step(.94,h(floor(gl_FragCoord.xy/2.)+K))*heat;
vec3 glow=mix(C2,vec3(1.),smoothstep(.55,1.,heat)*.7);
float a=clamp(max(body,heat*.9+spark),0.,1.);gl_FragColor=vec4(mix(C3,glow,clamp(heat+spark,0.,1.))*a,a);}`,
  // Rows of blocks snap across at their own offsets and jitter in steps; near the moving fronts the rows turn into
  // primary2 and accent stripes with scanlines, and the covered middle stays plain primary.
  glitch: `${WIPE_HEAD}
void main(){vec2 u=gl_FragCoord.xy/R;if(mod(K,2.)>.5)u.x=1.-u.x;
float r1=floor(u.y*7.),r2=floor(u.y*23.),s=.6*h(vec2(r1,K))+.4*h(vec2(r2,K+7.));
float jit=.16*P0*(1.-P0)*(h(vec2(r2,floor(P0*10.)+K))-.5);
float head=P0*1.7-s*.7+jit,tail=P1*1.7-s*.7,e0=.002+BH,e1=.002+BT;
float body=(1.-smoothstep(head-e0,head+e0,u.x))*smoothstep(tail-e1,tail+e1,u.x);
float c=h(vec2(r2,K+3.)),zone=max(on(P0)*(1.-smoothstep(0.,.22,head-u.x)),on(P1)*(1.-smoothstep(0.,.22,u.x-tail)));
vec3 stripe=c<.5?C3:(c<.8?C1:C2),col=mix(C3,stripe,zone)*(1.-.12*zone*step(.5,fract(gl_FragCoord.y*.5)));
gl_FragColor=vec4(col*body,body);}`,
  // White blooms out from the middle with an accent fringe, fills the frame at the cut and fades off it.
  flash: `${WIPE_HEAD}
void main(){vec2 u=gl_FragCoord.xy/R;float ar=R.x/R.y,d=length(vec2((u.x-.5)*ar,u.y-.5));
float a0=clamp(P0*2.-d*.9,0.,1.),fringe=on(P0)*a0*(1.-a0)*4.,a=a0*(1.-P1);
gl_FragColor=vec4(mix(vec3(1.),C2,fringe*.6+P1*.2)*a,a);}`,
};

// Lit flat-shaded solids for the shapes backdrop; fog fades the far ones into the background.
const SHAPE_VS = `attribute vec3 p,nm;uniform mat4 M,V,Pj;uniform mat3 Rm;varying vec3 vn;varying float vz;
void main(){vec4 v=V*M*vec4(p,1.);vn=Rm*nm;vz=-v.z;gl_Position=Pj*v;}`;
const SHAPE_FS = `precision highp float;varying vec3 vn;varying float vz;uniform vec3 K,C0;
void main(){vec3 nn=normalize(vn);float d=max(dot(nn,normalize(vec3(-.4,.7,.6))),0.),rim=pow(1.-abs(nn.z),2.);
vec3 col=K*(.5+.6*d)+rim*.16;col=mix(col,C0,smoothstep(3.5,11.,vz)*.85);gl_FragColor=vec4(col,1.);}`;

/** The page script: GL.draw(t) paints every layer for time t; seek(t) calls it. */
export const glJs = (L) => (L.backdrop === 'shapes' ? SOLIDS_JS : '') + String.raw`
const GL = (() => {
  const G = D.gl, hex = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16) / 255), COL = G.colors.map(hex);
  const FRAG = ${JSON.stringify(FRAG)};
  function context(id, alpha) {
    const gl = $(id).getContext('webgl', { preserveDrawingBuffer: true, alpha, premultipliedAlpha: true, antialias: true });
    if (!gl) throw new Error('WebGL is not available, so the ' + id + ' layer cannot be drawn');
    gl.getExtension('OES_standard_derivatives');
    return gl;
  }
  function program(gl, vs, fs) {
    const shader = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('A WebGL shader did not compile: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, vs)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('A WebGL program did not link: ' + gl.getProgramInfoLog(p));
    const u = {};
    for (let i = 0, k = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < k; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
    return { p, u };
  }
  // One triangle that covers the frame.
  function plane(gl, fs) {
    const pr = program(gl, 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}', fs), b = gl.createBuffer(), loc = gl.getAttribLocation(pr.p, 'a');
    gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    return (set) => {
      gl.useProgram(pr.p); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      if (pr.u.R) gl.uniform2f(pr.u.R, gl.drawingBufferWidth, gl.drawingBufferHeight);
      COL.forEach((v, i) => { if (pr.u['C' + i]) gl.uniform3fv(pr.u['C' + i], v); });
      set(pr.u); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.disableVertexAttribArray(loc);
    };
  }
  const layers = [];
  if (G.backdrop) {
    const gl = context('glb', false), sky = plane(gl, G.backdrop === 'shapes' ? FRAG.mesh : FRAG[G.backdrop]);
    const solids = G.backdrop === 'shapes' ? shapes(gl) : null;
    layers.push((t) => {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight); gl.disable(gl.DEPTH_TEST);
      sky((u) => { gl.uniform1f(u.T, t); gl.uniform1f(u.S, G.strength * (solids ? 0.6 : 1)); });
      if (solids) solids(t);
      gl.finish();
    });
  }
  if (G.wipe) {
    const gl = context('glw', true), wipe = plane(gl, FRAG[G.wipe]);
    const ease = (x) => { x = Math.min(1, Math.max(0, x)); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
    // How far an edge moves (in frame widths: it crosses 1.4) over a quarter of a 30 fps frame.
    const smear = (x, len) => (Math.abs(ease(x + 0.01) - ease(x - 0.01)) / 0.02) * (1.4 / len) / 120;
    layers.push((t) => {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      // The band covers the frame by the cut and is gone after it; each cut has its own window (G.cuts), so a cut
      // less than a second after another still gets a whole, faster wipe.
      const k = G.cuts.findIndex(([c, a, b]) => t > c - a && t < c + b);
      if (k >= 0) {
        const [c, a, b] = G.cuts[k], xh = (t - c + a) / a, xt = (t - c) / b;
        // A wipe that does not read a uniform has none (the compiler drops it).
        const set = (u, n, v) => { if (u[n]) gl.uniform1f(u[n], v); };
        wipe((u) => { set(u, 'P0', ease(xh)); set(u, 'P1', ease(xt)); set(u, 'BH', smear(xh, a)); set(u, 'BT', smear(xt, b)); set(u, 'K', k); });
      }
      gl.finish();
    });
  }
  // Sixteen solids on a ring around the middle of the frame (the text stays clear), seeded, drifting and turning.
  function shapes(gl) {
    const pr = program(gl, ${JSON.stringify(SHAPE_VS)}, ${JSON.stringify(SHAPE_FS)}), meshes = SOLIDS.map((tris) => {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(tris), gl.STATIC_DRAW); return { b, n: tris.length / 6 };
    });
    let s = 20261023;
    const r = () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
    const fov = 0.7, aspect = gl.drawingBufferWidth / gl.drawingBufferHeight;
    // Small and far, near the frame edge, in primary2 or the accent (primary is often near black and reads heavy).
    const items = Array.from({ length: 16 }, (_, i) => {
      const a = r() * 6.2832, rad = 0.82 + r() * 0.3, z = -(6 + r() * 7), hh = Math.tan(fov / 2) * -z;
      // A tall frame puts the ring under the title and the subtitles too: there the solids are smaller and paler.
      const tall = aspect < 1, tint = COL[1 + (i % 2)], mix = tall ? 0.45 : 0.3, k = tint.map((v, j) => v * (1 - mix) + COL[0][j] * mix);
      return { m: meshes[i % 3], x: Math.cos(a) * rad * hh * aspect, y: Math.sin(a) * rad * hh, z, sc: (0.28 + r() * 0.32) * (tall ? 0.7 : 1), ax: norm([r() - 0.5, r() - 0.5, r() - 0.5]), sp: 0.15 + r() * 0.35, ph: r() * 6.2832, k };
    });
    const proj = perspective(fov, aspect, 0.1, 40), lp = gl.getAttribLocation(pr.p, 'p'), ln = gl.getAttribLocation(pr.p, 'nm');
    return (t) => {
      gl.enable(gl.DEPTH_TEST); gl.clear(gl.DEPTH_BUFFER_BIT); gl.useProgram(pr.p);
      gl.uniformMatrix4fv(pr.u.Pj, false, proj);
      // The camera sways and creeps forward, never past the nearest solid.
      gl.uniformMatrix4fv(pr.u.V, false, translate(-0.25 * Math.sin(t * 0.09), -0.15 * Math.sin(t * 0.07 + 1), Math.min(t, 90) * 0.02));
      gl.uniform3fv(pr.u.C0, COL[0]);
      gl.enableVertexAttribArray(lp); gl.enableVertexAttribArray(ln);
      for (const it of items) {
        const R = rotation(it.ax, it.ph + t * it.sp);
        gl.uniformMatrix3fv(pr.u.Rm, false, R);
        gl.uniformMatrix4fv(pr.u.M, false, model(R, it.sc, it.x, it.y + 0.15 * Math.sin(t * 0.2 + it.ph), it.z));
        gl.uniform3fv(pr.u.K, it.k);
        gl.bindBuffer(gl.ARRAY_BUFFER, it.m.b);
        gl.vertexAttribPointer(lp, 3, gl.FLOAT, false, 24, 0); gl.vertexAttribPointer(ln, 3, gl.FLOAT, false, 24, 12);
        gl.drawArrays(gl.TRIANGLES, 0, it.m.n);
      }
      gl.disableVertexAttribArray(lp); gl.disableVertexAttribArray(ln);
    };
  }
  return { draw: (t) => layers.forEach((f) => f(t)) };
})();`;

// Matrix helpers and the three solids (icosahedron, cube, octahedron) as flat-shaded [x,y,z,nx,ny,nz] triangles.
// Written only on a page with the shapes backdrop.
const SOLIDS_JS = String.raw`
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const perspective = (fov, a, n, f) => { const t = 1 / Math.tan(fov / 2); return new Float32Array([t / a, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]); };
const translate = (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
function rotation([x, y, z], a) {
  const c = Math.cos(a), s = Math.sin(a), k = 1 - c;
  return new Float32Array([c + x * x * k, y * x * k + z * s, z * x * k - y * s, x * y * k - z * s, c + y * y * k, z * y * k + x * s, x * z * k + y * s, y * z * k - x * s, c + z * z * k]);
}
const model = (R, s, x, y, z) => new Float32Array([R[0] * s, R[1] * s, R[2] * s, 0, R[3] * s, R[4] * s, R[5] * s, 0, R[6] * s, R[7] * s, R[8] * s, 0, x, y, z, 1]);
function solid(V, F) {
  const out = [];
  for (const [a, b, c] of F) {
    const A = V[a], B = V[b], C = V[c], u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    let nn = norm([u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]);
    if (nn[0] * A[0] + nn[1] * A[1] + nn[2] * A[2] < 0) nn = nn.map((x) => -x);
    for (const P of [A, B, C]) out.push(...P, ...nn);
  }
  return out;
}
const SOLIDS = (() => {
  const g = (1 + Math.sqrt(5)) / 2, s = 1 / Math.hypot(1, g);
  const ico = [[-1, g, 0], [1, g, 0], [-1, -g, 0], [1, -g, 0], [0, -1, g], [0, 1, g], [0, -1, -g], [0, 1, -g], [g, 0, -1], [g, 0, 1], [-g, 0, -1], [-g, 0, 1]].map((v) => v.map((x) => x * s));
  const icoF = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const q = 0.62, cube = [[-q, -q, -q], [q, -q, -q], [q, q, -q], [-q, q, -q], [-q, -q, q], [q, -q, q], [q, q, q], [-q, q, q]];
  const cubeF = [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 4, 5], [0, 5, 1], [3, 2, 6], [3, 6, 7], [0, 3, 7], [0, 7, 4], [1, 5, 6], [1, 6, 2]];
  const oct = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const octF = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];
  return [solid(ico, icoF), solid(cube, cubeF), solid(oct, octF)];
})();`;
