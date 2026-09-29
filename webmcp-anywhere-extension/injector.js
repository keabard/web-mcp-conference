/**
 * injector.js — Constructeur d'exécuteurs d'actions DOM
 *
 * Chargé en world: MAIN avant content.js.
 * Expose buildExecutor() comme global utilisé par content.js.
 *
 * Types d'actions supportés :
 *   fill_and_submit    — remplir un ou plusieurs champs et soumettre le formulaire
 *   scrape             — extraire des données structurées du DOM
 *   click              — cliquer sur un élément (sélecteur statique ou par template)
 *   navigate           — naviguer vers une URL construite depuis un template
 *   multi_step         — enchaîner plusieurs actions dans l'ordre
 *   navigate_then_fill — naviguer vers une page si nécessaire, puis remplir le formulaire
 *                        (utilise sessionStorage pour traverser la navigation)
 *   remote_form_submit — soumet un formulaire via fetch (sans navigation de page),
 *                        parse la réponse HTML et retourne les résultats directement
 *   slow_type          — saisit un texte caractère par caractère (InputEvent) pour déclencher
 *                        les autocomplètes jQuery UI / Angular ; clique ensuite la suggestion
 */

function buildExecutor(action) {
  return async function execute(args) {
    switch (action.type) {

      case 'fill_and_submit': {
        const fieldDefs = action.fields ?? [{ selector: action.selector, argKey: action.argKey }];

        // Attendre que le premier champ requis apparaisse (utile quand un clic précédent révèle le champ dynamiquement)
        if (action.waitForFirstFieldMs) {
          const firstRequired = fieldDefs.find(f => !f.optional);
          if (firstRequired) {
            const deadline = Date.now() + action.waitForFirstFieldMs;
            while (!document.querySelector(firstRequired.selector) && Date.now() < deadline) {
              await sleep(150);
            }
          }
        }

        for (const field of fieldDefs) {
          if (field.optional && !(field.argKey in args)) continue;

          const rawValue = args[field.argKey];
          if (rawValue === undefined || rawValue === null) {
            if (!field.optional) throw new Error(`Argument manquant : ${field.argKey}`);
            continue;
          }
          const value = String(rawValue);
          const el = document.querySelector(field.selector);

          if (!el) {
            if (!field.optional) throw new Error(`Élément non trouvé : ${field.selector}`);
            continue;
          }

          fillElement(el, field.selector, value);
        }

        const submitBtn = action.submitSelector
          ? document.querySelector(action.submitSelector)
          : null;

        if (submitBtn) {
          submitBtn.click();
        } else {
          const firstSelector = fieldDefs[0]?.selector;
          const firstEl = firstSelector ? document.querySelector(firstSelector) : null;
          if (firstEl?.form) firstEl.form.submit();
        }

        await sleep(action.waitMs ?? 1000);

        if (action.resultSelector) {
          const data = scrapeTable(action.resultSelector);
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }
        return { content: [{ type: 'text', text: 'Action effectuée avec succès' }] };
      }

      case 'scrape': {
        const container = findFirst(action.selector);
        if (!container) return { content: [{ type: 'text', text: '[]' }] };

        let data;
        if (action.format === 'table') {
          data = scrapeTable(action.selector);
        } else if (action.format === 'list') {
          data = scrapeList(action.selector, action.fields);
        } else {
          data = { text: container.innerText.trim().slice(0, 4000) };
        }

        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }

      case 'click': {
        // Sauter ce clic si un élément sentinelle est déjà présent (évite de réinitialiser un état SPA déjà chargé)
        if (action.skipIfPresent && document.querySelector(action.skipIfPresent)) {
          return { content: [{ type: 'text', text: 'Clic ignoré (élément cible déjà présent)' }] };
        }
        let target;
        if (action.selectorTemplate) {
          const resolved = action.selectorTemplate.replace(/\{(\w+)\}/g, (_, key) => {
            return CSS.escape(String(args[key] ?? ''));
          });
          target = document.querySelector(resolved);
        } else if (action.selectorRaw) {
          // Substitution brute sans CSS.escape — utile pour [id='..._{val}'] où la valeur contient des points
          const resolved = action.selectorRaw.replace(/\{(\w+)\}/g, (_, key) => String(args[key] ?? ''));
          target = document.querySelector(resolved);
        } else if (action.selectorByText) {
          const { tag = '*', argKey, waitForMs = 0, fuzzy = false } = action.selectorByText;
          const text = String(args[argKey] ?? '').toLowerCase();
          const findTarget = () => {
            const candidates = [...document.querySelectorAll(tag)];
            if (!candidates.length) return null;
            if (fuzzy) {
              // Score par mots communs ; retourne null si aucun mot ne matche (pour que waitForMs puisse attendre l'apparition des éléments)
              const words = text.split(/\s+/).filter(Boolean);
              let best = null, bestScore = 0;
              for (const el of candidates) {
                const elText = el.textContent.trim().toLowerCase();
                const score = words.reduce((n, w) => n + (elText.includes(w) ? 1 : 0), 0);
                if (score > bestScore) { bestScore = score; best = el; }
              }
              return best;
            }
            return candidates.find(el => el.textContent.trim().toLowerCase().includes(text)) ?? null;
          };
          if (waitForMs > 0) {
            const deadline = Date.now() + waitForMs;
            while (!target && Date.now() < deadline) {
              target = findTarget();
              if (!target) await sleep(200);
            }
          } else {
            target = findTarget();
          }
        } else {
          target = document.querySelector(action.selector);
        }

        if (!target) throw new Error(`Élément cliquable non trouvé`);
        target.click();
        await sleep(action.waitMs ?? 500);

        if (action.resultSelector) {
          const data = scrapeTable(action.resultSelector);
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        }
        return { content: [{ type: 'text', text: 'Clic effectué' }] };
      }

      case 'navigate': {
        const url = action.urlTemplate.replace(/\{(\w+)\}/g, (_, key) =>
          String(args[key] ?? '')
        );
        window.location.href = url;
        return { content: [{ type: 'text', text: `Navigation vers : ${url}` }] };
      }

      case 'navigate_then_fill': {
        // Si le formulaire est déjà sur la page, exécuter directement le fill
        const alreadyOnPage = action.checkSelector
          ? !!document.querySelector(action.checkSelector)
          : false;

        if (alreadyOnPage) {
          const fillExecutor = buildExecutor({
            type: 'fill_and_submit',
            fields: action.fields,
            submitSelector: action.submitSelector,
            waitMs: action.waitMs,
            resultSelector: action.resultSelector
          });
          return await fillExecutor(args);
        }

        // Stocker les args dans sessionStorage pour reprise après navigation
        sessionStorage.setItem('__agentAdapterPending', JSON.stringify({
          toolName: action.toolName,
          waitForSelector: action.checkSelector ?? null,
          args
        }));
        window.location.href = action.url;
        return { content: [{ type: 'text', text: `Navigation vers ${action.url}, exécution différée…` }] };
      }

      case 'multi_step': {
        const results = [];
        const steps = action.steps;

        // Si une URL est requise et qu'on n'y est pas, naviguer d'abord et reprendre après
        if (action.requireUrl && !location.href.includes(action.requireUrl)) {
          sessionStorage.setItem('__agentAdapterResume', JSON.stringify({
            steps,
            args,
            waitFor: action.requireUrlWaitFor ?? null
          }));
          window.location.href = action.requireUrlTarget ?? action.requireUrl;
          return { content: [{ type: 'text', text: `Navigation vers ${action.requireUrlTarget ?? action.requireUrl}, reprise du formulaire après chargement…` }] };
        }

        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          if (step.crossPage) {
            // Sauvegarder les steps restants avant la navigation (le contexte JS sera détruit)
            sessionStorage.setItem('__agentAdapterResume', JSON.stringify({
              steps: steps.slice(i + 1),
              args,
              waitFor: step.crossPageWaitFor || null
            }));
          }
          const stepExecutor = buildExecutor(step);
          const result = await stepExecutor(args);
          results.push(result);
          if (step.stopOnResult && result.content?.[0]?.text) break;
        }
        const combined = results.map(r => r.content?.[0]?.text ?? '').join('\n---\n');
        return { content: [{ type: 'text', text: combined }] };
      }

      case 'slow_type': {
        const el = document.querySelector(action.selector);
        if (!el) {
          if (action.optional) return { content: [{ type: 'text', text: 'Champ non trouvé (optionnel)' }] };
          throw new Error(`Élément non trouvé : ${action.selector}`);
        }
        const value = action.value !== undefined
          ? String(action.value)
          : String(args[action.argKey ?? ''] ?? '');
        const nativeSetter = el instanceof HTMLInputElement
          ? Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
          : null;
        el.focus();
        el.click();
        if (nativeSetter) nativeSetter.call(el, ''); else el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        for (const ch of value) {
          const keyCode = ch.toUpperCase().charCodeAt(0);
          // Séquence clavier complète pour déclencher les autocomplètes Angular/jQuery
          el.dispatchEvent(new KeyboardEvent('keydown',  { key: ch, keyCode, which: keyCode, bubbles: true, cancelable: true }));
          if (nativeSetter) nativeSetter.call(el, el.value + ch); else el.value += ch;
          el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
          el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, keyCode, which: keyCode, charCode: keyCode, bubbles: true, cancelable: true }));
          el.dispatchEvent(new KeyboardEvent('keyup',    { key: ch, keyCode, which: keyCode, bubbles: true }));
          await sleep(action.charDelayMs ?? 80);
        }
        await sleep(action.waitMs ?? 2000);
        if (action.suggestionSelector) {
          const sug = document.querySelector(action.suggestionSelector);
          if (sug) { sug.click(); await sleep(500); }
        }
        if (action.submitSelector) {
          const btn = document.querySelector(action.submitSelector);
          if (btn && !btn.disabled) { btn.click(); await sleep(action.submitWaitMs ?? 1000); }
        }
        return { content: [{ type: 'text', text: `Texte saisi : ${value}` }] };
      }

      case 'remote_form_submit': {
        // Charger la page du formulaire via fetch (pas de navigation du navigateur)
        const pageResp = await fetch(action.formUrl, { credentials: 'same-origin' });
        if (!pageResp.ok) throw new Error(`Impossible de charger le formulaire (HTTP ${pageResp.status})`);

        const pageDoc = new DOMParser().parseFromString(await pageResp.text(), 'text/html');
        const form = pageDoc.querySelector(action.formSelector ?? 'form');
        if (!form) throw new Error('Formulaire non trouvé sur ' + action.formUrl);

        // Collecter les valeurs par défaut (selects, radios cochés, champs cachés)
        const params = new URLSearchParams();
        for (const el of form.elements) {
          if (!el.name || el.disabled) continue;
          if ((el.type === 'radio' || el.type === 'checkbox') && !el.checked) continue;
          if (el.type === 'submit') continue;
          params.set(el.name, el.value ?? '');
        }

        // Écraser avec les arguments fournis
        for (const field of action.fields ?? []) {
          if (field.optional && !(field.argKey in args)) continue;
          const rawValue = args[field.argKey];
          if (rawValue === undefined || rawValue === null) continue;
          const strValue = String(rawValue);

          const el = pageDoc.querySelector(field.selector);
          if (!el) {
            if (!field.optional) throw new Error(`Champ non trouvé : ${field.selector}`);
            continue;
          }

          if (el.tagName === 'SELECT') {
            const options = [...el.options];
            const match =
              options.find(o => o.value === strValue) ??
              options.find(o => o.text.trim().toLowerCase() === strValue.toLowerCase()) ??
              options.find(o => o.text.trim().toLowerCase().startsWith(strValue.toLowerCase()));
            params.set(el.name, match ? match.value : strValue);
          } else if (el.type === 'radio') {
            const group = pageDoc.querySelectorAll(`[name="${CSS.escape(el.name)}"]`);
            const radio = [...group].find(r => r.value === strValue)
              ?? [...group].find(r => r.value.toLowerCase() === strValue.toLowerCase());
            if (radio) params.set(el.name, radio.value);
          } else {
            params.set(el.name, strValue);
          }
        }

        // Inclure le bouton submit (certains backends PHP le vérifient)
        if (action.submitName) params.set(action.submitName, action.submitValue ?? '');

        // Soumettre
        const method = (form.getAttribute('method') || 'GET').toUpperCase();
        const formAction = new URL(form.getAttribute('action') || action.formUrl, action.formUrl).href;

        const fetchOpts = { credentials: 'same-origin' };
        let fetchUrl = formAction;
        if (method === 'POST') {
          fetchOpts.method = 'POST';
          fetchOpts.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
          fetchOpts.body = params.toString();
        } else {
          fetchUrl = `${formAction}?${params}`;
        }

        const resultResp = await fetch(fetchUrl, fetchOpts);
        if (!resultResp.ok) throw new Error(`Erreur lors de la soumission (HTTP ${resultResp.status})`);

        const resultDoc = new DOMParser().parseFromString(await resultResp.text(), 'text/html');

        if (action.resultSelector) {
          const table = findFirstInDoc(resultDoc, action.resultSelector);
          if (table) {
            return { content: [{ type: 'text', text: JSON.stringify(scrapeTableFromElement(table), null, 2) }] };
          }
        }

        // Aucun siège disponible sur ce site démo
        if (resultDoc.body?.textContent?.includes('No Seats Avaialble')) {
          return { content: [{ type: 'text', text: '[]' }] };
        }

        // Fallback : extraire le contenu textuel utile de la page de résultats.
        const seen = new Set();
        const lines = [];
        for (const el of resultDoc.querySelectorAll('font, p, h1, h2, h3, td')) {
          const text = el.textContent.replace(/\s+/g, ' ').trim();
          if (text.length < 8 || seen.has(text)) continue;
          seen.add(text);
          lines.push(text);
          if (lines.join('\n').length > 3000) break;
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      case 'fetch_nextdata': {
        const tpl0 = action.urlTemplate ?? '';
        const isBareUrl0 = /^\{[^}]+\}$/.test(tpl0.trim());

        // Appliquer les valueMaps sur les args avant substitution
        const mappedArgs = { ...args };
        for (const [argKey, map] of Object.entries(action.valueMaps ?? {})) {
          const rawVal = String(mappedArgs[argKey] ?? '');
          if (rawVal && map[rawVal] !== undefined) mappedArgs[argKey] = map[rawVal];
        }

        // Substituer les {placeholders} du template
        let fetchUrl0 = tpl0.replace(/\{(\w+)\}/g, (_, key) => {
          const val = String(mappedArgs[key] ?? action.defaults?.[key] ?? '');
          return isBareUrl0 ? val : encodeURIComponent(val);
        });

        // Construire l'URL et ajouter les rangeParams (format min-max)
        try {
          const u = new URL(fetchUrl0, location.href);
          for (const [urlParam, [minKey, maxKey]] of Object.entries(action.rangeParams ?? {})) {
            const rawMin = mappedArgs[minKey];
            const rawMax = mappedArgs[maxKey];
            // Ignorer 0 et valeurs vides (0 = "non renseigné" pour km/prix/année)
            const minVal = (rawMin !== undefined && rawMin !== null && rawMin !== 0 && rawMin !== '') ? String(rawMin).trim() : '';
            const maxVal = (rawMax !== undefined && rawMax !== null && rawMax !== 0 && rawMax !== '') ? String(rawMax).trim() : '';
            if (minVal || maxVal) {
              u.searchParams.set(urlParam, `${minVal || 'min'}-${maxVal || 'max'}`);
            }
          }
          // Supprimer les params vides
          for (const [k, v] of [...u.searchParams.entries()]) {
            if (v === '') u.searchParams.delete(k);
          }
          fetchUrl0 = u.href;
        } catch { /* URL relative, on laisse */ }

        const resp0 = await fetch(fetchUrl0, { credentials: 'same-origin' });
        if (!resp0.ok) throw new Error(`HTTP ${resp0.status} — ${fetchUrl0}`);

        const html0 = await resp0.text();
        const doc0 = new DOMParser().parseFromString(html0, 'text/html');
        const nextEl = doc0.getElementById('__NEXT_DATA__');
        if (!nextEl) throw new Error('Page non compatible Next.js (pas de __NEXT_DATA__)');

        const pageData = JSON.parse(nextEl.textContent);

        // Naviguer vers action.dataPath
        let target = pageData;
        if (action.dataPath) {
          for (const key of action.dataPath.split('.')) { target = target?.[key]; }
        }

        // Trouver le tableau en cherchant un tableau dont le premier item a la clé donnée
        if (action.findArrayByKey) {
          const findArr = (obj, d = 0) => {
            if (d > 8 || !obj) return null;
            if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === 'object' && obj[0] !== null && action.findArrayByKey in obj[0]) return obj;
            if (typeof obj === 'object' && !Array.isArray(obj)) {
              for (const k of Object.keys(obj)) { const r = findArr(obj[k], d + 1); if (r) return r; }
            }
            return null;
          };
          const found = findArr(target);
          if (!found) {
            return { content: [{ type: 'text', text: JSON.stringify({ resultats: 0, message: 'Aucune annonce trouvée pour ces critères.', url: fetchUrl0 }) }] };
          }
          target = found;
        }

        // Mapper les champs avec des chemins dot-notation
        if (action.mapFields && Array.isArray(target)) {
          const limit = action.limit ?? 25;
          target = target.slice(0, limit).map(item => {
            // Aplatir les champs-tableaux (ex: attributes: [{key,value_label}...]) en objet
            let flatItem = item;
            if (action.flattenArrayKey && Array.isArray(item[action.flattenArrayKey])) {
              const flatMap = {};
              for (const entry of item[action.flattenArrayKey]) {
                if (entry?.key) flatMap[entry.key] = entry;
              }
              flatItem = { ...item, [action.flattenArrayKey]: flatMap };
            }
            const obj = {};
            for (const [outKey, pathStr] of Object.entries(action.mapFields)) {
              const parts = pathStr.split('.');
              let val = flatItem;
              for (const p of parts) { val = val?.[p]; if (val === undefined) break; }
              if (val !== undefined && val !== null) obj[outKey] = val;
            }
            return obj;
          });
        }

        const text0 = JSON.stringify(target, null, 2);
        return { content: [{ type: 'text', text: text0.slice(0, 16000) }] };
      }

      case 'fetch_and_scrape': {
        // Construire l'URL depuis le template
        const tpl = action.urlTemplate ?? action.url ?? '';
        // Si le template est exactement un seul placeholder (ex: "{deckUrl}"), ne pas encoder
        const isBareUrl = /^\{[^}]+\}$/.test(tpl.trim());
        let fetchUrl = tpl.replace(/\{(\w+)\}/g, (_, key) => {
          const val = String(args[key] ?? action.defaults?.[key] ?? '');
          return isBareUrl ? val : encodeURIComponent(val);
        });

        // Supprimer les paramètres vides pour ne pas polluer l'URL
        try {
          const u = new URL(fetchUrl);
          for (const [k, v] of [...u.searchParams.entries()]) {
            if (v === '') u.searchParams.delete(k);
          }
          fetchUrl = u.href;
        } catch { /* URL relative ou invalide, on laisse tel quel */ }

        const resp = await fetch(fetchUrl, { credentials: 'same-origin' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} pour ${fetchUrl}`);

        const doc = new DOMParser().parseFromString(await resp.text(), 'text/html');

        if (action.resultSelector) {
          if (action.format === 'list') {
            // Collecter tous les éléments correspondants et retourner leur texte
            const items = [...doc.querySelectorAll(action.resultSelector)]
              .map(el => el.textContent.trim().replace(/\s+/g, ' '))
              .filter(t => t.length > 1);
            return { content: [{ type: 'text', text: items.join('\n').slice(0, 6000) }] };
          }
          const el = findFirstInDoc(doc, action.resultSelector);
          if (el) {
            if (action.format === 'text') {
              return { content: [{ type: 'text', text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 6000) }] };
            }
            let rows = scrapeTableFromElement(el, fetchUrl);

            // Post-filtrage par nombre d'exemplaires dans la decklist du deck
            if (action.deckCopiesFilter && rows.length > 0) {
              const { cardArg, minArg, deckUrlField = 'url', deckSelector = 'table', deckColNames, cardNameCol = 'name', countCol = 'count' } = action.deckCopiesFilter;
              const cardQuery = String(args[cardArg] ?? '').toLowerCase().trim();
              const minCopies = parseInt(String(args[minArg] ?? '0'), 10);
              if (cardQuery && minCopies > 0) {
                const kept = [];
                for (const row of rows) {
                  const deckUrl = row[deckUrlField];
                  if (!deckUrl) { kept.push(row); continue; }
                  try {
                    const deckResp = await fetch(deckUrl, { credentials: 'same-origin' });
                    if (!deckResp.ok) { kept.push(row); continue; }
                    const deckDoc = new DOMParser().parseFromString(await deckResp.text(), 'text/html');
                    const deckTable = findFirstInDoc(deckDoc, deckSelector);
                    if (!deckTable) { kept.push(row); continue; }
                    let deckRows = scrapeTableFromElement(deckTable, deckUrl);
                    if (deckColNames && deckRows.length > 0) {
                      const maxRow = deckRows.reduce((a, b) => Object.keys(a).length >= Object.keys(b).length ? a : b);
                      const oldKeys = Object.keys(maxRow).filter(k => k !== 'url');
                      const keyMap = {};
                      oldKeys.forEach((k, i) => { if (deckColNames[i]) keyMap[k] = deckColNames[i]; });
                      deckRows = deckRows.map(r => {
                        const obj = {};
                        for (const [k, v] of Object.entries(r)) obj[keyMap[k] ?? k] = v;
                        return obj;
                      });
                    }
                    const matchingRows = deckRows.filter(r => String(r[cardNameCol] ?? '').toLowerCase().includes(cardQuery));
                    const maxCount = matchingRows.reduce((max, r) => Math.max(max, parseInt(String(r[countCol] ?? '0'), 10)), 0);
                    if (maxCount >= minCopies) kept.push(row);
                  } catch {
                    kept.push(row);
                  }
                }
                rows = kept;
              }
            }

            if (action.colNames && rows.length > 0) {
              const maxRow = rows.reduce((a, b) => Object.keys(a).length >= Object.keys(b).length ? a : b);
              const oldKeys = Object.keys(maxRow).filter(k => k !== 'url');
              const keyMap = {};
              oldKeys.forEach((k, i) => { if (action.colNames[i]) keyMap[k] = action.colNames[i]; });
              const remapped = rows.map(row => {
                const obj = {};
                for (const [k, v] of Object.entries(row)) {
                  obj[k === 'url' ? 'url' : (keyMap[k] ?? k)] = v;
                }
                return obj;
              });
              return { content: [{ type: 'text', text: JSON.stringify(remapped, null, 2) }] };
            }
            return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
          }
        }
        return { content: [{ type: 'text', text: (doc.body?.textContent ?? '').trim().slice(0, 6000) }] };
      }

      default:
        throw new Error(`Type d'action inconnu : ${action.type}`);
    }
  };
}

