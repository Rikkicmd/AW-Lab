const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  p.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') errs.push(m.type() + ' ' + m.text()); });
  await p.goto('file://' + require('path').resolve(__dirname, '../index.html'));
  await p.waitForTimeout(300);
  const r = await p.evaluate(() => {
    const res = {};
    const tests = () => TESTS.map(t => reach(t.from, t.to) ? 1 : 0).join('');
    const ex = () => EXERCISES.map(e => e.check() ? 1 : 0).join('');
    res.factory = { tests: tests(), ex: ex() };
    for (const k of ['solved', 'cctv', 'data', 'mgmt']) { loadScenario(k); res[k] = { tests: tests(), ex: ex() }; }
    loadScenario('solved');
    const run = (id, cmds) => { const s = { buf: [], mode: 'priv', login: 'ok', ifSel: null, pending: null, sink: [] }; for (const c of cmds) { s.sink.push('#' + c); execLine(D[id], s, c); } return s.sink.join('\n'); };
    res.show = run('SW1', ['show running-config', 'sh vl br', 'sh ip int br', 'sh ip route', 'sh lldp nei', 'sh mac add', 'sh int sw', 'show bogus', 'conf t', 'int port1.0.99', 'do sh int port1.0.1']);
    res.acc = run('SW2', ['sh ip route', 'show running-config', 'conf t', 'interface port1.0.3', 'switchport access vlan 55', 'sw mo tr', 'sw tr al vl add 10', 'do show run int port1.0.3']);
    res.help = helpList(D.SW1, { mode: 'priv' }, 'show ip ').join('\n') + '\n--\n' + helpList(D.SW1, { mode: 'if-port' }, 'switchport trunk ').join('\n');
    res.ping = pingCalc('PC1', '192.168.20.22');
    delete res.ping.net; delete res.ping.eps;
    return res;
  });
  console.log(JSON.stringify({ factory: r.factory, solved: r.solved, cctv: r.cctv, data: r.data, mgmt: r.mgmt, ping: r.ping }, null, 0));
  console.log(r.show); console.log('======'); console.log(r.acc); console.log('======'); console.log(r.help);
  // UI flow: login on SW1 and type a command
  await p.evaluate(() => { localStorage.clear(); loadScenario('cctv'); active = 'SW1'; refresh(); });
  const t = async s => { await p.fill('#cmd', s); await p.press('#cmd', 'Enter'); };
  await t('manager'); await t('friend'); await t('en'); await t('ping 192.168.20.22');
  await p.waitForTimeout(2600);
  await p.click('.devtabs button[data-id="PC1"]'); await t('ping 192.168.20.22'); await p.waitForTimeout(2600);
  await p.click('.devtabs button[data-id="SW1"]');
  await p.fill('#cmd', 'show '); await p.press('#cmd', '?');
  await p.screenshot({ path: require('path').resolve(__dirname, 'shot.png') });
  console.log(await p.textContent('#out'));
  console.log(errs.join('\n'));
  await b.close();
})();
