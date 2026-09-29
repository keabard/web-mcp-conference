# WebMCP Anywhere

Extension Chrome (Manifest V3) qui **injecte des tools WebMCP sur des sites tiers dont on ne
contrôle pas le code**, pour les rendre pilotables par un agent IA, sans toucher au site.

Le projet vient d'une démo du talk WebMCP à Sunny Tech 2026 (les slides sont dans
`Sunny Tech 2026 - WebMCP.pdf`). Il s'appelait auparavant « Agent Adapter Hack » : c'est pour ça
que le code utilise encore le préfixe `AgentAdapter` / `__agentAdapter*`.

L'extension a deux moitiés :

- **Émetteur** : un content script détecte le site, enregistre des tools via
  `modelContext.registerTool()` et les exécute en pilotant le DOM ou en rejouant des requêtes HTTP.
- **Consommateur** : un chat dans le side panel transforme une phrase en appel de tool, via le LLM
  embarqué de Chrome (Gemini Nano), avec un repli sur un modèle hébergé.

> Pour le détail des contrats internes, lire [`webmcp-anywhere-extension/SPEC.md`](webmcp-anywhere-extension/SPEC.md).
> Pour la partie agent et le proxy de repli, lire [`webmcp-anywhere-extension/agent/README.md`](webmcp-anywhere-extension/agent/README.md).

---

## Prérequis

- **Chrome avec WebMCP activé** : le flag `chrome://flags/#webmcp-for-testing` (le nom peut varier
  selon la version, certaines builds utilisent `#enable-webmcp-testing`) ou un origin trial.
  L'extension utilise **l'API native du navigateur** (`document.modelContext`, puis
  `navigator.modelContext` en repli). Elle n'embarque **aucun polyfill** (pas de `@mcp-b/global`) :
  sans WebMCP natif, le popup affiche « WebMCP non disponible » et aucun tool n'est enregistré.
- **Pour l'agent du side panel** (optionnel) : Chrome 138+ avec Gemini Nano (Prompt API), ou le
  proxy de repli sur `http://localhost:8787/route` (voir `agent/README.md`).

Il n'y a **ni build ni dépendance npm** : c'est du JavaScript brut chargé tel quel.

## Installation

1. `chrome://extensions` → activer le **mode développeur** → **Charger l'extension non empaquetée**
   → sélectionner `webmcp-anywhere-extension/`.
2. Aller sur un site configuré (par ex. `https://demo.guru99.com/test/newtours/`).
3. Cliquer sur l'icône de l'extension : le popup affiche le statut WebMCP, la config détectée et
   la liste des tools actifs. La console affiche les logs `[AgentAdapter]`.
4. Bouton **🤖 Agent** → ouvre le side panel de chat.

Alternative pour piloter Chrome depuis un agent (Chrome DevTools MCP) : lancer Chrome avec
`--load-extension=<chemin>/webmcp-anywhere-extension` et un `--user-data-dir` persistant.

---

## Fonctionnement

```
Page du site tiers (world MAIN)                     Contexte extension
┌───────────────────────────────────────┐          ┌──────────────────────────────┐
│ configs-bundle.js  AGENT_ADAPTER_CONFIGS│         │ popup/     statut + tools    │
│ dom-analyzer.js    heuristique sans conf│         │ sidepanel/ chat              │
│ injector.js        buildExecutor(action)│◀────────│  agent/bridge.js             │
│ content.js         registerTool(...)    │ chrome. │  agent/agent-loop.js         │
│   ├ window.__agentAdapterExecute()      │ scripting│ agent/tool-router.js        │
│   └ window.__agentAdapterState          │ (MAIN)  │  agent/llm-backends.js       │
└───────────────────────────────────────┘          │   ├ Gemini Nano (défaut)     │
                                                    │   └ proxy hébergé (repli)    │
                                                    └──────────────────────────────┘
```

Au chargement de chaque page, `content.js` (injecté en `world: "MAIN"`, `document_idle`) :

1. Récupère `document.modelContext || navigator.modelContext`. S'il est absent, l'état passe à
   `no-webmcp` et le script s'arrête.
2. Patche `getTools()` : Chrome renvoie `inputSchema` sous forme de chaîne JSON, le patch le
   désérialise.
3. Cherche la config par clé = hostname avec les points remplacés par des tirets
   (`demo.guru99.com` → `demo-guru99-com`) dans `AGENT_ADAPTER_CONFIGS`.
4. Sans config : génère des tools par heuristique (`dom-analyzer.js`). Les formulaires deviennent
   des `fill_and_submit`, les tables des `scrape` et les boutons des `click`.
5. Attend `waitFor`, clique les éventuelles modales de consentement (`dismissOnLoad`), puis
   enregistre chaque tool avec `registerTool({ name, description, inputSchema, execute })`.
6. Expose `window.__agentAdapterExecute(name, args)`. `executeTool()` de WebMCP ne marche pas depuis
   un script de page dans la preview Chrome, donc le side panel et les scripts d'agent passent par
   ce point d'entrée.
7. Reprend les actions interrompues par une navigation (via `sessionStorage`) et publie l'état dans
   `window.__agentAdapterState`, que lit le popup.

---

## Ajouter ou modifier un site

Les configs vivent à **deux endroits**, à garder synchronisés à la main :

