// Lets node:test load the app's TypeScript modules the way Next.js does: "@/lib/x" and extensionless "./x" imports.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function resolve(specifier, context, next) {
  let spec = specifier;
  if (spec.startsWith("@/")) spec = pathToFileURL(path.join(ROOT, spec.slice(2))).href;
  const local = spec.startsWith(".") || spec.startsWith("file:");
  if (local && !/\.[cm]?[jt]sx?$/.test(spec)) {
    for (const ext of [".ts", "/index.ts"]) {
      try { return await next(spec + ext, context); } catch { /* try the next form */ }
    }
  }
  return next(spec, context);
}
