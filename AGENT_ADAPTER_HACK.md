# AGENT_ADAPTER_HACK — WebMCP Injection sur Sites Tiers

## 🎯 Objectif de la démarche

Ce document décrit la technique dite **"Agent Adapter Hack"** : injecter une couche WebMCP sur une application web **dont on ne contrôle pas le code source**, en passant par une **extension Chrome** qui analyse le DOM et enregistre des `navigator.modelContext` tools au nom du site cible.

Cette technique est au cœur d'une démo de talk de conférence (Sunny Tech 2026) sur WebMCP. Elle démontre que **même un vieux site sans API** peut devenir instantanément "IA-compatible" grâce à l'injection externe de tools structurés.

---

## 🧠 Contexte technique WebMCP

### Ce qu'est WebMCP

WebMCP est une spécification W3C (Draft Community Group Report, publié le 10 février 2026) qui introduit l'API navigateur `navigator.modelContext`. Elle permet à une page web d'exposer ses fonctionnalités comme des **tools MCP structurés et appelables par des agents IA**.

Au lieu qu'un agent IA prenne des screenshots et essaie de deviner où cliquer (approche vision), la page expose directement :
- Ce qu'elle peut faire (liste de tools)
- Les paramètres attendus (JSON Schema)
- La fonction à exécuter (`async execute(args)`)

### L'API essentielle (Mars 2026, après suppression de `provideContext`)

```javascript
// Vérification de support
if ('modelContext' in navigator) {

  // Enregistrer un tool
  navigator.modelContext.registerTool({
    name: 'searchProducts',
    description: 'Recherche des produits dans le catalogue par mot-clé',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Le terme de recherche' },
        category: { type: 'string', description: 'Catégorie optionnelle' }
      },
      required: ['query']
    },
    async execute(args) {
      // Logique d'exécution
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  });

  // Dé-enregistrer un tool
  navigator.modelContext.unregisterTool('searchProducts');
}
```

### État du support navigateur (Juin 2026)

| Navigateur | Support | Condition |
|------------|---------|-----------|
| Chrome 146-148 | ✅ Flag | `chrome://flags` → "WebMCP for testing" |
| Chrome 149+ | ✅ Origin Trial | Disponible |
| Edge 147+ | ✅ Flag | Même flag que Chrome |
| Firefox / Safari | 🔄 En discussion | Pas de support natif |

**Pour la démo** : utiliser Chrome Canary ou Chrome 149+ avec l'Origin Trial activé.

### Polyfill disponible

Pour les navigateurs sans support natif, le package `@mcp-b/global` injecte `navigator.modelContext` :

```javascript
import '@mcp-b/global'; // Polyfill qui installe navigator.modelContext
```

---

## 🏗️ Architecture de l'Agent Adapter Hack

### Principe

```
┌─────────────────────────────────────────────────────────┐
│                    Site Web Tiers                        │
│         (ERP, admin, vieille app — sans API)             │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              DOM de la page                       │   │
│  │  <input id="search" /><button>Chercher</button>   │   │
│  │  <table id="results">...</table>                  │   │
│  └──────────────────────────────────────────────────┘   │
│           ↑  analysé par le content script               │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │      Extension Chrome — Content Script            │   │
│  │                                                   │   │
│  │  1. Analyse le DOM au chargement                  │   │
│  │  2. Génère des tools WebMCP selon la config       │   │
│  │  3. Injecte via navigator.modelContext.            │   │
│  │     registerTool(...)                             │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │          navigator.modelContext (WebMCP)           │   │
│  │  tools disponibles pour l'agent IA :              │   │
│  │  - searchItems(query)                             │   │
│  │  - getResults() → données structurées             │   │
│  │  - fillForm(data)                                 │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                          ↓
              Agent IA (Claude, Gemini…)
              appelle les tools directement
```

### Stratégies d'injection possibles

**Stratégie A — Injection via `world: 'MAIN'`** (recommandée)

Le content script s'exécute dans le monde JS principal de la page, donc `navigator.modelContext` est accessible directement.

```json
// manifest.json (Manifest V3)
{
  "content_scripts": [{
    "js": ["content.js"],
    "world": "MAIN",
    "run_at": "document_idle"
  }]
}
```

**Stratégie B — Injection via `<script>` tag** (fallback)

