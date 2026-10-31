// Regenerates the README screenshots in docs/screenshots/.
// Usage: npm install playwright && node tests/screenshots.js
const path=require('path');const {chromium}=require('playwright');
const out=path.resolve(__dirname,'../docs/screenshots');const idx=path.resolve(__dirname,'../index.html');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+idx);await p.waitForTimeout(300);
const t=async s=>{await p.fill('#cmd',s);await p.press('#cmd','Enter');await p.waitForTimeout(80);};
const clear=async()=>{const pr=(await p.textContent('#prompt'))||'';const o=(await p.textContent('#out'))||'';if(/login|Password/i.test(pr)||/login:\s*$/.test(o)){await t('manager');await t('friend');}await p.click('#btnClear').catch(()=>{});};
// 1 overview: solved lab, CORE, show vlan brief
await p.evaluate(()=>{localStorage.clear();loadScenario('solved');active='SW1';refresh();});
await clear();
for(const c of ['show vlan brief','show ip interface brief']) await t(c);
await p.click('#tab-ex');
await p.screenshot({path:out+'/overview.png'});
// 2 spanning tree + etherchannel on ACCESS1
await p.evaluate(()=>{active='SW2';refresh();});await clear();
for(const c of ['show spanning-tree brief','show etherchannel summary']) await t(c);
await p.screenshot({path:out+'/spanning-tree-lacp.png'});
// 3 storm fault ticket
await p.evaluate(()=>{loadScenario('storm');active='SW3';refresh();});await clear();
await p.click('#tab-ft');
for(const c of ['show spanning-tree brief','show mac address-table | include port1.0.8']) await t(c);
await p.screenshot({path:out+'/fault-ticket-storm.png'});
// 4 DHCP camera
await p.evaluate(()=>{loadScenario('solved');active='CAM1';refresh();});await clear();
for(const c of ['dhcp']) await t(c);await p.waitForTimeout(1500);
for(const c of ['show','ping 192.168.20.22','trace 192.168.20.22']) await t(c);await p.waitForTimeout(1500);
await p.click('#tab-ref');
await p.screenshot({path:out+'/host-dhcp-ping.png'});
// 5 factory config session
await p.evaluate(()=>{localStorage.clear();loadScenario('factory');active='SW1';refresh();});await clear();
await p.click('#tab-ex');
for(const c of ['enable','configure terminal','hostname CORE','vlan database','vlan 10 name Data','vlan 20 name CCTV','vlan 99 name Mgmt','exit','interface vlan10','ip address 192.168.10.1/24','no shutdown','exit','interface port1.0.2']) await t(c);await p.fill('#cmd','switchport mode ');await p.press('#cmd','?');await p.waitForTimeout(150);
await p.screenshot({path:out+'/cli-config.png'});
console.log(errs);await b.close();})();
