# SPEC.md — WebMCP Agent Adapter (architecture technique)

> Brief d'ingénierie destiné à un agent de code travaillant sur ce dépôt.
> Décrit l'extension telle qu'elle est, ses contrats internes et ses pièges.

## 1. Résumé

Extension Chrome (Manifest V3) qui **injecte des tools WebMCP sur des sites tiers dont on ne
possède pas le code**, pour les rendre pilotables par un agent IA, et qui **fournit elle-même
l'agent consommateur** (un chat en langage naturel dans un side panel, propulsé par le LLM
embarqué de Chrome avec repli sur un modèle hébergé).

Deux moitiés distinctes :

- **Émetteur (injection)** — contenu en *world MAIN* : détecte le site, enregistre des tools via
  `document.modelContext.registerTool()`, et implémente leur exécution par pilotage du DOM ou
  rejeu de requêtes.
- **Consommateur (agent)** — *contexte d'extension* (side panel) : découvre les tools de la page,
  route une phrase utilisateur vers un tool + arguments via un LLM, et l'exécute.

## 2. Contraintes de plateforme

| Contrainte | Conséquence |
|---|---|
| WebMCP est en preview (Chrome 146+, origin trial Chrome 149+) | API instable ; nécessite le flag `chrome://flags` « WebMCP for testing » **ou** un token d'origin trial. Pas dispo en stable par défaut. |
| `modelContext` exposé sur `document` (Chrome 150+), `navigator` déprécié (146–149) | Toujours résoudre via `document.modelContext \|\| navigator.modelContext`. |
| Les content scripts tournent en `world: "MAIN"` | **Pas d'accès aux `chrome.*` APIs** depuis l'injection → les configs sont embarquées statiquement (cf. §6), pas lues via `chrome.runtime.getURL`. |
| `executeTool()` natif ne marche pas depuis un script de page (preview) | L'exécution passe par un point d'entrée maison `window.__agentAdapterExecute()`. |
| Prompt API (Gemini Nano) : pas de tool calling natif, contexte ~4K/1K, desktop only | Le routage utilise la **sortie structurée** (`responseConstraint`), un seul tool par tour, et un fallback hébergé. |
| Side panel = contexte d'extension | C'est là que tourne le LLM (permission `languageModel`), pas dans la page tierce (qui n'a pas d'origin trial). |

## 3. Arborescence

```
manifest.json                  MV3 ; content_scripts world:MAIN ; side_panel ; permissions
configs-bundle.js              [MAIN] AGENT_ADAPTER_CONFIGS = registre statique des sites
configs/*.json                 source de vérité ÉDITABLE (dupliquée à la main dans le bundle)
dom-analyzer.js                [MAIN] analyzeDOMForTools() — fallback heuristique sans config
injector.js                    [MAIN] buildExecutor(action) — moteur d'exécution des actions
content.js                     [MAIN] point d'entrée : détecte, enregistre, expose, publie l'état
popup/popup.html|js            UI de statut + bouton « 🤖 Agent » qui ouvre le side panel
agent/bridge.js                [side panel] getCatalog()/executeTool() via chrome.scripting→MAIN
agent/tool-router.js           catalogue → prompt + schéma contraint → {tool, args}
agent/llm-backends.js          backend Nano (Prompt API) + backend fallback hébergé
agent/agent-loop.js            createAgent() : pickBackend (Nano-first) + runTurn
agent/README.md                doc d'intégration + proxy fallback + checklist
sidepanel/sidepanel.html|js    [side panel] UI de chat (consommateur)
```

## 4. Flux d'exécution

**Injection (au chargement de page, content.js).**
1. Résoudre `modelContext` ; si absent → état `no-webmcp`, stop.
2. Monkey-patch `modelContext.getTools()` pour désérialiser `inputSchema` (Chrome le renvoie en
   chaîne JSON ; les consommateurs attendent un objet).
3. Clé de config = `hostname.replace(/\./g,'-')` → chercher dans `AGENT_ADAPTER_CONFIGS`.
4. Si pas de config → `analyzeDOMForTools()` (heuristique). Si rien → état `no-config`, stop.
5. Attendre `config.waitFor` (sélecteur) si défini.
6. Pour chaque tool : `buildExecutor(action)` → `registerTool({name, description, inputSchema, execute})`,
   et stocker l'executor dans une map locale.