Le content script insère un `<script>` dans le DOM qui s'exécute dans le contexte de la page :

```javascript
// content.js (dans ISOLATED world)
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
document.documentElement.appendChild(script);
```

```json
// manifest.json — déclarer le fichier comme web_accessible_resource
{
  "web_accessible_resources": [{
    "resources": ["injected.js"],
    "matches": ["<all_urls>"]
  }]
}
```

---

## 🏗️ Structure du projet Extension

```
webmcp-anywhere-extension/
├── manifest.json          # Configuration extension (MV3)
├── content.js             # Content script principal (world: MAIN)
├── injector.js            # Logique d'injection des tools WebMCP
├── dom-analyzer.js        # Analyse heuristique du DOM
├── configs/
│   └── target-site.json   # Config spécifique au site cible
├── popup/
│   ├── popup.html         # Interface utilisateur de l'extension
│   └── popup.js           # Gestion du popup
└── icons/
    └── icon-*.png
```

---

## 📄 Fichiers à implémenter

### `manifest.json`

```json
{
  "manifest_version": 3,
  "name": "WebMCP Agent Adapter",
  "version": "1.0.0",
  "description": "Injecte des tools WebMCP sur des sites tiers",
  "permissions": ["activeTab", "scripting", "storage"],
  "host_permissions": ["<all_urls>"],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": "icons/icon-48.png"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "world": "MAIN",
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["configs/*.json"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

### `content.js` — Point d'entrée

```javascript
/**
 * Agent Adapter Hack — Content Script
 * 
 * S'exécute dans le monde MAIN pour accéder à navigator.modelContext.
 * Charge la config spécifique au site courant, analyse le DOM,
 * et enregistre les tools WebMCP correspondants.
 */

(async () => {
  // 1. Vérifier le support WebMCP
  if (!('modelContext' in navigator)) {
    console.warn('[AgentAdapter] navigator.modelContext non disponible.');
    console.warn('[AgentAdapter] Activer le flag WebMCP dans chrome://flags');
    return;
  }

  // 2. Identifier le site courant
  const hostname = window.location.hostname;
  console.log(`[AgentAdapter] Tentative d'adaptation pour: ${hostname}`);

  // 3. Charger la config du site (si elle existe)
  const config = await loadSiteConfig(hostname);
  if (!config) {
    console.log(`[AgentAdapter] Aucune config trouvée pour ${hostname}`);
    return;
  }

  // 4. Attendre que le DOM soit prêt
  await waitForDOM(config.waitFor);

  // 5. Enregistrer les tools définis dans la config
  registerToolsFromConfig(config);

  console.log(`[AgentAdapter] ✅ ${config.tools.length} tools WebMCP injectés sur ${hostname}`);
})();

