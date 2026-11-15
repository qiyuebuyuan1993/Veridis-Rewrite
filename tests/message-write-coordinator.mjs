import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getMessageWriteCoordinator } from '../src/integrations/messageWriteCoordinator.js';

const flushTasks = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function syntheticChat() {
    const text = '她推开门，旧稿被风吹散，，';
    const message = {
        name: 'Synthetic',
        is_user: false,
        mes: text,
        extra: {
            qianqianjie: {
                floorId: 'synthetic-floor-main',
                anchors: [{ id: 'anchor-main-1', kind: 'memory', protected: true }],
                receipts: [{ id: 'receipt-main-1', state: 'kept' }],
            },
            display_text: '合成正文显示',
            synthetic_marker: { id: 'marker-main-1', value: 7 },
        },
        swipes: [text, '另一条合成 Swipe 分支。'],
        swipe_id: 0,
        swipe_info: [
            {
                extra: {
                    qianqianjie: {
                        floorId: 'synthetic-floor-main',
                        anchors: [{ id: 'anchor-swipe-1', kind: 'per-swipe', protected: true }],
                    },
                    display_text: '合成 Swipe 显示 0',
                },
            },
            {
                extra: {
                    qianqianjie: {
                        floorId: 'synthetic-floor-alt',
                        anchors: [{ id: 'anchor-swipe-2', kind: 'per-swipe', protected: true }],
                    },
                    display_text: '合成 Swipe 显示 1',
                },
            },
        ],
    };
    return [{ name: 'SyntheticUser', is_user: true, mes: '合成用户发言' }, message];
}

const TRANSFORM_OWNERS = {
    rewrite: 'synthetic-rewrite-owner',
    repair: 'synthetic-repair-owner',
};

function transformTask(coordinator, chat, kind, orderLog, metadataSnapshot) {
    const owner = TRANSFORM_OWNERS[kind];
    const otherOwner = TRANSFORM_OWNERS[kind === 'rewrite' ? 'repair' : 'rewrite'];
    return async () => {
        const message = chat[1];
        assert.equal(coordinator.isOwner(chat, owner), true, `${kind} must own the active lease`);
        assert.equal(coordinator.isOwner(chat, otherOwner), false, `${kind} must not claim the other lease`);

        if (orderLog.length > 0) {
            const previous = orderLog.at(-1);
            // The queued task starts only after the previous task published its completion.
            assert.equal(previous.done, true, `${previous.kind} must have completed before ${kind}`);
            assert.equal(message.mes, previous.after, `${kind} must observe ${previous.kind}'s completed result`);
        }

        // Independent metadata owned by another extension must already be intact.
        assert.deepEqual(message.extra, metadataSnapshot.extra);
        assert.deepEqual(message.swipe_info, metadataSnapshot.swipeInfo);
        assert.equal(message.swipes[1], metadataSnapshot.alternateSwipe);

        // Keep the transformation asynchronous so the coordinator, not call ordering alone, serializes it.
        await Promise.resolve();

        const before = message.mes;
        const after = kind === 'rewrite'
            ? before.replace('旧稿', '新稿')
            : before.replace('，，', '，');
        assert.notEqual(after, before, `${kind} should change the synthetic text`);

        // Synthetic atomic write: the active text and current swipe only.
        message.mes = after;
        message.swipes[message.swipe_id] = after;

        assert.deepEqual(message.extra, metadataSnapshot.extra);
        assert.deepEqual(message.swipe_info, metadataSnapshot.swipeInfo);
        orderLog.push({ kind, owner, before, after, done: true });
        return after;
    };
}

test('repeated get calls share one coordinator instance', async () => {
    const first = getMessageWriteCoordinator();
    const second = getMessageWriteCoordinator();
    assert.strictEqual(first, second);

    // A second module evaluation must reuse the registry entry instead of creating a rival coordinator.
    const reloaded = await import('../src/integrations/messageWriteCoordinator.js?shared-instance');
    assert.strictEqual(reloaded.getMessageWriteCoordinator(), first);
});

