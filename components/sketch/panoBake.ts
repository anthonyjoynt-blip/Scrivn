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
 * - WHERE THE RINGS AGREE (2026-10-03, "360 looks good other than some warping still. can see it on the
 *   dresser" - the owner). The 07:21 walk's dresser stood a metre from the bedroom spot and the floor ring
 *   saw it 10 degrees higher than the level ring did: no hand-off lines the two up, and the 6 degree one
 *   mixed them - every handle drawn twice. The rings now meet along a seam found column by column where the
 *   two agree and both have a frame (`seams`; lib/panorama.ts `seamCost`, `seamRows`), in under a degree, so
 *   a thing that near is cut once and not doubled; and each ring's light is evened to the other's along it
 *   (`seamLight`), so a hand-off that short is not a line.
 * - ONE FRAME AT A TIME WITHIN A RING TOO (2026-10-04, "The stitch doesn't look great" - the owner, of the first 360s
 *   on the ultra-wide). Its stills are 84 degrees across and 30 apart, so neighbours overlap by more than half, and
 *   blended over all of it the bathroom's arched doorway 0.85 m away was drawn twice and the bedroom's ceiling fan
 *   beside itself. Each pair of neighbours in a ring now meets on a seam too, row by row where the two agree
 *   (`columnSeams`; lib/panorama.ts `columnSeamCost`, `seamColumns`), handed over in a few degrees - and a still blown
 *   white by a window gives way, in a hand-off, to one that saw it.
 * - WHERE A SEAM MUST CROSS A THING NEAR, THE TWO MEET ON IT (2026-10-05, "duplicated pet bed. the stitching still has
 *   plenty of issues" - the owner, of the 04:41 walk). A seam cannot always go round: a pet bed on the floor, a lamp, a
 *   door a metre away is seen a few degrees apart by two stills from a hand swinging round the body, and the model is
 *   only the room's walls and floor. All along every seam the two are read ([readAcross], [evenAlong]) for how far
 *   apart they have what is there and how much brighter one is, and near it each frame is bent half the way to the
 *   other and lit half the way (`columnShift`, `ringShift`): they meet on the seam, the hand-off draws one thing once,
 *   and each frame's own middle stays as it was taken. With every still setting its own exposure (Scrivn Scan 0.1.96)
 *   the light is evened the same way - across the whole of a frame, from one seam's light to the other's - so a room
 *   keeps the light each still saw in its own middle and no seam is a line.
 * - THE GAINS (`gains`): every frame laid on a small panorama of its own, read back, and where two
 *   overlap their colours compared (lib/panorama.ts `overlapLog`, `solveGains`) - the level ring the one
 *   the others are evened to.
 *
 * The panorama is equirectangular, as lib/panorama.ts `dirOfEquirect` reads it: its rows run from
 * straight down (the first row drawn) to straight up.
 */

import { columnSeamCost, dirOfEquirect, equirectOf, evenAlong, overlapLog, readAcross, SEAM_COST_DEFAULTS, SEAM_LIGHT_DEFAULTS, seamColumns, seamCost, seamLight, seamRows, solveGains, type Gray, type Overlap, type PanoFrame, type SeamReading, type V3 } from "@/lib/panorama";

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
/**
 * The seams instead (2026-10-03, [PanoBaker.seams]): where the two rings meet is searched for between these pitches,
 * column by column, on a preview this wide; and the hand-off along the seam found is this short (half of it) - a
 * thing near, seen a degree or two apart by the two rings, is cut once there instead of drawn twice over a wide one.
 */
const SEAM_LOW_RANGE: [number, number] = [-40, -6];
const SEAM_HIGH_RANGE: [number, number] = [6, 40];
const SEAM_W = 1024;
const SEAM_EASE_DEG = 0.75;
/**
 * Where between the lowest (0) and highest (1) place both rings have a frame each seam is drawn to, where nothing
 * else decides ([seamCost]): the floor seam the middle; the ceiling seam the top - the top of a bulkhead or a feature
 * wall stands up into the band, and a seam along it cut the 07:21 walk's blue wall with a step, one above it passes over.
 */
const SEAM_TOWARD_LOW = 0.5;
const SEAM_TOWARD_HIGH = 1;
/**
 * A hand-off that short shows any difference in light between the two rings as a line, so each is evened to the
 * other along the seam ([seamLight]): half the difference each at the seam, none this many degrees from it.
 */
const SEAM_LIGHT_DEG = 10;

/**
 * Between two neighbours of a ring ([PanoBaker.columnSeams]): the seam is looked for this share of the turn between
 * them either side of half way, so the seams round a ring never cross; and the hand-off along it is this many degrees
 * (half of it) - long enough to hide what the gains leave between two stills' light, short enough that a thing seen two
 * degrees apart is not drawn twice. Two neighbours further apart than this share of their two half-widths barely
 * overlap, and are not cut.
 */
const COLUMN_BAND = 0.45;
const COLUMN_SEAM_EASE_DEG = 1.5;
const COLUMN_SEAM_REACH = 0.9;
/** The seams' rows: one per row of the previews they are found on. */
const COLUMN_SEAM_H = SEAM_W / 2;
/**
 * Where two frames have a thing near a few degrees apart, each is bent half the way to the other on the seam and less
 * and less away from it - none this many degrees from a seam between neighbours, or from the seam between two rings -
 * so a frame's own middle stays as it was taken ([PanoBaker.columnSeams], [PanoBaker.seams]). Read every few samples
 * along a seam.
 */
const COLUMN_SHIFT_FALLOFF_DEG = 12;
const RING_SHIFT_FALLOFF_DEG = 14;
const SEAM_READ_STEP = 3;
/** How far each ring's light may be evened to the other's along their seam (a log): each still sets its own exposure. */
const RING_LIGHT_LIMIT = 0.8;

/** Which ring a frame is in: down (-1), level (0) or up (1), more than about 17 degrees off level. */
function ringOf(f: PanoFrame): number {
  return f.forward[1] < -0.3 ? -1 : f.forward[1] > 0.3 ? 1 : 0;
}

/** The way a frame looks round the circle, degrees, as the panorama's columns run ([dirOfEquirect]). */
function yawOf(f: PanoFrame): number {
  return (Math.atan2(f.forward[0], -f.forward[2]) * 180) / Math.PI;
}

/** [deg] in (-180, 180]. */
function wrap180(deg: number): number {
  const d = (((deg + 180) % 360) + 360) % 360 - 180;
  return d === -180 ? 180 : d;
}

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

/**
 * Where the rings meet at column [u] ([PanoBaker.seams]), between texels: the floor seam's pitch (x) and the ceiling
 * seam's (y), and how much brighter the level ring is than the floor ring along the one (z) and than the ceiling ring
 * along the other (w), as logs ([seamLight]).
 */
const SEAM_GLSL = /* glsl */ `
  uniform sampler2D seams;
  uniform sampler2D ringShift; uniform int hasRingShift;
  vec4 seamAt(float u) {
    float x = u * ${SEAM_W.toFixed(1)} - 0.5;
    float x0 = floor(x);
    int i0 = int(mod(x0, ${SEAM_W.toFixed(1)}));
    int i1 = int(mod(x0 + 1.0, ${SEAM_W.toFixed(1)}));
    return mix(texelFetch(seams, ivec2(i0, 0), 0), texelFetch(seams, ivec2(i1, 0), 0), x - x0);
  }
  /** How far the other ring has what the level ring shows on the seam, degrees right and up: the floor seam's (xy), the ceiling seam's (zw). */
  vec4 ringShiftAt(float u) {
    float x = u * ${SEAM_W.toFixed(1)} - 0.5;
    float x0 = floor(x);
    int i0 = int(mod(x0, ${SEAM_W.toFixed(1)}));
    int i1 = int(mod(x0 + 1.0, ${SEAM_W.toFixed(1)}));
    return mix(texelFetch(ringShift, ivec2(i0, 0), 0), texelFetch(ringShift, ivec2(i1, 0), 0), x - x0);
  }
`;

/**
 * This frame within its ring at a place of the panorama ([PanoBaker.columnSeams]), from its seams with the neighbour to
 * its left and to its right, row by row (between texels): how much of the place is its own ([share], a short hand-off
 * across each seam), how far it is bent there ([shift], degrees right and up: half way to each neighbour on the seam,
 * nothing [COLUMN_SHIFT_FALLOFF_DEG] in), and its light ([light], a log: from one seam's evening to the other's across
 * the frame).
 */
const COLUMN_SEAM_GLSL = /* glsl */ `
  uniform sampler2D colSeams; uniform sampler2D colShift; uniform int hasColSeams; uniform int frameIndex; uniform float frameYaw;
  vec4 columnRow(sampler2D t, float v) {
    float y = v * ${COLUMN_SEAM_H.toFixed(1)} - 0.5;
    float y0 = floor(y);
    int i0 = int(clamp(y0, 0.0, ${(COLUMN_SEAM_H - 1).toFixed(1)}));
    int i1 = int(clamp(y0 + 1.0, 0.0, ${(COLUMN_SEAM_H - 1).toFixed(1)}));
    return mix(texelFetch(t, ivec2(frameIndex, i0), 0), texelFetch(t, ivec2(frameIndex, i1), 0), clamp(y - y0, 0.0, 1.0));
  }
  void columnOf(vec2 uv, out float share, out vec2 shift, out float light) {
    vec4 s = columnRow(colSeams, uv.y);
    vec4 m = columnRow(colShift, uv.y);
    float d = mod((uv.x - 0.5) * 360.0 - frameYaw + 540.0, 360.0) - 180.0;
    float ease = ${COLUMN_SEAM_EASE_DEG.toFixed(2)};
    share = smoothstep(s.x - ease, s.x + ease, d) * (1.0 - smoothstep(s.y - ease, s.y + ease, d));
    light = mix(s.z, s.w, clamp((d - s.x) / max(s.y - s.x, 1e-3), 0.0, 1.0));
    float fromLeft = 1.0 - smoothstep(0.0, ${COLUMN_SHIFT_FALLOFF_DEG.toFixed(1)}, d - s.x);
    float fromRight = 1.0 - smoothstep(0.0, ${COLUMN_SHIFT_FALLOFF_DEG.toFixed(1)}, s.y - d);
    shift = 0.5 * m.xy * fromLeft - 0.5 * m.zw * fromRight;
  }
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
        seams: { value: null },
        hasSeams: { value: 0 },
        hasLow: { value: 1 },
        hasHigh: { value: 1 },
        colSeams: { value: null },
        colShift: { value: null },
        hasColSeams: { value: 0 },
        frameIndex: { value: 0 },
        frameYaw: { value: 0 },
        ringShift: { value: null },
        hasRingShift: { value: 0 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform sampler2D distances; uniform int hasDistances;
        uniform vec3 forward; uniform vec3 up; uniform vec3 right; uniform vec3 offset;
        uniform vec4 lens; uniform vec2 size; uniform vec3 gain; uniform float power; uniform int mode; uniform float trim; uniform int ring;
        uniform int hasSeams;
        uniform int hasLow; uniform int hasHigh;
        varying vec2 vUv;
        ${EQUIRECT_GLSL}
        ${DISTANCE_GLSL}
        ${SEAM_GLSL}
        ${COLUMN_SEAM_GLSL}
        void main() {
          // This frame within its ring, and bent to its neighbours on the seams where they have a thing near apart.
          float share = 1.0;
          vec2 shift = vec2(0.0);
          float light = 0.0;
          if (hasColSeams == 1) columnOf(vUv, share, shift, light);
          if (hasSeams == 1 && hasRingShift == 1) {
            vec4 seamHere = seamAt(vUv.x);
            vec4 rs = ringShiftAt(vUv.x);
            float p = (vUv.y - 0.5) * 180.0;
            float fall = ${RING_SHIFT_FALLOFF_DEG.toFixed(1)};
            if (ring < 0) shift += 0.5 * rs.xy * (1.0 - smoothstep(0.0, fall, seamHere.x - p));
            else if (ring > 0) shift += 0.5 * rs.zw * (1.0 - smoothstep(0.0, fall, p - seamHere.y));
            else {
              if (hasLow == 1) shift -= 0.5 * rs.xy * (1.0 - smoothstep(0.0, fall, p - seamHere.x));
              if (hasHigh == 1) shift -= 0.5 * rs.zw * (1.0 - smoothstep(0.0, fall, seamHere.y - p));
            }
          }
          vec2 at = vUv + vec2(shift.x / 360.0, shift.y / 180.0);
          vec3 d = dirOfEquirect(at);
          if (hasDistances == 1) {
            float t = distanceFeet(texture(distances, at));
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
            // For the gains: the colour well inside the frame (stored as a photo is, gamma 2.2), and that it is there.
            gl_FragColor = vec4(pow(clamp(c, 0.0, 1.0), vec3(${(1 / 2.2).toFixed(6)})), (e > 0.15 && f > 0.15) ? 1.0 : 0.0);
            return;
          }
          if (mode == 2) {
            // For the seams: one ring's picture where a frame of it covers well, evened as the bake evens it - and
            // stored as a photo is (gamma 2.2), so a dim room's dark furniture keeps its detail in eight bits.
            if (e < 0.12 || f < 0.12 || keep < 0.5) discard;
            // Each frame of a ring where it is its own, bent and lit as the bake will draw it.
            if (hasColSeams == 1 && share < 0.5) discard;
            gl_FragColor = vec4(pow(clamp(c * gain * exp(light), 0.0, 1.0), vec3(${(1 / 2.2).toFixed(6)})), 1.0);
            return;
          }
          // Its own part of its ring ([PanoBaker.columnSeams]), and less of it where it saw only white: a still a window
          // blew out gives way, where the two hand over, to one that saw the window (2026-10-04).
          float clipped = 1.0 - 0.95 * smoothstep(0.9, 0.995, max(c.r, max(c.g, c.b)));
          // A floor every covered sample keeps, so a frame's soft edge is never taken for a hole and filled over.
          float w = pow(clamp(e * f, 0.0, 1.0), power) * keep * share * clipped + 1e-3;
          vec3 col = c * gain * exp(light);
          float pitchDeg = (vUv.y - 0.5) * 180.0;
          float lowDeg = ${BAND_LOW_DEG.toFixed(1)};
          float highDeg = ${BAND_HIGH_DEG.toFixed(1)};
          float ease = ${BAND_EASE_DEG.toFixed(1)};
          if (hasSeams == 1) {
            // The rings meet where they agree, column by column ([PanoBaker.seams]), and change sharply there - each
            // evened halfway to the other at the seam, less and less away from it, so the light does not.
            vec4 seam = seamAt(vUv.x);
            lowDeg = seam.x;
            highDeg = seam.y;
            ease = ${SEAM_EASE_DEG.toFixed(2)};
            float nearLow = 1.0 - smoothstep(0.0, ${SEAM_LIGHT_DEG.toFixed(1)}, abs(pitchDeg - lowDeg));
            float nearHigh = 1.0 - smoothstep(0.0, ${SEAM_LIGHT_DEG.toFixed(1)}, abs(pitchDeg - highDeg));
            if (ring < 0) col *= exp(0.5 * seam.z * nearLow);
            else if (ring > 0) col *= exp(0.5 * seam.w * nearHigh);
            else col *= exp(-0.5 * (seam.z * nearLow + seam.w * nearHigh));
          }
          if (ring < 0) w *= 1.0 - smoothstep(lowDeg - ease, lowDeg + ease, pitchDeg);
          else if (ring > 0) w *= smoothstep(highDeg - ease, highDeg + ease, pitchDeg);
          else {
            // The level ring hands over only to a ring there is (2026-10-04): a 360 on the ultra-wide is the level ring
            // alone, and keeps all it saw - 50 degrees up and down - its own frames' edges fading it out.
            if (hasLow == 1) w *= smoothstep(lowDeg - ease, lowDeg + ease, pitchDeg);
            if (hasHigh == 1) w *= 1.0 - smoothstep(highDeg - ease, highDeg + ease, pitchDeg);
          }
          gl_FragColor = vec4(col * w, w);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
  }

  /** Whether [frames] have a floor ring and a ceiling ring: the level ring is cut at a seam only to a ring there is. */
  private ringsOf(m: import("three").ShaderMaterial, frames: PanoFrame[]) {
    const u = m.uniforms as Record<string, { value: unknown }>;
    u.hasLow!.value = frames.some((f) => ringOf(f) < 0) ? 1 : 0;
    u.hasHigh!.value = frames.some((f) => ringOf(f) > 0) ? 1 : 0;
  }

  private setFrame(m: import("three").ShaderMaterial, f: PanoFrame, texture: Texture, dist: DistanceMap | null, index = 0) {
    const u = m.uniforms as Record<string, { value: unknown }>;
    u.map!.value = texture;
    u.frameIndex!.value = index;
    u.frameYaw!.value = yawOf(f);
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
    u.ring!.value = ringOf(f);
  }

  /** One gain per frame and channel, from where the frames overlap on a small panorama. */
  gains(frames: PanoFrame[], textures: Texture[], dist: DistanceMap | null): [number, number, number][] {
    const THREE = this.THREE;
    const W = 256;
    const H = 128;
    const small = this.target(W, H, THREE.UnsignedByteType);
    const m = this.projector();
    this.ringsOf(m, frames);
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
        const o = overlapLog(maps[i] as Uint8Array, maps[j] as Uint8Array);
        if (o) overlaps.push({ i, j, ...o });
      }
    }
    // The level ring is what the others are evened to, its brightness held hardest. In colour only the floor ring is
    // left free - the phone balances its white on the carpet; the ceiling ring, evened by the corner where it meets the
    // walls, came out warm.
    const rings = frames.map(ringOf);
    return solveGains(
      frames.length,
      overlaps,
      rings.map((r) => (r === 0 ? 0.15 : 1)),
      rings.map((r) => (r < 0 ? 0.3 : 0.01)),
    );
  }

  /**
   * Where each frame of a ring hands over to its neighbours round it, row by row (2026-10-04): every frame laid alone on
   * a preview [SEAM_W] wide, the band between each pair of neighbours cut out of the two, and the path from straight
   * down to straight up found ([columnSeamCost], [seamColumns]) that crosses the least difference in texture between
   * them and hands no place to a frame that has nothing there. A texture one texel wide per frame and one row per row of
   * the preview, as COLUMN_SEAM_GLSL reads it: its seam with the neighbour on its left and on its right, degrees from the
   * way it looks (-180 and 180 where it has no neighbour near enough to cut). Null when no ring has two frames.
   */
  columnSeams(frames: PanoFrame[], textures: Texture[], dist: DistanceMap | null, gains: [number, number, number][] | null = null): { seams: Texture; shift: Texture } | null {
    const THREE = this.THREE;
    const W = SEAM_W;
    const H = COLUMN_SEAM_H;
    const yaw = frames.map(yawOf);
    // Half of each frame's view across, degrees: what says two neighbours overlap at all.
    const half = frames.map((f) => (Math.atan(f.camera.width / 2 / f.camera.fx) * 180) / Math.PI);
    type Band = { a: number; b: number; x0: number; w: number; ta: Float32Array | null; tb: Float32Array | null; ga: Float32Array | null; gb: Float32Array | null };
    const bands: Band[] = [];
    for (const r of [-1, 0, 1]) {
      const ring = frames.map((f, k) => k).filter((k) => ringOf(frames[k] as PanoFrame) === r).sort((i, j) => (yaw[i] as number) - (yaw[j] as number));
      if (ring.length < 2) continue;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i] as number;
        const b = ring[(i + 1) % ring.length] as number;
        const gap = (((yaw[b] as number) - (yaw[a] as number)) % 360 + 360) % 360;
        if (gap <= 0 || gap > COLUMN_SEAM_REACH * ((half[a] as number) + (half[b] as number))) continue;
        const mid = (yaw[a] as number) + gap / 2;
        const x0 = Math.round((((mid - COLUMN_BAND * gap) / 360 + 0.5) * W));
        const x1 = Math.round((((mid + COLUMN_BAND * gap) / 360 + 0.5) * W));
        if (x1 - x0 < 3) continue;
        bands.push({ a, b, x0, w: x1 - x0 + 1, ta: null, tb: null, ga: null, gb: null });
      }
    }
    if (bands.length === 0) return null;
    // Each frame alone on the preview, once, and the bands it is in cut out of it.
    const target = this.target(W, SEAM_W / 2, THREE.UnsignedByteType, false);
    const m = this.projector();
    this.ringsOf(m, frames);
    (m.uniforms.mode as { value: number }).value = 2;
    m.blending = THREE.NoBlending;
    const buf = new Uint8Array(W * (SEAM_W / 2) * 4);
    for (let k = 0; k < frames.length; k++) {
      const mine = bands.filter((band) => band.a === k || band.b === k);
      if (mine.length === 0) continue;
      this.setFrame(m, frames[k] as PanoFrame, textures[k] as Texture, dist, k);
      (m.uniforms.gain as { value: import("three").Vector3 }).value.set(...(gains?.[k] ?? [1, 1, 1]));
      this.pass(m, target, true);
      this.renderer.readRenderTargetPixels(target, 0, 0, W, SEAM_W / 2, buf);
      for (const band of mine) {
        const cut = new Uint8Array(band.w * H * 4);
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < band.w; x++) {
            const src = (y * W + ((((band.x0 + x) % W) + W) % W)) * 4;
            cut.set(buf.subarray(src, src + 4), (y * band.w + x) * 4);
          }
        }
        const texture = textureOf(cut, band.w, H);
        const grey = linearGreyOf(cut, band.w, H);
        if (band.a === k) {
          band.ta = texture;
          band.ga = grey;
        } else {
          band.tb = texture;
          band.gb = grey;
        }
      }
    }
    m.dispose();
    target.dispose();
    // Left and right of each frame, degrees from the way it looks (as far as the circle goes where nothing cuts it), and
    // its light at each; and how far it is bent on each, degrees right and up.
    const data = new Float32Array(frames.length * H * 4);
    const bend = new Float32Array(frames.length * H * 4);
    for (let k = 0; k < frames.length; k++) {
      for (let y = 0; y < H; y++) {
        data[(y * frames.length + k) * 4] = -180;
        data[(y * frames.length + k) * 4 + 1] = 180;
      }
    }
    const degPerSample = 360 / W;
    for (const band of bands) {
      if (!band.ta || !band.tb || !band.ga || !band.gb) continue;
      const cols = seamColumns(columnSeamCost(band.ta, band.tb, band.w, H), band.w, H);
      // What the seam crosses, every few rows: how far apart the two have it, and which is brighter there.
      const rows: number[] = [];
      const readings: SeamReading[] = [];
      for (let y = 0; y < H; y += SEAM_READ_STEP) {
        rows.push(y);
        readings.push(readAcross(band.ta, band.tb, band.ga, band.gb, band.w, H, cols[y] as number, y));
      }
      const even = evenAlong(readings);
      for (let y = 0; y < H; y++) {
        const seamYaw = ((band.x0 + (cols[y] as number) + 0.5) / W - 0.5) * 360;
        const along = between(rows, y);
        const dx = lerpAt(even.dx, along) * degPerSample;
        const dy = lerpAt(even.dy, along) * degPerSample;
        const light = lerpAt(even.light, along);
        const ia = (y * frames.length + band.a) * 4;
        const ib = (y * frames.length + band.b) * 4;
        // The frame on the left of the seam: its right edge, evened down by half the difference, bent back by half.
        data[ia + 1] = wrap180(seamYaw - (yaw[band.a] as number));
        data[ia + 3] = -light / 2;
        bend[ia + 2] = dx;
        bend[ia + 3] = dy;
        // The frame on its right: its left edge, evened up by half, bent on by half.
        data[ib] = wrap180(seamYaw - (yaw[band.b] as number));
        data[ib + 2] = light / 2;
        bend[ib] = dx;
        bend[ib + 1] = dy;
      }
    }
    const texture = (values: Float32Array) => {
      const t = new THREE.DataTexture(values, frames.length, H, THREE.RGBAFormat, THREE.FloatType);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.needsUpdate = true;
      return t;
    };
    return { seams: texture(data), shift: texture(bend) };
  }

  /** Each frame of a ring cut, bent and lit at its seams with its neighbours ([columnSeams]), or not. */
  private withColumnSeams(m: import("three").ShaderMaterial, columns: { seams: Texture; shift: Texture } | null) {
    const u = m.uniforms as Record<string, { value: unknown }>;
    u.colSeams!.value = columns?.seams ?? null;
    u.colShift!.value = columns?.shift ?? null;
    u.hasColSeams!.value = columns ? 1 : 0;
  }

  /**
   * Where the level ring hands over to the floor ring and to the ceiling ring, column by column (2026-10-03): each
   * ring laid alone on a small panorama, read back, and the path round the circle found ([seamCost], [seamRows]) that
   * crosses the least difference in texture between the two, within [SEAM_LOW_RANGE] and [SEAM_HIGH_RANGE], handing
   * no place to a ring without a frame there; then how much brighter the level ring is than the other along it
   * ([seamLight]). A texture [SEAM_W] wide, one texel per column (as SEAM_GLSL reads it), or null without a level
   * ring. A ring that is missing leaves its seam where the fixed band had it. Each ring is drawn with its frames cut at
   * their own seams ([columns], 2026-10-04), as the bake draws it.
   */
  seams(frames: PanoFrame[], textures: Texture[], dist: DistanceMap | null, gains: [number, number, number][] | null, columns: { seams: Texture; shift: Texture } | null = null): { seams: Texture; shift: Texture } | null {
    const THREE = this.THREE;
    const W = SEAM_W;
    const H = SEAM_W / 2;
    const target = this.target(W, H, THREE.UnsignedByteType, false);
    const m = this.projector();
    this.ringsOf(m, frames);
    (m.uniforms.mode as { value: number }).value = 2;
    m.blending = THREE.NoBlending;
    this.withColumnSeams(m, columns);
    const pictures = new Map<number, Uint8Array>();
    for (const r of [-1, 0, 1]) {
      const members = frames.map((f, k) => k).filter((k) => ringOf(frames[k] as PanoFrame) === r);
      if (members.length === 0) continue;
      // Cleared once, then each frame where it covers well over what is there.
      const before = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(target);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear(true, false, false);
      this.renderer.setRenderTarget(before);
      for (const k of members) {
        this.setFrame(m, frames[k] as PanoFrame, textures[k] as Texture, dist, k);
        (m.uniforms.gain as { value: import("three").Vector3 }).value.set(...(gains?.[k] ?? [1, 1, 1]));
        this.pass(m, target, false);
      }
      const buf = new Uint8Array(W * H * 4);
      this.renderer.readRenderTargetPixels(target, 0, 0, W, H, buf);
      pictures.set(r, buf);
    }
    m.dispose();
    target.dispose();
    const level = pictures.get(0);
    if (!level) return null;
    // Row 0 is straight down: the pitch of a row's middle, and the row a pitch falls in.
    const pitchOf = (y: number) => ((y + 0.5) / H) * 180 - 90;
    const rowOf = (deg: number) => Math.min(H - 1, Math.max(0, Math.floor(((deg + 90) / 180) * H)));
    // The disagreement is in TEXTURE, not brightness: each ring's grey less its own local mean, so a ring a shade
    // brighter over a plain wall (the floor ring sees the lower wall at a slant) is no reason for the seam to wander.
    const levelTexture = textureOf(level, W, H);
    // Each seam's row in every column, and the light of the level ring over the other's along it.
    const levelGrey = linearGreyOf(level, W, H);
    const seamOf = (other: Uint8Array | undefined, range: [number, number], nominalDeg: number, side: 1 | -1, toward: number) => {
      if (!other) return { pitch: new Float32Array(W).fill(nominalDeg), light: new Float32Array(W), dx: new Float32Array(W), dy: new Float32Array(W) };
      const y0 = rowOf(range[0]);
      const h = rowOf(range[1]) - y0 + 1;
      const band = (t: Float32Array) => t.slice(y0 * W, (y0 + h) * W);
      const otherTexture = textureOf(other, W, H);
      const cost = seamCost(band(levelTexture), band(otherTexture), W, h, side, { ...SEAM_COST_DEFAULTS, toward });
      const rows = Int32Array.from(seamRows(cost, W, h), (r) => y0 + r);
      // What the seam crosses, every few columns round the circle: how far apart the two rings have it (2026-10-05).
      const otherGrey = linearGreyOf(other, W, H);
      const xs: number[] = [];
      const readings: SeamReading[] = [];
      for (let x = 0; x < W; x += SEAM_READ_STEP) {
        xs.push(x);
        readings.push(readAcross(levelTexture, otherTexture, levelGrey, otherGrey, W, H, x, rows[x] as number, true));
      }
      const even = evenAlong(readings);
      const dx = new Float32Array(W);
      const dy = new Float32Array(W);
      for (let x = 0; x < W; x++) {
        const along = between(xs, x, W);
        dx[x] = lerpAt(even.dx, along, true) * (360 / W);
        dy[x] = lerpAt(even.dy, along, true) * (360 / W);
      }
      return { pitch: Float32Array.from(rows, pitchOf), light: seamLight(level, other, W, H, rows, { ...SEAM_LIGHT_DEFAULTS, limit: RING_LIGHT_LIMIT }), dx, dy };
    };
    const low = seamOf(pictures.get(-1), SEAM_LOW_RANGE, BAND_LOW_DEG, -1, SEAM_TOWARD_LOW);
    const high = seamOf(pictures.get(1), SEAM_HIGH_RANGE, BAND_HIGH_DEG, 1, SEAM_TOWARD_HIGH);
    // One texel a column: the floor seam's pitch, the ceiling seam's, and the light along each (see SEAM_GLSL).
    const data = new Float32Array(W * 4);
    for (let x = 0; x < W; x++) {
      data[x * 4] = low.pitch[x] as number;
      data[x * 4 + 1] = high.pitch[x] as number;
      data[x * 4 + 2] = low.light[x] as number;
      data[x * 4 + 3] = high.light[x] as number;
    }
    // And how far each seam's other ring has what the level ring shows on it (see SEAM_GLSL's ringShiftAt).
    const bend = new Float32Array(W * 4);
    for (let x = 0; x < W; x++) {
      bend[x * 4] = low.dx[x] as number;
      bend[x * 4 + 1] = low.dy[x] as number;
      bend[x * 4 + 2] = high.dx[x] as number;
      bend[x * 4 + 3] = high.dy[x] as number;
    }
    const texture = (values: Float32Array) => {
      const t = new THREE.DataTexture(values, W, 1, THREE.RGBAFormat, THREE.FloatType);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.wrapS = THREE.RepeatWrapping;
      t.needsUpdate = true;
      return t;
    };
    return { seams: texture(data), shift: texture(bend) };
  }

  /**
   * The panorama: [frames] (with their [textures]) laid on a [width] x [width]/2 picture, through the
   * proxy [dist], evened by [gains]. Returned as a texture the caller owns (dispose it).
   */
  bake(frames: PanoFrame[], textures: Texture[], dist: DistanceMap | null, gains: [number, number, number][] | null, width: number): Texture {
    const THREE = this.THREE;
    const W = width;
    const H = width / 2;
    // Where each frame of a ring meets its neighbours (2026-10-04), then where the rings meet (2026-10-03), found on
    // previews first.
    const columns = this.columnSeams(frames, textures, dist, gains);
    const rings = this.seams(frames, textures, dist, gains, columns);
    const acc: RT[] = [this.target(W, H, THREE.HalfFloatType)];
    const m = this.projector();
    this.ringsOf(m, frames);
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneFactor;
    m.blendSrcAlpha = THREE.OneFactor;
    m.blendDstAlpha = THREE.OneFactor;
    (m.uniforms.seams as { value: Texture | null }).value = rings?.seams ?? null;
    (m.uniforms.hasSeams as { value: number }).value = rings ? 1 : 0;
    (m.uniforms.ringShift as { value: Texture | null }).value = rings?.shift ?? null;
    (m.uniforms.hasRingShift as { value: number }).value = rings ? 1 : 0;
    this.withColumnSeams(m, columns);
    frames.forEach((f, k) => {
      this.setFrame(m, f, textures[k] as Texture, dist, k);
      (m.uniforms.gain as { value: import("three").Vector3 }).value.set(...(gains?.[k] ?? [1, 1, 1]));
      this.pass(m, acc[0] as RT, k === 0);
    });
    m.dispose();
    rings?.seams.dispose();
    rings?.shift.dispose();
    columns?.seams.dispose();
    columns?.shift.dispose();

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

/** A preview's grey (RGBA, [w] x [h]), 0-1, NaN where nothing covers it. */
function greyOf(p: Uint8Array, w: number, h: number): Float32Array {
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    g[i] = (p[i * 4 + 3] as number) < 128 ? Number.NaN : (0.299 * (p[i * 4] as number) + 0.587 * (p[i * 4 + 1] as number) + 0.114 * (p[i * 4 + 2] as number)) / 255;
  }
  return g;
}

/** A preview's texture: its grey less the mean of the 5 x 5 round each place (wrapping round the circle), NaN where nothing covers it. */
function textureOf(p: Uint8Array, w: number, h: number): Float32Array {
  const g = greyOf(p, w, h);
  const r = 2;
  // Box sums, rows then columns, over what is covered.
  const sumH = new Float32Array(w * h);
  const cntH = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let c = 0;
      for (let d = -r; d <= r; d++) {
        const v = g[y * w + ((x + d + w) % w)] as number;
        if (!Number.isNaN(v)) { s += v; c++; }
      }
      sumH[y * w + x] = s;
      cntH[y * w + x] = c;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = g[y * w + x] as number;
      if (Number.isNaN(v)) { out[y * w + x] = Number.NaN; continue; }
      let s = 0;
      let c = 0;
      for (let d = -r; d <= r; d++) {
        const yy = y + d;
        if (yy < 0 || yy >= h) continue;
        s += sumH[yy * w + x] as number;
        c += cntH[yy * w + x] as number;
      }
      out[y * w + x] = v - s / Math.max(1, c);
    }
  }
  return out;
}

/** A preview's grey as linear light (it is stored gamma 2.2), 0-1, NaN where nothing covers it: what the light along a seam is read in. */
function linearGreyOf(p: Uint8Array, w: number, h: number): Float32Array {
  const g = new Float32Array(w * h);
  const lin = new Float32Array(256);
  for (let v = 0; v < 256; v++) lin[v] = Math.pow(v / 255, 2.2);
  for (let i = 0; i < w * h; i++) {
    g[i] = (p[i * 4 + 3] as number) < 128 ? Number.NaN : 0.299 * (lin[p[i * 4] as number] as number) + 0.587 * (lin[p[i * 4 + 1] as number] as number) + 0.114 * (lin[p[i * 4 + 2] as number] as number);
  }
  return g;
}

/** Where [x] falls among the sorted readings' places [at]: the reading before it and how far on to the next (0-1); round the circle of [period] when given. */
function between(at: number[], x: number, period = 0): { k: number; t: number } {
  const n = at.length;
  if (n === 0) return { k: 0, t: 0 };
  let k = 0;
  while (k + 1 < n && (at[k + 1] as number) <= x) k++;
  if (period > 0 && x < (at[0] as number)) {
    // Before the first reading: between the last, a lap back, and the first.
    const last = (at[n - 1] as number) - period;
    return { k: n - 1, t: (x - last) / ((at[0] as number) - last) };
  }
  const next = k + 1 < n ? (at[k + 1] as number) : period > 0 ? (at[0] as number) + period : (at[k] as number);
  const span = next - (at[k] as number);
  return { k, t: span > 0 ? (x - (at[k] as number)) / span : 0 };
}

/** [v] between readings [along].k and the next (round to the first when [wrap]). */
function lerpAt(v: Float32Array, along: { k: number; t: number }, wrap = false): number {
  const a = v[along.k] as number;
  const nk = along.k + 1 < v.length ? along.k + 1 : wrap ? 0 : along.k;
  const b = v[nk] as number;
  return a + (b - a) * along.t;
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
