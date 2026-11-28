// ST-Api-Scripts 2.2.22 catalog contract. Native imports keep its
// in-memory catalog current; never edit its persistent state behind its back.
const namespace = 'st-api-manager';
const catalogKey = 'st_api_manager_catalog_v2';
const format = 'st-api-manager-catalog';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string';
const invalid = () => new Error('API 管理器数据格式不兼容，请先打开并更新管理器；原配置未改动。');

export function validateManagerCatalog(catalog) {
    if (!object(catalog) || catalog.format !== format || catalog.version !== 2
        || !Array.isArray(catalog.groups) || !Array.isArray(catalog.entries)) throw invalid();
    const groups = new Set();
    for (const group of catalog.groups) {
        if (!object(group) || !text(group.id) || !group.id || groups.has(group.id)
            || !text(group.name) || !group.name.trim()) throw invalid();
        groups.add(group.id);
    }
    const ids = new Set();
    for (const row of catalog.entries) {
        if (!object(row) || !text(row.id) || !row.id || ids.has(row.id)
            || ![row.site, row.name, row.source, row.url, row.key, row.model].every(text)
            || !Array.isArray(row.groupIds) || row.groupIds.some(id => !groups.has(id))) throw invalid();
        ids.add(row.id);
    }
    return catalog;
}

export async function readManagerCatalog(host, extensionSettings) {
    let saved;
    try {
        if (host.__TAURITAVERN__) {
            const store = host.__TAURITAVERN__.api?.extension?.store;
            if (typeof store?.tryGetJson !== 'function') throw invalid();
            const result = await store.tryGetJson({ namespace, key: 'state' });
            saved = result.found ? result.value : undefined;
        } else saved = extensionSettings?.[namespace];
    } catch {
        throw new Error('无法读取 API 管理器本机存储，请确认管理器已启用且存储可用。');
    }
    if (saved === undefined) {
        // A freshly started manager has an empty in-memory catalog and has not
        // persisted anything yet. Its native importer can create the first row.
        if (host.document?.querySelector('dialog.st-api-manager[aria-label="API 管理器"]')) {
            return { format, version: 2, entries: [], groups: [] };
        }
        throw new Error('尚未找到 API 管理器目录，请先启用并打开管理器。');
    }
    if (saved?.version !== 1 || !object(saved.values) || !text(saved.values[catalogKey])) throw invalid();
    let state;
    try { state = JSON.parse(saved.values[catalogKey]); } catch { throw invalid(); }
    return validateManagerCatalog(state?.catalog);
}

