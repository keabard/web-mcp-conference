/**
 * dom-analyzer.js — Analyse heuristique automatique du DOM
 *
 * Chargé en world: MAIN. Expose analyzeDOMForTools() comme global.
 * Appelé par content.js quand aucune config spécifique n'est trouvée pour le site.
 *
 * Heuristiques :
 *   - Formulaires avec champs visibles → tools fill_and_submit
 *   - Tables avec en-têtes               → tools scrape (table)
 *   - Boutons hors formulaire            → tools click
 */

function analyzeDOMForTools() {
  const tools = [];

  analyzeFormsIntoTools(tools);
  analyzeTablesIntoTools(tools);
  analyzeButtonsIntoTools(tools);

  return tools;
}

function analyzeFormsIntoTools(tools) {
  document.querySelectorAll('form').forEach((form, formIndex) => {
    const inputs = [...form.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea'
    )].filter(el => el.offsetParent !== null); // visibles uniquement

    if (inputs.length === 0) return;

    const submitBtn =
      form.querySelector('[type="submit"]') ??
      form.querySelector('button:not([type="button"]):not([type="reset"])') ??
      null;

    const properties = {};
    const fieldDefs = [];

    inputs.forEach(input => {
      const rawKey = input.name || input.id || `field${fieldDefs.length}`;
      const argKey = rawKey.replace(/[^a-zA-Z0-9]/g, '_');
      const label =
        document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent.trim() ||
        input.placeholder ||
        input.getAttribute('aria-label') ||
        argKey;

      let type = 'string';
      if (input.type === 'number') type = 'number';

      properties[argKey] = { type, description: `Valeur pour le champ : ${label}` };

      const selector = input.name
        ? `[name="${input.name}"]`
        : input.id
          ? `#${CSS.escape(input.id)}`
          : null;

      if (selector) fieldDefs.push({ selector, argKey });
    });

    if (fieldDefs.length === 0) return;

    const formId = form.id ? `#${form.id}` : `form:nth-of-type(${formIndex + 1})`;
    const submitSelector = submitBtn
      ? (submitBtn.name
          ? `[name="${submitBtn.name}"]`
          : submitBtn.id
            ? `#${CSS.escape(submitBtn.id)}`
            : `${formId} [type="submit"]`)
      : null;

    tools.push({
      name: `fillForm${formIndex + 1}`,
      description: `Remplit et soumet le formulaire ${formIndex + 1}. Champs : ${Object.keys(properties).join(', ')}`,
      inputSchema: {
        type: 'object',
        properties,
        required: []
      },
      action: {
        type: 'fill_and_submit',
        fields: fieldDefs,
        submitSelector,
        waitMs: 1500
      }
    });
  });
}

function analyzeTablesIntoTools(tools) {
  document.querySelectorAll('table').forEach((table, i) => {
    const headerCells = table.querySelectorAll('thead th, thead td');
    const firstRowCells = headerCells.length === 0
      ? table.querySelector('tr')?.querySelectorAll('th')
      : null;

    const headers = [
      ...(headerCells.length > 0 ? headerCells : firstRowCells ?? [])
    ].map(c => c.textContent.trim()).filter(Boolean);

    if (headers.length === 0) return;

    const hasData = table.querySelectorAll('tbody tr, tr:not(:first-child)').length > 0;
    if (!hasData) return;

    const selector = table.id
      ? `#${CSS.escape(table.id)}`
      : `table:nth-of-type(${i + 1})`;

    tools.push({
      name: `scrapeTable${i + 1}`,
      description: `Extrait les données du tableau ${i + 1} (colonnes : ${headers.slice(0, 4).join(', ')}${headers.length > 4 ? '…' : ''})`,
      inputSchema: { type: 'object', properties: {} },
      action: {
        type: 'scrape',
        selector,
        format: 'table'
      }
    });
  });
}

function analyzeButtonsIntoTools(tools) {
  const standaloneButtons = [...document.querySelectorAll('button, [role="button"], a.btn, a.button')]
    .filter(btn => {
      if (btn.tagName === 'BUTTON' && btn.form) return false; // déjà couvert par les formulaires
      if (btn.tagName === 'A' && !btn.href) return false;
      const text = btn.textContent.trim();
      return text.length > 0 && text.length < 60;
    })
    .slice(0, 8); // limiter à 8 boutons

  standaloneButtons.forEach((btn, i) => {
    const text = btn.textContent.trim();
    const selector = btn.id
      ? `#${CSS.escape(btn.id)}`
      : btn.getAttribute('data-testid')
        ? `[data-testid="${btn.getAttribute('data-testid')}"]`
        : null;

    if (!selector) return;

    tools.push({
      name: `click${text.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20) || `Button${i + 1}`}`,
      description: `Clique sur le bouton "${text}"`,
      inputSchema: { type: 'object', properties: {} },
      action: {
        type: 'click',
        selector,
        waitMs: 500
      }
    });
  });
}