test('same chat: two owners run FIFO and async tasks never overlap', { timeout: 5000 }, async () => {
    const coordinator = getMessageWriteCoordinator();
    const chat = [];
    const gate = deferred();
    const events = [];
    let active = 0;
    let maxActive = 0;

    const enter = () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
    };
    const leave = () => {
        active -= 1;
    };

    const first = coordinator.run(chat, 'fifo-owner-a', async () => {
        enter();
        try {
            events.push('a:start');
            assert.equal(coordinator.isOwner(chat, 'fifo-owner-a'), true);
            await gate.promise;
            events.push('a:done');
            return 'result-a';
        } finally {
            leave();
        }
    });
    const second = coordinator.run(chat, 'fifo-owner-b', async () => {
        enter();
        try {
            assert.equal(active, 1, 'the second task must not overlap the first');
            assert.equal(events.at(-1), 'a:done');
            events.push('b:start');
            assert.equal(coordinator.isOwner(chat, 'fifo-owner-a'), false);
            assert.equal(coordinator.isOwner(chat, 'fifo-owner-b'), true);
            await Promise.resolve();
            events.push('b:done');
            return 'result-b';
        } finally {
            leave();
        }
    });

    await flushTasks();
    assert.deepEqual(events, ['a:start']);
    assert.equal(coordinator.isOwner(chat, 'fifo-owner-a'), true);
    assert.equal(coordinator.isOwner(chat, 'fifo-owner-b'), false);

    gate.resolve();
    const [resultA, resultB] = await Promise.all([first, second]);
    assert.equal(resultA, 'result-a');
    assert.equal(resultB, 'result-b');
    assert.deepEqual(events, ['a:start', 'a:done', 'b:start', 'b:done']);
    assert.equal(maxActive, 1);
    await flushTasks();
    assert.equal(coordinator.isOwner(chat, 'fifo-owner-a'), false);
    assert.equal(coordinator.isOwner(chat, 'fifo-owner-b'), false);
});

test('an async rejection releases the lease and queued work continues', { timeout: 5000 }, async () => {
    const coordinator = getMessageWriteCoordinator();
    const chat = [];
    const gate = deferred();
    const events = [];

    const failing = coordinator.run(chat, 'rejecting-owner', async () => {
        events.push('failing:start');
        await gate.promise;
        events.push('failing:throw');
        throw new Error('synthetic rewrite failure');
    });
    const queued = coordinator.run(chat, 'queued-owner', async () => {
        events.push('queued:start');
        assert.equal(coordinator.isOwner(chat, 'rejecting-owner'), false);
        return 'queued-result';
    });

    await flushTasks();
    assert.deepEqual(events, ['failing:start']);
    const rejection = assert.rejects(failing, /synthetic rewrite failure/);
    gate.resolve();
    await rejection;
    assert.equal(await queued, 'queued-result');
    assert.deepEqual(events, ['failing:start', 'failing:throw', 'queued:start']);
    await flushTasks();
    assert.equal(coordinator.isOwner(chat, 'rejecting-owner'), false);
    assert.equal(coordinator.isOwner(chat, 'queued-owner'), false);

    // A later run on the same chat must still acquire a clean lease.
    const later = await coordinator.run(chat, 'later-owner', async () => 'later-result');
    await flushTasks();
    assert.equal(later, 'later-result');
    assert.equal(coordinator.isOwner(chat, 'later-owner'), false);
});

test('a synchronous throw also releases the lease for queued work', { timeout: 5000 }, async () => {
    const coordinator = getMessageWriteCoordinator();
    const chat = [];

    const throwing = coordinator.run(chat, 'sync-throw-owner', () => {
        throw new Error('synthetic synchronous failure');
    });
    const queued = coordinator.run(chat, 'sync-queued-owner', async () => {
        assert.equal(coordinator.isOwner(chat, 'sync-throw-owner'), false);
        return 'sync-queued-result';
    });

    await assert.rejects(throwing, /synthetic synchronous failure/);
    assert.equal(await queued, 'sync-queued-result');
    assert.equal(coordinator.isOwner(chat, 'sync-throw-owner'), false);
    assert.equal(coordinator.isOwner(chat, 'sync-queued-owner'), false);
});

test('different chat arrays do not block each other', { timeout: 5000 }, async () => {
    const coordinator = getMessageWriteCoordinator();
    const blockedChat = [];
    const independentChat = [];
    const gate = deferred();
    const events = [];
    let runsInParallel = false;

    const blocked = coordinator.run(blockedChat, 'blocked-owner', async () => {
        events.push('blocked:start');
        await gate.promise;
        events.push('blocked:done');
        return 'blocked-result';
    });
    const independent = coordinator.run(independentChat, 'independent-owner', async () => {
        runsInParallel = coordinator.isOwner(blockedChat, 'blocked-owner');
        events.push('independent:start');
        await Promise.resolve();
        events.push('independent:done');
        return 'independent-result';
    });

    await flushTasks();
    assert.deepEqual(events, ['blocked:start', 'independent:start', 'independent:done']);
    assert.equal(runsInParallel, true, 'different chats may progress concurrently');
    assert.equal(await independent, 'independent-result');
    assert.equal(events.includes('blocked:done'), false);

    gate.resolve();
    assert.equal(await blocked, 'blocked-result');
    assert.deepEqual(events, ['blocked:start', 'independent:start', 'independent:done', 'blocked:done']);
    await flushTasks();
    assert.equal(coordinator.isOwner(blockedChat, 'blocked-owner'), false);
    assert.equal(coordinator.isOwner(independentChat, 'independent-owner'), false);
});