// --- Helpers ---

function fillElement(el, selector, value) {
  if (el.tagName === 'INPUT' && el.type === 'radio') {
    // Radio : trouver le bouton avec la valeur correspondante
    const radio = document.querySelector(`${selector}[value='${CSS.escape(value)}']`);
    if (radio) {
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } else if (el.tagName === 'SELECT') {
    // Select : correspondance exacte sur value, puis sur le texte de l'option
    const options = [...el.options];
    const match =
      options.find(o => o.value === value) ??
      options.find(o => o.text.trim().toLowerCase() === value.toLowerCase()) ??
      options.find(o => o.text.trim().toLowerCase().startsWith(value.toLowerCase()));
    el.value = match ? match.value : value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    // Champ texte — nativeSetter pour contourner le gel de propriété des frameworks (Angular, React)
    const setter = el instanceof HTMLInputElement
      ? Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      : el instanceof HTMLTextAreaElement
        ? Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
        : null;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function findFirst(selector) {
  const parts = selector.split(',').map(s => s.trim());
  for (const s of parts) {
    try {
      const el = document.querySelector(s);
      if (el) return el;
    } catch {
      // sélecteur CSS invalide, on passe au suivant
    }
  }
  return null;
}

function scrapeTable(selector) {
  const table = findFirst(selector);
  if (!table) return [];

  const tagToUse = table.tagName === 'TABLE' ? table : table.querySelector('table');
  if (!tagToUse) return [{ text: table.innerText.trim() }];

  const headerCells = tagToUse.querySelectorAll('thead th, thead td');
  const headers = headerCells.length > 0
    ? [...headerCells].map(th => th.innerText.trim())
    : [...(tagToUse.querySelector('tr')?.querySelectorAll('th, td') ?? [])].map(c => c.innerText.trim());

  const dataRows = headerCells.length > 0
    ? tagToUse.querySelectorAll('tbody tr')
    : [...tagToUse.querySelectorAll('tr')].slice(1);

  return [...dataRows].map(row =>
    [...row.querySelectorAll('td')].reduce((obj, td, i) => {
      obj[headers[i] ?? `col${i}`] = td.innerText.trim();
      return obj;
    }, {})
  ).filter(row => Object.values(row).some(v => v !== ''));
}

function scrapeList(selector, fieldMap) {
  return [...document.querySelectorAll(selector)].map(el => {
    if (!fieldMap) return { text: el.innerText.trim() };
    return Object.fromEntries(
      Object.entries(fieldMap).map(([key, subSel]) => [
        key,
        el.querySelector(subSel)?.innerText.trim() ?? ''
      ])
    );
  });
}

function findFirstInDoc(doc, selector) {
  const parts = selector.split(',').map(s => s.trim());
  for (const s of parts) {
    try {
      const el = doc.querySelector(s);
      if (el) return el;
    } catch { /* sélecteur CSS invalide */ }
  }
  return null;
}

function scrapeTableFromElement(table, baseUrl) {
  const tagToUse = table.tagName === 'TABLE' ? table : table.querySelector('table');
  if (!tagToUse) return [{ text: table.textContent.trim() }];

  const headerCells = tagToUse.querySelectorAll('thead th, thead td');
  const headers = headerCells.length > 0
    ? [...headerCells].map(th => th.textContent.trim())
    : [...(tagToUse.querySelector('tr')?.querySelectorAll('th, td') ?? [])].map(c => c.textContent.trim());

  const dataRows = headerCells.length > 0
    ? tagToUse.querySelectorAll('tbody tr')
    : [...tagToUse.querySelectorAll('tr')].slice(1);

  return [...dataRows].map(row => {
    const obj = [...row.querySelectorAll('td')].reduce((obj, td, i) => {
      obj[headers[i] ?? `col${i}`] = td.textContent.trim();
      return obj;
    }, {});
    // Inclure l'URL du premier lien de la ligne (utile pour les listes de decks, etc.)
    const rawHref = row.querySelector('a[href]')?.getAttribute('href');
    if (rawHref) {
      try { obj['url'] = new URL(rawHref, baseUrl || location.href).href; } catch { /* lien invalide */ }
    }
    return obj;
  }).filter(row => Object.values(row).some(v => v !== ''));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
