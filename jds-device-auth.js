(() => {
  "use strict";
  const BROKER_ID = "knholmgicchgkipplfmgpgdikmfibbmp";
  const TOOL_ID = "chintai-cost-calculator";
  const VERSION = "1.1.0";
  const ENFORCEMENT_AT = Date.parse("2026-09-30T15:00:00.000Z");
  let blocker = null;

  function request() {
    return new Promise((resolve) => {
      if (!globalThis.chrome?.runtime?.sendMessage) {
        resolve({ ok: false, allowed: Date.now() < ENFORCEMENT_AT, reason: "broker_unavailable" });
        return;
      }
      const timeout = setTimeout(() => resolve({ ok: false, allowed: Date.now() < ENFORCEMENT_AT, reason: "broker_timeout" }), 6000);
      chrome.runtime.sendMessage(BROKER_ID, { type: "JDS_DEVICE_ACCESS", toolId: TOOL_ID, version: VERSION }, (response) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) resolve({ ok: false, allowed: Date.now() < ENFORCEMENT_AT, reason: "broker_unavailable" });
        else resolve(response || { ok: false, allowed: false, reason: "broker_unavailable" });
      });
    });
  }

  function showBlocked(status) {
    if (blocker) return;
    blocker = document.createElement("div");
    blocker.id = "jds-device-access-blocker";
    blocker.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:20px;background:rgba(15,23,42,.82)";
    const shadow = blocker.attachShadow({ mode: "closed" });
    const update = status?.reason === "outdated_blocked";
    shadow.innerHTML = `<style>*{box-sizing:border-box}.box{width:min(420px,100%);padding:24px;border-radius:14px;background:#fff;color:#172033;font:14px/1.6 system-ui;box-shadow:0 20px 50px #0007}h2{margin:0 0 8px;font-size:20px}button{width:100%;padding:11px;border:0;border-radius:7px;background:#0f766e;color:#fff;font:inherit;font-weight:800}</style><section class="box"><h2>${update ? "最新版への更新が必要です" : "このツールは現在利用できません"}</h2><p>${update ? "JDSの業務改善ファイルから更新してください。" : "しばらくしてから再確認してください。"}</p><button type="button">再確認</button></section>`;
    shadow.querySelector("button").addEventListener("click", () => void authorize());
    document.documentElement.appendChild(blocker);
  }

  async function authorize() {
    const status = await request();
    if (status.allowed) {
      blocker?.remove();
      blocker = null;
      return true;
    }
    if (status.passwordRequired) {
      for (let attempt = 0; attempt < 150; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const retry = await request();
        if (retry.allowed) return authorize();
        if (!retry.passwordRequired) { showBlocked(retry); return false; }
      }
    }
    showBlocked(status);
    return false;
  }

  window.JdsDeviceAuthReady = authorize();
  setInterval(() => { void authorize(); }, 5 * 60 * 1000);
})();
