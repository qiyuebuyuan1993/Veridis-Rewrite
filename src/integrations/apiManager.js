// ST-Api-Scripts 2.2.8 catalog contract (82ea902). Native imports keep its
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

export function managerRowToConnection(row) {
    // Veridis sends OpenAI-compatible chat completions, not native Gemini.
    const defaults = { openai: 'https://api.openai.com/v1', deepseek: 'https://api.deepseek.com/v1' };
    if (!['custom', 'openai', 'deepseek'].includes(row?.source)) {
        throw new Error('此来源不是受支持的 OpenAI 兼容连接，请在管理器中使用自定义兼容接口。');
    }
    return connectionFields(row.url.trim() || defaults[row.source] || '', row.key, row.model);
}

export function buildManagerImport(catalog, connection, name, groupName = '词汇映射', makeId = () => crypto.randomUUID()) {
    validateManagerCatalog(catalog);
    const fields = connectionFields(String(connection.baseUrl || '').trim(), String(connection.apiKey || ''), String(connection.model || '').trim());
    const target = String(groupName || '').trim() || '词汇映射';
    const matches = catalog.groups.filter(group => group.name === target);
    if (matches.length > 1) throw new Error('管理器中有同名分组，请先区分分组名称后重试。');
    const group = matches[0] || { id: makeId(), name: target };
    const duplicate = catalog.entries.some(row => {
        if (!row.groupIds.includes(group.id)) return false;
        try {
            const existing = managerRowToConnection(row);
            return existing.baseUrl === fields.baseUrl && existing.apiKey === fields.apiKey && existing.model === fields.model;
        } catch { return false; }
    });
    if (duplicate) return null;
    return { format, version: 2, groups: [{ ...group }], entries: [{
        id: makeId(), site: target, name: String(name || '').trim() || fields.model,
        source: 'custom', url: fields.baseUrl, key: fields.apiKey, model: fields.model, groupIds: [group.id],
    }] };
}

const batchGroupName = '词汇映射';
const signature = fields => JSON.stringify([fields.baseUrl, fields.apiKey, fields.model]);
const rowSignature = row => {
    try { return signature(managerRowToConnection(row)); } catch { return null; }
};

export function getManagerBatchGroup(catalog) {
    validateManagerCatalog(catalog);
    const matches = catalog.groups.filter(group => group.name === batchGroupName);
    if (matches.length > 1) throw new Error('管理器中存在多个“词汇映射”标签分组，请先区分名称。');
    const group = matches[0];
    // Existing named labels are authoritative. Older site-only configurations
    // are considered only when the dedicated label has not been created yet.
    return { group, rows: catalog.entries.filter(row => group
        ? row.groupIds.includes(group.id) : row.site === batchGroupName) };
}

