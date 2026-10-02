/**
 * The drawing half of a 360° spot's panorama (2026-10-02; the arithmetic is lib/panorama.ts): every
 * frame of the turn laid on one sphere round the spot, blended, its exposure evened out, the gaps the
 * turn never covered (straight up, straight down) filled from round them - a single picture the view
 * stands inside, "all blends together looking nice and cohesive rather than the fragmentation and ghost
 * walls" (the owner).
 *
 * Runs on the graphics card through three.js, which the 3D view loads itself and hands in (`THREE`),
 * so nothing here pulls three.js into the claim page.
 *
 * - THE PROXY (`distanceMap`): how far the model is from the spot in every direction - its walls,
 *   floors, ceilings and cabinets drawn six times round the spot into a map of distances. A frame's
 *   camera stood up to a foot from the spot's middle, so a direction is looked at by each frame from
 *   where it stood, towards the point it meets there (lib/panorama.ts `warpThrough`).
 * - THE BAKE (`bake`): each frame projected onto the panorama's picture, weighted towards its middle
 *   (the edges of a phone picture are its worst), added up with its gain, divided out, the holes filled
 *   by push-pull (every level of a pyramid fills the next finer one's gaps).
 * - ONE RING AT A TIME (2026-10-02, "the stitch has the cabinet looking very very wrong" - the owner, of
 *   the bar counter 4' from the spot). The phone drops about 10" when it tilts down for the floor ring, so
 *   anything near - a counter, a cabinet, a chair - lands a few degrees apart in the level ring and the
 *   floor ring, and mixing the two drew the counter top twice and sheared the doors. Each ring now keeps
 *   to its own band of the sphere - the floor ring below 33 degrees down, the ceiling ring above 31 up,
 *   the level ring between - with one short hand-off (6 degrees) where they meet, instead of the whole of
 *   their overlap blended.
 * - THE GAINS (`gains`): every frame laid on a small panorama of its own, read back, and where two
 *   overlap their mean colours compared (lib/panorama.ts `solveGains`).
 *
 * The panorama is equirectangular, as lib/panorama.ts `dirOfEquirect` reads it: its rows run from
 * straight down (the first row drawn) to straight up.
 */

import { dirOfEquirect, equirectOf, solveGains, type Gray, type Overlap, type PanoFrame, type V3 } from "@/lib/panorama";

type Three = typeof import("three");
type Renderer = import("three").WebGLRenderer;
type RT = import("three").WebGLRenderTarget;
type Texture = import("three").Texture;

/** Nothing met within this many feet: the view through a window, or out of the model's end. */
export const FAR_FEET = 40;
/** Where the level ring hands over to the floor ring and to the ceiling ring, degrees of pitch, and how gradually (half the hand-off). */
const BAND_LOW_DEG = -33;
const BAND_HIGH_DEG = 31;
const BAND_EASE_DEG = 3;

/** How far the model is from a spot, every way (feet). */
export interface DistanceMap {
  /** The distances on the panorama's own map, encoded (see `DISTANCE_GLSL`), for the bake. */
  texture: Texture;
  /** The distance along direction [d], for the alignment on the CPU. */
  distanceOf: (d: V3) => number;
  dispose: () => void;
}

/** Decoding a distance texel: centimetres as two bytes, and a third saying anything was met. */
const DISTANCE_GLSL = /* glsl */ `
  float distanceFeet(vec4 t) {
    if (t.b < 0.5) return ${FAR_FEET.toFixed(1)};
    return (t.r * 255.0 * 256.0 + t.g * 255.0) / 30.48;
  }
`;

const EQUIRECT_GLSL = /* glsl */ `
  const float PI = 3.14159265358979;
  vec3 dirOfEquirect(vec2 uv) {
    float yaw = (uv.x - 0.5) * 2.0 * PI;
    float pitch = (uv.y - 0.5) * PI;
    return vec3(sin(yaw) * cos(pitch), sin(pitch), -cos(yaw) * cos(pitch));
  }
  vec2 equirectOf(vec3 d) {
    return vec2(0.5 + atan(d.x, -d.z) / (2.0 * PI), 0.5 + asin(clamp(d.y, -1.0, 1.0)) / PI);
  }
`;

