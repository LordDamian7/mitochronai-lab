// Build a signed update package for this app, to copy onto a USB stick.
//
//   node scripts/make-update.mjs --init-key            once, on John's PC: create the signing key
//   node scripts/make-update.mjs [--notes "..."] [--out <folder>]
//
// The private key lives in your user profile (never in a repository). Only its public half is in lib/update-key.ts.
// Bump "version" in package.json before building: the lab only accepts a newer version.
import { generateKeyPairSync, createPublicKey } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPackage, managedFiles } from "../lib/update.ts";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY_DIR = path.join(os.homedir(), ".mitochronai", "update-signing");
const PRIVATE = path.join(KEY_DIR, "ed25519-private.pem");
const PUBLIC_TS = path.join(WEB, "lib", "update-key.ts");
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const pubTs = (pem) => `/** Public half of the update-signing key. The private half stays on the developer's PC (see scripts/make-update.mjs). */\nexport const UPDATE_PUBLIC_KEY = ${JSON.stringify(pem)};\n`;

if (process.argv.includes("--init-key")) {
  if (existsSync(PRIVATE)) {
    console.log(`A signing key already exists: ${PRIVATE}\nNot replacing it (packages signed with it would stop being accepted). Writing its public half into the app.`);
  } else {
    mkdirSync(KEY_DIR, { recursive: true });
    const k = generateKeyPairSync("ed25519");
    writeFileSync(PRIVATE, k.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    console.log(`Created the signing key: ${PRIVATE}\nKeep it private and back it up (e.g. on an encrypted USB kept somewhere safe).`);
  }
  writeFileSync(PUBLIC_TS, pubTs(createPublicKey(readFileSync(PRIVATE)).export({ type: "spki", format: "pem" }).toString()));
  console.log(`Wrote the public key to ${path.relative(process.cwd(), PUBLIC_TS)}.`);
  process.exit(0);
}

if (!existsSync(PRIVATE)) { console.error(`No signing key at ${PRIVATE}. Run: node scripts/make-update.mjs --init-key`); process.exit(1); }
const priv = readFileSync(PRIVATE, "utf8");
const pub = createPublicKey(priv).export({ type: "spki", format: "pem" }).toString();
const { UPDATE_PUBLIC_KEY } = await import(`file:///${PUBLIC_TS.replace(/\\/g, "/")}`);
if (UPDATE_PUBLIC_KEY.trim() !== pub.trim()) { console.error("lib/update-key.ts doesn't match your signing key, so labs couldn't verify this package. Run --init-key."); process.exit(1); }

const pkgJson = JSON.parse(readFileSync(path.join(WEB, "package.json"), "utf8"));
const files = managedFiles(WEB).map((p) => ({ path: p, data: readFileSync(path.join(WEB, p)) }));
const out = path.resolve(arg("--out") ?? path.join(WEB, "..", "dist-updates"));
mkdirSync(out, { recursive: true });
const pkg = buildPackage({ app: pkgJson.name, version: pkgJson.version, notes: arg("--notes") ?? "", files, privateKeyPem: priv });
const file = path.join(out, `${pkgJson.name}-${pkgJson.version}.mlup`);
writeFileSync(file, pkg);
console.log(`Built ${file}\n  app ${pkgJson.name} · version ${pkgJson.version} · ${files.length} files · ${(pkg.length / 1024).toFixed(0)} KB · signed`);
