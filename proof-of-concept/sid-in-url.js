// Check: does the Engine.IO session identifier (sid) appear in the URL?
// And, with long-polling, can someone who knows only the sid act within the authenticated session?
// Local lab only: server and client run on 127.0.0.1, with no external requests.
// Usage: node sid-in-url.js   (SHOW=1 node sid-in-url.js prints the logged URLs, with the sid masked)
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { Server } = require("socket.io");
const { io: connect } = require("socket.io-client");
const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");

const SECRET = crypto.randomBytes(32);
const PAYLOAD = "INJECTED-WITHOUT-TOKEN";

async function scenario(name, serverOptions, clientOptions, tryInjection) {
  const urls = [];
  const httpServer = http.createServer();
  const io = new Server(httpServer, serverOptions);
  // logs the URLs as an access log would (HTTP and upgrade requests)
  httpServer.prependListener("request", (req) => urls.push(req.url));
  httpServer.prependListener("upgrade", (req) => urls.push(req.url));

  io.use((socket, next) => {
    try { socket.data.claims = jwt.verify(socket.handshake.auth.token, SECRET, { algorithms: ["HS256"] }); next(); }
    catch { next(new Error("unauthorized")); }
  });
  const received = [];
  io.on("connection", (socket) => {
    socket.on("reading:send", (v) => received.push({ from: socket.data.claims.sub, v }));
  });

  await new Promise((ok) => httpServer.listen(0, "127.0.0.1", ok));
  const port = httpServer.address().port;
  const token = jwt.sign({ sub: "collector-1" }, SECRET, { algorithm: "HS256", expiresIn: 60 });
  const client = connect(`http://127.0.0.1:${port}`, { auth: { token }, reconnection: false, ...clientOptions });
  let error = null;
  await new Promise((ok) => { client.once("connect", ok); client.once("connect_error", (e) => { error = e.message; ok(); }); });
  await new Promise((ok) => setTimeout(ok, 500)); // time for a possible transport upgrade

  const clientUrls = [...urls]; // before the injection attempt, which would also be logged
  let injection = "not tested";
  if (tryInjection && !error) {
    // a third party that knows ONLY the sid (e.g., read from an access log), without the JWT
    const sid = client.io.engine.id;
    const r = await fetch(`http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling&sid=${sid}`, {
      method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: `42["reading:send","${PAYLOAD}"]`,
    });
    await new Promise((ok) => setTimeout(ok, 300));
    const hit = received.find((x) => x.v === PAYLOAD);
    injection = `HTTP ${r.status}; event processed as ${hit ? hit.from : "nobody (rejected)"}`;
  }

  const withSid = clientUrls.filter((u) => /[?&]sid=/.test(u)).length;
  if (process.env.SHOW) console.log(name, clientUrls.map((u) => u.replace(/sid=[^&]+/, "sid=<SID>").replace(/t=[^&]+/, "t=<T>")));
  const result = {
    scenario: name,
    connected: error ? `no (${error})` : "yes",
    final_transport: error ? "-" : client.io.engine.transport.name,
    logged_urls: clientUrls.length,
    urls_with_sid: withSid,
    injection_with_sid_only: injection,
  };
  client.close(); io.close();
  return result;
}

function engineVersion() {
  let dir = path.dirname(require.resolve("engine.io")); // walk up to engine.io's own package.json
  while (!fs.existsSync(path.join(dir, "package.json")) || JSON.parse(fs.readFileSync(path.join(dir, "package.json"))).name !== "engine.io") dir = path.dirname(dir);
  return JSON.parse(fs.readFileSync(path.join(dir, "package.json"))).version;
}

(async () => {
  const rows = [];
  rows.push(await scenario("default (polling + upgrade)", {}, {}, true));
  rows.push(await scenario("client polling only", {}, { transports: ["polling"] }, true));
  rows.push(await scenario("client websocket only", {}, { transports: ["websocket"] }, true));
  rows.push(await scenario("server websocket only, default client", { transports: ["websocket"] }, {}, false));
  rows.push(await scenario("server websocket only, websocket client", { transports: ["websocket"] }, { transports: ["websocket"] }, true));
  console.log(`socket.io ${require("socket.io/package.json").version} · engine.io ${engineVersion()} · node ${process.version}`);
  console.table(rows);
  process.exit(0);
})();
