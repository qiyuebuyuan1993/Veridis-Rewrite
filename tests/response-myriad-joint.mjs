// Real extension modules; synthetic host, storage and model. Third-party sources stay external.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { initAppContext } from '../src/host/appContext.js';
import { defaultSettings, defaultAiRewriteSettings, extensionName } from '../src/settings/defaults.js';
import { runAiRewriteForMessageNow, resetAiRewriteRuntimeState } from '../src/aiRewrite/runtime.js';
import { generationLifecycle } from '../src/host/generationLifecycle.js';

const responseRoot=process.env.BLAI_RESPONSE_REFERENCE;
const myriadRoot=process.env.BLAI_MYRIAD_REFERENCE;
if(!responseRoot || !myriadRoot) throw Error('Set BLAI_RESPONSE_REFERENCE and BLAI_MYRIAD_REFERENCE to pinned repository roots');
globalThis.window=globalThis;
globalThis.document=new EventTarget();
Object.assign(document,{getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],documentElement:{setAttribute(){}},
    createElement:()=>({textContent:'',get innerHTML(){return this.textContent;}})});
globalThis.CultivationRuleRouter={};
let host;
globalThis.SillyTavern={getContext:()=>host};
const external=(root,file)=>import(pathToFileURL(path.join(root,file)).href);
const {createBackendController}=await external(responseRoot,'core/backend-controller.js');
const {messageHandler}=await external(responseRoot,'core/message-handler.js');
const {fixCoordinator}=await external(responseRoot,'core/fix-coordinator.js');
const {scanAssistantCandidates}=await external(myriadRoot,'src/v3/foundation-domain.js');
const controller=createBackendController('response-linter');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const gate=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{resolve,promise};};
async function until(fn){for(let i=0;i<300;i++){if(fn())return;await delay(5);}throw Error('joint fixture timed out');}

for(const order of ['rewrite-first','repair-first']) test(`real modules ${order}: both automatic edits survive and Myriad stabilizes final content`,{timeout:10000},async()=>{
    resetAiRewriteRuntimeState();
    const text='<think>内部推理</think><content>他极其认真地检查桌面。</content>';
    const message={is_user:false,mes:text,swipe_id:0,swipes:[text,'另一分支'],
        extra:{qqj_v3_recall_receipt:{receipt:'outer'}},
        swipe_info:[{extra:{qqj_v3_recall_receipt:{receipt:'selected'}}},{extra:{qianqianjieAutoHide:{keep:true}}}]};
    const memoryBefore=structuredClone({extra:message.extra,swipeInfo:message.swipe_info});
    const chat=[message],events=new EventEmitter();let saves=0,requests=0;
    host={chat,chatId:'joint',chatMetadata:{qianqianjie:{keep:true}},extensionSettings:{},
        eventSource:events,eventTypes:Object.fromEntries(['MESSAGE_RECEIVED','MESSAGE_UPDATED','CHARACTER_MESSAGE_RENDERED','GENERATION_STARTED','MESSAGE_SWIPED'].map(n=>[n,n])),
        updateMessageBlock:async()=>{},saveChat:async()=>{saves++;},getRequestHeaders:()=>({})};
    const settings=structuredClone(defaultSettings);
    Object.assign(settings,{logLevel:0,scopeTagMode:'protect',scopeTags:[],rules:[{enabled:true,subRules:[{enabled:true,mode:'text',rewriteMode:'ai',targets:['极其'],replacements:['']}]}],
        aiRewrite:{...defaultAiRewriteSettings,enabled:true,autoTriggerEnabled:true,xmlScopeTag:'content',baseUrl:'https://fixture.invalid/v1',apiKey:'fixture',model:'fixture',maxRetries:0}});
    initAppContext({chat,extension_settings:{[extensionName]:settings},getSillyTavernContext:()=>host,saveChat:host.saveChat,saveSettingsDebounced(){}});
    generationLifecycle.configure({getCurrentChatId:()=> 'host:joint',getCurrentChat:()=>chat});
    const session=generationLifecycle.startGeneration({chatId:'host:joint',chat,mode:'normal'});
    generationLifecycle.bindMessage(0,{chatId:'host:joint',chat});
    const payload={automatic:true,generationId:session.generationId,chatId:'host:joint',messageId:0};
    messageHandler.ctxRef=host;messageHandler.lastContent.clear();messageHandler.lastStates.clear();messageHandler.lastHandledAt.clear();
    fixCoordinator._sleep=async()=>{};
    controller.updateSettings({enabled:true,autoFix:true,removeLeakedReasoning:true,defaultAutoFixAction:'apply'});
    await until(()=>messageHandler.isListening);
    const entered=gate(),blocked=gate();
    globalThis.fetch=async()=>{requests++;if(order==='rewrite-first'){entered.resolve();await blocked.promise;}
        return{ok:true,status:200,json:async()=>({choices:[{message:{content:JSON.stringify({'hit-1':'他认真地检查桌面。'})}}]})};};
    let running;
    if(order==='rewrite-first'){
        running=runAiRewriteForMessageNow(payload);await entered.promise;
        events.emit('MESSAGE_RECEIVED',0);await until(()=>fixCoordinator.isProcessing);
        assert.equal(saves,0);blocked.resolve();
    }else{
        let first=true;host.updateMessageBlock=async()=>{if(first){first=false;entered.resolve();await blocked.promise;}};
        events.emit('MESSAGE_RECEIVED',0);await entered.promise;
        running=runAiRewriteForMessageNow(payload);await delay(10);assert.equal(requests,0);blocked.resolve();
    }
    await running;await until(()=>!fixCoordinator.isProcessing && !messageHandler.isProcessing);
    assert.equal(message.mes,'<content>他认真地检查桌面。</content>');
    assert.equal(message.swipes[0],message.mes);assert.equal(message.swipes[1],'另一分支');
    assert.equal(requests,1);
    assert.deepEqual(message.extra.qqj_v3_recall_receipt,memoryBefore.extra.qqj_v3_recall_receipt);
    assert.deepEqual(message.swipe_info,memoryBefore.swipeInfo);
    assert.deepEqual(host.chatMetadata,{qianqianjie:{keep:true}});
    chat.push({is_user:true,mes:'下一轮',send_date:'synthetic-next'});
    const floors=await scanAssistantCandidates(chat,{captureRawContent:true});
    assert.equal(floors[0].stabilityProof.kind,'nextUser');
    assert.equal(floors[0].canonicalContent,'他认真地检查桌面。');
    assert.equal(floors[0].rawContent,message.mes);
    const stableText=message.mes;await delay(250);assert.equal(message.mes,stableText);
    controller.updateSettings({enabled:true,autoFix:false});
    for(const timer of messageHandler.deferredEvents.values())clearTimeout(timer);
    messageHandler.deferredEvents.clear();resetAiRewriteRuntimeState();generationLifecycle.cancelActive('fixture-end');
});
