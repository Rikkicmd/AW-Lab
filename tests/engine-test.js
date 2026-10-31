// Headless checks for the AW+ Test Lab engine.
// Usage: npm install playwright && node tests/engine-test.js
const path = require('path');
const { chromium } = require('playwright');

const EXPECT = {
  // live connectivity tests (6) and exercise checks (11), 1 = pass
  factory: { tests: '110000', ex: '00000000000' },
  solved: { tests: '111111', ex: '11111111111' },
  cctv: { tests: '100010', ex: '11100011011' },
  data: { tests: '010101', ex: '11000011011' },
  mgmt: { tests: '111110', ex: '11111011011' },
  storm: { tests: '000000' },
  lacp: { tests: '000001' },
};

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  p.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') errs.push(m.type() + ' ' + m.text()); });
  await p.goto('file://' + path.resolve(__dirname, '../index.html'));
  await p.waitForTimeout(300);

  const r = await p.evaluate(() => {
    const res = {};
    const tests = () => TESTS.map(t => reach(t.from, t.to) ? 1 : 0).join('');
    const ex = () => EXERCISES.map(e => e.check() ? 1 : 0).join('');
    const run = (id, cmds) => { const s = { buf: [], mode: 'priv', login: 'ok', ifSel: null, pending: null, sink: [] }; for (const c of cmds) { s.sink.push('#' + c); execLine(D[id], s, c); } return s.sink.join('\n'); };
    for (const k of Object.keys(SCENARIOS)) { loadScenario(k); invalidate(); res[k] = { tests: tests(), ex: ex(), storms: buildNet().storms.length }; }
    // storm fix: re-enable STP on ACCESS2
    loadScenario('storm'); run('SW3', ['configure terminal', 'spanning-tree enable']); invalidate();
    res.stormFixed = { tests: tests(), storms: buildNet().storms.length, cross: linkState(LINKS[3]) };
    // lacp fix: one side active
    loadScenario('lacp'); run('SW1', ['configure terminal', 'interface port1.0.1,port1.0.3', 'channel-group 1 mode active']); invalidate();
    res.lacpFixed = { tests: tests() };
    // static LAG mismatch should loop if STP is off
    loadScenario('factory'); invalidate(); res.factoryStp = run('SW2', ['show spanning-tree brief']);
    loadScenario('solved');
    res.show = run('SW1', ['show spanning-tree brief', 'show etherchannel', 'show etherchannel summary', 'show running-config', 'sh int br', 'sh vlan brief',
      'conf t', 'int port1.0.1', 'switchport mode access', 'int po9', 'end']);
    res.acc = run('SW2', ['show spanning-tree', 'show mac address-table']);
    res.help = helpList(D.SW1, { mode: 'if-port' }, 'channel-group 1 mode ').join('\n');
    return res;
  });

  let fail = 0;
  for (const k in EXPECT) for (const f in EXPECT[k]) {
    const ok = r[k][f] === EXPECT[k][f];
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${k}.${f} = ${r[k][f]} (expected ${EXPECT[k][f]})`);
  }
  const extra = [['storm has a loop', r.storm.storms > 0], ['storm fixed', r.stormFixed.tests === '111111' && r.stormFixed.storms === 0 && r.stormFixed.cross === 'blocked'],
    ['lacp fixed', r.lacpFixed.tests === '111111'], ['solved has no loop', r.solved.storms === 0], ['factory has no loop', r.factory.storms === 0]];
  for (const [n, ok] of extra) { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}`); }
  if (process.argv.includes('-v')) { console.log(r.factoryStp); console.log(r.show); console.log(r.acc); console.log(r.help); console.log(JSON.stringify(r.stormFixed)); }

  // UI smoke test: log in, run a ping, open help
  await p.evaluate(() => { localStorage.clear(); loadScenario('storm'); active = 'SW1'; refresh(); });
  const t = async s => { await p.fill('#cmd', s); await p.press('#cmd', 'Enter'); };
  await t('manager'); await t('friend'); await t('en'); await t('show spanning-tree brief');
  await p.screenshot({ path: path.resolve(__dirname, 'shot.png') });
  if (errs.length) { fail++; console.log(errs.join('\n')); }
  console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
