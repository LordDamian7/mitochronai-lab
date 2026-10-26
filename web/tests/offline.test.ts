import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { managedFiles } from "@/lib/update";

test("the app builds offline: nothing is downloaded at build time (USB updates are installed without internet)", () => {
  const code = managedFiles(process.cwd()).filter((f) => /\.(tsx?|mjs|css)$/.test(f) && !f.startsWith("tests/"));
  const online = code.filter((f) => /next\/font\/google|fonts\.googleapis|fonts\.gstatic/.test(readFileSync(f, "utf8")));
  assert.deepEqual(online, [], `these files fetch fonts from Google at build time: ${online.join(", ")}`);
  for (const f of ["plex-sans-latin.woff2", "plex-sans-latin-ext.woff2", "plex-mono-400-latin.woff2", "plex-mono-600-latin-ext.woff2"])
    assert.ok(existsSync(`public/fonts/${f}`), `bundled font missing: ${f}`);
  assert.match(readFileSync("app/globals.css", "utf8"), /@font-face\s*{[^}]*IBM Plex Sans[^}]*\/fonts\/plex-sans-latin\.woff2/);
});
