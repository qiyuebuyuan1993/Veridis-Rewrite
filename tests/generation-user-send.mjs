import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initAppContext } from '../src/host/appContext.js';
import { bindHostLifecycleEvents } from '../src/host/lifecycleEvents.js';
import { generationLifecycle } from '../src/host/generationLifecycle.js';
import { resetAiRewriteRuntimeState } from '../src/aiRewrite/runtime.js';
import { defaultSettings, defaultAiRewriteSettings, extensionName } from '../src/settings/defaults.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) {
    for (let i = 0; i < 200; i++) { if (fn()) return; await pause(10); }
    throw Error('automatic rewrite did not reach expected state');
}
function fixture() {
    resetAiRewriteRuntimeState();
    generationLifecycle.cancelActive('fixture-reset');
    globalThis.window = { addEventListener() {} };
    globalThis.CultivationRuleRouter = {};
    globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
        createElement: () => ({ textContent: '', get innerHTML() { return this.textContent; } }) };
    const listeners = new Map();
    const events = { on(name, fn) { listeners.set(name, fn); }, makeFirst() {}, makeLast() {} };
    const chat = [{ is_user: false, mes: 'previous' }];
    const host = { chat, chatId: 'start-send', updateMessageBlock() {}, saveChat: async () => {}, getRequestHeaders: () => ({}) };
    const settings = structuredClone(defaultSettings);
    Object.assign(settings, { logLevel: 0, scopeTags: [], rules: [{ enabled: true, subRules: [{ enabled: true,
        mode: 'text', rewriteMode: 'ai', targets: ['极其'], replacements: [''] }] }],
        aiRewrite: { ...defaultAiRewriteSettings, enabled: true, autoTriggerEnabled: true, xmlScopeTag: '',
            baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture', model: 'fixture', maxRetries: 0 } });
    const types = Object.fromEntries(['GENERATION_STARTED', 'GENERATION_ENDED', 'GENERATION_STOPPED', 'MESSAGE_SENT', 'MESSAGE_RECEIVED'].map(n => [n, n]));
    initAppContext({ chat, extension_settings: { [extensionName]: settings }, eventSource: events, event_types: types,
        getSillyTavernContext: () => host, saveChat: host.saveChat, saveSettingsDebounced() {} });
    generationLifecycle.configure({ getCurrentChatId: () => 'host:start-send', getCurrentChat: () => chat });
    bindHostLifecycleEvents();
    return { chat, host, emit: (event, ...args) => listeners.get(event)?.(...args),
        send() { chat.push({ is_user: true, mes: 'user' }); listeners.get('MESSAGE_SENT')(chat.length - 1); } };
}
const reply = () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ 'hit-1': '他认真地检查桌面。' }) } }] }) });

for (const order of ['start-before-send', 'send-before-start']) test(`${order}: automatic AI runs once from real lifecycle events`, async () => {
    const f = fixture(); let requests = 0;
    globalThis.fetch = async () => { requests++; return reply(); };
    if (order === 'send-before-start') f.send();
    f.emit('GENERATION_STARTED', 'normal', {}, false);
    const session = generationLifecycle.getActive();
    if (order === 'start-before-send') f.send();
    assert.equal(generationLifecycle.getActive(), session);
    const message = { is_user: false, mes: '他极其认真地检查桌面。', extra: { qqj_v3_recall_receipt: { keep: true } } };
    f.chat.push(message);
    f.emit('GENERATION_ENDED', f.chat.length);
    f.emit('MESSAGE_RECEIVED', f.chat.length - 1, 'normal');
    await until(() => message.mes === '他认真地检查桌面。');
    assert.equal(requests, 1);
    assert.deepEqual(message.extra.qqj_v3_recall_receipt, { keep: true });
    resetAiRewriteRuntimeState();
});

test('next user during pending AI cancels without changing stable memory content', async () => {
    const f = fixture(); let entered = false, release;
    const blocked = new Promise(resolve => { release = resolve; });
    globalThis.fetch = async () => { entered = true; await blocked; return reply(); };
    f.emit('GENERATION_STARTED', 'normal', {}, false); f.send();
    const message = { is_user: false, mes: '他极其认真地检查桌面。', extra: { qqj_v3_recall_receipt: { keep: true } } };
    f.chat.push(message); f.emit('GENERATION_ENDED', f.chat.length); f.emit('MESSAGE_RECEIVED', f.chat.length - 1, 'normal');
    await until(() => entered);
    f.send(); assert.equal(generationLifecycle.getActive(), null);
    release(); await pause(150);
    assert.equal(message.mes, '他极其认真地检查桌面。');
    assert.deepEqual(message.extra.qqj_v3_recall_receipt, { keep: true });
    resetAiRewriteRuntimeState();
});

for (const mode of ['swipe', 'regenerate', 'continue']) test(`${mode}: user send still cancels`, () => {
    const f = fixture(); f.emit('GENERATION_STARTED', mode, {}, false); f.send();
    assert.equal(generationLifecycle.getActive(), null);
});
test('only one initiating append is allowed', () => {
    const f = fixture(); f.emit('GENERATION_STARTED', 'normal', {}, false); f.send();
    assert.ok(generationLifecycle.getActive()); f.send(); assert.equal(generationLifecycle.getActive(), null);
});
for (const event of ['GENERATION_ENDED', 'GENERATION_STOPPED']) test(`${event}: does not leave an unused send exemption`, () => {
    const f = fixture(); f.emit('GENERATION_STARTED', 'normal', {}, false); f.emit(event, f.chat.length); f.send();
    assert.equal(generationLifecycle.getActive(), null);
});
test('dry-run cannot create a generation or send exemption', () => {
    const f = fixture(); f.emit('GENERATION_STARTED', 'normal', {}, true); f.send();
    assert.equal(generationLifecycle.getActive(), null);
});
test('dry-run during a real start preserves its initiating message boundary', () => {
    const f = fixture(); f.emit('GENERATION_STARTED', 'normal', {}, false);
    const session = generationLifecycle.getActive();
    f.emit('GENERATION_STARTED', 'normal', {}, true); f.send();
    assert.equal(generationLifecycle.getActive(), session);
});
for (const mutation of ['replace-tail', 'edit-tail', 'extra-append', 'change-chat', 'automatic-trigger']) test(`${mutation}: cannot consume the initiating send exemption`, () => {
    const f = fixture(); f.emit('GENERATION_STARTED', 'normal', { automatic_trigger: mutation === 'automatic-trigger' }, false);
    if (mutation === 'replace-tail') f.chat[0] = { is_user: false, mes: 'replacement' };
    if (mutation === 'edit-tail') f.chat[0].mes = 'changed';
    if (mutation === 'extra-append') f.chat.push({ is_user: false, mes: 'another' });
    if (mutation === 'change-chat') f.host.chatId = 'different';
    f.send(); assert.equal(generationLifecycle.getActive(), null);
});
