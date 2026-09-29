# HANDOFF — WebMCP Anywhere (extension Chrome)

Objectif de la prochaine session : **reprendre l'extension WebMCP Anywhere et la faire évoluer**.
Le propriétaire veut qu'un collègue puisse s'en inspirer et l'étendre.

## Où est quoi

- Repo GitHub : `git@github.com:keabard/web-mcp-conference.git`, branche `main`.
- Clone local : `/Users/wescale/dev/sunnytech/web-mcp`. Le repo git a été initialisé **à la racine
  de ce dossier**, pas dans le sous-dossier du même nom.
- Code de l'extension : `webmcp-anywhere-extension/`.

## À lire en premier (ne pas dupliquer, s'y référer)

| Fichier | Contenu |
|---|---|
| `README.md` (racine) | Vue d'ensemble à jour : installation, flux, format des configs, table des 10 types d'actions, sites configurés, limites/pistes d'évolution. Réécrit à partir du code dans cette session. |
| `webmcp-anywhere-extension/SPEC.md` | Contrats internes, flux détaillé, pièges connus. Référence technique la plus précise. **Attention** : sa table des actions (§5) n'en liste que 7 ; `slow_type`, `fetch_and_scrape` et `fetch_nextdata` n'y figurent pas (ils sont dans le README). |
| `webmcp-anywhere-extension/PRD.md` | Pitch, cas d'usage, critères de succès, pistes d'évolution (§9). |
| `webmcp-anywhere-extension/agent/README.md` | Agent du side panel, contrat du proxy de repli sur `localhost:8787/route`, pièges de Gemini Nano. |
| `webmcp-anywhere-extension/CLAUDE.md` | **Instructions d'agent obligatoires** : workflow via Chrome DevTools MCP, synchronisation JSON → bundle, appel des tools via `window.__agentAdapterExecute`. |
| `Sunny Tech 2026 - WebMCP.pdf` | Slides du talk dont vient l'extension. |
| `git log` | 4 commits : l'extension, le PDF, la réécriture du README, la suppression des logs de debug. |

## Faits établis dans cette session (non évidents)

- **Pas de polyfill `@mcp-b/global`**. L'ancien doc de conception (`AGENT_ADAPTER_HACK.md`, renommé
  et réécrit en `README.md`) le mentionnait à tort. Le code n'utilise que l'API native
  `document.modelContext || navigator.modelContext`.
- **Aucun build, aucun `package.json`, aucun test.** C'est du JavaScript brut chargé en unpacked.
  Toute vérification passe par un vrai Chrome : flag WebMCP activé, extension rechargée après
  chaque modification.
- **Double source des configs** : `configs/*.json` sert de référence éditable, mais seul
  `configs-bundle.js` (`AGENT_ADAPTER_CONFIGS`) est chargé. Les 5 configs sont actuellement
  présentes dans les deux. C'est la dette n°1 : un script de build qui génère le bundle.
- **Préfixe historique** : le projet s'appelait « Agent Adapter Hack », d'où les identifiants
  `[AgentAdapter]`, `__agentAdapterState`, `__agentAdapterExecute`, `__agentAdapterPending` et
  `__agentAdapterResume`. `SPEC.md`, `PRD.md` et `CLAUDE.md` l'appellent encore « WebMCP Agent
  Adapter ». Le manifest dit « WebMCP Anywhere ». Un renommage est possible, mais les clés
  `sessionStorage` et `window.*` sont couplées entre `content.js`, `injector.js`, `popup.js` et
  `agent/bridge.js`.
- `executeTool()` de WebMCP ne fonctionne pas depuis un script de page (preview Chrome), d'où
  `window.__agentAdapterExecute`, sur lequel repose `agent/bridge.js`.
- Les tools **agissent sans confirmation** (soumission, navigation). Aucune demande de consentement
  n'est implémentée.

## Conventions

- Docs et commentaires en **français**. Les fichiers de `agent/` ont des commentaires en anglais :
  suivre la langue du fichier modifié.
- Commits courts en anglais, terminés par la ligne `Co-Authored-By` de l'environnement.
- Le propriétaire valide avant chaque push. Dans cette session, il demandait « commit et push »
  explicitement.

## Pistes d'évolution

Voir `README.md` § « Limites connues et pistes d'évolution » et `PRD.md` §9. Candidats les plus
rentables :

1. Script de génération de `configs-bundle.js` depuis `configs/*.json` (supprime la
   synchronisation manuelle).
2. Mettre à jour la table §5 de `SPEC.md` avec les 3 actions manquantes.
3. Ajouter une confirmation utilisateur pour les tools destructifs (soumission, navigation).
4. Un service worker avec `setPanelBehavior({ openPanelOnActionClick: true })` (SPEC §9.2).

## Skills suggérés

Les skills `webmcp-build` et `webmcp-run` sont copiés dans `skills/` : les installer (par ex. dans `~/.claude/skills/`) s'ils ne sont pas déjà disponibles.

- `chrome-extensions` : Manifest V3, content scripts en world MAIN, side panel, permissions.
- `webmcp-build` : écrire ou déboguer les tools `modelContext` et le comportement de la preview
  Chrome.
- `webmcp-run` : exigé par `webmcp-anywhere-extension/CLAUDE.md` avant toute interaction avec une
  webapp (`getTools()` est asynchrone).
- `chrome-devtools` : charger ou recharger l'extension et tester les tools via `evaluate_script`.
- `code-review` : avant de pousser une évolution significative.
