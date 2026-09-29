# Agent Adapter Extension

## Workflow obligatoire pour toute action sur une webapp

**Avant toute chose**, quand une action doit être réalisée sur une webapp, suivre impérativement ces étapes dans l'ordre :

1. Charger le skill `/webmcp-run` (il documente les patterns d'interaction corrects avec l'API WebMCP, notamment le fait que `getTools()` est asynchrone)
2. Lancer Chrome
3. Vérifier que l'extension **WebMCP Agent Adapter** est bien installée et active. Elle va injecter des outils WebMCP sur la webapp cible quand cette dernière va être chargée dans le navigateur, si une config est disponible dans le code de l'extension pour la webapp. La simple présence de document.modelContext ne prouve pas que l'extension est bien installée. Tu dois te connecter au MCP DevTools pour vérifier qu'elle est bien installée. **L'extension est chargée automatiquement via `--load-extension` dans la config MCP — elle devrait toujours être présente.**
4. Si l'extension n'est pas installée (cas rare), installe là. Ton répertoire courant contient le code de l'extension. Utilise le MCP DevTools pour l'installer.
5. Naviguer vers la webapp cible
6. Inspecter les tools WebMCP exposés par la page (via `document.modelContext` ou `navigator.modelContext`)
7. Utiliser ces tools WebMCP pour réaliser la demande — ne pas contourner par du scripting direct si des tools sont disponibles

Ne jamais interagir directement avec le DOM ou exécuter du JavaScript custom tant que les tools WebMCP n'ont pas été explorés. Si tu ne trouves rien, annule l'instruction demandée et explique pourquoi.

## Modifier la config d'un site

Les fichiers `configs/*.json` sont la **source de vérité éditable**, mais c'est `configs-bundle.js` qui est réellement chargé par l'extension (le MAIN world n'a pas accès aux `chrome.*` APIs pour lire des fichiers). Après toute modification d'un fichier JSON, **répercuter les changements dans `configs-bundle.js`** puis recharger l'extension.

## Appeler les tools WebMCP depuis evaluate_script

L'API `executeTool(tool, args)` de WebMCP **ne fonctionne pas depuis les scripts de page** dans l'implémentation Chrome preview — elle est réservée à l'agent externe. Pour invoquer un tool depuis `evaluate_script`, utiliser `window.__agentAdapterExecute` exposé par l'extension :

```js
// Attendre l'enregistrement des tools (getTools() est async, les tools s'enregistrent après chargement)
const ctx = document.modelContext || navigator.modelContext;
await new Promise(resolve => {
  ctx.addEventListener('toolchange', resolve, { once: true });
  setTimeout(resolve, 4000); // fallback
});

// Appeler un tool directement
const result = await window.__agentAdapterExecute('login', { username: 'tutorial', password: 'tutorial' });
```

Note : si la navigation se produit pendant l'exécution, `evaluate_script` retourne `Error: Execution context was destroyed` — c'est normal, cela signifie que l'action a déclenché une navigation (succès).

## Configuration du serveur MCP Chrome DevTools

Le serveur MCP `chrome-devtools` est configuré dans `~/.claude.json` (scope user, via `claude mcp add`) en **mode pipe** (communication via stdin/stdout) :

```
claude mcp add chrome-devtools -s user -- npx chrome-devtools-mcp@latest \
  --category-extensions \
  "--chromeArg=--load-extension=/Users/wescale/dev/sunnytech/web-mcp/webmcp-anywhere-extension" \
  "--chromeArg=--user-data-dir=/Users/wescale/.chrome-webmcp-profile"
```

**Pourquoi le mode pipe ?** Le flag `--category-extensions` — qui expose les outils de gestion des extensions Chrome — n'est supporté qu'en mode pipe. En mode réseau (`autoConnect`, `browserUrl`, `wsEndpoint`), ce flag est ignoré.

**`--load-extension`** : ce flag Chrome charge automatiquement l'extension unpacked depuis le répertoire du projet à chaque démarrage de Chrome. Plus besoin de l'installer manuellement en début de session.

**`--user-data-dir`** : ce flag pointe Chrome vers un profil persistant (`~/.chrome-webmcp-profile`). Sans lui, Chrome démarrait avec un profil temporaire et l'extension n'apparaissait pas dans `list_extensions`. Avec ce profil fixe, les cookies, l'état de session et l'extension persistent entre les sessions.

**Si les outils d'extension sont absents** au moment d'une session : vérifier la config avec `claude mcp get chrome-devtools`, puis relancer Claude Code (`/mcp` pour reconnecter le serveur).
