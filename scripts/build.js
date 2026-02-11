import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Read HTML and create an inline module
const html = readFileSync(join(root, "public", "index.html"), "utf-8");

const inlineHtmlPlugin = {
  name: "inline-html",
  setup(build) {
    // Intercept import of ./html.js and return inline content
    build.onResolve({ filter: /\.\/html\.js$/ }, (args) => ({
      path: args.path,
      namespace: "inline-html",
    }));
    build.onLoad({ filter: /.*/, namespace: "inline-html" }, () => ({
      contents: `export const INDEX_HTML = ${JSON.stringify(html)};`,
      loader: "js",
    }));
  },
};

await build({
  entryPoints: [join(root, "bin", "setup.js")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: join(root, "dist", "setup.cjs"),
  plugins: [inlineHtmlPlugin],
  // Don't bundle node built-ins
  external: [],
  minify: false,
  sourcemap: false,
});

console.log("Build complete: dist/setup.cjs");
