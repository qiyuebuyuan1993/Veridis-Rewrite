import { readManagerCatalog, buildManagerImport, mergeThroughManager } from '../integrations/apiManager.js';

export function bindApiManagerControls({ extensionSettings, getSettings }) {
    const button = document.getElementById('blai-ai-manager-export');
    const status = document.getElementById('blai-ai-manager-status');
    const read = () => readManagerCatalog(window, extensionSettings);
    button.onclick = async () => {
        if (button.disabled) return;
        button.disabled = true;
        try {
            const connection = { ...getSettings() };
            const incoming = buildManagerImport(await read(), connection);
            if (incoming) {
                await mergeThroughManager(window, incoming);
                if (buildManagerImport(await read(), connection)) throw new Error('未核实保存结果，请检查 API 管理器。');
            }
            status.textContent = incoming ? '已保存到管理器的词汇映射分组。' : '该连接已在词汇映射分组中。';
        } catch (error) {
            status.textContent = error.message;
        } finally {
            button.disabled = false;
        }
    };
}
