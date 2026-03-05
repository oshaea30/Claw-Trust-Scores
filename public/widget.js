(function () {
  const script = document.currentScript;
  const endpoint = script?.dataset?.endpoint;
  const apiKey = script?.dataset?.apiKey;
  if (!endpoint || !apiKey) return;

  const host = document.createElement("div");
  host.style.cssText = "border:1px solid #e6ddd5;border-radius:12px;padding:12px;background:#fff;color:#1f1a16;font:14px/1.4 ui-sans-serif,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:420px";
  host.innerHTML = "<div style='font-weight:700;margin-bottom:6px'>Claw Trust Snapshot</div><div style='color:#6c6258'>Loading...</div>";
  script.parentNode.insertBefore(host, script.nextSibling);

  fetch(endpoint, {
    headers: { "x-api-key": apiKey },
    cache: "no-store",
  })
    .then((res) => res.json())
    .then((data) => {
      const t = data?.totals || {};
      const s = data?.shadowMode?.last24h || {};
      host.innerHTML =
        "<div style='font-weight:700;margin-bottom:8px'>Claw Trust Snapshot</div>" +
        "<div style='display:grid;grid-template-columns:1fr 1fr;gap:8px'>" +
        `<div><div style='color:#6c6258'>Decisions (7d)</div><div style='font-size:22px;font-weight:700'>${t.decisions ?? 0}</div></div>` +
        `<div><div style='color:#6c6258'>Unique agents</div><div style='font-size:22px;font-weight:700'>${t.uniqueAgents ?? 0}</div></div>` +
        `<div><div style='color:#6c6258'>Would block (24h)</div><div style='font-size:22px;font-weight:700;color:#b33838'>${s.wouldBlock ?? 0}</div></div>` +
        `<div><div style='color:#6c6258'>Would review (24h)</div><div style='font-size:22px;font-weight:700;color:#a8731e'>${s.wouldReview ?? 0}</div></div>` +
        "</div>";
    })
    .catch(() => {
      host.innerHTML = "<div style='font-weight:700;margin-bottom:6px'>Claw Trust Snapshot</div><div style='color:#b33838'>Unable to load data.</div>";
    });
})();
