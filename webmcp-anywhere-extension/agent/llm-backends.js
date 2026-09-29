/**
 * llm-backends.js  —  the swappable "brain" behind the router
 * -----------------------------------------------------------
 * Two backends, ONE interface:
 *
 *    backend.decide({ systemPrompt, userText, responseSchema, history }) -> parsed object
 *
 * - NanoBackend     : Chrome's built-in Gemini Nano via the Prompt API. On-device, no key,
 *                     no network after the model downloads. NO native tool calling, so we use
 *                     `responseConstraint` (JSON Schema structured output) to get {tool, args}.
 * - FallbackBackend : a hosted model reached through YOUR proxy endpoint. Same JSON contract.
 *
 * Why a fallback at all? Chrome's docs are explicit: the on-device model "fails open" — it may
 * be unavailable (no model, unsupported language, low-end device). Your agent must not. Nano is
 * also "autocomplete-class": great at turning a free-form sentence into a structured object,
 * weaker at multi-tool disambiguation and non-English input. So: Nano first for the wow, hosted
 * fallback for muscle and for languages Nano won't serve.
 */

/* ------------------------------- Gemini Nano ------------------------------- */

// In extensions the Prompt API is global (Chrome 138+). Feature-detect defensively.
function getLanguageModel() {
  return (typeof globalThis !== 'undefined' && globalThis.LanguageModel) || null;
}

/**
 * Check Nano availability for the languages we actually need. CRITICAL: pass the SAME
 * language options you'll use in create()/prompt(), because a model may be 'available'
 * for English yet 'unavailable' for French — exactly the trap for a French demo.
 * Returns 'available' | 'downloadable' | 'downloading' | 'unavailable'.
 */
export async function nanoAvailability(languages = ['en']) {
  const LM = getLanguageModel();
  if (!LM) return 'unavailable';
  try {
    return await LM.availability({
      expectedInputs: [{ type: 'text', languages }],
      expectedOutputs: [{ type: 'text', languages }],
    });
  } catch {
    return 'unavailable';
  }
}

export function createNanoBackend({ languages = ['en'], onDownloadProgress } = {}) {
  const LM = getLanguageModel();

  return {
    name: 'gemini-nano',
    async isReady() {
      const status = await nanoAvailability(languages);
      return status === 'available' || status === 'downloadable' || status === 'downloading';
    },
    async decide({ systemPrompt, userText, responseSchema /* history unused: tiny context window */ }) {
      if (!LM) throw new Error('Prompt API (LanguageModel) not available in this context.');

      const status = await nanoAvailability(languages);
      if (status === 'unavailable') {
        throw new Error(`Gemini Nano unavailable for languages: ${languages.join(',')}`);
      }

      const session = await LM.create({
        initialPrompts: [{ role: 'system', content: systemPrompt }],
        expectedInputs: [{ type: 'text', languages }],
        expectedOutputs: [{ type: 'text', languages }],
        monitor(m) {
          if (onDownloadProgress) {
            m.addEventListener('downloadprogress', (e) => onDownloadProgress(e.loaded));
          }
        },
      });

      try {
        // responseConstraint forces valid JSON matching the schema (Chrome 137+).
        // omitResponseConstraintInput keeps the schema out of the prompt token budget —
        // important because Nano's window is small (~4K in / 1K out).
        const raw = await session.prompt(userText, {
          responseConstraint: responseSchema,
          omitResponseConstraintInput: true,
        });
        return parseJson(raw);
      } finally {
        session.destroy?.();
      }
    },
  };
}

/* ------------------------------ Hosted fallback ----------------------------- */

/**
 * Reaches a hosted model through YOUR endpoint. Default = a small proxy you run, so the API
 * key stays server-side (never ship a key in an extension). The proxy receives
 * { systemPrompt, userText, responseSchema } and must return the model's text completion
 * (ideally already JSON). A 10-line Express/Cloudflare-Worker proxy is enough — see INTEGRATION.md.
 *
 * For a quick local demo you MAY call a provider directly by setting `directUrl` + headers,
 * but treat that as throwaway: keys in client code are a liability.
 */
export function createFallbackBackend({
  endpoint = 'http://localhost:8787/route', // your proxy
  directUrl = null,                          // e.g. provider URL for throwaway local demos
  headers = {},
  buildBody,                                 // optional: shape the request for your proxy/provider
  extractText,                               // optional: pull the text out of the provider response
} = {}) {
  const url = directUrl || endpoint;

  return {
    name: directUrl ? 'hosted-direct' : 'hosted-proxy',
    async isReady() { return Boolean(url); },
    async decide({ systemPrompt, userText, responseSchema, history = [] }) {
      const body = buildBody
        ? buildBody({ systemPrompt, userText, responseSchema, history })
        : { systemPrompt, userText, responseSchema, history };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Fallback HTTP ${res.status}: ${await res.text().catch(() => '')}`);

      const data = await res.json();
      const text = extractText ? extractText(data) : (data.text ?? data.completion ?? JSON.stringify(data));
      return parseJson(text);
    },
  };
}

/* --------------------------------- helpers --------------------------------- */

// Defensive JSON parse: structured output should be clean, but hosted models sometimes
// wrap JSON in ```fences``` or prose. Extract the first balanced object.
function parseJson(raw) {
  if (raw == null) throw new Error('Empty model response');
  if (typeof raw === 'object') return raw;
  const text = String(raw).trim();
  try { return JSON.parse(text); } catch { /* fall through */ }
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
  throw new Error(`Could not parse model output as JSON: ${text.slice(0, 200)}`);
}
