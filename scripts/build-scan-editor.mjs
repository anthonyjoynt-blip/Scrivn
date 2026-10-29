/**
 * Builds Scrivn's sketch editor for Scrivn Scan (2026-10-28, lib/scanEditorWebView.tsx): the app's own editor, offline, in
 * its WebView (SketchEditorActivity.kt). The contract with the app is ARCapturePrototype's scan-editor/BRIDGE.md.
 *
 *   node scripts/build-scan-editor.mjs              writes ../ARCapturePrototype/android/app/src/main/assets/scrivn-editor/
 *   node scripts/build-scan-editor.mjs --out DIR    writes DIR/{index.html, editor.js, editor.css}
 *   node scripts/build-scan-editor.mjs --check      builds it in memory and says whether Scan's copy (or --out's) is this build
 *   node scripts/build-scan-editor.mjs --serve      serves it on :4623 with a pretend phone (?fixture=empty|target|basement)
 *
 * Build it again, and rebuild Scan, whenever the sketch editor changes here: the phone runs the copy it was built with. The
 * script names the Scrivn commit it was made from, and the phone records it with every sketch it saves.
 *
 * What it leaves out, and refuses to build with: the outside of the house (ExteriorEditor and everything behind it), the 3D
 * views (three.js), anything that talks to scrivn.ca ("/api/"), workers and CSS modules. They are replaced by stand-ins
 * that draw nothing ([STANDINS]); a stand-in no longer needed, a package not on [ALLOWED], or a file on [REFUSED] fails the
 * build, so a change in the editor that would pull one in is found here, not on the phone.
 */

import { build } from "esbuild";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outArg = args.indexOf("--out");
const check = args.includes("--check");
const serve = args.includes("--serve");
const scanAssets = resolve(root, "..", "ARCapturePrototype", "android", "app", "src", "main", "assets", "scrivn-editor");
const outDir = outArg >= 0 ? resolve(args[outArg + 1]) : scanAssets;

/** What the editor is built from: the libs, the sketch components, the styles and the packages' versions. */
const SOURCES = "lib components/sketch app/globals.css package-lock.json";

/** The page's own Content-Security-Policy (BRIDGE.md): nothing but its own two files, and no network at all. */
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";

/** Biggest editor.js allowed (measured ~1.3 MB on 2026-10-28). */
export const MAX_JS_BYTES = 1.6 * 1024 * 1024;

/** Packages the editor may bundle. Anything else is new, and asked about before it goes on a phone. */
export const ALLOWED = ["react", "react-dom", "scheduler", "react-reconciler", "its-fine", "konva", "react-konva", "jspdf", "pako", "fflate", "fast-png", "iobuffer", "@babel/runtime", "use-sync-external-store"];

/** Our own files that must never be in it. */
export const REFUSED = [/PhotoRoute/, /components[\\/]sketch[\\/]ExteriorEditor\.tsx$/, /Sketch3D\.tsx$/, /Exterior3D\.tsx$/, /closeUpWorker/, /\.module\.css$/, /exteriorImages/, /exteriorDrawings/];

/** The editor's imports that are replaced, and what by. */
const STANDINS = {
  "next/dynamic": `import { createElement, lazy, Suspense } from "react";
export default function dynamic(load, opts) {
  const Lazy = lazy(() => load().then((m) => ({ default: m && m.default ? m.default : m })));
  const Fallback = opts && opts.loading;
  return function Dynamic(props) { return createElement(Suspense, { fallback: Fallback ? createElement(Fallback) : null }, createElement(Lazy, props)); };
}`,
  "./ExteriorEditor": `export function ExteriorSite() { return null; }`,
  "./exteriorPhotoAccess": `import { createContext } from "react"; export const ExteriorPhotoContext = createContext(null);`,
  "./Sketch3D": `export default function Sketch3D() { return null; }`,
  "./Exterior3D": `export default function Exterior3D() { return null; }`,
};

/**
 * The last commit that changed what the editor is built from, and whether the tree has changes past it: the same name for
 * the same editor, whatever else is committed after it.
 */
function commit() {
  try {
    const sha = execSync(`git log -1 --format=%h -- ${SOURCES}`, { cwd: root }).toString().trim();
    const dirty = execSync(`git status --porcelain -- ${SOURCES}`, { cwd: root }).toString().trim() !== "";
    return `${sha}${dirty ? "+" : ""}`;
  } catch {
    return "unknown";
  }
}

