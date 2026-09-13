'use strict';
// Minimal JSON API server used to measure gzip compression behavior at
// different response sizes. No dependencies beyond Node's stdlib.
//
// GET /json?bytes=<n>&gzip=<0|1>       -> synthetic JSON payload, ~n bytes
// GET /real?gzip=<0|1>                 -> real fixture payload (fixture.json)
//
// bytes-on-wire accounting is left entirely to the raw-socket client
// (client.js) which counts everything actually received, including headers.

const http = require('http');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const FIXTURE_PATH = path.join(__dirname, 'fixture.json');

// Build a JSON payload of approximately `targetBytes` bytes. JSON, not
// random noise, so it compresses the way a real API response would
// (repeated key names, short string values) rather than like white noise.
function makeSyntheticPayload(targetBytes) {
  const items = [];
  let approxLen = 2; // for the enclosing []
  let i = 0;
  while (approxLen < targetBytes) {
    const item = {
      id: i,
      name: `user-${i}`,
      email: `user${i}@example.com`,
      active: i % 2 === 0,
      role: i % 5 === 0 ? 'admin' : 'member',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const serialized = JSON.stringify(item);
    approxLen += serialized.length + 1; // +1 for comma/bracket
    items.push(item);
    i += 1;
  }
  let body = JSON.stringify(items);
  // Trim/pad to land close to the exact target byte count so size buckets
  // are comparable across runs.
  if (Buffer.byteLength(body) > targetBytes) {
    // Drop the last item(s) until we're at or under target, then pad.
    while (items.length > 1 && Buffer.byteLength(JSON.stringify(items)) > targetBytes) {
      items.pop();
    }
    body = JSON.stringify(items);
  }
  const deficit = targetBytes - Buffer.byteLength(body);
  if (deficit > 0 && items.length > 0) {
    // Pad using a filler field on the last item so exact byte target is hit.
    const pad = 'x'.repeat(Math.max(0, deficit - 12)); // account for `"pad":""`
    items[items.length - 1].pad = pad;
    body = JSON.stringify(items);
  }
  return body;
}

// Known-incompressible payload: base64-encoded random bytes, wrapped in a
// tiny JSON envelope. Used only as a sanity check on the measurement
// instrument itself (gzip should not meaningfully shrink this).
function makeIncompressiblePayload(targetBytes) {
  const raw = crypto.randomBytes(Math.ceil((targetBytes * 3) / 4));
  const b64 = raw.toString('base64').slice(0, Math.max(0, targetBytes - 12));
  return JSON.stringify({ blob: b64 });
}

let fixtureCache = null;
function loadFixture() {
  if (fixtureCache === null) {
    fixtureCache = fs.readFileSync(FIXTURE_PATH, 'utf8');
  }
  return fixtureCache;
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  let bodyStr;

  if (parsed.pathname === '/json') {
    const bytes = parseInt(parsed.query.bytes, 10) || 100;
    bodyStr = makeSyntheticPayload(bytes);
  } else if (parsed.pathname === '/random') {
    const bytes = parseInt(parsed.query.bytes, 10) || 5000;
    bodyStr = makeIncompressiblePayload(bytes);
  } else if (parsed.pathname === '/real') {
    bodyStr = loadFixture();
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return;
  }

  const useGzip = parsed.query.gzip === '1';
  const bodyBuf = Buffer.from(bodyStr, 'utf8');

  if (useGzip) {
    zlib.gzip(bodyBuf, { level: zlib.constants.Z_DEFAULT_COMPRESSION }, (err, compressed) => {
      if (err) {
        res.writeHead(500);
        res.end('gzip error');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        'Content-Length': compressed.length,
        Connection: 'close',
      });
      res.end(compressed);
    });
  } else {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': bodyBuf.length,
      Connection: 'close',
    });
    res.end(bodyBuf);
  }
});

const PORT = process.env.PORT || 8085;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`server listening on http://127.0.0.1:${PORT}`);
});
