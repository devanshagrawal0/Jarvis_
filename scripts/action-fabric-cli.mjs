#!/usr/bin/env node
import process from "node:process";

const base = process.env.JARVIS_URL || "http://127.0.0.1:8799";
const [command = "status", ...rest] = process.argv.slice(2);
const routes = {
  status: ["GET", "/api/action/status"],
  list: ["GET", "/api/action/tasks"],
  create: ["POST", "/api/action/tasks"],
  stop: ["POST", "/api/action/stop"],
  release: ["POST", "/api/action/stop/release"],
};
if (!routes[command]) {
  console.error("Usage: node scripts/action-fabric-cli.mjs status|list|create|stop|release [JSON or prompt]");
  process.exit(2);
}
const [method, pathname] = routes[command];
let body;
if (method !== "GET") {
  const raw = rest.join(" ").trim();
  if (command === "create") {
    try { body = JSON.parse(raw); } catch { body = { prompt: raw || "Safe Action Fabric test", requestId: `cli-${Date.now()}` }; }
  } else body = raw ? { reason: raw } : {};
}
const response = await fetch(`${base}${pathname}`, { method, headers: { "content-type":"application/json" }, body: body ? JSON.stringify(body) : undefined });
console.log(JSON.stringify(await response.json(), null, 2));
if (!response.ok) process.exitCode = 1;
