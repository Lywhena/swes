// Proof of concept: residual authorization window in Socket.IO 4.8.4
// A = configuration taught by the official documentation (the middleware verifies the JWT once, at handshake)
// B = A + Gate 2 prototype (expiration timer, revocation channel and per-event check)
//
// Usage: node residual-window.js [repetitions] [limitSeconds]
// Local lab only: server and client run on 127.0.0.1, with no external requests.
"use strict";
const http = require("node:http");
const { Server } = require("socket.io");
const { io: connect } = require("socket.io-client");
const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");

const SECRET = crypto.randomBytes(32);
const REPETITIONS = Number(process.argv[2] || 5);
const LIMIT_MS = Number(process.argv[3] || 30) * 1000; // test time limit (censoring in A)
const ALGORITHMS = ["HS256"];

function issueToken(seconds) {
  const jti = crypto.randomUUID();
  const exp = Math.floor(Date.now() / 1000) + seconds;
  return { token: jwt.sign({ sub: "collector-1", jti, exp }, SECRET, { algorithm: "HS256" }), jti, exp };
}

function buildServer(withGate) {
  const httpServer = http.createServer();
  const io = new Server(httpServer);
  const revoked = new Set();
  const byJti = new Map();
  const acceptedAfter = { t0: Infinity, n: 0 };

  // Common to A and B: verification at handshake, as in the documentation
  io.use((socket, next) => {
    try {
      socket.data.claims = jwt.verify(socket.handshake.auth.token, SECRET, { algorithms: ALGORITHMS });
      next();
    } catch (e) {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const { jti, exp } = socket.data.claims;

    if (withGate) {
      // Gate 2 (prototype): closes the connection at expiration, even without any event
      const ms = exp * 1000 - Date.now();
      const timer = setTimeout(() => socket.disconnect(true), Math.max(0, ms));
      socket.on("disconnect", () => { clearTimeout(timer); byJti.delete(jti); });
      byJti.set(jti, socket);
      // Check on every received event
      socket.use((_packet, next) => {
        if (Date.now() >= exp * 1000 || revoked.has(jti)) {
          socket.disconnect(true);
          return next(new Error("credential expired or revoked"));
        }
        next();
      });
    }

    // The server delivers one reading per second to the client
    const interval = setInterval(() => socket.emit("reading", Date.now()), 1000);
    socket.on("disconnect", () => clearInterval(interval));

    // The server processes readings sent by the collector
    socket.on("reading:send", () => {
      if (Date.now() >= acceptedAfter.t0) acceptedAfter.n++;
    });
  });

  function revoke(jti) {
    revoked.add(jti);
    if (withGate) byJti.get(jti)?.disconnect(true); // revocation channel
  }

  return new Promise((ok) =>
    httpServer.listen(0, "127.0.0.1", () =>
      ok({ io, httpServer, port: httpServer.address().port, revoke, acceptedAfter })
    )
  );
}

async function runTrial(withGate, scenario) {
  const srv = await buildServer(withGate);
  const lifetime = scenario === "expiration" ? 5 : 3600;
  const { token, jti, exp } = issueToken(lifetime);
  const client = connect(`http://127.0.0.1:${srv.port}`, { auth: { token }, transports: ["websocket"], reconnection: false });

  await new Promise((ok, fail) => { client.once("connect", ok); client.once("connect_error", fail); });

  // t0: instant at which the credential stops being valid
  let t0;
  if (scenario === "expiration") {
    t0 = exp * 1000;
  } else {
    t0 = Date.now() + 3000;
    setTimeout(() => srv.revoke(jti), t0 - Date.now());
  }
  srv.acceptedAfter.t0 = t0;

  let deliveredAfter = 0;
  client.on("reading", () => { if (Date.now() >= t0) deliveredAfter++; });
  const sending = setInterval(() => client.emit("reading:send", Date.now()), 1000);

  const end = await new Promise((ok) => {
    const limit = setTimeout(() => ok({ closed: false, t: Date.now() }), Math.max(0, t0 - Date.now()) + LIMIT_MS);
    client.on("disconnect", () => { clearTimeout(limit); ok({ closed: true, t: Date.now() }); });
  });

  clearInterval(sending);
  client.close();
  srv.io.close();
  return {
    windowMs: end.t - t0,
    closed: end.closed,
    deliveredAfter,
    acceptedAfter: srv.acceptedAfter.n,
  };
}

function median(v) { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

(async () => {
  console.log(`socket.io ${require("socket.io/package.json").version} · node ${process.version} · ${REPETITIONS} repetitions · limit ${LIMIT_MS / 1000} s`);
  const rows = [];
  for (const scenario of ["expiration", "revocation"]) {
    for (const withGate of [false, true]) {
      const r = [];
      for (let i = 0; i < REPETITIONS; i++) r.push(await runTrial(withGate, scenario));
      const censored = r.filter((x) => !x.closed).length;
      rows.push({
        scenario,
        config: withGate ? "B (Gate 2 prototype)" : "A (documentation)",
        window_median_ms: censored === r.length ? `> ${LIMIT_MS} (still active at limit)` : median(r.map((x) => x.windowMs)),
        window_max_ms: censored ? `> ${LIMIT_MS}` : Math.max(...r.map((x) => x.windowMs)),
        delivered_after_t0_median: median(r.map((x) => x.deliveredAfter)),
        accepted_after_t0_median: median(r.map((x) => x.acceptedAfter)),
        censored_runs: `${censored}/${r.length}`,
      });
    }
  }
  console.table(rows);
  process.exit(0);
})();
