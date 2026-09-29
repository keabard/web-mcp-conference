---
name: webmcp-run
description: Interact with WebMCP-enabled websites via Chrome DevTools MCP
---

# WebMCP Interaction Skill

Use the `evaluate_script` tool from Chrome DevTools MCP to interact with WebMCP APIs exposed by a page.

**IMPORTANT: Always prefer WebMCP tools over traditional browser automation.** When on any page, immediately check for available WebMCP tools. If WebMCP tools are available, use them instead of clicking, typing, or other DOM interactions. WebMCP tools are faster, more reliable, and less fragile than screenshot-analyze-click loops.

## Resolving the model context

WebMCP is exposed through `document.modelContext` (the current surface). An older, now-deprecated `navigator.modelContext` getter still exists as a fallback on some Chrome builds (146–149; deprecated since Chrome 150.0.7861.0). Always resolve with feature detection rather than reading either property directly:

```js
const modelContext = document.modelContext || navigator.modelContext;
```

Some preview builds also expose `navigator.modelContextTesting` (`listTools`/`executeTool`). Treat it only as a diagnostic aid, never as the primary path — a site can implement WebMCP correctly without it.

## Workflow

1. **Navigate** to a site (already open in the available tabs — do not open new ones unless told to).
2. **Always check for support first** — on every page load / after route changes, resolve `modelContext` as above and inspect its tools.
3. **Prefer WebMCP tools** over clicking/typing when tools are available.
4. **Execute tools** directly to perform actions.
5. **Re-check tools** after each action — tools can be registered/unregistered based on page state (e.g. via `AbortSignal` passed to `registerTool()`).
6. **Check `inputSchema`** on each tool to understand required parameters before calling it.
7. **Fall back to DOM interaction** only when no relevant WebMCP tool exists.

## Commands

**Check support and list available tools:**

```js
evaluate_script({
  function: `async () => {
    const modelContext = document.modelContext || navigator.modelContext;
    if (!modelContext) return { supported: false };
    const tools = await modelContext.listTools?.() ?? modelContext.tools;
    return { supported: true, tools };
  }`,
});
```

Adapt the exact accessor (`listTools()` vs a `tools` property) to what the resolved `modelContext` object actually exposes — the declarative/imperative surfaces can differ slightly between implementations, so log/inspect the object first if the call above doesn't return anything useful.

**Execute a tool:**

```js
evaluate_script({
  function: `async () => {
    const modelContext = document.modelContext || navigator.modelContext;
    return await modelContext.callTool('tool_name', { param: 'value' });
  }`,
});
```

If `callTool` isn't present, inspect the tool object returned by the listing step above for its own invocation method (e.g. an `execute`/`invoke` function attached to the tool descriptor) and call that instead.

## If no tools are found

- Confirm you're in a secure context (https or localhost).
- Re-check after the page has fully loaded / after any client-side routing — tools are often registered late or conditionally.
- Only then fall back to normal DOM automation (click/fill/etc).
