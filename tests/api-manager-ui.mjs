// Uses the existing Veridis UI fixture plus the unmodified ST-Api-Scripts bundle.
// Set API_MANAGER_BUNDLE to a local index.js from upstream commit 82ea902.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const { chromium } = createRequire(process.env.BLAI_TEST_MODULES || import.meta.url)('playwright');
const template = fs.readFileSync(path.join(root, 'templates/purifier.html'), 'utf8').replace('{{logoUrl}}', '/images/veridis-logo.png');
const fixtureSource = fs.readFileSync(new URL('./ui-column.mjs', import.meta.url), 'utf8');
const expression = fixtureSource.slice(fixtureSource.indexOf('const fixture = ') + 16, fixtureSource.indexOf('\n\nconst server =')).trim().replace(/;$/, '');
const fixture = Function('template', 'return ' + expression)(template);
const bundle = fs.readFileSync(process.env.API_MANAGER_BUNDLE, 'utf8');
const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://fixture').pathname;
    if (pathname === '/') { res.setHeader('Content-Type', 'text/html;charset=utf-8'); return res.end(fixture); }
    if (pathname === '/manager.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(bundle); }
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'image/png');
    res.end(fs.readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, executablePath: process.env.BLAI_TEST_CHROME || undefined });
const results = [];
const output = process.env.BLAI_TEST_OUTPUT || path.join(root, '..', 'api-manager-ui-results');
fs.mkdirSync(output, { recursive: true });
try {
    for (const mode of ['ST', 'TT']) for (const width of [1280, 390]) {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        async function load(empty = false) {
            await page.goto('http://127.0.0.1:' + server.address().port, { waitUntil: 'networkidle' });
            await page.waitForFunction(() => window.fixture?.ready);
            await page.evaluate(async ({ mode, empty }) => {
                const { getAppContext } = await import('/src/host/appContext.js');
                const app = getAppContext();
                const original = { format: 'st-api-manager-catalog', version: 2,
                    groups: [{ id: 'original-group', name: '已有分组', color: '#123456' }], entries: [{
                        id: 'original-row', site: '原站点', name: '<img src=x onerror=alert(1)>', source: 'custom',
                        url: 'https://fixture.invalid/v1', key: 'fixture-private-key', model: 'fixture-model', groupIds: ['original-group'], modelNote: '原备注',
                    }] };
                const saved = empty ? undefined : JSON.parse(localStorage.getItem('manager-state') || 'null') || { version: 1, values: {
                    st_api_manager_catalog_v2: JSON.stringify({ catalog: original, sync: { revision: 'keep-revision', pending: false } }),
                    st_api_manager_connection_v2: JSON.stringify({ appliedRowId: 'original-row' }), unrelated: 'keep',
                } };
                fixture.original = original;
                fixture.store = saved;
                fixture.extensions = app.extension_settings;
                if (saved !== undefined) fixture.extensions['st-api-manager'] = saved;
                fixture.hostWrites = 0; fixture.network = 0;
                window.fetch = async () => { fixture.network++; throw new Error('Unexpected provider request'); };
                window.SillyTavern = { getContext: () => ({ extensionSettings: fixture.extensions,
                    saveSettingsDebounced() { fixture.hostWrites++; localStorage.setItem('manager-state', JSON.stringify(fixture.extensions['st-api-manager'])); },
                }) };
                if (mode === 'TT') window.__TAURITAVERN__ = { api: { extension: { store: {
                    async tryGetJson() { if (fixture.failRead) throw new Error('private failure'); return { found: fixture.store !== undefined, value: structuredClone(fixture.store) }; },
                    async setJson({ value }) { if (fixture.failWrite) throw new Error('private failure'); fixture.store = structuredClone(value); localStorage.setItem('manager-state', JSON.stringify(value)); fixture.hostWrites++; },
                } } } };
                fixture.state = () => mode === 'TT' ? fixture.store : fixture.extensions['st-api-manager'];
                fixture.catalog = () => JSON.parse(fixture.state().values.st_api_manager_catalog_v2).catalog;
                fixture.settings.aiRewrite.apiPresets = { '保存的 API': { baseUrl: 'https://saved.invalid/v1', apiKey: 'saved-private-key', model: 'saved-model' } };
                fixture.settings.aiRewrite.baseUrl = 'https://current.invalid/v1';
                fixture.settings.aiRewrite.apiKey = 'current-private-key';
                fixture.settings.aiRewrite.model = 'current-model';
                await import('/manager.js');
                fixture.shell.showResponsivePage('ai');
            }, { mode, empty });
            await page.locator('#blai-ai-manager summary').click();
        }
        await load();
        await page.locator('#blai-ai-manager-refresh').click();
        await page.waitForFunction(() => document.querySelector('#blai-ai-manager-status').textContent.includes('已读取'));
        await page.locator('#blai-ai-manager-group').selectOption('site:0');
        assert.equal(await page.locator('#blai-ai-manager-entry option').count(), 2);
        await page.locator('#blai-ai-manager-group').selectOption('id:original-group');
        await page.locator('#blai-ai-manager-entry').selectOption('0');
        await page.locator('#blai-ai-manager-import').click();
        await page.waitForFunction(() => fixture.settings.aiRewrite.model === 'fixture-model');
        assert.equal(await page.locator('#blai-ai-api-key').inputValue(), 'fixture-private-key');
        assert.equal(await page.evaluate(() => fixture.hostWrites), 0);
        assert.equal(await page.evaluate(() => fixture.settings.aiRewrite.temperature), 0.65);
        assert.equal(await page.locator('#blai-ai-manager img').count(), 0);
        await page.locator('#blai-ai-manager-source').selectOption('保存的 API');
        await page.locator('#blai-ai-manager-export').click();
        await page.waitForFunction(() => document.querySelector('#blai-ai-manager-status').textContent.includes('已保存到管理器')).catch(async error => {
            console.log(await page.locator('#blai-ai-manager-status').textContent(), errors);
            await page.screenshot({ path: path.join(output, 'failure.png') });
            throw error;
        });
        const state = await page.evaluate(() => ({ catalog: fixture.catalog(), original: fixture.original, values: fixture.state().values }));
        assert.deepEqual(state.catalog.entries[0], state.original.entries[0]);
        assert.equal(state.catalog.entries.length, 2);
        assert.equal(state.catalog.groups[1].name, '词汇映射');
        assert.equal(state.catalog.entries[1].site, '词汇映射');
        assert.equal(state.catalog.entries[1].model, 'saved-model');
        assert.equal(state.catalog.entries[1].key, 'saved-private-key');
        assert.equal(state.values.unrelated, 'keep');
        assert.equal(JSON.parse(state.values.st_api_manager_catalog_v2).sync.revision, 'keep-revision');
        assert.equal(JSON.parse(state.values.st_api_manager_catalog_v2).sync.pending, true);
        assert.equal(JSON.parse(state.values.st_api_manager_connection_v2).appliedRowId, 'original-row');
        await page.locator('#blai-ai-manager-export').click();
        await page.waitForFunction(() => document.querySelector('#blai-ai-manager-status').textContent.includes('无需重复'));
        assert.equal(await page.evaluate(() => fixture.catalog().entries.length), 2);
        // Actual manager UI sees the newly imported row from its live memory.
        await page.evaluate(() => dispatchEvent(new Event('st-api-manager-open-request')));
        assert.equal(await page.locator('.catalog-card-model').filter({ hasText: 'saved-model' }).count(), 1);
        await page.evaluate(() => document.querySelector('dialog.st-api-manager[aria-label="API 管理器"]').close());
        assert.equal(await page.evaluate(() => document.querySelector('#blai-ai-manager').scrollWidth > document.querySelector('#blai-ai-manager').clientWidth + 1), false);
        await page.screenshot({ path: path.join(output, `${mode}-${width}.png`) });
        assert.equal(await page.evaluate(() => fixture.network), 0);
        assert.equal(await page.locator('#blai-ai-manager').evaluate(el => el.innerHTML.includes('private-key')), false);
        await load();
        assert.equal(await page.evaluate(() => fixture.catalog().entries.length), 2);
        await page.evaluate(() => dispatchEvent(new Event('st-api-manager-open-request')));
        assert.equal(await page.locator('.catalog-card-model').filter({ hasText: 'saved-model' }).count(), 1);
        await page.evaluate(() => document.querySelector('dialog.st-api-manager[aria-label="API 管理器"]').close());
        if (mode === 'TT') {
            await page.evaluate(() => { fixture.failWrite = true; });
            await page.locator('#blai-ai-manager-export').click();
            await page.waitForFunction(() => document.querySelector('#blai-ai-manager-status').textContent.includes('未完成合并'));
            assert.equal(await page.evaluate(() => fixture.catalog().entries.length), 2);
            await page.evaluate(() => { document.querySelectorAll('dialog.st-api-manager[open]').forEach(dialog => dialog.close()); fixture.failRead = true; });
            await page.locator('#blai-ai-manager-refresh').click();
            await page.waitForFunction(() => document.querySelector('#blai-ai-manager-status').textContent.includes('无法读取'));
            assert.equal(await page.locator('#blai-ai-manager-import').isDisabled(), true);
        }
        await load(true);
        await page.locator('#blai-ai-manager-export').click();
        await page.waitForFunction(() => document.querySelector('#blai-ai-manager-status').textContent.includes('已保存到管理器'));
        assert.equal(await page.evaluate(() => fixture.catalog().entries.length), 1);
        assert.equal(await page.evaluate(() => fixture.catalog().groups[0].name), '词汇映射');
        assert.deepEqual(errors, []);
        results.push({ mode, width, passed: true });
        console.log(`PASS ${mode} ${width}: read, import, saved preset export, native merge, duplicate, persistence, isolation${mode === 'TT' ? ', storage failures' : ''}`);
        await context.close();
    }
} finally {
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, realHost: false, realModelCalls: 0, upstream: '82ea902c54d8ac91dbf27cbf0668a0cf7f6407b5' }, null, 2));
    await browser.close(); server.close();
}
