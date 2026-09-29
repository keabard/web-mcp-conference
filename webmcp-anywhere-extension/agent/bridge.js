/**
 * agent/bridge.js — runs in the SIDE PANEL (extension context, full chrome.* APIs)
 * --------------------------------------------------------------------------------
 * Provides the two dependencies the agent loop needs, by reusing what content.js
 * already exposes in the page's MAIN world:
 *    - discovery : modelContext.getTools()         (already patched to deserialize inputSchema)
 *    - execution : window.__agentAdapterExecute()   (the working path in Chrome preview)
 *
 * We reach the MAIN world exactly like popup.js does: chrome.scripting.executeScript
 * with world:'MAIN'. No postMessage relay, no extra registry — your injector stays the
 * single source of truth for what a tool does.
 */

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('Aucun onglet actif.');
  if (/^(chrome|edge|about|chrome-extension):/.test(tab.url || '')) {
    throw new Error("Page système non accessible (chrome://, etc.).");
  }
  return tab.id;
}

export async function getCatalog() {
  const tabId = await activeTabId();
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async () => {
      const mc = document.modelContext || navigator.modelContext;
      if (!mc || typeof mc.getTools !== 'function') return [];
      const tools = await mc.getTools(); // content.js already deserializes inputSchema
      return (tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema:
          typeof t.inputSchema === 'string'
            ? (() => { try { return JSON.parse(t.inputSchema); } catch { return { type: 'object' }; } })()
            : (t.inputSchema || { type: 'object' }),
      }));
    },
  });
  return res?.result ?? [];
}

export async function executeTool(name, args) {
  const tabId = await activeTabId();
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [name, args || {}],
    func: async (toolName, toolArgs) => {
      if (typeof window.__agentAdapterExecute !== 'function') {
        throw new Error("L'adapter n'est pas présent sur cette page (aucun tool injecté).");
      }
      return await window.__agentAdapterExecute(toolName, toolArgs);
    },
  });
  return res?.result;
}