async function loadSiteConfig(hostname) {
  // Les configs sont packagées dans l'extension
  // Format : configs/[hostname-sanitized].json
  const configName = hostname.replace(/\./g, '-');
  try {
    const url = chrome.runtime.getURL(`configs/${configName}.json`);
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function waitForDOM(selector) {
  if (!selector) return Promise.resolve();
  return new Promise(resolve => {
    if (document.querySelector(selector)) return resolve();
    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) {
        observer.disconnect();
        resolve();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(resolve, 5000); // timeout de sécurité
  });
}

function registerToolsFromConfig(config) {
  for (const toolDef of config.tools) {
    try {
      navigator.modelContext.registerTool({
        name: toolDef.name,
        description: toolDef.description,
        inputSchema: toolDef.inputSchema,
        execute: buildExecutor(toolDef.action)
      });
      console.log(`[AgentAdapter] Tool enregistré: ${toolDef.name}`);
    } catch (err) {
      console.error(`[AgentAdapter] Erreur enregistrement tool ${toolDef.name}:`, err);
    }
  }
}
```

### `injector.js` — Exécuteurs d'actions DOM

```javascript
/**
 * buildExecutor — Construit la fonction execute() d'un tool
 * à partir d'une description d'action déclarative dans la config JSON.
 *
 * Types d'actions supportés :
 * - fill_and_submit : remplir un champ et soumettre le formulaire
 * - click : cliquer sur un élément
 * - scrape : extraire des données du DOM et les retourner
 * - navigate : naviguer vers une URL
 * - multi_step : enchaîner plusieurs actions
 */

function buildExecutor(action) {
  return async function execute(args) {
    switch (action.type) {

      case 'fill_and_submit': {
        const input = document.querySelector(action.selector);
        if (!input) throw new Error(`Élément non trouvé: ${action.selector}`);

        // Remplir le champ
        const value = args[action.argKey] ?? '';
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        // Soumettre
        const submitBtn = document.querySelector(action.submitSelector);
        if (submitBtn) {
          submitBtn.click();
        } else if (input.form) {
          input.form.submit();
        }

        // Attendre les résultats
        await sleep(action.waitMs ?? 1000);

        // Retourner les résultats scrapés si demandé
        if (action.resultSelector) {
          const data = scrapeTable(action.resultSelector);
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        }
        return { content: [{ type: 'text', text: 'Action effectuée' }] };
      }

      case 'scrape': {
        const container = document.querySelector(action.selector);
        if (!container) return { content: [{ type: 'text', text: '[]' }] };

        let data;
        if (action.format === 'table') {
          data = scrapeTable(action.selector);
        } else if (action.format === 'list') {
          data = scrapeList(action.selector, action.fields);
        } else {
          data = { text: container.innerText.trim() };
        }

        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }

      case 'click': {
        const target = action.selectorFn
          ? evalSelectorFn(action.selectorFn, args)
          : document.querySelector(action.selector);

        if (!target) throw new Error(`Élément cliquable non trouvé`);
        target.click();
        await sleep(action.waitMs ?? 500);

        if (action.resultSelector) {
          const data = scrapeTable(action.resultSelector);
          return { content: [{ type: 'text', text: JSON.stringify(data) }] };
        }
        return { content: [{ type: 'text', text: 'Clic effectué' }] };
      }

      case 'navigate': {
        const url = action.urlTemplate.replace(/\{(\w+)\}/g, (_, key) => args[key] ?? '');
        window.location.href = url;
        return { content: [{ type: 'text', text: `Navigation vers: ${url}` }] };
      }

      default:
        throw new Error(`Type d'action inconnu: ${action.type}`);
    }
  };
}

// --- Helpers ---

function scrapeTable(selector) {
  const table = document.querySelector(selector);
  if (!table) return [];

  const headers = [...table.querySelectorAll('thead th, thead td')]
    .map(th => th.innerText.trim());
  const rows = [...table.querySelectorAll('tbody tr')].map(row =>
    [...row.querySelectorAll('td')].reduce((obj, td, i) => {
      obj[headers[i] ?? `col${i}`] = td.innerText.trim();
      return obj;
    }, {})
  );
  return rows;
}

function scrapeList(selector, fields) {
  return [...document.querySelectorAll(selector)].map(el => {
    if (!fields) return { text: el.innerText.trim() };
    return Object.fromEntries(
      Object.entries(fields).map(([key, subSelector]) => [
        key,
        el.querySelector(subSelector)?.innerText.trim() ?? ''
      ])
    );
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

## 📋 Format de Configuration Site (`configs/[hostname].json`)

Chaque site cible a un fichier de config JSON déclaratif qui définit les tools à injecter **sans modifier le code source du site**.

### Exemple concret pour un ERP/admin fictif

```json
{
  "name": "ERP Adapter",
  "hostname": "erp.example.com",
  "waitFor": "#main-content",
  "tools": [
    {
      "name": "searchEmployees",
      "description": "Recherche des employés par nom, département ou matricule",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string",
            "description": "Nom, prénom ou matricule de l'employé"
          },
          "department": {
            "type": "string",
            "description": "Filtrer par département (optionnel)"
          }
        },
        "required": ["query"]
      },
      "action": {
        "type": "fill_and_submit",
        "selector": "#search-input",
        "argKey": "query",
        "submitSelector": "#search-btn",
        "waitMs": 1500,
        "resultSelector": "#results-table"
      }
    },
    {
      "name": "getEmployeeList",
      "description": "Retourne la liste complète des employés visibles sur la page courante",
      "inputSchema": {
        "type": "object",
        "properties": {}
      },
      "action": {
        "type": "scrape",
        "selector": "#employees-table",
        "format": "table"
      }
    },
    {
      "name": "openEmployeeRecord",
      "description": "Ouvre la fiche détaillée d'un employé par son ID",
      "inputSchema": {
        "type": "object",
        "properties": {
          "employeeId": {
            "type": "string",
            "description": "L'identifiant unique de l'employé"
          }
        },
        "required": ["employeeId"]
      },
      "action": {
        "type": "navigate",
        "urlTemplate": "/employees/{employeeId}/details"
      }
    }
  ]
}
```

---

## 🎬 Scénario de Démo Recommandé pour le Talk

### Site cible suggéré : `demo.guru99.com/test/newtours/`
*Demo Travel Agency — site de démo public, complexe, sans API*

Ou alternativement : n'importe quelle instance locale d'un vieux CMS / ERP de démo.

### Déroulé de la démo en live

1. **SANS l'extension** (30 secondes) :
   - Montrer l'agent IA face au site : screenshots, clics hésitants, 10-20 secondes par action
   - Montrer le coût en tokens (compteur visible)

2. **Activer l'extension** (10 secondes) :
   - Cliquer sur l'icône de l'extension → badge "WebMCP Activé ✅"
   - Recharger la page
   - Montrer dans la console : `[AgentAdapter] ✅ 3 tools WebMCP injectés`
   - Ouvrir le **Model Context Tool Inspector** (extension officielle Chrome Labs) pour visualiser les tools

3. **AVEC l'extension** (60 secondes) :
   - L'agent appelle directement `searchEmployees({query: "Martin"})`
   - Résultat instantané, structuré, en JSON
   - Montrer le gain de vitesse : **<1 seconde vs 10-15 secondes**
   - Comparer le nombre de tokens : vision = ~2000 tokens/action, WebMCP = ~50 tokens

---

## ⚙️ Tooling Recommandé

### Développement

```bash
# Initialiser le projet extension
npm init -y
npm install --save-dev @mcp-b/global  # Polyfill si besoin pour navigateurs sans flag
```

### Test et debug

- **Model Context Tool Inspector** (Chrome Web Store, extension officielle Chrome Labs) : visualise les tools enregistrés sur la page en temps réel
- **Console DevTools** : les logs `[AgentAdapter]` permettent de suivre l'injection
- Flag à activer : `chrome://flags/#webmcp-for-testing`

### Tester l'appel d'un tool depuis la console

```javascript
// Dans la console DevTools, tester un tool manuellement
const tools = navigator.modelContext; // Inspecter l'objet
// Les tools sont invoqués par l'agent via le protocole navigateur
// Pour tester sans agent : utiliser le Model Context Tool Inspector
```

---

## 🔒 Considérations de Sécurité (à mentionner dans le talk)

1. **Périmètre limité** : les tools ne peuvent que ce que le JS de la page peut faire (pas d'accès cross-origin)
2. **Consentement utilisateur** : `navigator.modelContext.requestUserInteraction()` permet de demander validation avant une action destructive
3. **Pas d'auto-submit par défaut** : les formulaires ne se soumettent pas sans clic utilisateur (sauf opt-in explicite)
4. **HTTPS requis** : `navigator.modelContext` est `[SecureContext]` — ne fonctionne pas en HTTP

---

## 📦 Checklist de Livraison

- [ ] `manifest.json` (Manifest V3, permission `world: MAIN`)
- [ ] `content.js` (vérification support, chargement config, registration)
- [ ] `injector.js` (buildExecutor avec tous les types d'actions)
- [ ] `dom-analyzer.js` (optionnel : analyse heuristique automatique)
- [ ] `configs/[site-cible].json` (config du site de démo)
- [ ] `popup/popup.html` + `popup.js` (UI simple : statut + tools actifs)
- [ ] Test de bout en bout sur Chrome 149+ avec Origin Trial
- [ ] Capture vidéo de la démo (backup si la démo live échoue)

---

## 🗣️ Key Messages pour le Talk

> "On n'a pas modifié une seule ligne du site cible. On a juste glissé une extension entre le navigateur et l'IA — et le site parle désormais WebMCP."

> "C'est le principe d'un adaptateur USB. Le site est le même. L'extension est le câble. Et l'agent IA branche enfin correctement."

> "Cette technique rend tout le web hérité automatisable — sans attendre que les éditeurs mettent à jour leur code."
