const path=require('path');const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1400,height:900}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('file://'+path.resolve(__dirname,'../index.html'));
await p.evaluate(()=>{localStorage.clear();loadScenario('dhcp');active='CAM1';refresh();});
const t=async s=>{await p.fill('#cmd',s);await p.press('#cmd','Enter');};
await t('dhcp');await p.waitForTimeout(1200);await t('show');
await p.click('#tab-ft');
await p.screenshot({path:path.resolve(__dirname,'shot-ui.png')});console.log(await p.textContent('#out'));console.log(errs);await b.close();})();
