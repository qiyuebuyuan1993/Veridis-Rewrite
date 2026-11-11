import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readManagerCatalog, managerRowToConnection, buildManagerImport, buildManagerBatch } from '../src/integrations/apiManager.js';

const base = () => ({ format: 'st-api-manager-catalog', version: 2,
    groups: [{ id: 'g1', name: '已有分组', color: '#112233' }], entries: [{
        id: 'e1', site: '站点', name: '别名', source: 'custom', url: 'https://example.test/v1',
        key: 'test-key', model: 'test-model', groupIds: ['g1'], modelNote: '保留备注',
    }] });
const wrap = catalog => ({ version: 1, values: { st_api_manager_catalog_v2: JSON.stringify({ catalog, sync: { revision: null, pending: false } }) } });
const connection = { baseUrl: 'https://example.test/v1', apiKey: 'test-key', model: 'test-model' };

test('reads ST and TT catalog without any writes, preferring TT over stale ST data', async () => {
    const catalog = base();
    assert.deepEqual(await readManagerCatalog({}, { 'st-api-manager': wrap(catalog) }), catalog);
    const host = { __TAURITAVERN__: { api: { extension: { store: { async tryGetJson(args) {
        assert.deepEqual(args, { namespace: 'st-api-manager', key: 'state' });
        return { found: true, value: wrap(catalog) };
    } } } } } };
    assert.deepEqual(await readManagerCatalog(host, { 'st-api-manager': {} }), catalog);
});

test('missing, malformed, future versions and dangling group references fail closed', async () => {
    for (const value of [undefined, { version: 3 }, { version: 1, values: { st_api_manager_catalog_v2: '{test-key' } },
        wrap({ ...base(), version: 3 }), wrap({ ...base(), groups: [] })]) {
        await assert.rejects(readManagerCatalog({}, { 'st-api-manager': value }), error => !error.message.includes('test-key'));
    }
    await assert.rejects(readManagerCatalog({ __TAURITAVERN__: {} }, { 'st-api-manager': wrap(base()) }));
});

test('import handles compatible provider defaults and rejects incompatible or incomplete connections', () => {
    assert.deepEqual(managerRowToConnection(base().entries[0]), connection);
    assert.equal(managerRowToConnection({ ...base().entries[0], source: 'openai', url: '' }).baseUrl, 'https://api.openai.com/v1');
    assert.equal(managerRowToConnection({ ...base().entries[0], source: 'deepseek', url: '' }).baseUrl, 'https://api.deepseek.com/v1');
    for (const patch of [{ source: 'makersuite' }, { key: '' }, { model: '' }, { url: 'javascript:alert(1)' }, { url: 'https://example.test/?key=test-key' }]) {
        assert.throws(() => managerRowToConnection({ ...base().entries[0], ...patch }));
    }
});

test('export creates default group, preserves original catalog and writes no unrelated data', () => {
    const catalog = base(), before = JSON.stringify(catalog);
    let id = 0;
    const incoming = buildManagerImport(catalog, connection, '我的预设', '', () => 'new-' + ++id);
    assert.equal(incoming.groups[0].name, '词汇映射');
    assert.equal(incoming.entries[0].name, '我的预设');
    assert.equal(incoming.entries[0].source, 'custom');
    assert.deepEqual(incoming.entries[0].groupIds, [incoming.groups[0].id]);
    assert.equal(JSON.stringify(catalog), before);
    assert.equal(incoming.entries.length, 1);
    assert.equal(buildManagerImport({ ...incoming }, connection, '重复'), null);
});

test('export reuses existing groups and only deduplicates complete matching credentials in that group', () => {
    const catalog = base();
    assert.equal(buildManagerImport(catalog, connection, '改名', '已有分组'), null);
    const changed = buildManagerImport(catalog, { ...connection, apiKey: 'another-test-key' }, '预设', '已有分组');
    assert.deepEqual(changed.groups, catalog.groups);
    assert.equal(changed.entries[0].key, 'another-test-key');
    catalog.groups.push({ id: 'g2', name: '已有分组' });
    assert.throws(() => buildManagerImport(catalog, connection, '预设', '已有分组'), /同名分组/);
});

const batchCatalog = () => {
    const catalog = base();
    catalog.groups.push({ id: 'v', name: '词汇映射', color: '#abcdef' });
    catalog.entries.push({ ...catalog.entries[0], id: 'owned', name: '旧预设', groupIds: ['v'] },
        { ...catalog.entries[0], id: 'shared', name: '共享预设', model: 'shared-model', groupIds: ['v', 'g1'], modelNote: '共享备注' });
    return catalog;
};

