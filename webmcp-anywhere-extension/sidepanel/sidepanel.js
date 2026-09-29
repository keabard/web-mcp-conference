/**
 * sidepanel/sidepanel.js — the consumer UI
 * ----------------------------------------
 * Runs in the side panel (extension context), so the Prompt API (Gemini Nano) is
 * available with the "languageModel" permission, regardless of the visited site.
 * Page tools are reached through bridge.js (chrome.scripting -> MAIN world).
 */

import { createAgent } from '../agent/agent-loop.js';
import { getCatalog, executeTool } from '../agent/bridge.js';

const LANGUAGE = 'fr';

const agent = createAgent({
  getCatalog,
  executeTool,
  language: LANGUAGE,
  nano: {
    onDownloadProgress: (loaded) =>
      setStatus(`Téléchargement du modèle local… ${Math.round(loaded * 100)}%`),
  },
  fallback: {
    // Démarre ton proxy (voir agent/README.md). Laisse tel quel si tu n'utilises que Nano.
    endpoint: 'http://localhost:8787/route',
  },
});

const history = [];
const logEl = document.getElementById('log');
const inputEl = document.getElementById('input');
const sendEl = document.getElementById('send');
const statusEl = document.getElementById('status');

function setStatus(text) { statusEl.textContent = text; }

function append(kind, text) {
  const div = document.createElement('div');
  div.className = `msg msg-${kind}`;
  div.textContent = text;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
  return div;
}

// Tool executors return MCP-style { content: [{ type:'text', text }] }. Unwrap for display.
function renderResult(result) {
  if (result == null) return '(ok)';
  if (typeof result === 'string') return result;
  const text = result?.content?.[0]?.text;
  if (typeof text === 'string') {
    try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
  }
  try { return JSON.stringify(result, null, 2); } catch { return String(result); }
}

async function send() {
  const userText = (inputEl.value || '').trim();
  if (!userText) return;
  inputEl.value = '';
  sendEl.disabled = true;
  append('user', userText);
  setStatus('Réflexion…');

  try {
    const turn = await agent.runTurn(userText, history);
    console.log({userText, turn})
    history.push({ role: 'user', content: userText });

    if (!turn.tool) {
      const msg = turn.message || "Je n'ai pas trouvé de tool correspondant.";
      append('assistant', msg);
      history.push({ role: 'assistant', content: msg });
    } else {
      append('tool', `→ ${turn.tool}(${JSON.stringify(turn.args)})`);
      if (turn.error) append('error', `⚠ ${turn.error}`);
      else append('result', renderResult(turn.result));
    }
    setStatus(`Backend : ${turn.backend}`);
  } catch (err) {
    append('error', `Erreur : ${err.message || err}`);
    setStatus('');
  } finally {
    sendEl.disabled = false;
    inputEl.focus();
  }
}

sendEl.addEventListener('click', send);
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

// Announce which brain will answer, and pre-warm Nano on open.
agent.pickBackend().then(({ backend, status }) => {
  setStatus(
    backend.name === 'gemini-nano'
      ? `Agent local prêt (Gemini Nano · ${status})`
      : `Agent distant prêt (${backend.name})`
  );
}).catch((err) => setStatus(`Indisponible : ${err.message || err}`));
