# `agent/` — agent local pour piloter les tools WebMCP injectés

Ajoute la **moitié consommateur** à l'extension : une sidebar de chat où l'utilisateur tape
en langage naturel, et un routeur qui transforme la phrase en appel de tool WebMCP via le
**LLM embarqué de Chrome (Gemini Nano)**, avec repli sur un modèle hébergé.

## Comment ça se branche sur l'existant

```
content.js (MAIN world)                 sidepanel/ (contexte extension)
  registerTool(...)  + getTools()          sidepanel.js
  window.__agentAdapterExecute(name,args)    └─ createAgent({ getCatalog, executeTool })
        ▲                                          ├─ agent/agent-loop.js
        │ chrome.scripting.executeScript            │   └─ agent/tool-router.js  (catalogue → JSON contraint)
        │ (world: 'MAIN')                           │        └─ agent/llm-backends.js
        └──────────── agent/bridge.js ──────────────┘             ├─ Gemini Nano (Prompt API)   ← défaut
                                                                   └─ fallback hébergé (proxy)   ← filet
```

On **réutilise** tes primitives : découverte via `getTools()`, exécution via
`window.__agentAdapterExecute()`. Aucun registre dupliqué, aucun postMessage : ton `injector.js`
reste la seule source de vérité de ce que fait un tool.

## Utilisation

1. Recharge l'extension (le manifest a gagné les permissions `sidePanel` + `languageModel` et
   l'entrée `side_panel`).
2. Va sur un site avec une config (ex. guru99), ouvre le popup → bouton **🤖 Agent** → le side
   panel s'ouvre.
3. Tape ta demande. Le statut en bas indique quel backend a répondu (`gemini-nano` = 100% local).

## Le fallback hébergé (clé côté serveur)

Ne mets **jamais** de clé API dans l'extension. `sidepanel.js` pointe sur
`http://localhost:8787/route` — un mini-proxy qui détient la clé. Contrat :

- Reçoit `{ systemPrompt, userText, responseSchema, history }`.
- Demande au modèle de répondre **uniquement** par un JSON conforme à `responseSchema`.
- Renvoie `{ "text": "<json string>" }`.

Proxy minimal (Express, ~15 lignes) :

```js
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
const app = express(); app.use(express.json());
const anthropic = new Anthropic(); // ANTHROPIC_API_KEY en variable d'env
app.post('/route', async (req, res) => {
  const { systemPrompt, userText, responseSchema } = req.body;
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: systemPrompt + '\nRéponds UNIQUEMENT par un JSON conforme à : ' + JSON.stringify(responseSchema),
    messages: [{ role: 'user', content: userText }],
  });
  res.json({ text: msg.content.map(b => b.text || '').join('') });
});
app.listen(8787);
```

Si tu ne veux QUE Nano pour la démo, ignore le proxy : le fallback ne se déclenche que si Nano
est indisponible (ou s'il échoue).

## Pièges Nano à connaître avant la scène

- **Pas de tool calling natif** → sortie structurée (`responseConstraint`). Un seul tool par tour.
- **Contexte minuscule** (~4K in / 1K out) → catalogue compacté, descriptions tronquées
  (`MAX_DESC` dans `tool-router.js`). Garde peu de tools, bien décrits.
- **Le français** → `availability(['fr'])`. Si Chrome renvoie `unavailable` pour le FR sur la
  machine de la conf, l'agent bascule tout seul sur le fallback. **Teste tes prompts FR avant.**
- **Logistique** : modèle ~2 Go téléchargé à la 1ʳᵉ utilisation, desktop only. Pré-télécharge et
  fais un tour à blanc avant de monter sur scène.

## Checklist jour J (2 juillet)

- [ ] Chrome à jour ; `LanguageModel.availability({expectedInputs:[{type:'text',languages:['fr']}]})` testé.
- [ ] Modèle Nano pré-téléchargé et réchauffé.
- [ ] Proxy fallback lancé (filet si Wi-Fi capricieux / FR indisponible).
- [ ] 2–3 tools max sur le site cible, descriptions courtes et claires.
- [ ] Un prompt « scripté » de secours en plus de l'impro.