test('batch add compares only dedicated group, adds all saved connections once and leaves source intact', () => {
    const catalog = batchCatalog(), snapshot = JSON.stringify(catalog);
    const plan = buildManagerBatch(catalog, { A: connection, B: { ...connection, model: 'new-model' }, C: { ...connection, model: 'new-model' } }, 'add');
    assert.equal(plan.count, 1);
    assert.equal(plan.catalog.entries[0].name, 'B');
    assert.equal(plan.catalog.entries[0].model, 'new-model');
    assert.deepEqual(plan.catalog.groups, [catalog.groups[1]]);
    assert.equal(JSON.stringify(catalog), snapshot);
    assert.equal(buildManagerBatch(catalog, { A: connection }, 'add').catalog, null);
});

test('batch overwrite removes only target membership, retains shared entries and every other group', () => {
    const catalog = batchCatalog(), snapshot = JSON.stringify(catalog);
    const plan = buildManagerBatch(catalog, { New: { ...connection, model: 'new-model' } }, 'to-manager');
    assert.equal(plan.replace, true);
    assert.deepEqual(plan.catalog.groups, catalog.groups);
    assert.deepEqual(plan.catalog.entries.find(row => row.id === 'e1'), catalog.entries[0]);
    assert.deepEqual(plan.catalog.entries.find(row => row.id === 'shared'), { ...catalog.entries[2], groupIds: ['g1'] });
    assert.equal(plan.catalog.entries.some(row => row.id === 'owned'), false);
    assert.equal(plan.catalog.entries.filter(row => row.groupIds.includes('v')).length, 1);
    assert.equal(JSON.stringify(catalog), snapshot);
});

test('batch overwrite reuses exact rows and preserves their metadata', () => {
    const catalog = batchCatalog();
    const plan = buildManagerBatch(catalog, { '旧预设': connection, '共享预设': { ...connection, model: 'shared-model' } }, 'to-manager');
    assert.deepEqual(plan.catalog.entries, catalog.entries);
});

test('reverse overwrite only uses dedicated group, disambiguates aliases and retains per-preset tuning', () => {
    const catalog = batchCatalog();
    catalog.entries[2].name = '旧预设';
    const plan = buildManagerBatch(catalog, { '旧预设': { ...connection, temperature: 0.4 }, '被替换': connection }, 'to-veridis');
    assert.deepEqual(Object.keys(plan.presets), ['旧预设', '旧预设 (2)']);
    assert.equal(plan.presets['旧预设'].temperature, 0.4);
    assert.equal(plan.presets['旧预设 (2)'].model, 'shared-model');
    assert.equal(plan.presets['旧预设'].apiKey, 'test-key');
});

test('invalid bulk member aborts entire plan without dropping other valid members or leaking key', () => {
    const catalog = batchCatalog(), snapshot = JSON.stringify(catalog);
    assert.throws(() => buildManagerBatch(catalog, { good: connection, bad: { ...connection, baseUrl: 'test-key' } }, 'add'), error => !error.message.includes('test-key'));
    assert.equal(JSON.stringify(catalog), snapshot);
    catalog.entries[2].source = 'makersuite';
    assert.throws(() => buildManagerBatch(catalog, {}, 'to-veridis'), /OpenAI/);
});

test('empty sources support explicit whole-set clearing but missing manager group never erases presets', () => {
    assert.throws(() => buildManagerBatch(base(), { A: connection }, 'to-veridis'), /尚无/);
    const emptied = buildManagerBatch(batchCatalog(), {}, 'to-manager').catalog;
    assert.equal(emptied.entries.length, 2);
    assert.deepEqual(buildManagerBatch(emptied, { A: connection }, 'to-veridis').presets, {});
    assert.equal(buildManagerBatch(base(), {}, 'add').catalog, null);
});

test('legacy site-only group can be synced, ambiguous group names fail closed', () => {
    const catalog = base(); catalog.entries[0].site = '词汇映射';
    assert.equal(buildManagerBatch(catalog, {}, 'to-veridis').count, 1);
    const plan = buildManagerBatch(catalog, {}, 'to-manager');
    assert.deepEqual(plan.catalog.entries[0], catalog.entries[0]); // still belongs to another label
    catalog.groups.push({ id: 'a', name: '词汇映射' }, { id: 'b', name: '词汇映射' });
    assert.throws(() => buildManagerBatch(catalog, {}, 'add'), /多个/);
});

test('reverse import treats prototype-like names as ordinary preset names', () => {
    const catalog = batchCatalog(); catalog.entries[1].name = '__proto__';
    const plan = buildManagerBatch(catalog, {}, 'to-veridis');
    assert.equal(Object.hasOwn(plan.presets, '__proto__'), true);
    assert.equal(Object.getPrototypeOf(plan.presets), Object.prototype);
});
