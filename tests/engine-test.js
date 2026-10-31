// Headless checks for the AW+ Test Lab engine.
// Usage: npm install playwright && node tests/engine-test.js
const path = require('path');
const { chromium } = require('playwright');

const EXPECT = {
  // live connectivity tests (6) and exercise checks (13), 1 = pass
  factory: { tests: '110000', ex: '0000000000000' },
  solved: { tests: '111111', ex: '1111111111111' },
  cctv: { tests: '100010', ex: '1110001101011' },
  data: { tests: '010101', ex: '1100001101001' },
  mgmt: { tests: '111110', ex: '1111101101111' },
  dhcp: { tests: '101011' },
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
    const tests = () => TESTS.map(t => testOk(t) ? 1 : 0).join('');
    const ex = () => EXERCISES.map(e => e.check() ? 1 : 0).join('');
    const run = (id, cmds) => { const s = { buf: [], mode: 'priv', login: 'ok', ifSel: null, pending: null, sink: [] }; for (const c of cmds) { s.sink.push('#' + c); execLine(D[id], s, c); } return s.sink.join('\n'); };
    for (const k of Object.keys(SCENARIOS)) { loadScenario(k); invalidate(); res[k] = { tests: tests(), ex: ex(), storms: buildNet().storms.length }; }
    // storm fix: re-enable STP on ACCESS2
    loadScenario('storm'); run('SW3', ['configure terminal', 'spanning-tree enable']); invalidate();
    res.stormFixed = { tests: tests(), storms: buildNet().storms.length, cross: linkState(LINKS[3]) };
    // lacp fix: one side active
    loadScenario('lacp'); run('SW1', ['configure terminal', 'interface port1.0.1,port1.0.3', 'channel-group 1 mode active']); invalidate();
    res.lacpFixed = { tests: tests() };
    // dhcp ticket: fix network, camera gets address but wrong gateway; fix gateway too
    loadScenario('dhcp');
    const cam = () => { const s = S.CAM1; s.sink = []; hostCmd('CAM1', 'dhcp'); const o = s.sink.join(' '); delete s.sink; return o; };
    res.dhcp0 = cam();
    run('SW1', ['configure terminal', 'ip dhcp pool CCTV', 'network 192.168.20.0/24']); res.dhcp1 = cam(); res.dhcp1t = tests();
    run('SW1', ['configure terminal', 'ip dhcp pool CCTV', 'default-router 192.168.20.1']); res.dhcp2 = cam(); res.dhcpFixed = { tests: tests() };
    res.dhcpShow = run('SW1', ['show ip dhcp binding', 'show ip dhcp pool']) + '\n' + run('SW2', ['show access-list', 'show running-config interface port1.0.2']);
    // static LAG mismatch should loop if STP is off
    loadScenario('factory'); invalidate(); res.factoryStp = run('SW2', ['show spanning-tree brief']);
    loadScenario('solved');
    res.show = run('SW1', ['show spanning-tree brief', 'show etherchannel', 'show etherchannel summary', 'show running-config', 'sh int br', 'sh vlan brief',
      'conf t', 'int port1.0.1', 'switchport mode access', 'int po9', 'end']);
    res.acc = run('SW2', ['show spanning-tree', 'show mac address-table']);
    // config round trip: every switch's running-config replays onto factory defaults unchanged
    res.roundTrip = ['SW1', 'SW2', 'SW3'].map(id => { const d = D[id]; const t = configText(d.def, d.cfg); const r = replayConfig(d.def, t, factoryCfg(d.def)); return r.bad === 0 && configText(d.def, r.cfg) === t; }).every(Boolean);
    // backup file, break config, restore it
    run('SW2', ['copy running-config backup.cfg', 'configure terminal', 'hostname BROKEN', 'no vlan 99', 'end']);
    const broken = D.SW2.cfg.hostname;
    run('SW2', ['copy backup.cfg running-config']);
    res.restore = broken === 'BROKEN' && D.SW2.cfg.hostname === 'ACCESS1' && !!D.SW2.cfg.vlans[99];
    res.dir = run('SW2', ['dir', 'show boot']);
    // pipes
    res.pipe = run('SW1', ['show running-config | include ip address']);
    res.pipeOk = res.pipe.split('\n').filter(l => l.startsWith(' ip address')).length === 3 && !res.pipe.includes('hostname');
    // users, banner, ntp, snmp, speed mismatch
    run('SW1', ['configure terminal', 'username tech privilege 1 password Secret1', 'banner motd Authorised access only', 'ntp master 4', 'snmp-server', 'snmp-server community public ro', 'snmp-server location Comms room', 'service ssh', 'clock timezone BST plus 1']);
    run('SW2', ['configure terminal', 'ntp server 192.168.99.1']);
    res.ntp = run('SW2', ['show ntp status']);
    res.misc = run('SW1', ['show users', 'show snmp-server community', 'show clock', 'show arp', 'show interface status | include connected', 'show lldp neighbors detail | include System Name', 'show log tail', 'show ip dhcp binding | begin Pool CCTV']);
    res.rt2 = (() => { const d = D.SW1, t = configText(d.def, d.cfg), r = replayConfig(d.def, t, factoryCfg(d.def)); return r.bad === 0 && configText(d.def, r.cfg) === t; })();
    run('SW1', ['configure terminal', 'interface port1.0.2', 'speed 100']); run('SW3', ['configure terminal', 'interface port1.0.10', 'speed 1000']); invalidate();
    res.speedDown = !physUp(LINKS[2]) && !reach('NVR1', '192.168.99.3');
    run('SW3', ['configure terminal', 'interface port1.0.10', 'speed auto']); invalidate();
    res.speedUp = physUp(LINKS[2]);
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
    ['lacp fixed', r.lacpFixed.tests === '111111'], ['dhcp fixed', r.dhcpFixed.tests === '111111'], ['config round trip', r.roundTrip && r.rt2], ['backup restore', r.restore], ['pipe include', r.pipeOk],
    ['ntp sync', r.ntp.includes('synchronized, stratum 5')], ['speed mismatch drops link', r.speedDown], ['speed auto restores link', r.speedUp], ['solved has no loop', r.solved.storms === 0], ['factory has no loop', r.factory.storms === 0]];
  for (const [n, ok] of extra) { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}`); }
  if (process.argv.includes('-v')) { console.log(r.factoryStp); console.log(r.show); console.log(r.acc); console.log(r.help); console.log(JSON.stringify(r.stormFixed)); console.log(r.dhcp0, '|', r.dhcp1, r.dhcp1t, '|', r.dhcp2); console.log(r.dhcpShow); console.log(r.dir); console.log(r.pipe); console.log(r.ntp); console.log(r.misc); }

  // UI smoke test: log in, run a ping, open help
  await p.evaluate(() => { localStorage.clear(); loadScenario('storm'); active = 'SW1'; refresh(); });
  const t = async s => { await p.fill('#cmd', s); await p.press('#cmd', 'Enter'); };
  await t('manager'); await t('friend'); await t('en'); await t('show spanning-tree brief');
  // remote sessions from CORE (solved lab)
  await p.evaluate(() => { loadScenario('solved'); active = 'SW1'; refresh(); });
  await t('manager'); await t('friend'); await t('en');
  await t('telnet 192.168.99.2'); await t('manager'); await t('friend');
  const p1 = await p.textContent('#prompt');
  await t('show users'); await t('exit');
  const p2 = await p.textContent('#prompt');
  await t('ssh 192.168.99.3');
  const p3 = await p.textContent('#out');
  const remoteOk = p1 === 'ACCESS1>' && p2 === 'CORE#' && p3.includes('port 22: Connection refused');
  console.log(`${remoteOk ? 'PASS' : 'FAIL'} telnet/ssh sessions (${p1} / ${p2})`); if (!remoteOk) fail++;
  await p.screenshot({ path: path.resolve(__dirname, 'shot.png') });
  if (errs.length) { fail++; console.log(errs.join('\n')); }
  console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
