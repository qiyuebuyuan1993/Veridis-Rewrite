// Isolated browser, real projection/lifecycle modules; no model or chat writes.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(process.env.BLAI_TEST_MODULES || import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(process.env.BLAI_TEST_SOURCE || fileURLToPath(new URL('..', import.meta.url)));
const fixture = `<!doctype html><style>.blai-diff-btn{display:inline-block;width:24px;height:24px}.blai-diff-btn:before{content:'↶'}</style><div id="chat"></div><script type="module">
import {initAppContext} from '/src/host/appContext.js';
import {defaultSettings,extensionName} from '/src/settings/defaults.js';
import {bindHostLifecycleEvents} from '/src/host/lifecycleEvents.js';
import {initDomObserver} from '/src/dom/observer.js';
import {injectDiffButtonsStreamingSafe} from '/src/host/streaming.js';
import {streamingRuntimeState} from '/src/host/streamingState.js';
const listeners=new Map(), chat=[{is_user:true,mes:'question'},{is_user:false,mes:'answer',extra:{qqj_receipt:{keep:1}}}];
const settings=structuredClone(defaultSettings); settings.logLevel=0;
let writes=0;
initAppContext({chat,extension_settings:{[extensionName]:settings},eventSource:{on(n,f){listeners.set(n,f)}},event_types:{CHARACTER_MESSAGE_RENDERED:'rendered',GENERATION_ENDED:'ended'},getSillyTavernContext:()=>({chat,chatId:'fixture'}),saveChat(){writes++},saveSettingsDebounced(){writes++}});
bindHostLifecycleEvents();
window.fixture={chat,settings,streamingRuntimeState,emit:(n,p)=>listeners.get(n)?.(p),observe:()=>initDomObserver({injectDiffButtons:injectDiffButtonsStreamingSafe}),writes:()=>writes};
</script>`;
const server=http.createServer((req,res)=>{
 const name=new URL(req.url,'http://fixture').pathname;
 if(name==='/'){res.setHeader('Content-Type','text/html');return res.end(fixture)}
 const file=path.resolve(root,'.'+name);
 if(!file.startsWith(root)||!fs.existsSync(file)){res.writeHead(404);return res.end()}
 res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(file));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BLAI_TEST_CHROME||undefined});
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
page.setDefaultTimeout(5000);
try{
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.waitForFunction(()=>window.fixture);
 const before=await page.evaluate(()=>JSON.stringify(fixture.chat));
 // Receipt-time projection can run before the host inserts the new node.
 await page.evaluate(()=>fixture.emit('rendered',1));
 await page.evaluate(()=>{
  document.querySelector('#chat').innerHTML='<div class="mes" mesid="1"><div class="mes_buttons"><div class="extraMesButtons"></div><div class="mes_edit">edit</div></div><div><div class="swipeRightBlock"></div></div></div>';
  fixture.emit('rendered',1);
 });
 await page.locator('.blai-diff-btn-top').waitFor();
 assert.equal(await page.locator('.blai-diff-btn-top').getAttribute('data-index'),'1');
 // A later host render replaces only the toolbar, without adding .mes.
 await page.evaluate(()=>{fixture.observe();document.querySelector('.mes_buttons').innerHTML='<div class="extraMesButtons"></div><div class="mes_edit">edit</div>'});
 await page.locator('.blai-diff-btn-top').waitFor();
 // Observer skips streaming; the final rendered event must still project.
 await page.evaluate(()=>{fixture.streamingRuntimeState.isStreamingGeneration=true;document.querySelector('.blai-diff-btn-top').remove();fixture.emit('rendered',1);fixture.emit('ended',2)});
 await page.locator('.blai-diff-btn-top').waitFor();
 await page.evaluate(()=>{fixture.emit('rendered',1);fixture.emit('rendered',1)});
 assert.equal(await page.locator('.blai-diff-btn-top').count(),1);
 assert.equal(await page.locator('.blai-diff-btn-bottom').count(),1);
 // Existing visibility preferences remain effective.
 await page.evaluate(()=>{fixture.settings.diffButtonInExtraMenu=true;fixture.emit('rendered',1)});
 assert.equal(await page.locator('.extraMesButtons > .blai-diff-btn-top').count(),1);
 await page.evaluate(()=>{fixture.settings.enableVisualDiff=false;fixture.emit('rendered',1)});
 assert.equal(await page.locator('.blai-diff-btn').count(),0);
 assert.equal(await page.evaluate(()=>JSON.stringify(fixture.chat)),before);
 assert.equal(await page.evaluate(()=>fixture.writes()),0);
 assert.deepEqual(errors,[]);
 console.log('PASS: late render, toolbar replacement, stream end, deduplication, preferences, unchanged chat and zero saves');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