test('isOwner is true only for the currently active task owner', { timeout: 5000 }, async () => {
    const coordinator = getMessageWriteCoordinator();
    const chat = [];
    const gate = deferred();

    assert.equal(coordinator.isOwner(chat, 'owner-a'), false);
    assert.equal(coordinator.isOwner(chat, 'owner-b'), false);

    const first = coordinator.run(chat, 'owner-a', async () => {
        assert.equal(coordinator.isOwner(chat, 'owner-a'), true);
        assert.equal(coordinator.isOwner(chat, 'owner-b'), false);
        await gate.promise;
        // Ownership must still belong to the active task after an asynchronous suspension.
        assert.equal(coordinator.isOwner(chat, 'owner-a'), true);
        return 'a';
    });
    const second = coordinator.run(chat, 'owner-b', async () => {
        assert.equal(coordinator.isOwner(chat, 'owner-b'), true);
        assert.equal(coordinator.isOwner(chat, 'owner-a'), false);
        return 'b';
    });

    assert.equal(coordinator.isOwner(chat, 'owner-a'), true);
    assert.equal(coordinator.isOwner(chat, 'owner-b'), false, 'a queued owner must not own the lease');
    await flushTasks();

    gate.resolve();
    assert.equal(await first, 'a');
    assert.equal(await second, 'b');
    await flushTasks();
    assert.equal(coordinator.isOwner(chat, 'owner-a'), false);
    assert.equal(coordinator.isOwner(chat, 'owner-b'), false);
    assert.equal(coordinator.isOwner(chat, 'unrelated-owner'), false);
});

test('invalid arguments are rejected as TypeError without executing the task', async () => {
    const coordinator = getMessageWriteCoordinator();
    const chat = [];
    let taskCalls = 0;
    const task = () => {
        taskCalls += 1;
        return 'should-not-run';
    };

    const invalidCalls = [
        ['non-array chat', () => coordinator.run('not-a-chat', 'owner', task)],
        ['null chat', () => coordinator.run(null, 'owner', task)],
        ['object chat', () => coordinator.run({}, 'owner', task)],
        ['empty owner', () => coordinator.run(chat, '', task)],
        ['null owner', () => coordinator.run(chat, null, task)],
        ['undefined owner', () => coordinator.run(chat, undefined, task)],
        ['zero owner', () => coordinator.run(chat, 0, task)],
        ['false owner', () => coordinator.run(chat, false, task)],
        ['missing task', () => coordinator.run(chat, 'owner', undefined)],
        ['null task', () => coordinator.run(chat, 'owner', null)],
        ['non-function task', () => coordinator.run(chat, 'owner', {})],
    ];

    for (const [label, call] of invalidCalls) {
        await assert.rejects(call, TypeError, label);
    }
    assert.equal(taskCalls, 0);

    // Rejections must not leave a lease or poison a later valid run.
    const valid = await coordinator.run(chat, 'valid-owner', task);
    await flushTasks();
    assert.equal(valid, 'should-not-run');
    assert.equal(taskCalls, 1);
    assert.equal(coordinator.isOwner(chat, 'valid-owner'), false);
});

