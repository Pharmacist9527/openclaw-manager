import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const INDEX_HTML = readFileSync(
  join(__dirname, "..", "public", "index.html"),
  "utf-8"
);
