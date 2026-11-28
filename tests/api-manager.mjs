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

test('same endpoint appends a labeled key/model under the existing site, and repeats are idempotent', () => {
    const catalog = base();
    const incoming = buildManagerImport(catalog, { ...connection, baseUrl: connection.baseUrl + '/', apiKey: 'other' });
    const row = incoming.entries[0];
    assert.equal(row.site, '站点');
    assert.equal(row.key, 'other');
    assert.equal(row.model, connection.model);
    assert.equal(incoming.keyNotes[0].note, '词汇映射');
    assert.equal(row.credentialId, incoming.keyNotes[0].id);
    assert.deepEqual(row.groupIds, [incoming.groups[0].id]);
    const saved = { ...catalog, entries: [...catalog.entries, row], groups: [...catalog.groups, ...incoming.groups], keyNotes: incoming.keyNotes };
    assert.equal(buildManagerImport(saved, { ...connection, apiKey: 'other' }), null);
});
