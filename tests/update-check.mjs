import assert from 'node:assert/strict';
import {test} from 'node:test';
import {bindUpdateStatusEvents} from '../src/update/status.js';

const selector='#blai-tools-version-section [data-update-action="check"]';
function fixture(){
 const handlers=new Map();
 class Element {
  constructor(){this.children=[];this.dataset={};this.textContent='';this.disabled=false;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(){this.children=[];}
  querySelector(){return this.children.find(x=>x.dataset.updateAction==='check')||null;}
 }
 const content=new Element();
 globalThis.document={createElement:()=>new Element(),getElementById:id=>id==='blai-tools-version-content'?content:null};
 globalThis.$=()=>({off(_event,sel){handlers.delete(sel);return this;},on(_event,sel,fn){handlers.set(sel,fn);return this;}});
 return {content,click:()=>handlers.get(selector).call(content.querySelector())};
}
test('initialization performs no version request and offers an explicit check',()=>{
 const f=fixture();let calls=0;bindUpdateStatusEvents(()=>{calls++;});
 assert.equal(calls,0);assert.equal(f.content.querySelector().textContent,'检查版本');
});
test('repeated clicks share a single in-flight check and allow a later check',async()=>{
 const f=fixture();let calls=0,finish;bindUpdateStatusEvents(()=>{calls++;return new Promise(r=>finish=r);});
 const first=f.click();await f.click();assert.equal(calls,1);assert.equal(f.content.querySelector().disabled,true);
 finish();await first;assert.equal(f.content.querySelector().disabled,false);
 const second=f.click();assert.equal(calls,2);finish();await second;
});
test('rendering the version result retains a way to check again',async()=>{
 const f=fixture();bindUpdateStatusEvents(()=>{f.content.replaceChildren();});await f.click();
 assert.equal(f.content.querySelector().textContent,'检查版本');assert.equal(f.content.children.length,1);
});
test('rebinding does not accumulate check buttons or listeners',async()=>{
 const f=fixture();let oldCalls=0,newCalls=0;bindUpdateStatusEvents(()=>{oldCalls++;});bindUpdateStatusEvents(()=>{newCalls++;});
 await f.click();assert.equal(oldCalls,0);assert.equal(newCalls,1);assert.equal(f.content.children.filter(x=>x.dataset.updateAction==='check').length,1);
});
