# PRD.md — WebMCP Agent Adapter

> Document produit. Décrit le problème, la valeur, les utilisateurs et le périmètre.
> Complément du `SPEC.md` (le « comment »). Ici : le « quoi » et le « pourquoi ».

## 1. Pitch

**Offrir une API aux applications web qui n'en ont pas.** Une extension Chrome qui rend
n'importe quel site — même ancien, même sans API, même dont on ne possède pas le code —
instantanément pilotable par un agent IA, et qui fournit l'agent qui le pilote, en langage
naturel.

## 2. Problème

Automatiser une interface web hostile (vieil ERP, site administratif, appli métier) n'offrait
que deux options, toutes deux mauvaises :

- **Scripts Playwright/Selenium** : fragiles, cassent au moindre changement de CSS/DOM, coûteux à
  maintenir.
- **Agents IA par vision** : lents, gourmands en tokens, peu fiables (ils « lisent » des pixels et
  devinent où cliquer).

Le standard WebMCP corrige ça côté site — un site déclare ses *tools* et l'agent les appelle au
lieu de scraper. Mais ça suppose que **le propriétaire du site coopère**. Or l'immense majorité
des sites n'adopteront jamais WebMCP, et l'utilisateur lambda n'a aucun moyen simple de piloter
les tools d'un site même quand ils existent.

## 3. Proposition de valeur

Combler **les deux moitiés manquantes** :

1. **Émetteur sans coopération du site** : injecter une couche WebMCP sur un site tiers via
   l'extension, par configuration ou par détection heuristique — le site devient « IA-compatible »
   sans toucher à son code.
2. **Consommateur grand public** : un chat intégré (side panel) où l'on tape une demande en
   français ; l'agent choisit le bon tool et l'exécute. Pas de console de dev, pas de client MCP à
   installer, pas de terminal.

Bénéfice mesurable : passer du scan de pixels au *tool calling* structuré donne un gain de vitesse
d'un ordre de grandeur, et une robustesse bien supérieure aux sélecteurs fragiles.

## 4. Utilisateurs cibles

| Persona | Besoin |
|---|---|
| Utilisateur métier non technique | Automatiser une tâche répétitive sur un outil interne sans savoir coder |
| Développeur / intégrateur | Donner une surface programmable à un site legacy sans API, rapidement |
| Équipe automatisation / RPA | Remplacer des scripts Selenium fragiles par des tools déclaratifs stables |

## 5. Cas d'usage

- *« Connecte-moi puis cherche un vol Paris → New York le 5 juillet »* → l'agent enchaîne les tools
  `login` puis `searchFlights` et renvoie la liste.
- *« Extrais le tableau des résultats »* → tool `scrape`.
- Site sans config : l'extension détecte formulaires/tables/boutons et propose des tools
  automatiquement.

## 6. Périmètre fonctionnel

**Inclus (aujourd'hui)**
- Injection de tools par **config par site** (`configs/*.json`) et par **détection heuristique** du DOM.
- Moteur d'actions : remplir/soumettre, scraper, cliquer, naviguer, multi-étapes, et **rejeu de
  formulaire via fetch** (rapide, sans navigation).
- Agent consommateur en **langage naturel** dans un side panel, propulsé par le **LLM embarqué de
  Chrome (Gemini Nano)** avec **repli automatique** sur un modèle hébergé.
- Popup de statut (WebMCP actif ? config trouvée ? tools enregistrés ?).

**Non-inclus / non-objectifs**
- Pas un serveur MCP back-end (WebMCP est côté navigateur, in-page).
- Pas un framework de scraping généraliste ni un contournement d'anti-bot / de signature de requête.
- Pas de planification multi-étapes complexe par le LLM (un tool par tour pour l'instant).
- Pas de support mobile (Prompt API desktop only).

## 7. Critères de succès

- Un utilisateur non technique réalise une tâche multi-étapes sur un site cible **sans toucher au
  code ni à des outils de dev**.
- Une même tâche est **nettement plus rapide** via tool calling (`remote_form_submit`) que via
  pilotage DOM/navigation — démontrable chrono à l'appui.
- Le routage en **français** fonctionne (Nano si dispo, sinon fallback) sur la machine de démo.
- Ajouter le support d'un nouveau site = écrire une config, sans modifier le moteur.

## 8. Contexte & priorités

Le produit sert de support à une conférence (SunnyTech, juillet 2026) : il illustre « le mur du
DOM », WebMCP 101, l'« Agent Adapter Hack » (injection sur site tiers), la **Performance** (x10 via
tool calling vs scan de pixels) et une **démo live**. La priorité court terme est donc la
**fiabilité en démo** (déterminisme, repli, prompts FR testés) plus que l'exhaustivité.

## 9. Pistes d'évolution

- **Build des configs** : générer `configs-bundle.js` depuis `configs/*.json` (supprimer la double
  source).
- **Injection d'annotations déclaratives** WebMCP (`toolname`/`tooldescription`) sur les formulaires
  existants du site, en complément des tools impératifs.
- **Service worker** pour ouvrir le side panel de façon robuste (`openPanelOnActionClick`).
- **Apprentissage de tool** : observer une action réelle (intercepteur fetch/XHR) pour générer
  automatiquement un `remote_form_submit` paramétré.
- **Multi-étapes piloté par le LLM** quand le modèle/contexte le permet.
- **Bibliothèque de configs** pour des sites cibles courants.
