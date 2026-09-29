/**
 * tool-router.js  —  catalog -> {tool, args} via constrained JSON
 * ---------------------------------------------------------------
 * This is the piece you asked for: turn the page's live WebMCP tool catalog into a
 * routing decision. Backend-agnostic — it just hands a system prompt + a JSON schema to
 * whatever brain you pass in (Nano or hosted).
 *
 * Design notes that matter for Nano specifically:
 *  - Keep the catalog COMPACT. Nano's context window is tiny; long descriptions blow the budget.
 *  - Validate loosely here, strictly in the tool's own execute() (WebMCP authoring principle).
 *  - Single tool per turn. Multi-step planning is a separate concern; small models are bad at it.
 */

const MAX_DESC = 220; // keep each tool description short for the on-device context window

function compactCatalog(catalog) {
  return catalog.map((t) => ({
    name: t.name,
    description: (t.description || '').slice(0, MAX_DESC),
    inputSchema: t.inputSchema || { type: 'object' },
  }));
}

export function buildRoutingPrompt(catalog, { language = 'fr' } = {}) {
  const tools = compactCatalog(catalog)
    .map((t) => `- ${t.name}: ${t.description}\n  params: ${JSON.stringify(t.inputSchema)}`)
    .join('\n');

  // Short, directive system prompt. The constraint schema (below) enforces the OUTPUT shape,
  // so we don't waste tokens describing JSON formatting here.
  return [
    `You route a user request to exactly ONE tool from the catalog, or to "none".`,
    `Pick the single best tool. Extract its arguments from the user's message using the param schema.`,
    `Use the user's own values; do not invent data. If no tool fits, set tool to "none" and write a short clarifying question in "message" (in language: ${language}).`,
    ``,
    `TOOLS:`,
    tools,
  ].join('\n');
}

/**
 * The responseConstraint schema. `tool` is constrained to the real tool names (+ "none"),
 * which is what keeps a small model honest. `args` is a generic object — the chosen tool's
 * execute() does the strict validation and returns a corrective error if needed.
 */
export function buildResponseSchema(catalog) {
  const names = catalog.map((t) => t.name);
  return {
    type: 'object',
    properties: {
      tool: { type: 'string', enum: [...names, 'none'] },
      args: { type: 'object' },
      message: { type: 'string' }, // used when tool === "none"
    },
    required: ['tool'],
    additionalProperties: false,
  };
}

/**
 * routeToTool: the one call your agent loop makes.
 * Returns { tool: string|null, args: object, message?: string }.
 */
export async function routeToTool({ backend, catalog, userText, history = [], language = 'fr' }) {
  if (!catalog || catalog.length === 0) {
    return { tool: null, args: {}, message: 'No tools are available on this page.' };
  }

  const systemPrompt = buildRoutingPrompt(catalog, { language });
  const responseSchema = buildResponseSchema(catalog);

  const decision = await backend.decide({ systemPrompt, userText, responseSchema, history });

  const tool = decision && decision.tool && decision.tool !== 'none' ? decision.tool : null;
  return {
    tool,
    args: (decision && decision.args) || {},
    message: decision && decision.message,
  };
}
