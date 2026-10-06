(() => {
  "use strict";
  // Compatibility for cached pages from before the mobile Web release.
  document.getElementById("jds-device-access-blocker")?.remove();
  window.JdsDeviceAuthReady = Promise.resolve(true);
})();
