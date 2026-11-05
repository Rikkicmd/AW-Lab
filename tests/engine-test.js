// Headless checks for the AW+ Test Lab engine.
// Usage: npm install playwright && node tests/engine-test.js
const path = require('path');
const { chromium } = require('playwright');

const EXPECT = {
  // live connectivity tests (6) and exercise checks (13), 1 = pass
  factory: { tests: '110000', ex: '000000000000000' },
  solved: { tests: '111111', ex: '111111111111111' },
  cctv: { tests: '100010', ex: '111000110101011' },
  data: { tests: '010101', ex: '110000110100011' },
  mgmt: { tests: '111110', ex: '111110110111111' },
  hotdesk: { tests: '010101' },
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
  await p.goto('file://' + path.resolve(__dirname, '../AW-Lab.html'));
  await p.waitForTimeout(300);

  const r = await p.evaluate(() => {
    const res = {};
    const tests = () => TESTS.map(t => testOk(t) ? 1 : 0).join('');
    const ex = () => EXERCISES.map(e => e.check() ? 1 : 0).join('');
    const run = (id, cmds) => { const s = { buf: [], mode: 'priv', login: 'ok', ifSel: null, pending: null, sink: [] }; for (const c of cmds) { s.sink.push('#' + c); execLine(D[id], s, c); } return s.sink.join('\n'); };
    for (const k of Object.keys(SCENARIOS)) { loadScenario(k); invalidate(); res[k] = { tests: tests(), ex: ex(), storms: buildNet().storms.length }; }
    // course walkthrough: do each exercise in order from factory; exercise N must complete at step N
    loadScenario('factory');
    const ct = 'configure terminal', both = ['SW2', 'SW3'], all = ['SW1', 'SW2', 'SW3'];
    const trunk = ['switchport mode trunk', 'switchport trunk allowed vlan add 10,20,99'];
    const steps = [
      () => { run('SW1', [ct, 'hostname CORE']); run('SW2', [ct, 'hostname ACCESS1']); run('SW3', [ct, 'hostname ACCESS2']); },
      () => all.forEach(id => run(id, [ct, 'vlan database', 'vlan 10 name Data', 'vlan 20 name CCTV', 'vlan 99 name Mgmt'])),
      () => both.forEach(id => run(id, [ct, 'interface port1.0.1', 'switchport mode access', 'switchport access vlan 10', 'interface port1.0.2', 'switchport access vlan 20'])),
      () => { run('SW1', [ct, 'interface port1.0.1-1.0.2', ...trunk]); both.forEach(id => run(id, [ct, 'interface port1.0.10', ...trunk])); },
      () => run('SW1', [ct, 'interface vlan10', 'ip address 192.168.10.1/24', 'interface vlan20', 'ip address 192.168.20.1/24']),
      () => { run('SW1', [ct, 'interface vlan99', 'ip address 192.168.99.1/24']); both.forEach((id, i) => run(id, [ct, 'interface vlan99', `ip address 192.168.99.${i + 2}/24`, 'exit', 'ip route 0.0.0.0/0 192.168.99.1'])); },
      () => all.forEach(id => run(id, [ct, 'lldp run'])),
      () => run('SW1', [ct, 'spanning-tree priority 4096']),
      () => { run('SW1', [ct, 'interface port1.0.1,port1.0.3', 'channel-group 1 mode active', 'interface po1', ...trunk]); run('SW2', [ct, 'interface port1.0.9-1.0.10', 'channel-group 1 mode active', 'interface po1', ...trunk]); },
      () => both.forEach(id => run(id, [ct, 'interface port1.0.1-1.0.2', 'spanning-tree edgeport'])),
      () => run('SW2', [ct, 'access-list 3000 permit ip 192.168.20.0/24 192.168.20.0/24', 'access-list 3000 deny ip 192.168.20.0/24 any', 'interface port1.0.2', 'access-group 3000']),
      () => { run('SW1', [ct, 'ip dhcp pool DATA', 'network 192.168.10.0/24', 'range 192.168.10.100 192.168.10.199', 'default-router 192.168.10.1', 'exit', 'ip dhcp pool CCTV', 'network 192.168.20.0/24', 'range 192.168.20.100 192.168.20.199', 'default-router 192.168.20.1', 'exit', 'service dhcp-server']); invalidate(); S.PC1.sink = []; hostCmd('PC1', 'dhcp'); delete S.PC1.sink; },
      () => both.forEach(id => run(id, [ct, 'interface port1.0.1-1.0.2', 'switchport port-security', 'switchport port-security violation shutdown'])),
      () => both.forEach(id => run(id, [ct, 'loop-protection loop-detect', 'interface port1.0.1-1.0.2', 'loop-protection action link-down'])),
      () => all.forEach(id => run(id, ['write'])),
    ];
    res.course = steps.map(f => { f(); invalidate(); return ex(); });
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
    // port security: a new MAC on a locked port shuts it down; recover it
    loadScenario('solved'); invalidate();
    const pc1 = v => { const s = S.PC1; s.sink = []; hostCmd('PC1', v); const o = s.sink.join(' '); delete s.sink; invalidate(); return o; };
    res.psLearn = run('SW2', ['show port-security interface port1.0.1']);
    pc1('mac 0050.7966.68aa');
    res.psViol = { down: !reach('PC1', ipOf('PC2')), status: run('SW2', ['show interface status | include port1.0.1 ']), log: run('SW2', ['show log tail | include PSEC']) };
    run('SW2', ['configure terminal', 'interface port1.0.1', 'no shutdown']);
    res.psStill = !reach('PC1', ipOf('PC2'));
    pc1('mac reset'); run('SW2', ['configure terminal', 'interface port1.0.1', 'no shutdown']);
    res.psBack = reach('PC1', ipOf('PC2')) && EXERCISES[12].check();
    run('SW2', ['configure terminal', 'interface port1.0.1', 'switchport port-security violation restrict']); pc1('mac 0050.7966.68ab');
    res.psRestrict = !reach('PC1', ipOf('PC2')) && run('SW2', ['show interface status | include port1.0.1 ']).includes('connected') && run('SW2', ['show port-security intrusion']).includes('0050.7966.68ab');
    pc1('mac reset');
    res.psTrunk = run('SW2', ['configure terminal', 'interface port1.0.1', 'switchport mode trunk']).includes('% Port security is enabled');
    // hot desk ticket: clear the stale address, no shutdown, dhcp
    loadScenario('hotdesk'); invalidate();
    res.hdStatus = run('SW2', ['show interface status | include port1.0.1 ']);
    run('SW2', ['clear mac address-table dynamic interface port1.0.1', 'configure terminal', 'interface port1.0.1', 'no shutdown']); pc1('dhcp');
    res.hdFixed = tests();
    // loop protection: storm ticket, turn loop detection back on on ACCESS2 only
    loadScenario('storm'); invalidate();
    run('SW3', ['configure terminal', 'loop-protection loop-detect']); invalidate();
    res.ldp = { tests: tests(), storms: buildNet().storms.length, show: run('SW3', ['show loop-protection interface port1.0.8']) };
    // CLI realism: no forms, write terminal, help
    loadScenario('solved');
    res.noIf = run('SW1', ['configure terminal', 'interface vlan30', 'exit', 'no interface vlan30', 'no interface vlan1']);
    res.noIfOk = !D.SW1.cfg.vifs[30] && res.noIf.includes('% vlan1 cannot be removed');
    run('SW2', ['configure terminal', 'no access-list 3000 deny ip 192.168.20.0/24 any']);
    res.noAce = D.SW2.cfg.acls[3000].length === 1;
    res.wrt = run('SW1', ['write terminal']).includes('hostname CORE');
    res.psHelp = helpList(D.SW2, { mode: 'if-port' }, 'switchport port-security violation ').join('\n');
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
    ['ntp sync', r.ntp.includes('synchronized, stratum 5')], ['speed mismatch drops link', r.speedDown], ['speed auto restores link', r.speedUp], ['solved has no loop', r.solved.storms === 0], ['factory has no loop', r.factory.storms === 0],
    ['port security learns the host', r.psLearn.includes('Total MAC Addresses           : 1') && r.psLearn.includes('LOCKED')],
    ['port security shuts the port on a new MAC', r.psViol.down && r.psViol.status.includes('err-disabled') && r.psViol.log.includes('0050.7966.68aa')],
    ['no shutdown alone does not beat port security', r.psStill], ['port security recovers', r.psBack], ['port security restrict keeps link up', r.psRestrict], ['port security refuses trunks', r.psTrunk],
    ['hot desk ticket starts err-disabled', r.hdStatus.includes('err-disabled')], ['hot desk ticket fixed', r.hdFixed === '111111'],
    ['loop protection stops the storm', r.ldp.storms === 0 && r.ldp.tests === '111111' && r.ldp.show.includes('Blocking')],
    ['no interface vlan', r.noIfOk], ['no access-list entry', r.noAce], ['write terminal', r.wrt], ['port security help', r.psHelp.includes('shutdown') && r.psHelp.includes('restrict')]];
  for (const [n, ok] of extra) { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}`); }
  const courseBad = r.course.map((e, i) => e === '1'.repeat(i + 1) + '0'.repeat(e.length - i - 1) ? null : `step ${i + 1}: ${e}`).filter(Boolean);
  console.log(`${courseBad.length ? 'FAIL' : 'PASS'} course walkthrough completes each exercise in order${courseBad.length ? ' (' + courseBad.join(', ') + ')' : ''}`); if (courseBad.length) fail++;
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
  // --More-- paging: long output stops, space pages, q quits, terminal length 0 turns it off
  await t('show running-config');
  const m1 = await p.textContent('#prompt'); await p.press('#cmd', ' '); await p.press('#cmd', 'q');
  const m2 = await p.textContent('#prompt'); await t('terminal length 0'); const n0 = (await p.textContent('#out')).split('\n').length; await t('show running-config');
  const m3 = await p.textContent('#prompt'); const n1 = (await p.textContent('#out')).split('\n').length;
  const moreOk = m1 === '--More--' && m2 === 'CORE#' && m3 === 'CORE#' && n1 - n0 > 40;
  console.log(`${moreOk ? 'PASS' : 'FAIL'} --More-- paging (${m1} / ${m2} / ${m3})`); if (!moreOk) fail++;
  const remoteOk = p1 === 'ACCESS1>' && p2 === 'CORE#' && p3.includes('port 22: Connection refused');
  console.log(`${remoteOk ? 'PASS' : 'FAIL'} telnet/ssh sessions (${p1} / ${p2})`); if (!remoteOk) fail++;
  // sandbox: add equipment, cable it, configure it, remove it; the lessons lab must be untouched
  const sb = await p.evaluate(() => {
    const run = (id, cmds) => { const s = { buf: [], mode: 'priv', login: 'ok', ifSel: null, pending: null, sink: [] }; for (const c of cmds) execLine(D[id], s, c); return s.sink.join('\n'); };
    const r = {};
    localStorage.clear(); loadScenario('solved'); save();
    enterSandbox();
    r.start = Object.keys(D).join(',') === 'SW1,SW2,SW3,PC1,CAM1,PC2,NVR1' && LINKS.length === 8 && D.SW1.cfg.hostname === 'awplus';
    const sw = sbAddDevice('x230-18GP').id, pc = sbAddDevice('PC').id, cam = sbAddDevice('CAM').id;
    r.ids = sw === 'SW4' && pc === 'PC3' && cam === 'CAM2' && D.SW4.def.nports === 18;
    r.cable = sbConnect('SW1', 'port1.0.5', sw, 'port1.0.18') === null && sbConnect(sw, 'port1.0.1', pc, 'eth0') === null;
    r.refuse = !!sbConnect(sw, 'port1.0.1', cam, 'eth0') && !!sbConnect(pc, 'eth0', cam, 'eth0') && !!sbConnect(sw, 'port1.0.19', cam, 'eth0');
    run('SW1', ['configure terminal', 'interface vlan1', 'ip address 10.0.0.1/24']);
    Object.assign(D[pc].cfg, { ip: '10.0.0.5', len: 24, gw: '10.0.0.1' }); invalidate();
    r.ping = reach(pc, '10.0.0.1');
    r.ver = run(sw, ['show version']).includes('x230-18GP');
    r.lldp = run('SW1', ['configure terminal', 'lldp run', 'end', 'show lldp neighbors']);
    const exp = JSON.stringify(snapshot());
    sbRemoveDevice(sw); invalidate();
    r.removed = !D[sw] && !reach(pc, '10.0.0.1') && LINKS.every(l => l.a[0] !== sw && l.b[0] !== sw);
    exitSandbox(); invalidate();
    r.lab = mode === 'lab' && Object.keys(D).length === 7 && TESTS.every(testOk) && D.SW1.cfg.hostname === 'CORE';
    enterSandbox();
    r.persist = !!D[pc] && !D[sw];
    applySnapshot(JSON.parse(exp)); invalidate();
    r.import = mode === 'sandbox' && !!D[sw] && reach(pc, '10.0.0.1');
    exitSandbox(); refresh();
    return r;
  });
  for (const k of ['start', 'ids', 'cable', 'refuse', 'ping', 'ver', 'removed', 'lab', 'persist', 'import']) { const ok = !!sb[k]; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} sandbox ${k}`); }
  // subnet calculator: maths, parsing, and the tab in both modes
  const sc = await p.evaluate(() => {
    const r = {}, f = x => [intIp(x.net), intIp(x.first), intIp(x.last), intIp(x.bc), x.hosts, intIp(x.mask), intIp(x.wild)].join(' ');
    r.c24 = f(parseSubnet('192.168.10.25/24')) === '192.168.10.0 192.168.10.1 192.168.10.254 192.168.10.255 254 255.255.255.0 0.0.0.255';
    r.mask = f(parseSubnet('172.16.5.130 255.255.255.192')) === '172.16.5.128 172.16.5.129 172.16.5.190 172.16.5.191 62 255.255.255.192 0.0.0.63';
    r.edge = parseSubnet('10.0.0.1/31').hosts === 2 && parseSubnet('10.0.0.1/32').hosts === 1 && parseSubnet('1.2.3.4/0').total === 2 ** 32 && intIp(parseSubnet('1.2.3.4/0').bc) === '255.255.255.255';
    r.bad = !!parseSubnet('1.2.3.4').err && !!parseSubnet('1.2.3.4 255.0.255.0').err && !!parseSubnet('1.2.3.400/24').err && !!parseSubnet('1.2.3.4/33').err;
    const sp = splitSubnet(parseSubnet('192.168.10.0/24'), 26, 64);
    r.split = sp.count === 4 && sp.list.map(x => intIp(x.net)).join(',') === '192.168.10.0,192.168.10.64,192.168.10.128,192.168.10.192';
    loadScenario('solved'); refresh(); selectTab('tab-sub'); $('#scIp').value = '192.168.20.9/24'; scRender();
    r.lab = $('#scOut').textContent.includes('CAM1 192.168.20.21/24');
    enterSandbox(); r.sandbox = !$('#tab-sub').hidden; exitSandbox(); refresh(); selectTab('tab-ex');
    return r;
  });
  for (const k of ['c24', 'mask', 'edge', 'bad', 'split', 'lab', 'sandbox']) { const ok = !!sc[k]; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} subnet ${k}`); }
  await p.screenshot({ path: path.resolve(__dirname, 'shot.png') });
  if (errs.length) { fail++; console.log(errs.join('\n')); }
  console.log(fail ? `${fail} FAILED` : 'ALL PASSED');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
