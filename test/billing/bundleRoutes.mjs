/**
 * Bundles app routes for test/billing/routes.mjs and stripe-e2e.mjs: the real route code, with the
 * modules that reach outside the process swapped for test/billing/routeShims.mjs.
 */
import { build } from "esbuild";
import { mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

/** Bundles the routes with the shims; written under node_modules so the packages left external resolve. */
export async function bundleRoutes(entry, name) {
  const outDir = join(root, "node_modules", ".cache", "billing-routes");
  mkdirSync(outDir, { recursive: true });
  const outfile = join(outDir, `${name}-${process.pid}.mjs`);
  const shims = join(here, "routeShims.mjs");
  await build({
    stdin: { contents: entry, resolveDir: root, loader: "ts" },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    alias: { "@": root },
    jsx: "automatic",
    packages: "external",
    logLevel: "error",
    plugins: [
      {
        name: "billing-route-shims",
        setup(b) {
          // By alias or by relative path (lib/usage.ts imports "./supabase/server"), the same modules.
          const shimmed = new Set(["lib/supabase/admin", "lib/supabase/server", "lib/email/send", "lib/stripe/server", "lib/anthropic"].map((m) => join(root, m)));
          b.onResolve({ filter: /^(server-only|next\/server)$/ }, () => ({ path: shims }));
          b.onResolve({ filter: /^(@\/|\.{1,2}\/)/ }, (args) => {
            const target = args.path.startsWith("@/") ? join(root, args.path.slice(2)) : join(args.resolveDir, args.path);
            return shimmed.has(target.replace(/\.tsx?$/, "")) ? { path: shims } : undefined;
          });
          // Next's other entry points have no exports map, so Node needs the file name.
          b.onResolve({ filter: /^next\/(link|headers|navigation)$/ }, (args) => ({ path: `${args.path}.js`, external: true }));
        },
      },
    ],
  });
  const mod = await import(pathToFileURL(outfile).href);
  return { mod, cleanup: () => rmSync(outfile, { force: true }) };
}
