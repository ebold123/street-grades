import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildQuery, fetchWays } from "../pipeline/overpass.js";

const BBOX = [-122.5, 37.7, -122.4, 37.8];

/** A local stand-in for Overpass. `script` lists one response per request, in order. */
async function fakeOverpass(script) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push(body);
      const step = script[Math.min(requests.length - 1, script.length - 1)];
      res.writeHead(step.status, { "Content-Type": "application/json" });
      res.end(typeof step.body === "string" ? step.body : JSON.stringify(step.body));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    endpoint: `http://127.0.0.1:${server.address().port}/api/interpreter`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const OK = { status: 200, body: { elements: [{ type: "way", id: 1 }] } };
const fast = { retryDelayMs: 1 };

test("buildQuery puts the box in south,west,north,east order and drops parking aisles", () => {
  const query = buildQuery(BBOX);
  assert.ok(query.includes("(37.7,-122.5,37.8,-122.4)"));
  assert.ok(query.includes('["service"!="parking_aisle"]'));
  assert.ok(query.includes("out geom;"));
  assert.ok(!query.includes("motorway"));
});

test("busy-server responses are retried until one succeeds", async () => {
  const server = await fakeOverpass([{ status: 504, body: "gateway timeout" }, { status: 429, body: "too many" }, OK]);
  try {
    const elements = await fetchWays(BBOX, { endpoint: server.endpoint, ...fast });
    assert.deepEqual(elements, [{ type: "way", id: 1 }]);
    assert.equal(server.requests.length, 3);
  } finally {
    await server.close();
  }
});

test("a 200 response carrying a timeout remark is treated as a failure and retried", async () => {
  const server = await fakeOverpass([
    { status: 200, body: { elements: [], remark: "runtime error: Query timed out in \"query\" at line 1" } },
    OK,
  ]);
  try {
    const elements = await fetchWays(BBOX, { endpoint: server.endpoint, ...fast });
    assert.equal(elements.length, 1);
    assert.equal(server.requests.length, 2);
  } finally {
    await server.close();
  }
});

test("a bad query (HTTP 400) fails at once instead of retrying", async () => {
  const server = await fakeOverpass([{ status: 400, body: "syntax error" }, OK]);
  try {
    await assert.rejects(fetchWays(BBOX, { endpoint: server.endpoint, ...fast }), /HTTP 400/);
    assert.equal(server.requests.length, 1);
  } finally {
    await server.close();
  }
});

test("gives up after the configured number of attempts and reports the last error", async () => {
  const server = await fakeOverpass([{ status: 503, body: "busy" }]);
  try {
    await assert.rejects(fetchWays(BBOX, { endpoint: server.endpoint, attempts: 3, ...fast }), /HTTP 503/);
    assert.equal(server.requests.length, 3);
  } finally {
    await server.close();
  }
});

test("a successful result is cached and the second call makes no request", async () => {
  const server = await fakeOverpass([OK]);
  const dir = await mkdtemp(path.join(os.tmpdir(), "overpass-test-"));
  const cacheFile = path.join(dir, "osm", "region.json");
  try {
    await fetchWays(BBOX, { endpoint: server.endpoint, cacheFile, ...fast });
    assert.equal(JSON.parse(await readFile(cacheFile, "utf8")).elements.length, 1);
    const again = await fetchWays(BBOX, { endpoint: server.endpoint, cacheFile, ...fast });
    assert.equal(again.length, 1);
    assert.equal(server.requests.length, 1);
  } finally {
    await server.close();
  }
});

test("a failed fetch leaves no cache file behind", async () => {
  const server = await fakeOverpass([{ status: 400, body: "syntax error" }]);
  const dir = await mkdtemp(path.join(os.tmpdir(), "overpass-test-"));
  const cacheFile = path.join(dir, "region.json");
  try {
    await assert.rejects(fetchWays(BBOX, { endpoint: server.endpoint, cacheFile, ...fast }));
    await assert.rejects(readFile(cacheFile), { code: "ENOENT" });
  } finally {
    await server.close();
  }
});
