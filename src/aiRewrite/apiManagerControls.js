import { readManagerCatalog, managerRowToConnection, buildManagerImport, buildManagerBatch, mergeThroughManager } from '../integrations/apiManager.js';

export function bindApiManagerControls({ extensionSettings, getSettings, applyConnection, applyPresets }) {
    const root = document.getElementById('blai-ai-manager');
    if (!root) return () => {};
    const find = name => root.querySelector('#blai-ai-manager-' + name);
    const group = find('group'), rows = find('entry'), source = find('source');
    const status = find('status'), target = find('target');
    let catalog = null, visibleRows = [], sites = [], busy = false;
    const siteKey = row => JSON.stringify([row.site, row.source, row.url]);
    const read = () => readManagerCatalog(window, extensionSettings);
    const isBatch = () => (target.value.trim() || '词汇映射') === '词汇映射';
    const syncMode = () => {
        const batch = isBatch();
        find('single').hidden = batch;
        find('batch').hidden = !batch;
        source.disabled = busy || batch;
        find('mode').disabled = busy || !batch;
        find('export').textContent = batch ? '对比并批量同步' : '保存所选 API 到管理器';
    };
    const renderRows = () => {
        visibleRows = (catalog?.entries || []).filter(row => !group.value
            || (group.value === 'ungrouped' ? !row.groupIds.length
                : group.value.startsWith('site:') ? siteKey(row) === sites[Number(group.value.slice(5))]
                : row.groupIds.includes(group.value.slice(3))));
        rows.replaceChildren(new Option(visibleRows.length ? '请选择连接配置' : '此分组暂无配置', ''));
        visibleRows.forEach((row, index) => rows.add(new Option(`${row.site} · ${row.model || '未填写模型'} · ${row.name || '配置'} (${index + 1})`, String(index))));
        find('import').disabled = true;
    };
    const renderCatalog = () => {
        const selected = group.value;
        group.replaceChildren(new Option('全部分组', ''), new Option('未分组', 'ungrouped'));
        for (const item of catalog.groups) group.add(new Option('标签分组：' + item.name, 'id:' + item.id));
        sites = [...new Set(catalog.entries.map(siteKey))];
        sites.forEach((key, index) => group.add(new Option('配置组：' + JSON.parse(key)[0] + ` (${index + 1})`, 'site:' + index)));
        if ([...group.options].some(option => option.value === selected)) group.value = selected;
        const names = new Set([...catalog.groups.map(item => item.name), ...catalog.entries.map(item => item.site)]);
        find('groups').replaceChildren(...[...names].map(name => new Option(name, name)));
        renderRows();
    };
    const sync = () => {
        const selected = source.value;
        source.replaceChildren(new Option('当前连接（含未保存修改）', ''));
        Object.keys(getSettings().apiPresets || {}).forEach(name => source.add(new Option('已保存：' + name, name)));
        if ([...source.options].some(option => option.value === selected)) source.value = selected;
        syncMode();
    };
    const run = async action => {
        if (busy) return;
        busy = true;
        root.setAttribute('aria-busy', 'true');
        root.querySelectorAll('button,input,select').forEach(control => { control.disabled = true; });
        status.textContent = '正在处理…';
        try { await action(); }
        catch (error) { status.textContent = error.message; }
        finally {
            busy = false;
            root.setAttribute('aria-busy', 'false');
            root.querySelectorAll('button,input,select').forEach(control => { control.disabled = false; });
            find('import').disabled = !catalog || rows.value === '';
            syncMode();
        }
    };
    find('refresh').onclick = () => run(async () => {
        catalog = null;
        renderRows();
        catalog = await read();
        renderCatalog();
        status.textContent = `已读取 ${catalog.groups.length} 个分组、${catalog.entries.length} 条配置。`;
    });
    group.onchange = renderRows;
    rows.onchange = () => { find('import').disabled = rows.value === '' || busy; };
    find('import').onclick = () => run(async () => {
        const selected = visibleRows[Number(rows.value)];
        if (rows.value === '' || !selected) return;
        // Read again so a rotated/deleted credential is never silently imported.
        const latest = await read();
        const row = latest.entries.find(item => item.id === selected.id);
        if (!row || JSON.stringify(row) !== JSON.stringify(selected)) {
            catalog = latest;
            renderCatalog();
            throw new Error('这条配置已变化，请重新选择后填入。');
        }
        applyConnection(managerRowToConnection(row));
        status.textContent = '已填入 URL、Key 和模型；可用原有保存按钮保存为 API 预设。';
    });
    find('export').onclick = () => run(async () => {
        const settings = getSettings();
        if (isBatch()) {
            const mode = find('mode').value;
            const originalPresets = JSON.stringify(settings.apiPresets || {});
            const latest = await read();
            const originalCatalog = JSON.stringify(latest);
            const plan = buildManagerBatch(latest, settings.apiPresets || {}, mode);
            status.textContent = plan.summary;
            if (!plan.catalog && !plan.presets) return;
            if (mode !== 'add' && !window.confirm(plan.summary + '\n是否继续整组覆盖？')) {
                status.textContent = '已取消批量覆盖，原有配置未改动。';
                return;
            }
            const verifyUnchanged = async () => {
                if (JSON.stringify(await read()) !== originalCatalog
                    || JSON.stringify(getSettings().apiPresets || {}) !== originalPresets) {
                    throw new Error('对比后配置已变化，未执行覆盖，请重新对比。');
                }
            };
            if (plan.presets) {
                await verifyUnchanged();
                applyPresets(plan.presets);
                status.textContent = `已批量保存 ${plan.count} 个 API 预设到词汇映射，当前连接保留。`;
                return;
            }
            await mergeThroughManager(window, plan.catalog, { replace: plan.replace, beforeWrite: verifyUnchanged });
            catalog = await read();
            const expected = plan.catalog.entries;
            if (!expected.every(entry => catalog.entries.some(row => JSON.stringify(row) === JSON.stringify(entry)))
                || (plan.replace && catalog.entries.length !== expected.length)) {
                throw new Error('尚未核实批量保存结果，请检查管理器后再重试。');
            }
            renderCatalog();
            status.textContent = `批量同步完成。${plan.summary}`;
            return;
        }
        const name = source.value;
        const connection = name ? settings.apiPresets?.[name] : settings;
        if (!connection) throw new Error('这个 API 预设已不存在，请重新选择。');
        const latest = await read();
        const incoming = buildManagerImport(latest, connection, name || settings.activeApiPreset || '词汇映射', target.value);
        if (!incoming) {
            status.textContent = '该分组中已保存相同的 URL、Key 和模型，无需重复添加。';
            return;
        }
        await mergeThroughManager(window, incoming);
        catalog = await read();
        const entry = incoming.entries[0];
        if (!catalog.entries.some(row => row.id === entry.id && row.url === entry.url && row.key === entry.key && row.model === entry.model)) {
            throw new Error('尚未核实管理器保存结果，请检查管理器后再重试。');
        }
        renderCatalog();
        status.textContent = `已保存到管理器的“${incoming.groups[0].name}”分组（本机）。`;
    });
    target.oninput = syncMode;
    target.onchange = syncMode;
    root.ontoggle = () => { if (root.open) sync(); };
    sync();
    return sync;
}
