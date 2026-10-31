// Test double for the Dani Free proxy: mints a key, serves /v1/models, prints the ready line.
import { createServer } from "node:http";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const home = process.env.DANI_FREE_HOME;
mkdirSync(home, { recursive: true });
const apiKeyFile = join(home, "proxy-key");
writeFileSync(apiKeyFile, "stub-key-0123456789\n", { mode: 0o600 });

const server = createServer((req, res) => {
  if (req.headers["x-api-key"] !== "stub-key-0123456789") {
    res.writeHead(401).end(JSON.stringify({ error: "bad key" }));
    return;
  }
  if (req.url === "/v1/models" && req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "dani-free-auto", object: "model" }] }));
    return;
  }
  if (req.url === "/v1/models/refresh" && req.method === "POST") {
    res.writeHead(200, { "content-type": "application/json" }).end("{}");
    return;
  }
  res.writeHead(404).end("{}");
});
server.listen(0, "127.0.0.1", () => {
  const { port } = server.address();
  console.log(`DANI_FREE_READY ${JSON.stringify({ baseUrl: `http://127.0.0.1:${port}/v1`, port, pid: process.pid, apiKeyFile, privateMode: process.env.DANI_FREE_PRIVATE_MODE === "1" })}`);
});
process.on("SIGTERM", () => { server.close(); process.exit(0); });
if (process.env.STUB_DIE_EARLY) { console.error("stub: refusing to start"); process.exit(3); }