7. Exposer `window.__agentAdapterExecute(name, args)` (lit la map d'executors).
8. Rejouer une éventuelle action différée stockée en `sessionStorage` (cas `navigate_then_fill`).
9. Publier `window.__agentAdapterState = {status, hostname, tools, configName, …}` pour le popup.

**Tour d'agent (sidepanel.js → agent-loop.js).**
1. `getCatalog()` → `chrome.scripting.executeScript({world:'MAIN'})` exécute `getTools()` dans la page.
2. `pickBackend()` → `LanguageModel.availability(['fr'])` ; Nano si dispo, sinon fallback.
3. `routeToTool()` → construit un system prompt (catalogue compacté) + un schéma `responseConstraint`
   contraignant `{tool: enum(noms+none), args, message}` ; le backend renvoie ce JSON.
4. Si `tool === none` → afficher `message` (question de clarification).
5. Sinon `executeTool(name, args)` → `executeScript({world:'MAIN'})` appelle `window.__agentAdapterExecute`.
6. Rendre le résultat (déballer la forme MCP `{content:[{type:'text',text}]}`).

## 5. Le moteur d'actions (injector.js) — le « DSL »

`buildExecutor(action)` renvoie `async (args) => result`. Types d'`action` supportés :

| type | rôle | note perf |
|---|---|---|
| `fill_and_submit` | remplit des champs (`fields[]`) puis clique `submitSelector` ou `form.submit()` ; peut scraper `resultSelector` | pilotage DOM + navigation |
| `scrape` | extrait `table` / `list` / `text` depuis `selector` | lecture DOM |
| `click` | clic par `selector`, `selectorTemplate` (`{arg}`) ou `selectorByText` | pilotage DOM |
| `navigate` | `window.location = urlTemplate` (interpolé) | navigation |
| `navigate_then_fill` | navigue si besoin (stocke args en `sessionStorage`), puis remplit après chargement | traverse une navigation |
| `multi_step` | enchaîne des sous-actions ; `stopOnResult` pour court-circuiter | composition |
| `remote_form_submit` | **fetch** la page du formulaire, fusionne valeurs par défaut + args, **soumet via fetch**, parse le HTML de réponse | **rapide, sans navigation** — voie privilégiée pour la perf |

Helpers : `fillElement` (gère text/select/radio + events `input`/`change`), `scrapeTable`,
`scrapeList`. Les résultats suivent la forme MCP `{content:[{type:'text', text}]}`.

> Note stratégique : `remote_form_submit` est la voie « rejeu réseau » (rapide, robuste, auth par
> cookies same-origin) ; les autres types sont la voie « pilotage DOM » (universelle mais lente).
> C'est l'axe de la démo Performance.

## 6. Système de configuration

- `configs/<hostname-tirets>.json` = **source éditable**. Forme :
  `{ name, hostname, waitFor, tools: [{ name, description, inputSchema, action }] }`.
- `configs-bundle.js` = objet `AGENT_ADAPTER_CONFIGS` **chargé réellement** (le MAIN world ne peut
  pas lire les fichiers via `chrome.*`). **Toute modif d'un JSON doit être répercutée à la main
  dans le bundle**, puis recharger l'extension. (Candidat #1 à un step de build qui génère le
  bundle depuis `configs/*.json`.)
- Sans config : `dom-analyzer.js` génère des tools heuristiques (formulaires→`fill_and_submit`,
  tables→`scrape`, boutons hors-form→`click`), noms auto, `inputSchema` déduit des champs.

Exemple (guru99 / Mercury Tours) : tools `login`, `searchFlights` (en `remote_form_submit`),
`getPageText`, `navigateTo`.

## 7. Couche LLM (agent/)

- **Interface backend uniforme** : `decide({systemPrompt, userText, responseSchema, history}) → objet`.
- **NanoBackend** : `globalThis.LanguageModel` ; `availability()` avec les **mêmes** options de
  langue que `create()`/`prompt()` ; `session.prompt(text, {responseConstraint, omitResponseConstraintInput})`
  → string JSON parsé. Pas de tool calling → on contraint la sortie.
- **FallbackBackend** : POST vers un proxy (`endpoint`) qui détient la clé API ; renvoie `{text}`
  contenant le JSON. **Jamais de clé dans l'extension.** (Direct provider possible via `directUrl`,
  jetable.)
- **tool-router** : `buildRoutingPrompt` (catalogue tronqué à `MAX_DESC`), `buildResponseSchema`
  (`tool` contraint à `enum(noms+none)`), `routeToTool`.
- **agent-loop** : `createAgent({getCatalog, executeTool, language, nano, fallback})` →
  `runTurn(text, history)` ; bascule Nano→fallback sur indisponibilité ou erreur.

## 8. manifest.json (état actuel)

- `permissions`: `activeTab, scripting, storage, tabs, sidePanel, languageModel`
- `host_permissions`: `<all_urls>`
- `content_scripts`: `world:"MAIN"`, `run_at:"document_idle"`, ordre
  `configs-bundle.js → dom-analyzer.js → injector.js → content.js`
- `side_panel.default_path`: `sidepanel/sidepanel.html`
- `web_accessible_resources`: `configs/*.json`
- `action.default_popup`: `popup/popup.html`

## 9. Pièges connus / dettes

1. **Double source de configs** (JSON vs bundle) — à automatiser par un build.
2. **`chrome.sidePanel.open({tabId})`** requiert Chrome 116+ et un geste utilisateur (le clic popup
   convient) ; fallback robuste = `setPanelBehavior({openPanelOnActionClick:true})` dans un service
   worker (non présent aujourd'hui).
3. **Nano + français** : `availability(['fr'])` peut renvoyer `unavailable` ; le fallback couvre,
   mais à tester sur la machine cible.
4. **Nom du flag WebMCP** : vérifier la chaîne exacte selon la version de Chrome (le popup référence
   `#webmcp-for-testing` ; certaines builds utilisent `#enable-webmcp-testing`).
5. **`remote_form_submit`** dépend du même-origine pour les cookies ; casse sur signature de requête
   / anti-bot.
6. **Side panel non automatisable** par les outils de pilotage de page (surface d'extension séparée).

## 10. Dev / run

- Charger en **unpacked** (`chrome://extensions` → mode dev → « charger l'extension non empaquetée »),
  ou via `--load-extension=<dir>` + `--user-data-dir=<profil>` (profil persistant requis pour que
  l'extension apparaisse dans `list_extensions`).
- Activer le flag WebMCP (cf. §9.4) **ou** enregistrer un origin trial.
- Recharger l'extension après toute modif de `configs-bundle.js` ou du manifest.
- Le proxy fallback (optionnel) écoute sur `http://localhost:8787/route` (voir `agent/README.md`).