for (const order of [['rewrite', 'repair'], ['repair', 'rewrite']]) {
    test(`realistic message: ${order.join(' then ')} preserves extra.qianqianjie and swipe_info and observes prior completion`, { timeout: 5000 }, async () => {
        const coordinator = getMessageWriteCoordinator();
        const chat = syntheticChat();
        const message = chat[1];
        const metadataSnapshot = {
            extra: structuredClone(message.extra),
            swipeInfo: structuredClone(message.swipe_info),
            alternateSwipe: message.swipes[1],
        };
        const orderLog = [];
        const [firstKind, secondKind] = order;

        const first = coordinator.run(
            chat,
            TRANSFORM_OWNERS[firstKind],
            transformTask(coordinator, chat, firstKind, orderLog, metadataSnapshot),
        );
        const second = coordinator.run(
            chat,
            TRANSFORM_OWNERS[secondKind],
            transformTask(coordinator, chat, secondKind, orderLog, metadataSnapshot),
        );

        const [firstResult, secondResult] = await Promise.all([first, second]);
        const expectedFinal = '她推开门，新稿被风吹散，';
        const expectedFirst = firstKind === 'rewrite'
            ? '她推开门，新稿被风吹散，，'
            : '她推开门，旧稿被风吹散，';

        assert.deepEqual(orderLog.map(entry => entry.kind), order);
        assert.equal(orderLog[0].done, true);
        assert.equal(orderLog[0].after, firstResult);
        assert.equal(orderLog[1].done, true);
        assert.equal(orderLog[1].before, firstResult, `${secondKind} must see ${firstKind}'s completed output`);
        assert.equal(secondResult, expectedFinal);
        assert.equal(firstResult, expectedFirst);

        assert.equal(message.mes, expectedFinal);
        assert.equal(message.swipes[message.swipe_id], expectedFinal);
        assert.deepEqual(message.extra, metadataSnapshot.extra);
        assert.deepEqual(message.swipe_info, metadataSnapshot.swipeInfo);
        assert.equal(message.swipes[1], metadataSnapshot.alternateSwipe);

        assert.equal(coordinator.isOwner(chat, TRANSFORM_OWNERS[firstKind]), false);
        assert.equal(coordinator.isOwner(chat, TRANSFORM_OWNERS[secondKind]), false);
    });
}

test('a deferred save lease prevents the queued second task from writing', { timeout: 5000 }, async () => {
    const coordinator = getMessageWriteCoordinator();
    const chat = syntheticChat();
    const message = chat[1];
    const initialText = message.mes;
    const metadataSnapshot = {
        extra: structuredClone(message.extra),
        swipeInfo: structuredClone(message.swipe_info),
        alternateSwipe: message.swipes[1],
    };
    const saveGate = deferred();
    const events = [];
    let saveSawText = null;
    let secondStarted = false;
    let active = 0;
    let maxActive = 0;

    const save = coordinator.run(chat, 'synthetic-save-owner', async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        try {
            events.push('save:start');
            assert.equal(coordinator.isOwner(chat, 'synthetic-save-owner'), true);
            assert.equal(coordinator.isOwner(chat, 'synthetic-repair-owner'), false);
            await saveGate.promise;
            saveSawText = message.mes;
            events.push('save:done');
            return 'saved';
        } finally {
            active -= 1;
        }
    });
    const second = coordinator.run(chat, 'synthetic-repair-owner', async () => {
        secondStarted = true;
        active += 1;
        maxActive = Math.max(maxActive, active);
        try {
            events.push('repair:start');
            assert.equal(active, 1, 'the repair must not overlap the save');
            assert.equal(saveSawText, initialText, 'the save must observe the pre-repair text');
            assert.equal(message.mes, initialText, 'the queued repair must not have written during the save');

            const after = message.mes.replace('，，', '，');
            message.mes = after;
            message.swipes[message.swipe_id] = after;
            events.push('repair:done');
            return after;
        } finally {
            active -= 1;
        }
    });

    await flushTasks();
    await flushTasks();
    assert.equal(secondStarted, false);
    assert.deepEqual(events, ['save:start']);
    assert.equal(message.mes, initialText);
    assert.equal(coordinator.isOwner(chat, 'synthetic-save-owner'), true);
    assert.equal(coordinator.isOwner(chat, 'synthetic-repair-owner'), false);

    saveGate.resolve();
    assert.equal(await save, 'saved');
    assert.equal(await second, '她推开门，旧稿被风吹散，');
    assert.deepEqual(events, ['save:start', 'save:done', 'repair:start', 'repair:done']);
    assert.equal(saveSawText, initialText);
    assert.equal(maxActive, 1);
    assert.equal(message.mes, '她推开门，旧稿被风吹散，');
    assert.equal(message.swipes[message.swipe_id], '她推开门，旧稿被风吹散，');
    assert.deepEqual(message.extra, metadataSnapshot.extra);
    assert.deepEqual(message.swipe_info, metadataSnapshot.swipeInfo);
    assert.equal(message.swipes[1], metadataSnapshot.alternateSwipe);
    await flushTasks();
    assert.equal(coordinator.isOwner(chat, 'synthetic-save-owner'), false);
    assert.equal(coordinator.isOwner(chat, 'synthetic-repair-owner'), false);
});