- `configs/<hostname-avec-tirets>.json` : la source lisible et éditable.
- `configs-bundle.js` : ce qui est **réellement chargé**. Le world MAIN n'a pas accès aux APIs
  `chrome.*` pour lire les fichiers de l'extension, donc les JSON y sont recopiés.

Après toute modification : copier le JSON dans le bundle, puis recharger l'extension.

Format (`dismissOnLoad` est optionnel ; l'exemple est tiré de la config guru99) :

```json
{
  "name": "Mercury Tours Adapter",
  "hostname": "demo.guru99.com",
  "waitFor": "body",
  "dismissOnLoad": [{ "selector": "button", "textMatch": "Accepter et fermer", "waitMs": 300 }],
  "tools": [
    {
      "name": "login",
      "description": "Se connecter au site Mercury Tours. Identifiants de démo : tutorial / tutorial.",
      "inputSchema": {
        "type": "object",
        "properties": { "username": { "type": "string" }, "password": { "type": "string" } },
        "required": ["username", "password"]
      },
      "action": {
        "type": "fill_and_submit",
        "fields": [
          { "selector": "[name='userName']", "argKey": "username" },
          { "selector": "[name='password']", "argKey": "password" }
        ],
        "submitSelector": "[name='submit']",
        "waitMs": 2000
      }
    }
  ]
}
```

### Types d'`action` (`injector.js`)

| type | rôle |
|---|---|
| `fill_and_submit` | remplit `fields[]` puis clique `submitSelector` (ou `form.submit()`) ; peut scraper `resultSelector` |
| `scrape` | extrait `table` / `list` / `text` depuis `selector` |
| `click` | clic par `selector`, `selectorTemplate` (`{arg}`) ou `selectorByText` |
| `navigate` | `location.href = urlTemplate` (interpolé avec les args) |
| `navigate_then_fill` | navigue si nécessaire, puis remplit le formulaire après rechargement (`sessionStorage`) |
| `multi_step` | enchaîne des `steps` ; `requireUrl` permet de reprendre après une navigation, y compris SPA (`hashchange`) |
| `slow_type` | tape caractère par caractère pour déclencher les autocomplétions, puis clique `suggestionSelector` |
| `remote_form_submit` | `fetch` la page du formulaire, fusionne valeurs par défaut + args, soumet en `fetch` et parse le HTML de réponse, **sans navigation** |
| `fetch_and_scrape` | `fetch` une URL construite depuis `urlTemplate`, puis scrape le HTML obtenu |
| `fetch_nextdata` | `fetch` une page Next.js et extrait les données de `__NEXT_DATA__` (`dataPath`, `mapFields`…) |

Les actions `fetch*` / `remote_form_submit` constituent la voie « rejeu réseau » : rapide, sans
navigation, avec les cookies de la session (même origine). Les autres pilotent le DOM : c'est plus
universel mais plus lent. Les résultats sont renvoyés au format MCP
`{ content: [{ type: 'text', text }] }`.

### Sites déjà configurés

| clé | tools |
|---|---|
| `demo-guru99-com` (Mercury Tours) | `login`, `searchFlights`, `getPageText`, `navigateTo` |
| `riftdecks-com` | `getTopExpensiveCards`, `searchDecksByCard`, `getDeckDecklist`, `getMetaBreakdown` |
| `www-leboncoin-fr` | `searchVehicles` |
| `www-lelynx-fr` | `navigateTo`, `compareAssurancesAuto` |
| `autoquote-lelynx-fr` | `getResultatsAssuranceAuto`, `getPageText` |

---

## Tester un tool à la main

Depuis la console DevTools de la page, ou via `evaluate_script` de Chrome DevTools MCP :

```js
const ctx = document.modelContext || navigator.modelContext;
console.log(await ctx.getTools());                       // catalogue (inputSchema désérialisé)
await window.__agentAdapterExecute('login', { username: 'tutorial', password: 'tutorial' });
```

L'erreur `Execution context was destroyed` après un appel veut dire que le tool a déclenché une
navigation : c'est le comportement attendu.

## Agent du side panel

- Il découvre les tools de l'onglet actif (`getTools()`) et les exécute via
  `__agentAdapterExecute`, en passant par `chrome.scripting.executeScript({ world: 'MAIN' })`.
- Le routage fait **un tool par tour**. Gemini Nano n'a pas de tool calling natif, donc la sortie
  est contrainte par `responseConstraint` au format `{ tool: enum(noms + "none"), args, message }`.
- Le backend est choisi « Nano d'abord » : si Nano est indisponible pour le français ou échoue,
  l'agent bascule sur le proxy hébergé. La clé API reste côté proxy, jamais dans l'extension.
- Si des arguments requis manquent, l'agent les demande au lieu d'exécuter le tool.

## Limites connues et pistes d'évolution

- **Configs en double** (JSON + bundle) : un petit script de build qui génère `configs-bundle.js`
  depuis `configs/*.json` réglerait le problème.
- Les tools **agissent directement** : soumission de formulaires et navigation se font sans
  confirmation utilisateur. Aucune demande de consentement n'est implémentée.
- `remote_form_submit` / `fetch*` dépendent du même-origine et cassent en cas de signature de
  requête ou de protection anti-bot.
- Les sélecteurs CSS des configs sont fragiles face aux refontes des sites cibles.
- Le side panel n'est pas automatisable par les outils de pilotage de page.
- Il reste du debug (`console.log('COUCOU')`) dans le patch `getTools()` de `content.js`.
