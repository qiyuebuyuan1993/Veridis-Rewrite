import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { formatLocalLogTime } from '../src/aiRewrite/logTime.js';
import { recordAiCommunicationSuccess, clearAiCommunicationRecords, getAiCommunicationRecords, formatAiCommunicationRecords } from '../src/aiRewrite/communicationMonitor.js';
import { recordAiRewriteDebug, getAiRewriteDebugDisplayText, getAiRewriteDebugLogText } from '../src/aiRewrite/debug.js';

for (const [zone, input, expected] of [
    ['Asia/Shanghai', '2026-10-28T05:39:00.000Z', '2026-10-28 13:39:00.000 UTC+08:00'],
    ['Asia/Shanghai', '2026-10-28T10:19:21.475Z', '2026-10-28 18:19:21.475 UTC+08:00'],
    ['America/New_York', '2026-01-01T01:00:00.000Z', '2025-12-31 20:00:00.000 UTC-05:00'],
    ['UTC', '2026-10-28T05:39:00.000Z', '2026-10-28 05:39:00.000 UTC+00:00'],
]) test(`local log time ${zone}: ${input}`, () => {
    const module = new URL('../src/aiRewrite/logTime.js', import.meta.url).href;
    const script = `import {formatLocalLogTime} from ${JSON.stringify(module)}; console.log(formatLocalLogTime(${JSON.stringify(input)}));`;
    assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        env: { ...process.env, TZ: zone }, encoding: 'utf8',
    }).trim(), expected);
});

test('communication display labels request start and preserves the stored UTC instant', () => {
    clearAiCommunicationRecords();
    const input = '2026-10-28T05:39:00.000Z';
    recordAiCommunicationSuccess({ startedAt: Date.parse(input), endedAt: Date.parse(input) + 9878,
        requestJson: '{}', response: '{}' });
    assert.equal(getAiCommunicationRecords()[0].timestamp, input);
    assert.ok(formatAiCommunicationRecords().includes(`请求开始：${formatLocalLogTime(input)}`));
    assert.ok(formatAiCommunicationRecords().includes('9878 ms'));
    clearAiCommunicationRecords();
});

test('invalid historical timestamps stay visible rather than crashing log display', () => {
    assert.equal(formatLocalLogTime('invalid-date'), 'invalid-date');
    assert.equal(formatLocalLogTime(undefined), '');
});

test('runtime UI converts the same instant while copied JSON retains UTC', () => {
    const event = recordAiRewriteDebug('fixture-time-check', { count: 1 });
    assert.ok(getAiRewriteDebugDisplayText().includes(formatLocalLogTime(event.time)));
    const exported = JSON.parse(getAiRewriteDebugLogText()).find(item => item.stage === 'fixture-time-check');
    assert.equal(exported.time, event.time);
    assert.ok(exported.time.endsWith('Z'));
});
