(() => {
  "use strict";
  const API_URL = "https://jds-tool.aincehome.com/api/business-tools/device-auth";
  const STORAGE_KEY = "jdsBusinessToolDeviceAuthV2";
  const TOOL_ID = "chintai-cost-calculator";
  const VERSION = "1.0.1";
  let expiryTimer = 0;
  let heartbeatTimer = 0;

  async function post(payload) {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      cache: "no-store",
      body: JSON.stringify({ ...payload, toolId: TOOL_ID, version: VERSION })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(String(data.error || `HTTP_${response.status}`));
    return data;
  }

  function readSaved() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
    catch { return {}; }
  }

  function save(value) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  }

  function scheduleChecks(expiresAt) {
    clearTimeout(expiryTimer);
    const delay = Math.max(1000, Math.min(0x7fffffff, Number(expiresAt || 0) - Date.now()));
    expiryTimer = setTimeout(() => { void enforceAuthorization(); }, delay);
    if (!heartbeatTimer) heartbeatTimer = setInterval(() => { void enforceAuthorization(); }, 15 * 60 * 1000);
  }

  function showForm(saved) {
    return new Promise((resolve) => {
      const host = document.createElement("div");
      host.id = "jds-device-auth";
      host.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:20px;background:rgba(15,23,42,.82)";
      const shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = `<style>*{box-sizing:border-box}.box{width:min(460px,100%);padding:24px;border-radius:14px;background:#fff;color:#172033;font:14px/1.6 system-ui;box-shadow:0 20px 50px #0007}h2{margin:0 0 8px;font-size:20px}.note{padding:9px 11px;border-left:4px solid #0f766e;background:#ecfdf5}label{display:grid;gap:5px;margin:14px 0;font-weight:700}input{padding:10px;border:1px solid #94a3b8;border-radius:7px;font:inherit}button{width:100%;padding:11px;border:0;border-radius:7px;background:#0f766e;color:#fff;font:inherit;font-weight:800}.status{min-height:22px;color:#b91c1c;font-weight:700}</style><form class="box"><h2>端末認証</h2><p class="note">初回起動時にPCユーザー名と接続元IPをJDSへ記録します。</p><label>PCのユーザー名<input name="username" maxlength="80" autocomplete="username" required></label><label>起動パスワード<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">認証して起動</button><p class="status"></p></form>`;
      const form = shadow.querySelector("form");
      const username = form.elements.username;
      const password = form.elements.password;
      const button = form.querySelector("button");
      const status = form.querySelector(".status");
      username.value = String(saved.pcUsername || "");
      form.onsubmit = async (event) => {
        event.preventDefault();
        button.disabled = true;
        status.textContent = "JDSで確認中です…";
        const deviceId = String(saved.deviceId || (crypto.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/[^a-z0-9_-]/gi, ""));
        try {
          const result = await post({ action: "activate", deviceId, pcUsername: username.value.trim(), password: password.value });
          const next = { ...saved, deviceId, pcUsername: username.value.trim(), tools: { ...(saved.tools || {}) } };
          const expiresAt = Date.parse(result.expiresAt) || Date.now() + 60 * 60 * 1000;
          next.tools[TOOL_ID] = { accessToken: result.accessToken, expiresAt };
          save(next);
          scheduleChecks(expiresAt);
          host.remove();
          resolve({ ok: true });
        } catch (error) {
          password.value = "";
          status.textContent = error?.message === "invalid_password" ? "パスワードが違います。" : "認証できません。管理者へ連絡してください。";
          button.disabled = false;
        }
      };
      document.documentElement.appendChild(host);
      (username.value ? password : username).focus();
    });
  }

  async function authorize() {
    const saved = readSaved();
    const credential = saved.tools?.[TOOL_ID];
    if (credential?.accessToken) {
      try {
        const result = await post({ action: "resume", accessToken: credential.accessToken });
        const expiresAt = Date.parse(result.expiresAt) || Date.now() + 60 * 60 * 1000;
        saved.tools[TOOL_ID] = { accessToken: result.accessToken || credential.accessToken, expiresAt };
        save(saved);
        scheduleChecks(expiresAt);
        return { ok: true };
      } catch {
        delete saved.tools[TOOL_ID];
        save(saved);
      }
    }
    return showForm(saved);
  }

  async function enforceAuthorization() {
    const saved = readSaved();
    const credential = saved.tools?.[TOOL_ID];
    if (!credential?.accessToken) return;
    try {
      const result = await post({ action: "resume", accessToken: credential.accessToken });
      const expiresAt = Date.parse(result.expiresAt) || Date.now() + 60 * 60 * 1000;
      saved.tools[TOOL_ID] = { accessToken: result.accessToken || credential.accessToken, expiresAt };
      save(saved);
      scheduleChecks(expiresAt);
    } catch {
      delete saved.tools[TOOL_ID];
      save(saved);
      if (!document.getElementById("jds-device-auth")) void showForm(saved);
    }
  }

  window.JdsDeviceAuthReady = authorize();
})();
