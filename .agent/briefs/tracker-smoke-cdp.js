// Minimal CDP smoke test for tracker boot — no external deps (Node 24 global WebSocket/fetch)
const CDP_PORT = 9333;
const URL_TO_TEST = 'http://127.0.0.1:8765/tracker/';

async function main() {
  // wait for the browser's devtools endpoint
  let version;
  for (let i = 0; i < 40; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); break; }
    catch { await new Promise(r => setTimeout(r, 250)); }
  }
  if (!version) throw new Error('devtools endpoint never came up');

  const target = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const exceptions = [];
  const consoleErrors = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      exceptions.push(d.exception?.description || d.text || JSON.stringify(d).slice(0, 300));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id; pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL_TO_TEST });
  await new Promise(r => setTimeout(r, 4000)); // let boot scripts run

  const checks = {
    'typeof renderUtilities': 'typeof renderUtilities',
    'typeof renderOpsHub': 'typeof renderOpsHub',
    'typeof switchTab': 'typeof switchTab',
    'tab-utilities exists': '!!document.getElementById("tab-utilities")',
    'utilSnapRun exists': '!!document.getElementById("utilSnapRun")',
    'tab-utilities className': '(document.getElementById("tab-utilities")||{}).className || "MISSING"',
    'typeof LY_MODELS': 'typeof LY_MODELS',
    'typeof LY_CONTROLLERS': 'typeof LY_CONTROLLERS',
    'gate: passcode input present': '!!document.querySelector("input[type=password], input[inputmode=numeric], #gate input, .gate input, [id*=gate] input, [id*=pass] input")',
    'gate: any visible input on page': 'Array.from(document.querySelectorAll("input")).filter(i=>i.offsetParent!==null).map(i=>i.id||i.name||i.type).join(",")',
    'gate element ids': 'Array.from(document.querySelectorAll("[id*=gate],[id*=Gate],[id*=passcode],[id*=Passcode]")).map(e=>e.id).join(",")',
    'scripts mention utilities': 'Array.from(document.scripts).some(s=>s.textContent.includes("renderUtilities"))',
    'data-ops-go in code': 'Array.from(document.scripts).some(s=>s.textContent.includes("data-ops-go"))',
    'body data-auth / lock state': 'document.body.className + " | " + (document.body.dataset.auth||"")',
  };
  const results = {};
  for (const [label, expr] of Object.entries(checks)) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    results[label] = r.result?.exceptionDetails
      ? 'EVAL-ERROR: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)
      : r.result?.result?.value;
  }

  console.log(JSON.stringify({ results, exceptions, consoleErrors }, null, 2));
  ws.close();
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
