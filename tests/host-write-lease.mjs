import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initAppContext } from '../src/host/appContext.js';
import { bindHostLifecycleEvents } from '../src/host/lifecycleEvents.js';
import { generationLifecycle } from '../src/host/generationLifecycle.js';
import { getMessageWriteCoordinator } from '../src/integrations/messageWriteCoordinator.js';
import { defaultSettings, extensionName } from '../src/settings/defaults.js';

test('host receipt emitted inside another plugin render does not await its own queue tail', {timeout:3000}, async()=>{
    globalThis.window={addEventListener(){}};
    globalThis.document={getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[]};
    const listeners=new Map();
    const events={on(name,fn){listeners.set(name,fn);},makeFirst(){},makeLast(){}};
    const message={is_user:false,mes:'他极其认真。',extra:{qqj_v3_recall_receipt:{keep:true}}};
    const chat=[message];
    const settings=structuredClone(defaultSettings);
    Object.assign(settings,{logLevel:0,scopeTags:[],rules:[{enabled:true,subRules:[{enabled:true,mode:'text',rewriteMode:'program',targets:['极其'],replacements:['']}]}]});
    const host={chat,chatId:'host-lease',updateMessageBlock(){},saveChat:async()=>{}};
    initAppContext({chat,extension_settings:{[extensionName]:settings},eventSource:events,event_types:{MESSAGE_RECEIVED:'received'},getSillyTavernContext:()=>host,saveSettingsDebounced(){}});
    generationLifecycle.configure({getCurrentChatId:()=> 'host:host-lease',getCurrentChat:()=>chat});
    generationLifecycle.startGeneration({chatId:'host:host-lease',chat,mode:'normal'});
    bindHostLifecycleEvents();
    const coordinator=getMessageWriteCoordinator();let callbackReturned=false;
    await coordinator.run(chat,'response-linter',async()=>{
        await listeners.get('received')(0);
        callbackReturned=true;
        assert.equal(message.mes,'他极其认真。');
    });
    await coordinator.run(chat,'test-barrier',()=>{});
    assert.equal(callbackReturned,true);
    assert.equal(message.mes,'他认真。');
    assert.deepEqual(message.extra.qqj_v3_recall_receipt,{keep:true});
});
