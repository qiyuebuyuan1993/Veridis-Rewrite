// Isolated browser host: real plugin template, styles, shell and rule-card renderer.
// Optional BLAI_TEST_MODULES points at a node_modules directory containing Playwright.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(process.env.BLAI_TEST_MODULES || import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const template = fs.readFileSync(path.join(root, 'templates/purifier.html'), 'utf8').replace('{{logoUrl}}', '/images/veridis-logo.png');
const jquery = fs.readFileSync(process.env.BLAI_TEST_JQUERY, 'utf8');
const fixture = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/style.css">
<style>html,body{margin:0;font-family:Arial,'Microsoft YaHei',sans-serif;font-size:14px}body{background:linear-gradient(120deg,#dce8dc,#e5cfc3)}
#sheld{position:absolute;width:51vw;left:24.5vw;top:0;height:100vh;background:#eef1f4}#outside-left,#outside-right{position:absolute;top:160px;padding:18px}#outside-left{left:12px}#outside-right{right:12px}
:root{--SmartThemeBlurTintColor:#fbfaf7;--SmartThemeQuoteColor:#62564f;--SmartThemeBodyColor:#403831;--SmartThemeBorderColor:#d9cec4}
#data_bank_wand_container,#open-chat-diff{position:relative;z-index:1}
.fas:before{content:'·'}button{font:inherit}</style></head><body><div id="sheld"></div><button id="outside-left">左侧区域</button><button id="outside-right">右侧区域</button><div id="data_bank_wand_container"><div id="blai-wand-btn" class="list-group-item">词汇映射</div></div><button class="blai-diff-btn" data-index="0" id="open-chat-diff" type="button">打开聊天差异</button>${template}
<script src="/jquery.js"></script><script type="module">
class Q {
 constructor(nodes){this.nodes=nodes;this.length=nodes.length;nodes.forEach((n,i)=>this[i]=n)}
 each(fn){this.nodes.forEach((n,i)=>fn.call(n,i,n));return this}
 find(sel){return new Q(this.nodes.flatMap(n=>Array.from(n.querySelectorAll(sel))))}
 children(){return new Q(this.nodes.flatMap(n=>Array.from(n.children)))}
 filter(fn){return new Q(this.nodes.filter((n,i)=>fn(i,n)))}
 closest(sel){return new Q(this.nodes.map(n=>n.closest(sel)).filter(Boolean))}
 text(value){if(value===undefined)return this.nodes[0]?.textContent;return this.each(function(){this.textContent=value})}
 html(value){if(value===undefined)return this.nodes[0]?.innerHTML;return this.each(function(){this.innerHTML=value})}
 val(value){if(value===undefined)return this.nodes[0]?.value;return this.each(function(){this.value=value})}
 attr(name,value){if(value===undefined)return this.nodes[0]?.getAttribute(name);return this.each(function(){this.setAttribute(name,value)})}
 prop(name,value){if(value===undefined)return this.nodes[0]?.[name];return this.each(function(){this[name]=value})}
 toggleClass(name,on){return this.each(function(){this.classList.toggle(name,on)})}
 addClass(name){return this.each(function(){this.classList.add(name)})}
 removeClass(name){return this.each(function(){this.classList.remove(name)})}
 remove(){return this.each(function(){this.remove()})}
 hasClass(name){return this.nodes.some(n=>n.classList.contains(name))}
 is(sel){return this.nodes.some(n=>sel===':focus'?n===document.activeElement:n.matches(sel))}
 css(name,value){return this.each(function(){this.style.setProperty(name,value)})}
 insertAfter(target){const el=$(target)[0];if(el)this.nodes.forEach(n=>el.after(n));return this}
 prependTo(target){const el=$(target)[0];if(el)this.nodes.slice().reverse().forEach(n=>el.prepend(n));return this}
 trigger(type){return this.each(function(){if(type==='focus')this.focus();else this.dispatchEvent(new Event(type,{bubbles:true}))})}
 off(){return this}
 on(types,selector,handler){if(typeof selector==='function'){handler=selector;selector=null}return this.each(function(){for(const type of types.split(' ')){this.addEventListener(type.split('.')[0],e=>{const matched=selector?e.target.closest(selector):this;if(matched)handler.call(matched,e)})}})}
 empty(){return this.html('')}
 append(child){return this.each(function(){for(const node of child.nodes||(child.nodeType?[child]:[]))this.append(node)})}
 appendTo(target){$(target).append(this);return this}
}
if (!window.jQuery) window.$=(sel,props)=>{
 if(sel instanceof Q)return sel;
 if(typeof sel==='string'&&sel.startsWith('<')){const t=document.createElement('template');t.innerHTML=sel.replace(/^<(\\w+)>$/,'<$1></$1>');const q=new Q(Array.from(t.content.children));if(props)for(const[k,v]of Object.entries(props))k==='text'?q.text(v):q.attr(k,v);return q}
 return new Q(typeof sel==='string'?Array.from(document.querySelectorAll(sel)):sel?[sel]:[])
};
const shell=await import('/src/ui/shell.js');
const {initAppContext}=await import('/src/host/appContext.js');
const {extensionName,defaultSettings,defaultAiRewriteSettings}=await import('/src/settings/defaults.js');
const {bindEvents}=await import('/src/events.js');
const fonts=await import('/src/ui/fontScale.js');
window.fixture={shell,fonts,bindEvents,saves:0,sideClicks:0,failSave:false};
const chat=[{mes:'好。好。',swipe_id:0,swipes:['好。好。','其他'],extra:{}}];
const diffMeta=await import('/src/diff/messageMeta.js');
diffMeta.writeMessageDiffAiStage(chat[0],'swipe:0','旧。旧。','好。好。','好。好。');
fixture.chat=chat;
const rules=Array.from({length:20},(_,i)=>({name:'规则组 '+(i+1),enabled:i%5!==0,subRules:Array.from({length:5},(_,n)=>({mode:'regex',rewriteMode:'ai',enabled:n%3!==0,targets:['(?<![“「])示例目标与较长正则表达式'.repeat(4)],replacements:[],aiPromptTemplate:'保持实际动作、对白和正常数量。'}))}));
const settings=structuredClone(defaultSettings);Object.assign(settings,{logLevel:0,rules,activePreset:'原有规则集',guidedTourSeen:{main:true,deepClean:true},presets:{'原有规则集':{rules},'新规则集':{rules:rules.slice(0,3),aiRewrite:{temperature:1.9,promptTemplate:'不覆盖'}}},aiRewrite:{...defaultAiRewriteSettings,enabled:true,temperature:0.65,promptTemplate:'保持当前全局提示词。'}});
fixture.settings=settings;
const hostExtensions=await import('/extensions.js');hostExtensions.extension_settings[extensionName]=settings;
const eventTypes=Object.fromEntries(['APP_READY','CHAT_CHANGED','MESSAGE_RECEIVED','MESSAGE_EDITED','MESSAGE_UPDATED','CHARACTER_MESSAGE_RENDERED','USER_MESSAGE_RENDERED','MESSAGE_SWIPED','MESSAGE_DELETED','GENERATION_STARTED','GENERATION_ENDED','GENERATION_STOPPED','STREAM_TOKEN_RECEIVED'].map(name=>[name,'fixture:'+name]));
const eventSource={on(){},off(){},makeFirst(){},makeLast(){}};
initAppContext({extension_settings:{[extensionName]:settings},saveSettingsDebounced:()=>{if(fixture.failSave)throw new Error('fixture save failure');fixture.saves++;},getSillyTavernContext:()=>({}),eventSource,event_types:eventTypes,chat,saveChat:()=>{},getStreamingProcessor:()=>null});
fixture.saveSettings=()=>{if(fixture.failSave)throw new Error('fixture save failure');fixture.saves++;};
bindEvents();
shell.annotateTauriMobileSurfaces();
fixture.renderTemplate=async()=>{const text=await(await fetch('/templates/purifier.html')).text();return text.replace('{{logoUrl}}','/images/veridis-logo.png');};
document.querySelector('#blai-ai-temperature').value=settings.aiRewrite.temperature;
document.querySelector('#blai-ai-prompt').value=settings.aiRewrite.promptTemplate;
document.getElementById('blai-wand-btn').click();
for(const id of ['outside-left','outside-right'])document.getElementById(id).onclick=()=>fixture.sideClicks++;
fixture.ready=true;
</script></body></html>`;

const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://fixture').pathname);
    if (pathname === '/') { res.setHeader('Content-Type', 'text/html;charset=utf-8'); return res.end(fixture); }
    if (pathname === '/jquery.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(jquery); }
    if (pathname === '/extensions.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end('export const extension_settings = {};'); }
    if (pathname === '/script.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end('export const saveSettingsDebounced = () => window.fixture?.saveSettings?.();'); }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'image/png');
    res.end(fs.readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], executablePath: process.env.BLAI_TEST_CHROME || undefined });
const results = [], errors = [];
const output = process.env.BLAI_TEST_OUTPUT || path.join(root, '..', 'scrollbar-ui-results');
fs.mkdirSync(output, { recursive: true });
const page = await browser.newPage();
page.on('pageerror', error => { errors.push(error.message); console.log('BROWSER ERROR '+error.message); });
const check = (name, data = {}) => { results.push({ name, passed: true, ...data }); console.log('PASS ' + name); };
const setStreaming = async enabled => {
    const input = page.locator('#blai-ai-streaming-enabled');
    if (await input.isChecked() !== enabled) await page.locator('label.blai-ai-switch:has(#blai-ai-streaming-enabled)').click();
    assert.equal(await input.isChecked(), enabled);
};
try {
    await page.goto('http://127.0.0.1:' + server.address().port, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.fixture?.ready);
    for (const [width, height, columnWidth, expected] of [[3840,1800,null,'compact'],[1920,1080,null,'compact'],[1366,900,null,'compact'],[1200,900,560,'compact'],[768,900,null,'compact'],[601,900,null,'compact'],[600,844,null,'mobile'],[390,844,null,'mobile'],[360,744,null,'mobile']]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(columnWidth => { const c=document.getElementById('sheld');c.style.width=columnWidth?columnWidth+'px':'51vw';c.style.left=columnWidth?'calc((100vw - '+columnWidth+'px) / 2)':'24.5vw';fixture.shell.showResponsivePage('overview'); }, columnWidth);
        await page.waitForFunction(mobile => matchMedia('(max-width: 600px)').matches===mobile, width<=600);
        await page.waitForTimeout(60);
        const dims = await page.evaluate(() => {
            const root=document.getElementById('blai-purifier-popup'),r=root.getBoundingClientRect(),chat=document.getElementById('sheld').getBoundingClientRect();
            const active=root.querySelector('.page-panel.active'),nav=root.querySelector('.bottom-nav');
            return {left:r.left,width:r.width,right:r.right,chatLeft:chat.left,chatWidth:chat.width,rootOverflow:root.scrollWidth-root.clientWidth,panelOverflow:active.scrollWidth-active.clientWidth,navVisible:getComputedStyle(nav).display!=='none',scrollable:active.scrollHeight>active.clientHeight};
        });
        assert.equal(dims.rootOverflow,0,JSON.stringify(dims)); assert.equal(dims.panelOverflow,0,JSON.stringify(dims)); assert.equal(dims.scrollable,true);
        if(width>600){const expectedWidth=Math.min(1040,width-32);assert.ok(Math.abs(dims.width-expectedWidth)<=1);assert.ok(Math.abs(dims.left-(width-expectedWidth)/2)<=1);}
        else {const expectedWidth=width-16;assert.ok(Math.abs(dims.width-expectedWidth)<=1);assert.ok(Math.abs(dims.left-(width-expectedWidth)/2)<=1);assert.ok(dims.left>=7);}
        assert.equal(dims.navVisible,expected==='mobile');
        const nav = expected==='mobile'?'.bottom-nav':'.rail';
        await page.locator(nav+' [data-page-target="ai"]').click();
        assert.equal(await page.locator('.page-panel.active').getAttribute('data-page'),'ai');
        await page.locator('#blai-ai-temperature').fill('0.73');
        await page.locator('#blai-ai-prompt').fill('窗口内可编辑的全局提示词');
        if(width<=600)await page.locator('#blai-ai-generation-open').click();
        await page.locator('#blai-ai-max-tokens').scrollIntoViewIfNeeded();
        const aiOverflow = await page.locator('.page-panel.active').evaluate(el=>el.scrollWidth-el.clientWidth);
        assert.equal(aiOverflow,0);
        const close=await page.locator('#blai-close-btn').boundingBox();assert.ok(close.x>=0&&close.x+close.width<=width+1&&close.y>=0);
        if(width===1920||width===390)await page.screenshot({path:path.join(output,'ai-'+width+'.png')});
        if(width<=600)await page.locator('#blai-ai-generation-modal-done').click();
        await page.locator(nav+' [data-page-target="overview"]').click();
        await page.locator('#blai-preset-select').selectOption('新规则集');
        assert.equal(await page.locator('#blai-home-rule-grid .blai-home-card').count(),3);
        assert.equal(await page.evaluate(()=>fixture.settings.aiRewrite.promptTemplate),'窗口内可编辑的全局提示词');
        assert.equal(await page.evaluate(()=>fixture.settings.aiRewrite.temperature),0.73);
        await page.locator('#blai-preset-select').selectOption('原有规则集');
        if(width===1920||width===390)await page.screenshot({path:path.join(output,'overview-'+width+'.png')});
        check(width+' viewport / '+expected+' layout: column, side access, navigation, scrolling, settings and rules',dims);
    }
    for (const width of [1920,390]) {
        await page.setViewportSize({width,height:900});
        await page.waitForFunction(mobile=>matchMedia('(max-width: 600px)').matches===mobile,width<=600);
        await page.evaluate(()=>{fixture.shell.showResponsivePage('ai');const select=document.getElementById('blai-ui-font-scale');select.value='1.6';select.dispatchEvent(new Event('change',{bubbles:true}));});
        assert.equal(await page.locator('.blai-ai-request-options').evaluate(el=>el.open),false);
        const switchLabel=page.locator('.blai-ai-connection-grid > label:has(#blai-ai-streaming-enabled)');
        assert.equal(await switchLabel.isVisible(),true);
        assert.equal(await page.locator('#blai-ai-streaming-enabled').count(),1);
        assert.equal(await page.locator('.blai-ai-connection-header #blai-ai-streaming-enabled').count(),0);
        assert.equal(await switchLabel.evaluate(el=>el.previousElementSibling.classList.contains('blai-ai-model-field')),true);
        await setStreaming(true); await setStreaming(false);
        const bounds=await switchLabel.boundingBox();
        const grid=await page.locator('.blai-ai-connection-grid').boundingBox();
        assert.ok(bounds.x>=grid.x&&bounds.x+bounds.width<=grid.x+grid.width+1);
        assert.ok(bounds.y>=grid.y&&bounds.y+bounds.height<=grid.y+grid.height+1);
        await page.locator('.blai-ai-connection-grid').screenshot({path:path.join(output,'api-switch-grid-'+width+'.png')});
        check(width+': streaming switch follows model in API fields and works with additional parameters collapsed');
        await page.locator('.blai-ai-request-options > summary').click();
        await setStreaming(false);
        for (const scale of ['1', '1.6']) {
            await page.evaluate(scale=>{const select=document.getElementById('blai-ui-font-scale');select.value=scale;select.dispatchEvent(new Event('change',{bubbles:true}));},scale);
            for (const id of ['blai-ai-additional-parameters', 'blai-ai-excluded-parameters']) {
                const sizes = await page.locator('#'+id).evaluate(el=>({text:parseFloat(getComputedStyle(el).fontSize),placeholder:parseFloat(getComputedStyle(el,'::placeholder').fontSize),other:parseFloat(getComputedStyle(document.getElementById('blai-ai-base-url')).fontSize)}));
                assert.equal(sizes.text,sizes.other); assert.equal(sizes.placeholder,sizes.text);
                assert.ok(Math.abs(sizes.text-13*Number(scale))<0.01);
            }
            check(width+': request parameter text and placeholders match API inputs at '+Number(scale)*100+'%');
        }
        await page.locator('#blai-ai-excluded-parameters').fill('frequency_penalty\npresence_penalty');
        await page.locator('#blai-ai-additional-parameters').fill('{');
        assert.equal(await page.locator('#blai-ai-additional-parameters').getAttribute('aria-invalid'),'true');
        assert.equal(await page.locator('#blai-ai-request-options-error').isVisible(),true);
        await page.locator('#blai-ai-additional-parameters').fill('{"reasoning_effort":"none","thinking":{"enabled":false}}');
        assert.equal(await page.locator('#blai-ai-additional-parameters').getAttribute('aria-invalid'),'false');
        assert.equal(await page.locator('#blai-ai-request-options-error').isVisible(),false);
        assert.equal(await page.locator('.page-panel.active').evaluate(el=>el.scrollWidth-el.clientWidth),0);
        assert.ok(await page.locator('.blai-ai-request-options > summary').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))>22);
        assert.ok(await page.locator('.blai-ai-request-options small').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize))>19);
        const original = await page.evaluate(()=>({rules:JSON.stringify(fixture.settings.rules),prompt:fixture.settings.aiRewrite.promptTemplate,temperature:fixture.settings.aiRewrite.temperature}));
        page.once('dialog',d=>d.accept('API-'+width));
        await page.locator('#blai-ai-api-preset-new').click();
        assert.equal(await page.evaluate(()=>fixture.settings.aiRewrite.apiPresets[fixture.settings.aiRewrite.activeApiPreset].excludedParameters),'frequency_penalty\npresence_penalty');
        await setStreaming(true);
        assert.match(await page.locator('#blai-ai-api-preset option:checked').textContent(),/未保存/);
        assert.equal(await page.evaluate(()=>fixture.settings.aiRewrite.streamingEnabled),true);
        await page.locator('#blai-ai-api-preset-save').click();
        assert.doesNotMatch(await page.locator('#blai-ai-api-preset option:checked').textContent(),/未保存/);
        await setStreaming(false);
        await page.locator('#blai-ai-additional-parameters').fill('{"reasoning_effort":"low"}');
        page.once('dialog',d=>d.accept('其他API-'+width));
        await page.locator('#blai-ai-api-preset-new').click();
        await page.locator('#blai-ai-api-preset').selectOption('API-'+width);
        assert.equal(await page.locator('#blai-ai-streaming-enabled').isChecked(),true);
        check(width+': streaming toggles, marks API preset dirty, saves and restores with preset');
        assert.equal(await page.locator('#blai-ai-additional-parameters').inputValue(),'{"reasoning_effort":"none","thinking":{"enabled":false}}');
        await page.evaluate(()=>{const saved=JSON.parse(JSON.stringify(fixture.settings));Object.assign(fixture.settings,saved);});
        const nav=width>600?'.rail':'.bottom-nav';
        await page.locator(nav+' [data-page-target="overview"]').click();
        await page.locator('#blai-preset-select').selectOption('新规则集');
        await page.locator('#blai-preset-select').selectOption('原有规则集');
        await page.locator(nav+' [data-page-target="ai"]').click();
        assert.equal(await page.locator('#blai-ai-additional-parameters').inputValue(),'{"reasoning_effort":"none","thinking":{"enabled":false}}');
        assert.equal(await page.evaluate(()=>fixture.settings.aiRewrite.promptTemplate),original.prompt);
        assert.equal(await page.evaluate(()=>fixture.settings.aiRewrite.temperature),original.temperature);
        assert.equal(await page.evaluate(()=>JSON.stringify(fixture.settings.rules)),original.rules);
        assert.equal(await page.locator('#blai-ai-streaming-enabled').isChecked(),true);
        await page.locator('#blai-ai-additional-parameters').scrollIntoViewIfNeeded();
        await page.evaluate(()=>document.querySelectorAll('.blai-toast').forEach(el=>el.remove()));
        await page.screenshot({path:path.join(output,'api-options-'+width+'.png')});
        await page.locator('.blai-ai-request-options > summary').click();
        check(width+': API options validate JSON, save and switch API presets, survive reload and rule-preset switching');
    }
    const settingsBeforeScroll = await page.evaluate(() => JSON.stringify(fixture.settings));
    const pageIds = await page.locator('.page-panel').evaluateAll(panels => panels.map(panel => panel.dataset.page));
    assert.deepEqual(pageIds, ['overview', 'ai', 'clean', 'tools']);
    // Model long dynamic lists without changing the plugin's production templates or settings.
    await page.evaluate(() => {
        for (const panel of document.querySelectorAll('.page-panel')) {
            const tail = document.createElement('div');
            tail.dataset.scrollFixture = panel.dataset.page;
            tail.style.height = '1400px';
            tail.textContent = '滚动检查区域（模拟长列表）';
            panel.lastElementChild.append(tail);
        }
    });
    for (const [width, height, columnWidth] of [[1920,900,null],[1200,900,560],[390,844,null]]) {
        await page.setViewportSize({width,height});
        await page.evaluate(columnWidth => {
            const chat = document.getElementById('sheld');
            chat.style.width = columnWidth ? columnWidth+'px' : '51vw';
            chat.style.left = columnWidth ? 'calc((100vw - '+columnWidth+'px) / 2)' : '24.5vw';
        },columnWidth);
        await page.waitForFunction(mobile=>matchMedia('(max-width: 600px)').matches===mobile,width<=600);
        for (const theme of ['light','dark']) {
            await page.evaluate(theme => document.getElementById('blai-purifier-popup').dataset.theme=theme,theme);
            const savedPositions={};
            const nav=width>600?'.rail':'.bottom-nav';
            for (const id of pageIds) {
                await page.locator(nav+' [data-page-target="'+id+'"]').click();
                const panel=page.locator('.page-panel.active');
                await panel.evaluate(el=>el.scrollTop=0);
                const dims=await panel.evaluate(el=>{
                    const r=el.getBoundingClientRect(),root=document.getElementById('blai-purifier-popup').getBoundingClientRect();
                    return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,rootRight:root.right,
                        clientHeight:el.clientHeight,scrollHeight:el.scrollHeight,gutter:el.offsetWidth-el.clientWidth,
                        overflow:getComputedStyle(el).overflowY,scrollbarWidth:getComputedStyle(el).scrollbarWidth,
                        scrollbarDisplay:getComputedStyle(el,'::-webkit-scrollbar').display,horizontalOverflow:el.scrollWidth-el.clientWidth};
                });
                assert.equal(dims.overflow,'scroll');assert.equal(dims.scrollbarWidth,'auto');assert.equal(dims.scrollbarDisplay,'block');
                assert.ok(dims.gutter>=12,dims.gutter+' scrollbar gutter');assert.ok(Math.abs(dims.rootRight-dims.right)<=2,JSON.stringify(dims));assert.equal(dims.horizontalOverflow,0);
                const x=dims.right-dims.gutter/2;
                const thumb=Math.max(36,dims.clientHeight*dims.clientHeight/dims.scrollHeight);
                const maximum=dims.scrollHeight-dims.clientHeight;assert.ok(maximum>200);
                await page.mouse.move(x,dims.y+thumb/2);await page.mouse.down();
                await page.mouse.move(x,dims.y+dims.height-1,{steps:12});await page.mouse.up();
                await page.waitForFunction(()=>{const el=document.querySelector('.page-panel.active');return el.scrollTop>=el.scrollHeight-el.clientHeight-3},null,{timeout:3000});
                await page.mouse.move(x,dims.y+dims.height-thumb/2-1);await page.mouse.down();
                await page.mouse.move(x,dims.y+1,{steps:12});await page.mouse.up();
                await page.waitForFunction(()=>document.querySelector('.page-panel.active').scrollTop<=3,null,{timeout:3000});
                await page.mouse.move(dims.x+5,dims.y+100);await page.mouse.wheel(0,500);
                await page.waitForFunction(()=>{const el=document.querySelector('.page-panel.active');return el.scrollTop>=Math.min(500,el.scrollHeight-el.clientHeight)-1});
                savedPositions[id]=await panel.evaluate(el=>el.scrollTop);
                const header=await page.locator('.blai-global-header').boundingBox();const panelBox=await page.locator('#blai-purifier-popup').boundingBox();assert.ok(Math.abs(header.y-panelBox.y)<=2);assert.ok(header.y>=0);
                if(theme==='light'&&width===1920&&id==='overview'){
                    await panel.evaluate(el=>el.scrollTop=0);savedPositions[id]=0;
                    await page.screenshot({path:path.join(output,'right-scrollbar-desktop.png')});
                }
                check(width+' '+theme+' '+id+': right-edge scrollbar drags to both ends; wheel and fixed header work',dims);
            }
            for(const id of pageIds){
                await page.locator(nav+' [data-page-target="'+id+'"]').click();
                assert.ok(Math.abs((await page.locator('.page-panel.active').evaluate(el=>el.scrollTop))-savedPositions[id])<=1,id+' keeps its own scroll offset');
            }
            check(width+' '+theme+': switching all four pages retains independent scroll positions');
            if(width===390&&theme==='light')await page.screenshot({path:path.join(output,'right-scrollbar-mobile.png')});
        }
    }
    assert.equal(await page.evaluate(()=>JSON.stringify(fixture.settings)),settingsBeforeScroll);
    check('scrolling and page changes do not modify AI settings, rules or switches');
    const shortStyles=await page.evaluate(()=>{
        fixture.shell.showResponsivePage('overview');
        return Array.from(document.querySelector('.page-panel.active').children,child=>{
            const previous=child.getAttribute('style');child.style.display='none';return previous;
        });
    });
    const short=await page.locator('.page-panel.active').evaluate(el=>({range:el.scrollHeight-el.clientHeight,gutter:el.offsetWidth-el.clientWidth}));
    assert.equal(short.range,0);assert.ok(short.gutter>=12);
    await page.evaluate(previous=>Array.from(document.querySelector('.page-panel.active').children).forEach((child,index)=>{
        if(previous[index]===null)child.removeAttribute('style');else child.setAttribute('style',previous[index]);
    }),shortStyles);
    check('short pages keep a stable scrollbar gutter without creating artificial scroll range');
    const beforeFonts=await page.evaluate(()=>({rules:JSON.stringify(fixture.settings.rules),ai:JSON.stringify(fixture.settings.aiRewrite),hostFont:getComputedStyle(document.getElementById('outside-left')).fontSize}));
    for(const width of [1920,390]){
        await page.setViewportSize({width,height:900});
        await page.evaluate(()=>{document.getElementById('sheld').style.width='51vw';document.getElementById('sheld').style.left='24.5vw';});
        await page.waitForFunction(mobile=>matchMedia('(max-width: 600px)').matches===mobile,width<=600);
        const nav=width>600?'.rail':'.bottom-nav';
        await page.locator(nav+' [data-page-target="tools"]').click();
        await page.locator('#blai-ui-font-scale').selectOption('1');
        const baseline={};
        for(const id of pageIds){await page.locator(nav+' [data-page-target="'+id+'"]').click();baseline[id]=await page.locator('.page-panel.active h2').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize));}
        const modalBaseline=await page.locator('#blai-ai-prompt-expanded').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
        await page.locator(nav+' [data-page-target="tools"]').click();
        await page.locator('#blai-ui-font-scale').selectOption('1.6');
        for(const id of pageIds){
            await page.locator(nav+' [data-page-target="'+id+'"]').click();
            const panel=page.locator('.page-panel.active');
            const size=await panel.locator('h2').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
            assert.ok(Math.abs(size/baseline[id]-1.6)<0.01,id+' has scaled font');
            assert.equal(await panel.evaluate(el=>el.scrollWidth-el.clientWidth),0,id+' enlarged text has no horizontal overflow');
            const rects=await panel.evaluate(el=>{const r=el.getBoundingClientRect();return [...el.querySelectorAll('button,input,select,textarea')].filter(c=>!c.hidden&&c.getBoundingClientRect().width>1).filter(c=>{const a=c.getBoundingClientRect();return a.left<r.left-1||a.right>r.right-(el.offsetWidth-el.clientWidth)+1}).map(c=>c.id||c.className)});
            assert.deepEqual(rects,[],id+' controls stay inside content at 160%');
            if(id==='tools'){
                await page.locator('#blai-ui-font-scale').scrollIntoViewIfNeeded();
                assert.ok((await page.locator('#blai-ui-font-scale').boundingBox()).width>=150,'font-size value is readable');
                await page.screenshot({path:path.join(output,'font-size-160-'+width+'.png')});
            }
            check(width+' '+id+': 160% font grows proportionally without horizontal clipping');
        }
        await page.locator(nav+' [data-page-target="ai"]').click();
        await page.locator('#blai-ai-prompt-expand').click();
        const expanded=await page.locator('#blai-ai-prompt-expanded').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
        assert.ok(Math.abs(expanded/modalBaseline-1.6)<0.01);
        const modal=await page.locator('.blai-ai-prompt-modal-card').boundingBox();assert.ok(modal.x>=0&&modal.x+modal.width<=width+1);
        await page.locator('#blai-ai-prompt-modal-close').click();
        check(width+': detached prompt editor follows the selected font scale');
        await page.locator(nav+' [data-page-target="tools"]').click();
        await page.locator('#blai-ui-font-scale').selectOption('1.2');
        await page.evaluate(()=>{document.documentElement.style.removeProperty('--blai-ui-font-scale');fixture.fonts.bindUiFontScaleEvents();});
        assert.equal(await page.locator('#blai-ui-font-scale').inputValue(),'1.2');
        assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--blai-ui-font-scale')),'1.2');
        await page.locator('#blai-ui-font-scale').selectOption('1');
        check(width+': font preference persists on rebinding and returns to standard size');
    }
    const afterFonts=await page.evaluate(()=>({rules:JSON.stringify(fixture.settings.rules),ai:JSON.stringify(fixture.settings.aiRewrite),hostFont:getComputedStyle(document.getElementById('outside-left')).fontSize}));
    assert.deepEqual(afterFonts,beforeFonts);check('font setting leaves host text, AI configuration and rule switches unchanged');
    await page.locator('#blai-ui-font-scale').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,'font-size-setting.png')});
    await page.setViewportSize({width:1920,height:1080});
    await page.evaluate(()=>{document.getElementById('blai-purifier-popup').dataset.theme='dark';});
    await page.waitForFunction(()=>!matchMedia('(max-width: 600px)').matches);
    await page.screenshot({path:path.join(output,'dark-1920.png')});check('dark theme retains readable original tokens');
    const saves=await page.evaluate(()=>fixture.saves);await page.locator('#blai-preset-save').click();assert.equal(await page.evaluate(()=>fixture.saves),saves+1);
    const overlay=page.locator('#blai-main-panel-overlay'),panel=page.locator('#blai-purifier-popup');
    await page.locator('#blai-close-btn').click();await page.waitForFunction(()=>document.getElementById('blai-main-panel-overlay').hidden);
    assert.equal(await overlay.evaluate(el=>getComputedStyle(el).display),'none');assert.equal(await panel.isVisible(),false);
    check('explicit close removes the overlay from display');
    assert.equal(await page.locator('#blai-diff-modal').evaluate(el=>!!el.closest('#blai-main-panel-overlay')),false);
    check('standalone chat Diff dialog is outside the main overlay');
    await page.locator('#open-chat-diff').click();
    await page.waitForFunction(()=>getComputedStyle(document.getElementById('blai-diff-modal')).display!=='none');
    await page.waitForFunction(()=>document.getElementById('blai-diff-modal-content')?.textContent.trim().length>0);
    assert.equal(await overlay.isVisible(),false);assert.equal(await page.locator('#blai-diff-modal').isVisible(),true);
    check('chat Diff opens independently while the main panel and backdrop are closed');
    await page.locator('#blai-diff-modal-close').click();
    await page.waitForFunction(()=>getComputedStyle(document.getElementById('blai-diff-modal')).display==='none');
    await page.evaluate(()=>{document.getElementById('sheld').style.width='800px';document.getElementById('sheld').style.left='200px';});
    await page.locator('#blai-wand-btn').click();await page.waitForFunction(()=>!document.getElementById('blai-main-panel-overlay').hidden);
    const openedShell=await page.evaluate(()=>{
        const overlay=document.getElementById('blai-main-panel-overlay'),panel=document.getElementById('blai-purifier-popup'),style=getComputedStyle(overlay),rect=panel.getBoundingClientRect();
        return {hidden:overlay.hidden,overlayDisplay:style.display,background:style.backgroundColor,panelDisplay:getComputedStyle(panel).display,width:rect.width,left:rect.left,top:rect.top,height:rect.height,viewportWidth:innerWidth,viewportHeight:innerHeight,ttOverlay:overlay.getAttribute('data-tt-mobile-surface'),ttPanel:panel.getAttribute('data-tt-mobile-surface')};
    });
    assert.equal(openedShell.hidden,false);assert.equal(openedShell.overlayDisplay,'flex');assert.match(openedShell.background,/rgba\(0, 0, 0, 0\.55\)/);
    assert.equal(openedShell.panelDisplay,'grid');assert.equal(Math.round(openedShell.width),1040);assert.ok(Math.abs(openedShell.left-(openedShell.viewportWidth-1040)/2)<=1);
    assert.ok(openedShell.height<=900&&openedShell.top>=16);assert.equal(openedShell.ttOverlay,'backdrop');assert.equal(openedShell.ttPanel,'free-window');
    check('wand opens a centered 1040px free window over a dim backdrop with TT free-window annotation');
    await page.locator('#blai-responsive-title').click();assert.equal(await overlay.isVisible(),true);
    await overlay.click({position:{x:2,y:2}});await page.waitForFunction(()=>document.getElementById('blai-main-panel-overlay').hidden);
    check('click inside keeps the panel open; clicking the backdrop closes it');
    await page.locator('#blai-wand-btn').click();
    const foreignKeys=await page.evaluate(()=>{
        // Myriad Knots uses a body-level Shadow DOM host. Reproduce that event boundary.
        const host=document.createElement('div');host.id='qqj-panel-host';
        const shadow=host.attachShadow({mode:'open'});
        shadow.innerHTML='<button>记忆面板</button>';
        document.body.append(host);const button=shadow.querySelector('button');button.focus();
        const keys=['Escape','Tab'].map(key=>{
            const event=new KeyboardEvent('keydown',{key,bubbles:true,composed:true,cancelable:true});
            button.dispatchEvent(event);return {key,prevented:event.defaultPrevented};
        });
        const result={keys,focus:document.activeElement===host,open:fixture.shell.isMainPanelOpen()};
        host.remove();return result;
    });
    assert.deepEqual(foreignKeys,{keys:[{key:'Escape',prevented:false},{key:'Tab',prevented:false}],focus:true,open:true});
    check('foreign Shadow DOM memory panel retains Escape, Tab and focus ownership');
    await page.locator('#blai-close-btn').click();
    await page.locator('#blai-wand-btn').click();await page.waitForFunction(()=>!document.getElementById('blai-main-panel-overlay').hidden);
    await page.setViewportSize({width:390,height:844});
    await page.locator('.bottom-nav [data-page-target="ai"]').click();await page.locator('#blai-ai-generation-open').click();
    await page.waitForFunction(()=>document.getElementById('blai-ai-generation-modal').classList.contains('blai-is-open'));
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.getElementById('blai-ai-generation-modal').classList.contains('blai-is-open'));
    assert.equal(await overlay.isVisible(),true);
    await page.keyboard.press('Escape');await page.waitForFunction(()=>document.getElementById('blai-main-panel-overlay').hidden);
    check('Esc closes the child dialog first and only then closes the main panel');
    await page.setViewportSize({width:1920,height:1080});
    await page.locator('#blai-wand-btn').click();await page.waitForFunction(()=>!document.getElementById('blai-main-panel-overlay').hidden);
    await page.evaluate(()=>{const placeholder=document.createElement('div');placeholder.id='dialogue_popup';placeholder.style.cssText='display:block;position:fixed;width:0;height:0;overflow:hidden;top:0;left:0';document.body.append(placeholder);});
    await page.locator('#blai-close-btn').click();await page.waitForFunction(()=>document.getElementById('blai-main-panel-overlay').hidden);
    await page.evaluate(()=>document.getElementById('dialogue_popup')?.remove());
    check('explicit close is not blocked by a zero-size host popup placeholder');
    await page.locator('#blai-wand-btn').click();await page.waitForFunction(()=>!document.getElementById('blai-main-panel-overlay').hidden);
    await page.evaluate(()=>{const settings=fixture.settings;settings.rules=JSON.parse(JSON.stringify(settings.presets[settings.activePreset].rules||[]));fixture.failSave=true;settings.rules.pop();});
    const failedRuleCount=await page.evaluate(()=>fixture.settings.rules.length),errorBaseline=errors.length;
    page.once('dialog',dialog=>dialog.dismiss());
    await overlay.click({position:{x:2,y:2}});await page.waitForTimeout(100);
    assert.equal(await overlay.isVisible(),true);
    await page.evaluate(()=>{fixture.failSave=false;});
    assert.ok(errors.length>errorBaseline,'failed rollback should be surfaced');
    errors.length=errorBaseline;
    assert.equal(await page.evaluate(()=>fixture.settings.rules.length),failedRuleCount+1);
    check('failed rollback preserves the open panel and does not hide the error state');
    await page.locator('#blai-close-btn').focus();
    await page.keyboard.press('Escape');await page.waitForFunction(()=>document.getElementById('blai-main-panel-overlay').hidden);
    await page.locator('#blai-wand-btn').click();await page.waitForFunction(()=>!document.getElementById('blai-main-panel-overlay').hidden);
    const presetRuleCount=await page.evaluate(()=>{const settings=fixture.settings;settings.rules=JSON.parse(JSON.stringify(settings.presets[settings.activePreset].rules||[]));settings.rules.pop();return settings.presets[settings.activePreset].rules.length;});
    page.once('dialog',dialog=>dialog.dismiss());
    await overlay.click({position:{x:2,y:2}});await page.waitForFunction(()=>document.getElementById('blai-main-panel-overlay').hidden);
    assert.equal(await page.evaluate(()=>fixture.settings.rules.length),presetRuleCount);
    check('backdrop close discard uses the existing rollback path');
    await page.locator('#blai-wand-btn').click();await page.waitForFunction(()=>!document.getElementById('blai-main-panel-overlay').hidden);
    const savesBeforeClose=await page.evaluate(()=>fixture.saves);
    const dirtyRuleCount=await page.evaluate(()=>{const settings=fixture.settings;settings.rules=JSON.parse(JSON.stringify(settings.presets[settings.activePreset].rules||[]));settings.rules.pop();return settings.rules.length;});
    page.once('dialog',dialog=>dialog.accept());
    await overlay.click({position:{x:2,y:2}});await page.waitForFunction(()=>document.getElementById('blai-main-panel-overlay').hidden);
    assert.equal(await page.evaluate(()=>fixture.settings.presets[fixture.settings.activePreset].rules.length),dirtyRuleCount);
    assert.equal(await page.evaluate(()=>fixture.saves),savesBeforeClose+1);
    check('backdrop close save uses the existing preset save path');
    await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>matchMedia('(max-width: 600px)').matches);
    await page.locator('#blai-wand-btn').click();await page.waitForFunction(()=>!document.getElementById('blai-main-panel-overlay').hidden);
    const mobileShell=await page.evaluate(()=>{const overlay=document.getElementById('blai-main-panel-overlay'),panel=document.getElementById('blai-purifier-popup'),rect=panel.getBoundingClientRect();return{width:rect.width,left:rect.left,right:innerWidth-rect.right,top:rect.top,bottom:innerHeight-rect.bottom,nav:getComputedStyle(panel.querySelector('.bottom-nav')).display,overlayDisplay:getComputedStyle(overlay).display};});
    assert.ok(Math.abs(mobileShell.width-374)<=1);assert.ok(mobileShell.left>=7&&mobileShell.right>=7);assert.ok(mobileShell.top>=7&&mobileShell.bottom>=7);
    assert.equal(mobileShell.nav,'grid');assert.equal(mobileShell.overlayDisplay,'flex');
    await overlay.click({position:{x:2,y:2}});await page.waitForFunction(()=>document.getElementById('blai-main-panel-overlay').hidden);
    check('390px mobile keeps visible margins, bounded viewport and the bottom navigation');
    await page.setViewportSize({width:1920,height:1080});await page.waitForFunction(()=>!matchMedia('(max-width: 600px)').matches);
    await page.locator('#blai-wand-btn').click();await page.waitForFunction(()=>!document.getElementById('blai-main-panel-overlay').hidden);
    const fixed=await panel.boundingBox();assert.equal(Math.round(fixed.width),1040);assert.equal(Math.round(fixed.x),440);check('save, close and reopen preserve fixed centered window');
    await page.evaluate(()=>{document.getElementById('sheld').style.width='540px';document.getElementById('sheld').style.left='40px';});
    await page.waitForTimeout(80);
    assert.deepEqual(await panel.boundingBox(),fixed);check('host chat column changes do not resize or move plugin window');
    await page.evaluate(()=>{document.getElementById('sheld').remove();});
    assert.deepEqual(await panel.boundingBox(),fixed);check('window works without a host chat column or layout binding');
    await page.evaluate(async()=>{await fixture.shell.setupUI(fixture.renderTemplate,'/fixture');});
    await page.waitForFunction(()=>document.querySelectorAll('#blai-main-panel-overlay').length===1);
    const resetShell=await page.evaluate(()=>{const overlays=document.querySelectorAll('#blai-main-panel-overlay'),overlay=overlays[0];return{count:overlays.length,hidden:overlay.hidden,display:getComputedStyle(overlay).display,bodyOpen:document.body.classList.contains('blai-main-panel-open'),panelDisplay:getComputedStyle(document.getElementById('blai-purifier-popup')).display};});
    assert.equal(resetShell.count,1);assert.equal(resetShell.hidden,true);assert.equal(resetShell.display,'none');assert.equal(resetShell.bodyOpen,false);assert.equal(resetShell.panelDisplay,'none');
    await page.locator('#blai-wand-btn').click();await page.waitForFunction(()=>!document.getElementById('blai-main-panel-overlay').hidden);
    assert.equal(await page.locator('#blai-main-panel-overlay').count(),1);
    await page.locator('#blai-close-btn').click();await page.waitForFunction(()=>document.getElementById('blai-main-panel-overlay').hidden);
    check('repeated setupUI removes the stale overlay, body lock and duplicate panels');
    assert.deepEqual(errors,[]);check('no browser JavaScript errors');
} catch(error) { results.push({passed:false,error:error.stack}); await page.screenshot({path:path.join(output,'failure.png')});throw error; }
finally { fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({results,errors,realModelCalls:0,host:'isolated fixture; native template, CSS, modules and jQuery; simulated host APIs'},null,2));await browser.close();server.close(); }
