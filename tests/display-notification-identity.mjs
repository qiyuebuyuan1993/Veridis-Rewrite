import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initAppContext } from '../src/host/appContext.js';
import { generationLifecycle } from '../src/host/generationLifecycle.js';
import { refreshMessageDisplay } from '../src/chat/display.js';

for (const scheduler of ['raf', 'timeout']) {
for (const event of ['rendered', 'updated']) {
    for (const boundary of ['none', 'chat', 'chat-id', 'message', 'swipe', 'unmaterialized', 'generation', 'generation-cancelled', 'text', 'display', 'host-hook']) {
        test(`${scheduler} ${event}: deferred notification ${boundary}`, async () => {
            generationLifecycle.cancelActive();
            const frames = [], emitted = [];
            const msg = { mes: 'original', swipe_id: 0, swipes: ['original', 'other'], extra: { qqj: { keep: true } } };
            const host = {
                chat: [msg], chatId: 'one',
                eventSource: { emit: async (...args) => emitted.push(args) },
                eventTypes: { CHARACTER_MESSAGE_RENDERED: 'rendered', MESSAGE_UPDATED: 'updated' },
                updateMessageBlock() { if (boundary === 'host-hook') host.chat = []; },
            };
            globalThis.document = { getElementById: () => null, querySelector: () => null };
            const originalTimeout = globalThis.setTimeout;
            if (scheduler === 'raf') globalThis.requestAnimationFrame = fn => frames.push(fn);
            else globalThis.setTimeout = fn => frames.push(fn);
            globalThis['online-content-floating-window'] = true;
            initAppContext({ chat: host.chat, getSillyTavernContext: () => host });
            if (boundary === 'unmaterialized') msg.swipe_id = 2;
            const before = JSON.stringify(msg);
            let released = 0;
            assert.equal(refreshMessageDisplay(0, {
                emitRenderedEvent: event === 'rendered', atomicSwap: { release() { released++; } },
            }), true);
            if (boundary === 'chat') host.chat = [msg];
            if (boundary === 'chat-id') host.chatId = 'two';
            if (boundary === 'message') host.chat[0] = structuredClone(msg);
            if (boundary === 'swipe') { msg.swipe_id = 1; msg.mes = 'other'; }
            if (boundary === 'text') msg.mes = 'edited';
            if (boundary === 'display') msg.extra.display_text = 'edited display';
            if (boundary.startsWith('generation')) {
                generationLifecycle.startGeneration({ chat: host.chat, chatId: 'one' });
                if (boundary === 'generation-cancelled') generationLifecycle.cancelActive();
            }
            // Also drains the atomic display release; a skipped notification must settle.
            for (let i = 0; i < 12; i++) {
                for (const fn of frames.splice(0)) fn();
                await Promise.resolve();
            }
            assert.deepEqual(emitted, boundary === 'none' ? [[event, 0]] : []);
            assert.equal(released, 1);
            assert.deepEqual(msg.extra.qqj, { keep: true });
            if (['none', 'unmaterialized', 'generation', 'generation-cancelled'].includes(boundary)) assert.equal(JSON.stringify(msg), before);
            delete globalThis.requestAnimationFrame;
            globalThis.setTimeout = originalTimeout;
        });
    }
}
}
