import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readManagerCatalog, managerRowToConnection, buildManagerImport } from '../src/integrations/apiManager.js';

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