function standins(used) {
  return {
    name: "scan-editor-standins",
    setup(b) {
      const filter = new RegExp(`^(${Object.keys(STANDINS).map((k) => k.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|")})$`);
      b.onResolve({ filter }, (a) => {
        used.add(a.path);
        return { path: a.path, namespace: "standin" };
      });
      b.onLoad({ filter: /.*/, namespace: "standin" }, (a) => ({ contents: STANDINS[a.path], loader: "jsx", resolveDir: root }));
    },
  };
}

/** The packages and our files a build took in, from its metafile. */
function inputsOf(metafile) {
  const packages = new Set();
  const ours = [];
  for (const path of Object.keys(metafile.inputs)) {
    if (path.startsWith("standin:")) continue;
    const m = path.match(/node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/);
    if (m) packages.add(m[1].replace(/\\/g, "/"));
    else ours.push(path);
  }
  return { packages: [...packages].sort(), ours };
}

/** Everything wrong with a build, or nothing. */
export function guards(js, metafile, used) {
  const problems = [];
  for (const k of Object.keys(STANDINS)) if (!used.has(k)) problems.push(`stand-in ${k} is no longer used: take it out of STANDINS`);
  const { packages, ours } = inputsOf(metafile);
  for (const p of packages) if (!ALLOWED.includes(p)) problems.push(`package ${p} is not on the allowed list`);
  for (const f of ours) for (const r of REFUSED) if (r.test(f)) problems.push(`${f} must not be in the phone's editor`);
  if (js.includes("/api/")) problems.push(`"/api/" is in the bundle: something in it talks to scrivn.ca`);
  if (Buffer.byteLength(js) > MAX_JS_BYTES) problems.push(`editor.js is ${(Buffer.byteLength(js) / 1024).toFixed(0)} KB, over ${(MAX_JS_BYTES / 1024).toFixed(0)} KB`);
  return { problems, packages, ours };
}

