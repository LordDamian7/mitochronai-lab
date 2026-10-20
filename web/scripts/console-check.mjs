import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await (await b.newContext()).newPage();
const msgs = [];
p.on("console", (m) => { if (["error", "warning"].includes(m.type())) msgs.push(`${m.type()}: ${m.text().slice(0, 400)}`); });
await p.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
await p.waitForTimeout(1500);
console.log(msgs.join("\n---\n") || "no console errors");
await b.close();