const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** The pieces a bake needs from the graphics card, made once per 3D view and reused for every spot. */
export class PanoBaker {
  private readonly quadScene: import("three").Scene;
  private readonly quadCamera: import("three").OrthographicCamera;
  private readonly quad: import("three").Mesh;
  private readonly owned: { dispose: () => void }[] = [];

  constructor(
    private readonly THREE: Three,
    private readonly renderer: Renderer,
  ) {
    this.quadScene = new THREE.Scene();
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.PlaneGeometry(2, 2);
    this.owned.push(geometry);
    this.quad = new THREE.Mesh(geometry);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** Whether this graphics card can add half-floats up, which the bake needs. */
  static supported(renderer: Renderer): boolean {
    const gl = renderer.getContext();
    return !!(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
  }

  /** One full-screen pass of [material] into [target], adding to what is there or not as the material says. */
  private pass(material: import("three").Material, target: RT | null, clear: boolean) {
    const r = this.renderer;
    this.quad.material = material;
    const before = r.getRenderTarget();
    const autoClear = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(target);
    if (clear) {
      r.setClearColor(0x000000, 0);
      r.clear(true, false, false);
    }
    r.render(this.quadScene, this.quadCamera);
    r.setRenderTarget(before);
    r.autoClear = autoClear;
  }

  private target(w: number, h: number, type: import("three").TextureDataType, linear = true): RT {
    const THREE = this.THREE;
    const t = new THREE.WebGLRenderTarget(w, h, {
      type,
      depthBuffer: false,
      magFilter: linear ? THREE.LinearFilter : THREE.NearestFilter,
      minFilter: linear ? THREE.LinearFilter : THREE.NearestFilter,
      generateMipmaps: false,
    });
    t.texture.wrapS = THREE.RepeatWrapping;
    t.texture.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  }

  // ---- The proxy ------------------------------------------------------------------------------------

  /**
   * How far [meshes] are from [centre], every way: six views of 90 degrees round it, each drawn with the
   * distance itself as its colour, then laid on the panorama's map ([w] x [w]/2) and read back for the CPU.
   */
  distanceMap(meshes: import("three").Mesh[], centre: V3, w = 1024): DistanceMap {
    const THREE = this.THREE;
    const r = this.renderer;
    const scene = new THREE.Scene();
    const material = new THREE.ShaderMaterial({
      uniforms: { centre: { value: new THREE.Vector3(...centre) } },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 centre;
        varying vec3 vWorld;
        void main() {
          float cm = clamp(floor(length(vWorld - centre) * 30.48 + 0.5), 0.0, 65535.0);
          gl_FragColor = vec4(floor(cm / 256.0) / 255.0, mod(cm, 256.0) / 255.0, 1.0, 1.0);
        }
      `,
      side: THREE.DoubleSide,
    });
    for (const m of meshes) {
      const copy = new THREE.Mesh(m.geometry, material);
      m.updateWorldMatrix(true, false);
      copy.matrixAutoUpdate = false;
      copy.matrix.copy(m.matrixWorld);
      copy.matrixWorld.copy(m.matrixWorld);
      scene.add(copy);
    }
    // Six faces whose orientation is ours, so the lookup below needs no cube-map conventions.
    const size = 256;
    const faces: { target: RT; viewProj: import("three").Matrix4 }[] = [];
    const dirs: [V3, V3][] = [
      [[1, 0, 0], [0, 1, 0]],
      [[-1, 0, 0], [0, 1, 0]],
      [[0, 1, 0], [0, 0, 1]],
      [[0, -1, 0], [0, 0, -1]],
      [[0, 0, 1], [0, 1, 0]],
      [[0, 0, -1], [0, 1, 0]],
    ];
    const autoClear = r.autoClear;
    const before = r.getRenderTarget();
    r.autoClear = false;
    for (const [look, up] of dirs) {
      const camera = new THREE.PerspectiveCamera(90, 1, 0.05, 2000);
      camera.position.set(...centre);
      camera.up.set(...up);
      camera.lookAt(centre[0] + look[0], centre[1] + look[1], centre[2] + look[2]);
      camera.updateMatrixWorld(true);
      const target = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, generateMipmaps: false });
      r.setRenderTarget(target);
      r.setClearColor(0x000000, 0);
      r.clear(true, true, false);
      r.render(scene, camera);
      faces.push({ target, viewProj: new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse) });
    }
    r.setRenderTarget(before);
    r.autoClear = autoClear;
    material.dispose();

    // On to the panorama's map, face by face: the face a direction lies in is the one whose view it falls inside.
    const h = w / 2;
    const out = this.target(w, h, THREE.UnsignedByteType, false);
    const toMap = new THREE.ShaderMaterial({
      uniforms: {
        faces: { value: faces.map((f) => f.target.texture) },
        viewProj: { value: faces.map((f) => f.viewProj) },
        centre: { value: new THREE.Vector3(...centre) },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D faces[6];
        uniform mat4 viewProj[6];
        uniform vec3 centre;
        varying vec2 vUv;
        ${EQUIRECT_GLSL}
        vec4 sampleFace(int k, vec3 p) {
          vec4 clip = viewProj[k] * vec4(p, 1.0);
          vec2 ndc = clip.xy / clip.w;
          vec2 uv = ndc * 0.5 + 0.5;
          if (k == 0) return texture(faces[0], uv);
          if (k == 1) return texture(faces[1], uv);
          if (k == 2) return texture(faces[2], uv);
          if (k == 3) return texture(faces[3], uv);
          if (k == 4) return texture(faces[4], uv);
          return texture(faces[5], uv);
        }
        void main() {
          vec3 d = dirOfEquirect(vUv);
          vec3 a = abs(d);
          int k;
          if (a.x >= a.y && a.x >= a.z) k = d.x > 0.0 ? 0 : 1;
          else if (a.y >= a.z) k = d.y > 0.0 ? 2 : 3;
          else k = d.z > 0.0 ? 4 : 5;
          gl_FragColor = sampleFace(k, centre + d);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.pass(toMap, out, true);
    toMap.dispose();
    for (const f of faces) f.target.dispose();
    const pixels = new Uint8Array(w * h * 4);
    r.readRenderTargetPixels(out, 0, 0, w, h, pixels);
    const distanceOf = (d: V3) => {
      const [u, v] = equirectOf(d);
      const x = Math.min(w - 1, Math.max(0, Math.floor(u * w)));
      const y = Math.min(h - 1, Math.max(0, Math.floor(v * h)));
      const i = (y * w + x) * 4;
      if ((pixels[i + 2] as number) < 128) return FAR_FEET;
      return ((pixels[i] as number) * 256 + (pixels[i + 1] as number)) / 30.48;
    };
    return { texture: out.texture, distanceOf, dispose: () => out.dispose() };
  }

  // ---- The frames on the sphere ----------------------------------------------------------------------

  /** The shader that lays one frame on the panorama's map, through the proxy when there is one. */
  private projector(): import("three").ShaderMaterial {
    const THREE = this.THREE;
    return new THREE.ShaderMaterial({
      uniforms: {
        map: { value: null },
        forward: { value: new THREE.Vector3() },
        up: { value: new THREE.Vector3() },
        right: { value: new THREE.Vector3() },
        offset: { value: new THREE.Vector3() },
        lens: { value: new THREE.Vector4() },
        size: { value: new THREE.Vector2() },
        gain: { value: new THREE.Vector3(1, 1, 1) },
        power: { value: 2 },
        mode: { value: 0 },
        distances: { value: null },
        hasDistances: { value: 0 },
        trim: { value: 0 },
        ring: { value: 0 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform sampler2D distances; uniform int hasDistances;
        uniform vec3 forward; uniform vec3 up; uniform vec3 right; uniform vec3 offset;
        uniform vec4 lens; uniform vec2 size; uniform vec3 gain; uniform float power; uniform int mode; uniform float trim; uniform int ring;
        varying vec2 vUv;
        ${EQUIRECT_GLSL}
        ${DISTANCE_GLSL}
        void main() {
          vec3 d = dirOfEquirect(vUv);
          if (hasDistances == 1) {
            float t = distanceFeet(texture(distances, vUv));
            d = normalize(d * t - offset);
          }
          float z = dot(d, forward);
          if (z <= 0.1) discard;
          float px = lens.z + lens.x * dot(d, right) / z;
          float py = lens.w - lens.y * dot(d, up) / z;
          vec2 n = vec2(px / size.x, py / size.y);
          if (n.x < 0.0 || n.x > 1.0 || n.y < 0.0 || n.y > 1.0) discard;
          vec3 c = texture(map, vec2(n.x, 1.0 - n.y)).rgb;
          float e = min(n.x, 1.0 - n.x) * 2.0;
          float f = min(n.y, 1.0 - n.y) * 2.0;
          // A frame looking down has the person holding the phone along its bottom: that part is left to the fill.
          float keep = trim > 0.0 ? smoothstep(trim, trim + 0.08, 1.0 - n.y) : 1.0;
          if (keep <= 0.0) discard;
          if (mode == 1) {
            // For the gains: the colour well inside the frame, and that it is there.
            gl_FragColor = vec4(c, (e > 0.15 && f > 0.15) ? 1.0 : 0.0);
            return;
          }
          // A floor every covered sample keeps, so a frame's soft edge is never taken for a hole and filled over.
          float w = pow(clamp(e * f, 0.0, 1.0), power) * keep + 1e-3;
          float pitchDeg = (vUv.y - 0.5) * 180.0;
          if (ring < 0) w *= 1.0 - smoothstep(${BAND_LOW_DEG - BAND_EASE_DEG}.0, ${BAND_LOW_DEG + BAND_EASE_DEG}.0, pitchDeg);
          else if (ring > 0) w *= smoothstep(${BAND_HIGH_DEG - BAND_EASE_DEG}.0, ${BAND_HIGH_DEG + BAND_EASE_DEG}.0, pitchDeg);
          else w *= smoothstep(${BAND_LOW_DEG - BAND_EASE_DEG}.0, ${BAND_LOW_DEG + BAND_EASE_DEG}.0, pitchDeg) * (1.0 - smoothstep(${BAND_HIGH_DEG - BAND_EASE_DEG}.0, ${BAND_HIGH_DEG + BAND_EASE_DEG}.0, pitchDeg));
          gl_FragColor = vec4(c * gain * w, w);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
  }

  private setFrame(m: import("three").ShaderMaterial, f: PanoFrame, texture: Texture, dist: DistanceMap | null) {
    const u = m.uniforms as Record<string, { value: unknown }>;
    u.map!.value = texture;
    (u.forward!.value as import("three").Vector3).set(...f.forward);
    (u.up!.value as import("three").Vector3).set(...f.up);
    (u.right!.value as import("three").Vector3).set(...f.right);
    (u.offset!.value as import("three").Vector3).set(...f.offset);
    (u.lens!.value as import("three").Vector4).set(f.camera.fx, f.camera.fy, f.camera.cx, f.camera.cy);
    (u.size!.value as import("three").Vector2).set(f.camera.width, f.camera.height);
    u.distances!.value = dist?.texture ?? null;
    u.hasDistances!.value = dist ? 1 : 0;
    // Looking down more than about 17 degrees: the bottom quarter of the picture is the person's own legs.
    u.trim!.value = f.forward[1] < -0.3 ? 0.25 : 0;
    // Which ring the frame is in: down (-1), level (0) or up (1), more than about 17 degrees off level.
    u.ring!.value = f.forward[1] < -0.3 ? -1 : f.forward[1] > 0.3 ? 1 : 0;
  }

  /** One gain per frame and channel, from where the frames overlap on a small panorama. */
  gains(frames: PanoFrame[], textures: Texture[], dist: DistanceMap | null): [number, number, number][] {
    const THREE = this.THREE;
    const W = 256;
    const H = 128;
    const small = this.target(W, H, THREE.UnsignedByteType);
    const m = this.projector();
    (m.uniforms.mode as { value: number }).value = 1;
    m.blending = THREE.NoBlending;
    const maps: Uint8Array[] = [];
    frames.forEach((f, k) => {
      this.setFrame(m, f, textures[k] as Texture, dist);
      this.pass(m, small, true);
      const buf = new Uint8Array(W * H * 4);
      this.renderer.readRenderTargetPixels(small, 0, 0, W, H, buf);
      maps.push(buf);
    });
    m.dispose();
    small.dispose();
    const overlaps: Overlap[] = [];
    for (let i = 0; i < frames.length; i++) {
      for (let j = i + 1; j < frames.length; j++) {
        const fi = frames[i] as PanoFrame;
        const fj = frames[j] as PanoFrame;
        if (fi.forward[0] * fj.forward[0] + fi.forward[1] * fj.forward[1] + fi.forward[2] * fj.forward[2] < Math.cos((80 * Math.PI) / 180)) continue;
        const mi = maps[i] as Uint8Array;
        const mj = maps[j] as Uint8Array;
        let n = 0;
        const a: [number, number, number] = [0, 0, 0];
        const b: [number, number, number] = [0, 0, 0];
        for (let p = 0; p < W * H * 4; p += 4) {
          if ((mi[p + 3] as number) < 128 || (mj[p + 3] as number) < 128) continue;
          n++;
          a[0] += mi[p] as number;
          a[1] += mi[p + 1] as number;
          a[2] += mi[p + 2] as number;
          b[0] += mj[p] as number;
          b[1] += mj[p + 1] as number;
          b[2] += mj[p + 2] as number;
        }
        if (n < 40) continue;
        overlaps.push({ i, j, n, a: [a[0] / n / 255, a[1] / n / 255, a[2] / n / 255], b: [b[0] / n / 255, b[1] / n / 255, b[2] / n / 255] });
      }
    }
    return solveGains(frames.length, overlaps);
  }

  /**
   * The panorama: [frames] (with their [textures]) laid on a [width] x [width]/2 picture, through the
   * proxy [dist], evened by [gains]. Returned as a texture the caller owns (dispose it).
   */
  bake(frames: PanoFrame[], textures: Texture[], dist: DistanceMap | null, gains: [number, number, number][] | null, width: number): Texture {
    const THREE = this.THREE;
    const W = width;
    const H = width / 2;
    const acc: RT[] = [this.target(W, H, THREE.HalfFloatType)];
    const m = this.projector();
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneFactor;
    m.blendSrcAlpha = THREE.OneFactor;
    m.blendDstAlpha = THREE.OneFactor;
    frames.forEach((f, k) => {
      this.setFrame(m, f, textures[k] as Texture, dist);
      (m.uniforms.gain as { value: import("three").Vector3 }).value.set(...(gains?.[k] ?? [1, 1, 1]));
      this.pass(m, acc[0] as RT, k === 0);
    });
    m.dispose();

    // Push-pull: halve until tiny, then fill each level's holes from the next coarser one.
    const down = new THREE.ShaderMaterial({
      uniforms: { src: { value: null } },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D src;
        void main() {
          ivec2 p = ivec2(gl_FragCoord.xy) * 2;
          ivec2 s = textureSize(src, 0) - 1;
          vec4 a = texelFetch(src, min(p, s), 0) + texelFetch(src, min(p + ivec2(1, 0), s), 0)
                 + texelFetch(src, min(p + ivec2(0, 1), s), 0) + texelFetch(src, min(p + ivec2(1, 1), s), 0);
          gl_FragColor = a * 0.25;
        }
      `,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    let w = W;
    let h = H;
    while (w > 8) {
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
      const t = this.target(w, h, THREE.HalfFloatType);
      (down.uniforms.src as { value: Texture | null }).value = (acc[acc.length - 1] as RT).texture;
      this.pass(down, t, false);
      acc.push(t);
    }
    down.dispose();
    // The caps no frame reaches - straight up past about 66 degrees, straight down past the legs - are
    // filled from round them like any hole, and towards the pole evened to one colour: the mean of the
    // coarsest level's top or bottom row (the pole of an equirectangular picture is a point, and a fill
    // that differs with longitude there draws a pinwheel).
    const upMaterial = new THREE.ShaderMaterial({
      uniforms: { accTex: { value: null }, coarse: { value: null }, hasCoarse: { value: 0 }, caps: { value: null }, hasCaps: { value: 0 } },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D accTex; uniform sampler2D coarse; uniform int hasCoarse; uniform sampler2D caps; uniform int hasCaps;
        varying vec2 vUv;
        vec3 rowMean(float v) {
          vec3 s = vec3(0.0);
          for (int i = 0; i < 16; i++) s += texture(caps, vec2((float(i) + 0.5) / 16.0, v)).rgb;
          return s / 16.0;
        }
        void main() {
          vec4 a = texture(accTex, vUv);
          vec3 own = a.rgb / max(a.a, 1e-6);
          if (hasCoarse == 0) { gl_FragColor = vec4(a.a > 0.0 ? own : vec3(0.5), 1.0); return; }
          vec3 c = mix(texture(coarse, vUv).rgb, own, smoothstep(0.0, 0.001, a.a));
          if (hasCaps == 1) {
            float pitch = (vUv.y - 0.5) * 3.14159265;
            float hole = 1.0 - smoothstep(0.0, 0.002, a.a);
            c = mix(c, rowMean(0.02), hole * (1.0 - smoothstep(-1.40, -1.08, pitch)));
            c = mix(c, rowMean(0.98), hole * smoothstep(1.15, 1.42, pitch));
          }
          gl_FragColor = vec4(c, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    let fill: RT | null = null;
    let caps: RT | null = null;
    for (let k = acc.length - 1; k >= 0; k--) {
      const level = acc[k] as RT;
      let t: RT;
      if (k === 0) {
        t = this.target(W, H, THREE.UnsignedByteType);
        // Kept as sRGB, as a photo is: eight bits spent where the eye sees them.
        t.texture.colorSpace = THREE.SRGBColorSpace;
      } else {
        t = this.target(level.width, level.height, THREE.HalfFloatType);
      }
      const u = upMaterial.uniforms as Record<string, { value: unknown }>;
      u.accTex!.value = level.texture;
      u.coarse!.value = fill ? fill.texture : null;
      u.hasCoarse!.value = fill ? 1 : 0;
      u.caps!.value = caps ? caps.texture : null;
      u.hasCaps!.value = caps ? 1 : 0;
      this.pass(upMaterial, t, false);
      // The coarsest level, filled, is what the caps are evened to; it is kept to the end.
      if (fill && fill !== caps) fill.dispose();
      if (!caps) caps = t;
      fill = t;
    }
    upMaterial.dispose();
    if (caps && caps !== fill) caps.dispose();
    for (const a of acc) a.dispose();
    const result = (fill as RT).texture;
    // The render target's own texture outlives it only if the target is not disposed: hand the target over.
    (result as Texture & { __target?: RT }).__target = fill as RT;
    return result;
  }

  /** Lets a panorama made by [bake] go. */
  static release(texture: Texture) {
    const target = (texture as Texture & { __target?: RT }).__target;
    if (target) target.dispose();
    else texture.dispose();
  }

  dispose() {
    for (const o of this.owned) o.dispose();
  }
}

/** A frame's picture in grey at [scale] of its full size ([fullWidth] wide), for the alignment. */
export function grayOf(image: CanvasImageSource & { width: number; height: number }, fullWidth: number, scale = 0.25): Gray | null {
  if (typeof document === "undefined") return null;
  const k = (fullWidth * scale) / Math.max(1, image.width);
  const w = Math.max(1, Math.round(image.width * k));
  const h = Math.max(1, Math.round(image.height * k));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(image, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data;
  const data = new Float32Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = (0.299 * (px[4 * i] as number) + 0.587 * (px[4 * i + 1] as number) + 0.114 * (px[4 * i + 2] as number)) / 255;
  return { w, h, scale: w / fullWidth, data };
}

/** The panorama drawn round the view: a sphere of [radius] feet, its picture looked up by direction. */
export function panoMaterial(THREE: Three, texture: Texture | null): import("three").ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { pano: { value: texture }, opacity: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D pano; uniform float opacity;
      varying vec3 vDir;
      ${EQUIRECT_GLSL}
      void main() {
        gl_FragColor = vec4(texture(pano, equirectOf(normalize(vDir))).rgb, opacity);
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
}

/** For tests and the console: the equirect convention, re-exported. */
export { dirOfEquirect, equirectOf };