function connectionFields(baseUrl, apiKey, model) {
    let url;
    try { url = new URL(baseUrl); } catch { throw new Error('请先填写完整的 API URL。'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || [...url.searchParams.keys()].some(key => /^(key|api[_-]?key|access_token)$/i.test(key))) {
        throw new Error('API URL 须为 HTTP/HTTPS，密钥请放在独立的 Key 栏。');
    }
    if (!apiKey.trim() || !model.trim()) throw new Error('这条 API 缺少 Key 或模型，请先补全。');
    return { baseUrl: baseUrl.trim(), apiKey, model: model.trim() };
}

function compatibleEndpoint(row) {
    // Veridis sends OpenAI-compatible chat completions, not native Gemini.
    const defaults = { openai: 'https://api.openai.com/v1', deepseek: 'https://api.deepseek.com/v1' };
    if (!['custom', 'openai', 'deepseek'].includes(row?.source)) {
        throw new Error('此来源不是受支持的 OpenAI 兼容连接，请在管理器中使用自定义兼容接口。');
    }
    return row.url.trim() || defaults[row.source] || '';
}

export function managerRowToConnection(row) {
    return connectionFields(compatibleEndpoint(row), row.key, row.model);
}

export function buildManagerImport(catalog, connection, makeId = () => crypto.randomUUID()) {
    validateManagerCatalog(catalog);
    const fields = connectionFields(connection.baseUrl || '', connection.apiKey || '', connection.model || '');
    const label = '词汇映射';
    const groups = catalog.groups.filter(group => group.name === label);
    if (groups.length > 1) throw new Error('管理器中有多个同名词汇映射分组，请先区分名称。');
    const group = groups[0] || { id: makeId(), name: label };
    const normalized = url => new URL(url).href.replace(/\/+$/, '');
    const rows = catalog.entries.filter(row => {
        try {
            return normalized(compatibleEndpoint(row)) === normalized(fields.baseUrl);
        } catch { return false; }
    });
    if (new Set(rows.map(row => JSON.stringify([row.site, row.source, row.url]))).size > 1) {
        throw new Error('管理器中有多个配置组使用这个 URL，请先确认目标配置组。');
    }
    const existing = rows.find(row => row.key === fields.apiKey && row.model === fields.model && row.groupIds.includes(group.id));
    if (existing) return null;
    const site = rows[0];
    const credential = rows.find(row => row.key === fields.apiKey && row.credentialId);
    const note = catalog.keyNotes?.find(note => note.id === credential?.credentialId) || { id: makeId(), note: label };
    return { format, version: 2, groups: [group], keyNotes: [note], entries: [{
        id: makeId(), site: site?.site ?? label, source: site?.source ?? 'custom', url: site?.url ?? fields.baseUrl,
        key: fields.apiKey, model: fields.model, name: '', groupIds: [group.id], credentialId: note.id,
    }] };
}

export async function mergeThroughManager(host, catalog) {
    validateManagerCatalog(catalog);
    const doc = host.document;
    const main = doc.querySelector('dialog.st-api-manager[aria-label="API 管理器"]');
    if (!main) throw new Error('请先启用 API 管理器，再重试保存。');
    if (doc.querySelector('dialog.st-api-manager[open]')) throw new Error('请先关闭 API 管理器的窗口，再重试保存。');
    let settingsPane;
    const dataButton = [...main.querySelectorAll('.api-manager-toolbar button')]
        .find(button => ['设置', '数据'].includes(button.textContent.trim()));
    if (!dataButton || dataButton.disabled || !host.DataTransfer || !host.File) {
        throw new Error('此版本暂不支持直接写回，请更新 API 管理器或浏览器。');
    }
    let dataPane, mergePane;
    const waitFor = (read, failurePane) => new Promise((resolve, reject) => {
        const start = Date.now();
        const check = () => {
            const result = read();
            if (result) return resolve(result);
            if (!main.open || (failurePane && !failurePane.open)) return reject(new Error('已取消保存到 API 管理器。'));
            if (failurePane?.querySelector('[role="status"]')?.textContent.trim()) {
                return reject(new Error('API 管理器未完成合并，请查看管理器中的提示。'));
            }
            if (Date.now() - start > 10000) return reject(new Error('管理器保存尚未确认，请检查目录后再重试。'));
            host.setTimeout(check, 50);
        };
        check();
    });
    try {
        host.dispatchEvent(new host.Event('st-api-manager-open-request'));
        if (!main.open) throw new Error('无法打开 API 管理器，请确认管理器已正常启动。');
        dataButton.click();
        settingsPane = doc.querySelector('dialog.st-api-manager[open][aria-label="设置"]');
        settingsPane?.querySelector('button[aria-label="数据"]')?.click();
        dataPane = doc.querySelector('dialog.st-api-manager[open][aria-label="数据"]');
        const input = dataPane?.querySelector('input.data-actions-file-input[type="file"]');
        if (!input) throw new Error('未找到管理器的合并导入入口，请更新管理器。');
        const transfer = new host.DataTransfer();
        transfer.items.add(new host.File([JSON.stringify(catalog)], 'veridis-api-transfer.json', { type: 'application/json' }));
        input.files = transfer.files;
        input.dispatchEvent(new host.Event('change', { bubbles: true }));
        mergePane = await waitFor(() => doc.querySelector('dialog.st-api-manager[open][aria-label="导入方式"]'), dataPane);
        const label = '合并导入';
        const merge = [...mergePane.querySelectorAll('button.import-mode-option')]
            .find(button => button.querySelector('span')?.textContent.trim() === label);
        if (!merge || merge.disabled) throw new Error('未找到安全的合并导入按钮，未执行写入。');
        merge.click();
        await waitFor(() => !mergePane.isConnected && dataPane.querySelector('[role="status"]')?.textContent === '已合并导入配置。', mergePane);
        dataPane.close();
        settingsPane?.close();
        main.close();
    } catch (error) {
        // Keep manager errors visible; never retry or change the chosen mode.
        throw error;
    }
}
