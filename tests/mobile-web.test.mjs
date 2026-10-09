import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("chintai-cost-calculator.html", root), "utf8");
const legacyAuth = readFileSync(new URL("jds-device-auth.js", root), "utf8");
const worker = readFileSync(new URL("service-worker.js", root), "utf8");

test("Safari用の画面は認証アドオン不要で旧画面の互換処理も即時完了する", async () => {
  assert.ok(!html.includes('src="./jds-device-auth.js"'));
  let removed = false;
  const window = {};
  vm.runInNewContext(legacyAuth, { window, document: { getElementById: () => ({ remove: () => { removed = true; } }) } });
  assert.equal(await window.JdsDeviceAuthReady, true);
  assert.equal(removed, true);
  for (const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
});

function serviceWorker(fetchResult, cachedResult) {
  const handlers = {};
  const deleted = [];
  const writes = [];
  const cache = { match: async () => cachedResult, put: async (...args) => writes.push(args), addAll: async () => {} };
  const self = {
    location: { origin: "https://example.test" },
    registration: { scope: "https://example.test/calculator/" },
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
    addEventListener: (event, callback) => { handlers[event] = callback; }
  };
  vm.runInNewContext(worker, {
    self, URL, Response,
    fetch: async () => { if (fetchResult instanceof Error) throw fetchResult; return fetchResult; },
    caches: { open: async () => cache, match: async () => cachedResult,
      keys: async () => ["chintai-cost-calculator-v18", "chintai-cost-calculator-v19", "chintai-cost-calculator-v20", "chintai-cost-calculator-v21", "other-tool-v1"],
      delete: async (key) => deleted.push(key) }
  });
  return { handlers, deleted, writes };
}

async function navigate(worker, request = { method: "GET", mode: "navigate", url: "https://example.test/calculator/chintai-cost-calculator.html?v=1.2.0" }) {
  let response;
  worker.handlers.fetch({ request, respondWith: (promise) => { response = promise; } });
  return response;
}

test("古い画面をキャッシュしていてもオンライン時は新版が返る", async () => {
  const worker = serviceWorker(new Response("new"), new Response("old"));
  assert.equal(await (await navigate(worker)).text(), "new");
  assert.equal(worker.writes.length, 1);
});

test("オフライン・HTTPエラー時は保存済み計算画面で利用を継続する", async () => {
  for (const result of [new Error("offline"), new Response("failed", {status:503})]) {
    const worker = serviceWorker(result, new Response("saved"));
    assert.equal(await (await navigate(worker)).text(), "saved");
    assert.equal(worker.writes.length, 0);
  }
});

test("更新時に他アプリのキャッシュは削除しない", async () => {
  const worker = serviceWorker();
  let completed;
  worker.handlers.activate({ waitUntil: (promise) => { completed = promise; } });
  await completed;
  assert.deepEqual(worker.deleted, ["chintai-cost-calculator-v18", "chintai-cost-calculator-v19", "chintai-cost-calculator-v20"]);
});

test("別アプリ・別ドメインの通信には介入しない", async () => {
  const worker = serviceWorker();
  for (const url of ["https://example.test/other/page.html", "https://other.test/calculator/page.html"]) {
    assert.equal(await navigate(worker, { method:"GET", mode:"navigate", url }), undefined);
  }
});