export async function buildEditor() {
  const version = `scrivn ${commit()}`;
  const used = new Set();
  const result = await build({
    entryPoints: [join(root, "lib", "scanEditorWebView.tsx")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    minify: true,
    write: false,
    metafile: true,
    jsx: "automatic",
    alias: { "@": root },
    define: { __SCRIVN_EDITOR__: JSON.stringify(version), "process.env.NODE_ENV": '"production"' },
    // jsPDF's optional pieces for HTML and SVG-as-picture: the plan draws neither.
    external: ["html2canvas", "dompurify", "canvg"],
    loader: { ".css": "empty" },
    plugins: [standins(used)],
    legalComments: "none",
    logLevel: "error",
  });
  const date = new Date().toISOString().slice(0, 10);
  const js = `/* scrivn-editor ${version} ${date} - Scrivn's sketch editor for Scrivn Scan, built by ScopeAssistantWeb/scripts/build-scan-editor.mjs: do not edit. */\n${result.outputFiles[0].text}`;
  const css = `/* scrivn-editor ${version}: app/globals.css, then lib/scanEditor.css. */\n${readFileSync(join(root, "app", "globals.css"), "utf8")}\n${readFileSync(join(root, "lib", "scanEditor.css"), "utf8")}`;
  const html = indexHtml(false);
  const checked = guards(result.outputFiles[0].text, result.metafile, used);
  return { version, js, css, html, ...checked };
}

/** The page: the CSP, the styles, the app's mount point, the script (and, served, the pretend phone first). */
function indexHtml(devBridge) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>Sketch</title>
<link rel="stylesheet" href="editor.css">
</head>
<body>
<div id="app"></div>
${devBridge ? '<script src="dev-bridge.js"></script>\n' : ""}<script src="editor.js"></script>
</body>
</html>
`;
}

/** What the three files are, line endings and header lines aside (git's autocrlf, the build date). */
function body(text) {
  return text.replace(/\r\n/g, "\n").replace(/^\/\*[^\n]*\*\/\n/, "");
}

const FIXTURES = {
  empty: null,
  target: resolve(root, "..", "Medicine Hat basement - target layout.json"),
  basement: resolve(root, "..", "ARCapturePrototype", "captures", "basement-1026", "room_20261026_061738_taps.json"),
};

/** A pretend phone for --serve: the bridge's page side talking to the console, the saves kept on window.__saves. */
function devBridge(fixture) {
  const file = FIXTURES[fixture] ?? null;
  const capture = file && existsSync(file) ? readFileSync(file, "utf8") : null;
  const input = {
    format: "scan-editor-input/1",
    project: { id: `dev_${fixture}`, name: fixture === "empty" ? "Sketch by hand" : fixture === "target" ? "Medicine Hat basement" : "Basement 10-26", origin: capture ? "scan" : "hand" },
    sketch: null,
    capture,
    captureId: capture ? `dev-${fixture}` : null,
    capturedAt: null,
    moisture: null,
    knownRoomNames: [],
    app: { versionName: "dev", versionCode: 0 },
    notice: null,
  };
  return `window.__saves = []; window.__actions = []; window.__renders = {}; window.__ready = null;
window.ScanEditor = {
  input: function () { return ${JSON.stringify(JSON.stringify(input))}; },
  ready: function (v) { window.__ready = v; console.log("[phone] ready", v); },
  changed: function (seq, json) { var o = JSON.parse(json); window.__saves.push({ seq: seq, done: false, save: o }); console.log("[phone] changed", seq, o.summary, "edited", o.edited); },
  done: function (seq, json) { var o = JSON.parse(json); window.__saves.push({ seq: seq, done: true, save: o }); console.log("[phone] done", seq, o.summary); },
  action: function (name) { window.__actions.push(name); console.log("[phone] action", name); },
  put: function (id, piece) { window.__renders[id] = (window.__renders[id] || "") + piece; },
  finished: function (id, error) { console.log("[phone] finished", id, error || "ok", (window.__renders[id] || "").length, "chars"); window.__renders[id + ":done"] = error || "ok"; },
  log: function (line) { console.log("[editor]", line); }
};`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const built = await buildEditor();
  if (built.problems.length > 0) {
    console.error(`The phone's editor is not built:\n  - ${built.problems.join("\n  - ")}`);
    process.exit(1);
  }
  const files = { "index.html": built.html, "editor.js": built.js, "editor.css": built.css };
  if (check) {
    const stale = Object.entries(files).filter(([name, text]) => {
      const target = join(outDir, name);
      return !existsSync(target) || body(readFileSync(target, "utf8")) !== body(text);
    });
    console.log(stale.length === 0 ? `Scan's editor is this build (${built.version}).` : `Scan's editor is not this build (${stale.map(([n]) => n).join(", ")}): run node scripts/build-scan-editor.mjs.`);
    process.exit(stale.length === 0 ? 0 : 1);
  }
  if (serve) {
    const port = Number(args[args.indexOf("--serve") + 1]) || 4623;
    let current = built;
    createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://x");
      const send = (type, text) => {
        res.writeHead(200, { "content-type": type, "cache-control": "no-store", "content-security-policy": CSP });
        res.end(text);
      };
      if (url.pathname === "/rebuild") {
        current = await buildEditor();
        return send("text/plain", current.problems.length ? current.problems.join("\n") : `rebuilt ${current.version}`);
      }
      if (url.pathname === "/" || url.pathname === "/index.html") {
        // The fixture rides in a cookie-free way: the bridge file is asked for with the page's own query.
        return send("text/html", indexHtml(true).replace('src="dev-bridge.js"', `src="dev-bridge.js?fixture=${url.searchParams.get("fixture") ?? "empty"}"`));
      }
      if (url.pathname === "/dev-bridge.js") return send("text/javascript", devBridge(url.searchParams.get("fixture") ?? "empty"));
      if (url.pathname === "/editor.js") return send("text/javascript", current.js);
      if (url.pathname === "/editor.css") return send("text/css", current.css);
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("");
    }).listen(port, () => console.log(`Scan's editor, served with a pretend phone: http://localhost:${port}/?fixture=empty|target|basement (${built.version}, ${(built.js.length / 1024).toFixed(0)} KB)`));
  } else {
    mkdirSync(outDir, { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(outDir, name), text);
    console.log(`${relative(process.cwd(), outDir) || outDir}: editor.js ${(built.js.length / 1024).toFixed(0)} KB, editor.css ${(built.css.length / 1024).toFixed(0)} KB, ${built.version}`);
  }
}