export function buildManagerBatch(catalog, presets, mode, makeId = () => crypto.randomUUID()) {
    if (!['add', 'to-manager', 'to-veridis'].includes(mode)) throw new Error('请选择批量同步方式。');
    const { group, rows } = getManagerBatchGroup(catalog);
    const names = Object.keys(presets || {});
    if (mode === 'to-veridis') {
        if (!group && !rows.length) throw new Error('管理器中尚无“词汇映射”分组，未覆盖 API 预设。');
        const entries = [], used = new Set();
        for (const row of rows) {
            // Abort the entire operation on unsupported/incomplete entries.
            const fields = managerRowToConnection(row);
            const originalName = row.name.trim() || row.model.trim() || 'API';
            let name = originalName, suffix = 2;
            while (used.has(name)) name = `${originalName} (${suffix++})`;
            used.add(name);
            entries.push([name, { ...(Object.hasOwn(presets, name) ? presets[name] : {}), ...fields, modelOptions: [] }]);
        }
        return { presets: Object.fromEntries(entries), count: entries.length,
            summary: `管理器“词汇映射”分组 ${rows.length} 条 → 覆盖词汇映射已保存的 ${names.length} 个 API 预设。当前连接和全局改写参数保留。` };
    }
    const source = names.map(name => {
        const preset = presets[name];
        const fields = connectionFields(String(preset?.baseUrl || '').trim(), String(preset?.apiKey || ''), String(preset?.model || '').trim());
        return { name, fields, signature: signature(fields) };
    });
    const target = group || { id: makeId(), name: batchGroupName };
    const create = item => ({ id: makeId(), site: batchGroupName, name: item.name, source: 'custom',
        url: item.fields.baseUrl, key: item.fields.apiKey, model: item.fields.model, groupIds: [target.id] });
    if (mode === 'add') {
        const known = new Set(rows.map(rowSignature).filter(Boolean)), added = [];
        for (const item of source) {
            if (known.has(item.signature)) continue;
            added.push(create(item));
            known.add(item.signature);
        }
        return { catalog: added.length ? { format, version: 2, groups: [{ ...target }], entries: added } : null,
            count: added.length, summary: `已保存 ${names.length} 个 API；管理器分组已有 ${rows.length} 条；新增 ${added.length} 条，跳过重复 ${names.length - added.length} 条。` };
    }
    const reused = new Set();
    const desired = source.map(item => {
        const match = rows.find(row => !reused.has(row.id) && row.name === item.name && rowSignature(row) === item.signature);
        if (!match) return create(item);
        reused.add(match.id);
        return match.groupIds.includes(target.id) ? match : { ...match, groupIds: [...match.groupIds, target.id] };
    });
    const scoped = new Set(rows.map(row => row.id)), retained = [];
    let removed = 0, detached = 0;
    for (const row of catalog.entries) {
        if (!scoped.has(row.id)) retained.push(row);
        else if (!reused.has(row.id)) {
            const otherGroups = row.groupIds.filter(id => id !== target.id);
            if (otherGroups.length) { retained.push({ ...row, groupIds: otherGroups }); detached++; }
            else removed++;
        }
    }
    const entries = [...retained, ...desired];
    const next = { ...catalog, groups: group ? catalog.groups : [...catalog.groups, target], entries };
    // Retain credential notes still referenced by any group.
    if (catalog.keyNotes) {
        const referenced = new Set(entries.map(row => row.credentialId));
        next.keyNotes = catalog.keyNotes.filter(note => referenced.has(note.id));
    }
    return { catalog: next, replace: true, count: desired.length,
        summary: `用已保存的 ${names.length} 个 API 覆盖管理器“词汇映射”分组（原有 ${rows.length} 条）：保留相同条目 ${reused.size} 条，新增 ${desired.length - reused.size} 条，移除 ${removed} 条；${detached} 条仅移出本分组并保留在其他分组。` };
}

// The manager currently exposes no public write API. Its supported merge-import
// path serializes writes, preserves unrelated data, refreshes the UI and marks
// account sync pending. Never bypass this by editing its persistent state.
export async function mergeThroughManager(host, catalog, { replace = false, beforeWrite = async () => {} } = {}) {
    validateManagerCatalog(catalog);
    const doc = host.document;
    const main = doc.querySelector('dialog.st-api-manager[aria-label="API 管理器"]');
    if (!main) throw new Error('请先启用 API 管理器，再重试保存。');
    if (doc.querySelector('dialog.st-api-manager[open]')) throw new Error('请先关闭 API 管理器的窗口，再重试保存。');
    const dataButton = [...main.querySelectorAll('.api-manager-toolbar button')]
        .find(button => button.textContent.trim() === '数据');
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
        dataPane = doc.querySelector('dialog.st-api-manager[open][aria-label="数据"]');
        const input = dataPane?.querySelector('input.data-actions-file-input[type="file"]');
        if (!input) throw new Error('未找到管理器的合并导入入口，请更新管理器。');
        const transfer = new host.DataTransfer();
        transfer.items.add(new host.File([JSON.stringify(catalog)], 'veridis-api-transfer.json', { type: 'application/json' }));
        input.files = transfer.files;
        input.dispatchEvent(new host.Event('change', { bubbles: true }));
        mergePane = await waitFor(() => doc.querySelector('dialog.st-api-manager[open][aria-label="导入方式"]'), dataPane);
        const label = replace ? '替换导入' : '合并导入';
        const merge = [...mergePane.querySelectorAll('button.import-mode-option')]
            .find(button => button.querySelector('span')?.textContent.trim() === label);
        if (!merge || merge.disabled) throw new Error('未找到安全的合并导入按钮，未执行写入。');
        try { await beforeWrite(); }
        catch (error) {
            mergePane.close(); dataPane.close(); main.close();
            throw error;
        }
        merge.click();
        // A cancelled native replacement confirmation does not start a write.
        if (replace && !merge.disabled && mergePane.isConnected) {
            mergePane.close(); dataPane.close(); main.close();
            throw new Error('已取消覆盖，原有配置未改动。');
        }
        await waitFor(() => !mergePane.isConnected && dataPane.querySelector('[role="status"]')?.textContent === (replace ? '已替换导入配置。' : '已合并导入配置。'), mergePane);
        dataPane.close();
        main.close();
    } catch (error) {
        // Keep manager errors visible; never retry or change the chosen mode.
        throw error;
    }
}
