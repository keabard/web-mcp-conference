/**
 * agent-loop.js  —  one user turn, end to end
 * -------------------------------------------
 * Ties the pieces together:
 *    getCatalog()  ->  routeToTool()  ->  executeTool()  ->  render-ready result
 *
 * Backend selection is "Nano first, hosted fallback":
 *  - If Nano is ready for the requested language, use it (on-device, free, private).
 *  - Otherwise (or on Nano error) fall back to the hosted backend.
 * This is exactly Chrome's recommended pattern: the on-device model fails open; your code
 * provides the safety net.
 */

import { routeToTool } from './tool-router.js';
import { createNanoBackend, createFallbackBackend, nanoAvailability } from './llm-backends.js';

function getMissingRequiredFields(toolDef, args) {
  if (!toolDef?.inputSchema?.required) return [];
  return toolDef.inputSchema.required.filter(f => {
    const v = args[f];
    return v === undefined || v === null || v === '';
  });
}

function buildMissingArgsMessage(toolName, toolDef, missing, language) {
  const props = toolDef?.inputSchema?.properties || {};
  const items = missing.map(f => `• ${props[f]?.description || f}`);
  return language === 'fr'
    ? `Pour lancer « ${toolName} », j'ai besoin des informations suivantes :\n${items.join('\n')}`
    : `To run "${toolName}", I need the following information:\n${items.join('\n')}`;
}

export function createAgent({
  getCatalog,         // () => Promise<tool[]>
  executeTool,        // (name, args) => Promise<result>
  language = 'fr',
  nano = {},          // options forwarded to createNanoBackend (e.g. onDownloadProgress)
  fallback = {},      // options forwarded to createFallbackBackend (endpoint / directUrl / headers)
} = {}) {
  const nanoBackend = createNanoBackend({ languages: [language], ...nano });
  const fallbackBackend = createFallbackBackend(fallback);

  async function pickBackend() {
    const status = await nanoAvailability([language]);
    // 'downloadable'/'downloading' still resolve to a usable session (it just downloads first).
    if (status === 'available' || status === 'downloadable' || status === 'downloading') {
      return { backend: nanoBackend, status };
    }
    return { backend: fallbackBackend, status };
  }

  /**
   * runTurn: process one natural-language message.
   * Returns a structured result you can render in the sidebar:
   *   { backend, tool, args, result }                  // a tool ran
   *   { backend, tool: null, message }                 // no tool matched -> clarify
   *   { backend, tool, args, error }                   // tool threw -> show corrective error
   */
  async function runTurn(userText, history = []) {
    const catalog = await getCatalog();

    let { backend } = await pickBackend();
    let decision;
    try {
      decision = await routeToTool({ backend, catalog, userText, history, language });
    } catch (err) {
      // Nano choked (unsupported language, parse failure, no model): retry on the fallback once.
      if (backend !== fallbackBackend && (await fallbackBackend.isReady())) {
        backend = fallbackBackend;
        decision = await routeToTool({ backend, catalog, userText, history, language });
      } else {
        throw err;
      }
    }

    if (!decision.tool) {
      return { backend: backend.name, tool: null, message: decision.message || "I couldn't match a tool to that request." };
    }

    const toolDef = catalog.find(t => t.name === decision.tool);
    const missing = getMissingRequiredFields(toolDef, decision.args);
    if (missing.length > 0) {
      return {
        backend: backend.name,
        tool: null,
        message: buildMissingArgsMessage(decision.tool, toolDef, missing, language),
      };
    }

    try {
      const result = await executeTool(decision.tool, decision.args);
      return { backend: backend.name, tool: decision.tool, args: decision.args, result };
    } catch (err) {
      // Surface the tool's corrective error so the user (or a follow-up turn) can fix the input.
      return { backend: backend.name, tool: decision.tool, args: decision.args, error: String(err.message || err) };
    }
  }

  return { runTurn, pickBackend };
}
