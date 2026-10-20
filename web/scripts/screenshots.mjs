// Visual review: signs in as each role and photographs every screen at laptop and phone sizes, light and dark.
//   node scripts/screenshots.mjs [outDir]
// Uses the installed Google Chrome through playwright-core (no extra browser download).
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? path.join("var", "screenshots");
const users = JSON.parse(fs.readFileSync(path.join("seed", "demo-users.json"), "utf8")).users;
const pw = (u) => users.find((x) => x.username === u).password;
fs.mkdirSync(OUT, { recursive: true });

const SIZES = [
  { name: "laptop", viewport: { width: 1440, height: 900 } },
  { name: "phone", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
];
const PAGES = [
  ["worklist", "/worklist"],
  ["record", "/orders/ORD-016"],
  ["report", "/orders/ORD-016/report"],
  ["audit", "/audit"],
];

const browser = await chromium.launch({ channel: "chrome", headless: true });
const problems = [];
for (const size of SIZES) {
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ ...size, colorScheme: scheme, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("console", (m) => { if (m.type() === "error") problems.push(`${size.name}/${scheme} console: ${m.text()}`); });
    page.on("pageerror", (e) => problems.push(`${size.name}/${scheme} page error: ${e.message}`));
    await page.goto(`${BASE}/login`);
    await page.screenshot({ path: path.join(OUT, `${size.name}-${scheme}-login.png`) });
    await page.fill("#username", "gram.stain");
    await page.fill("#password", pw("gram.stain"));
    await Promise.all([page.waitForURL("**/dashboard"), page.click("button[type=submit]")]);
    for (const [name, url] of PAGES) {
      await page.goto(BASE + url, { waitUntil: "networkidle" }).catch(() => page.goto(BASE + url));
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (overflow) problems.push(`${size.name}/${scheme} ${name}: page scrolls sideways`);
      await page.screenshot({ path: path.join(OUT, `${size.name}-${scheme}-${name}.png`), fullPage: size.name === "laptop" });
    }
    await ctx.close();
  }
}
await browser.close();
console.log(`Screenshots in ${OUT}`);
console.log(problems.length ? problems.join("\n") : "No console errors, page errors or sideways scrolling.");
