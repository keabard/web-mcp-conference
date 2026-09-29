/**
 * configs-bundle.js — Registre des configurations de sites cibles
 *
 * Ce fichier est chargé en world: MAIN où chrome.* APIs ne sont PAS disponibles,
 * donc toutes les configs sont embarquées statiquement ici.
 *
 * Pour ajouter un nouveau site :
 *   1. Créer configs/[hostname-avec-tirets].json
 *   2. Copier son contenu dans AGENT_ADAPTER_CONFIGS ci-dessous
 *   3. La clé est le hostname avec les points remplacés par des tirets
 */

const AGENT_ADAPTER_CONFIGS = {

  'demo-guru99-com': {
    name: 'Mercury Tours Adapter',
    hostname: 'demo.guru99.com',
    waitFor: 'body',
    tools: [
      {
        name: 'login',
        description: 'Se connecter au site Mercury Tours avec un nom d\'utilisateur et un mot de passe. Identifiants de démo : tutorial / tutorial.',
        inputSchema: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            password: { type: 'string' }
          },
          required: ['username', 'password']
        },
        action: {
          type: 'fill_and_submit',
          fields: [
            { selector: "[name='userName']", argKey: 'username' },
            { selector: "[name='password']", argKey: 'password' }
          ],
          submitSelector: "[name='submit']",
          waitMs: 2000
        }
      },
      {
        name: 'searchFlights',
        description: 'Rechercher des vols disponibles entre deux villes et retourner la liste des vols. L\'utilisateur doit être connecté. Villes : Acapulco, Frankfurt, London, New York, Paris, Portland, San Francisco, Seattle, Sydney, Zurich.',
        inputSchema: {
          type: 'object',
          properties: {
            fromCity:     { type: 'string' },
            toCity:       { type: 'string' },
            fromMonth:    { type: 'integer' },
            fromDay:      { type: 'integer' },
            toMonth:      { type: 'integer' },
            toDay:        { type: 'integer' },
            serviceClass: { type: 'string', enum: ['Coach', 'Business', 'First'] },
            passengers:   { type: 'integer' }
          },
          required: ['fromCity', 'toCity']
        },
        action: {
          type: 'remote_form_submit',
          formUrl: 'https://demo.guru99.com/test/newtours/reservation.php',
          fields: [
            { selector: "[name='fromPort']",  argKey: 'fromCity' },
            { selector: "[name='toPort']",    argKey: 'toCity' },
            { selector: "[name='fromMonth']", argKey: 'fromMonth',    optional: true },
            { selector: "[name='fromDay']",   argKey: 'fromDay',      optional: true },
            { selector: "[name='toMonth']",   argKey: 'toMonth',      optional: true },
            { selector: "[name='toDay']",     argKey: 'toDay',        optional: true },
            { selector: "[name='servClass']", argKey: 'serviceClass', optional: true },
            { selector: "[name='passCount']", argKey: 'passengers',   optional: true }
          ],
          submitName: 'findFlights',
          resultSelector: "table.browseTable, table[border='0'][cellpadding='4']"
        }
      },
      {
        name: 'getPageText',
        description: 'Retourne le texte visible sur la page courante.',
        inputSchema: { type: 'object', properties: {} },
        action: {
          type: 'scrape',
          selector: 'body',
          format: 'text'
        }
      },
      {
        name: 'navigateTo',
        description: 'Naviguer vers une section du site. Chemins disponibles : /test/newtours/ (accueil), /test/newtours/login.php, /test/newtours/register.php, /test/newtours/reservation.php',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' }
          },
          required: ['path']
        },
        action: {
          type: 'navigate',
          urlTemplate: 'https://demo.guru99.com{path}'
        }
      }
    ]
  }

  ,

  'riftdecks-com': {
    name: 'RiftDecks.com Adapter',
    hostname: 'riftdecks.com',
    waitFor: 'body',
    tools: [
      {
        name: 'getTopExpensiveCards',
        description: 'Retourne les cartes Riftbound les plus chères triées par prix décroissant (source : TCGPlayer). Retourne pour chaque carte : rang, prix, nom, set, numéro de collection, variante (foil/normal), et variation de prix. Utile pour savoir quelles cartes valent le plus cher.',
        inputSchema: {
          type: 'object',
          properties: {
            period: {
              type: 'string',
              enum: ['daily', 'weekly'],
              description: 'Filtrer uniquement les cartes ayant bougé sur cette période. Omettre pour voir toutes les cartes sans filtre de tendance.'
            },
            move_direction: {
              type: 'string',
              enum: ['all', 'winners', 'losers'],
              description: 'Filtrer les gagnants (hausse) ou perdants (baisse) de prix. Par défaut : all.'
            }
          }
        },
        action: {
          type: 'fetch_and_scrape',
          urlTemplate: 'https://riftdecks.com/prices/trends?sort=Prices.price&direction=desc&period={period}&move_direction={move_direction}',
          defaults: { period: '', move_direction: 'all' },
          resultSelector: 'table'
        }
      },
      {
        name: 'searchDecksByCard',
        description: 'Cherche les decklists de tournoi Riftbound qui jouent une carte spécifique. Peut filtrer par plage de dates, classement minimum et nombre minimum d\'exemplaires. Retourne la liste des decks avec : rang, legend, nom du deck, tournoi, prix total, date, et URL du deck. L\'URL peut être passée à getDeckDecklist pour obtenir la liste complète des cartes avec le nombre d\'exemplaires.',
        inputSchema: {
          type: 'object',
          properties: {
            cardName: {
              type: 'string',
              description: 'Nom partiel ou complet de la carte à rechercher (ex: \'Defy\', \'Arise\', \'Diana\').'
            },
            minCopies: {
              type: 'integer',
              minimum: 1,
              maximum: 3,
              description: 'Nombre minimum d\'exemplaires de la carte (cardName) présents dans le deck. Valeurs possibles : 1, 2 ou 3. Omettre pour ne pas filtrer par nombre d\'exemplaires.'
            },
            startDate: {
              type: 'string',
              description: 'Date de début au format YYYY-MM-DD (ex: 2026-06-17 pour il y a une semaine).'
            },
            endDate: {
              type: 'string',
              description: 'Date de fin au format YYYY-MM-DD.'
            },
            rank: {
              type: 'string',
              enum: ['1st', 'top4', 'top8', 'top16', 'top32'],
              description: 'Classement minimum requis. Par défaut : top8.'
            }
          },
          required: ['cardName']
        },
        action: {
          type: 'fetch_and_scrape',
          urlTemplate: 'https://riftdecks.com/riftbound-decks?omni={cardName}&start_date={startDate}&end_date={endDate}&rank={rank}',
          defaults: { startDate: '', endDate: '', rank: 'top8' },
          resultSelector: 'table',
          deckCopiesFilter: {
            cardArg: 'cardName',
            minArg: 'minCopies',
            deckUrlField: 'url',
            deckSelector: 'table',
            deckColNames: ['section', 'count', 'name', 'price'],
            cardNameCol: 'name',
            countCol: 'count'
          }
        }
      },
      {
        name: 'getDeckDecklist',
        description: 'Récupère la decklist complète d\'un deck à partir de son URL. Retourne toutes les cartes avec le nombre d\'exemplaires joués (1, 2 ou 3) et le prix unitaire, par catégorie (Legend, Champion, Unit, Gear, Spell, Battlefield, Runes, Sideboard). Très utile pour vérifier combien d\'exemplaires d\'une carte précise sont joués dans ce deck. L\'URL du deck s\'obtient via searchDecksByCard.',
        inputSchema: {
          type: 'object',
          properties: {
            deckUrl: {
              type: 'string',
              description: 'URL complète du deck, ex: https://riftdecks.com/riftbound-metagame/deck-azir-emperor-of-the-sands-205931'
            }
          },
          required: ['deckUrl']
        },
        action: {
          type: 'fetch_and_scrape',
          urlTemplate: '{deckUrl}',
          resultSelector: 'table',
          colNames: ['section', 'count', 'name', 'price']
        }
      },
      {
        name: 'getMetaBreakdown',
        description: 'Retourne le classement des legends Riftbound dans le méta compétitif actuel : meta share (%), nombre total de decks, nombre de top8s, prix moyen du deck, tier. Utile pour comprendre quelles legends dominent le méta.',
        inputSchema: {
          type: 'object',
          properties: {}
        },
        action: {
          type: 'fetch_and_scrape',
          urlTemplate: 'https://riftdecks.com/legends',
          resultSelector: 'table'
        }
      }
    ]
  }

  ,

  'www-leboncoin-fr': {
    name: 'Leboncoin Véhicules',
    hostname: 'www.leboncoin.fr',
    waitFor: 'body',
    tools: [
      {
        name: 'searchVehicles',
        description: 'Recherche des véhicules d\'occasion sur leboncoin avec filtres avancés. Retourne jusqu\'à 25 annonces avec titre, prix, année, kilométrage, carburant, boîte, localisation et URL. IMPORTANT : n\'utiliser que les paramètres explicitement mentionnés par l\'utilisateur. Ne jamais déduire ou inventer des valeurs. Tous les paramètres sont optionnels. Limitation connue : le filtre géographique par département n\'est pas supporté.',
        inputSchema: {
          type: 'object',
          properties: {
            marque: {
              type: 'string',
              description: 'Marque du véhicule en majuscules. Exemples : BMW, RENAULT, PEUGEOT, MERCEDES-BENZ, VOLKSWAGEN, CITROEN, AUDI, TOYOTA, FORD, SEAT, MINI, TESLA, KIA, HYUNDAI, OPEL, FIAT. N\'utiliser que si explicitement mentionné.'
            },
            modele: {
              type: 'string',
              description: 'Modèle du véhicule avec préfixe marque et underscore. Fonctionne aussi pour les anciens modèles. Exemples récents : BMW_Série 3, RENAULT_Clio, PEUGEOT_308, VOLKSWAGEN_Golf. Exemples anciens : PEUGEOT_205, RENAULT_R5, CITROEN_2CV. N\'utiliser que si un modèle précis est demandé.'
            },
            prixMin: { type: 'integer', description: 'Prix minimum en euros. N\'utiliser que si l\'utilisateur mentionne un prix minimum. Ne JAMAIS mettre 0.' },
            prixMax: { type: 'integer', description: 'Prix maximum en euros. N\'utiliser que si l\'utilisateur mentionne un prix maximum. Ne JAMAIS mettre 0.' },
            kmMin:   { type: 'integer', description: 'Kilométrage minimum. N\'utiliser que si explicitement demandé. Ne JAMAIS mettre 0.' },
            kmMax:   { type: 'integer', description: 'Kilométrage maximum. N\'utiliser que si explicitement demandé. Ne JAMAIS mettre 0.' },
            anneeMin: { type: 'integer', description: 'Année de mise en circulation minimum. N\'utiliser que si l\'utilisateur mentionne une année ou une période. Ne JAMAIS mettre 0.' },
            anneeMax: { type: 'integer', description: 'Année de mise en circulation maximum. N\'utiliser que si l\'utilisateur mentionne une année ou une période. Ne JAMAIS mettre 0.' },
            carburant: {
              type: 'string',
              enum: ['Essence', 'Diesel', 'Hybride', 'Hybride Rechargeable', 'Électrique', 'GPL', 'GNV', 'Hydrogène', 'Autre'],
              description: 'Type de carburant. N\'utiliser que si explicitement mentionné.'
            },
            boite: {
              type: 'string',
              enum: ['Manuelle', 'Automatique'],
              description: 'Boîte de vitesses. N\'utiliser que si explicitement mentionné.'
            },
            typeVehicule: {
              type: 'string',
              enum: ['berline', 'break', '4x4', 'coupe', 'citadine', 'monospace', 'autre'],
              description: 'Type de carrosserie. N\'utiliser que si explicitement mentionné.'
            },
            typeVendeur: {
              type: 'string',
              enum: ['private', 'pro'],
              description: 'Type de vendeur : private (particulier) ou pro (professionnel). N\'utiliser que si explicitement mentionné.'
            },
            puissanceDinMin:    { type: 'integer', description: 'Puissance DIN minimum en chevaux. N\'utiliser que si explicitement mentionné.' },
            puissanceDinMax:    { type: 'integer', description: 'Puissance DIN maximum en chevaux. N\'utiliser que si explicitement mentionné.' },
            puissanceFiscaleMin: { type: 'integer', description: 'Puissance fiscale minimum en CV. N\'utiliser que si explicitement mentionné.' },
            puissanceFiscaleMax: { type: 'integer', description: 'Puissance fiscale maximum en CV. N\'utiliser que si explicitement mentionné.' },
            portes:  { type: 'integer', enum: [2, 3, 4, 5], description: 'Nombre de portes. N\'utiliser que si explicitement mentionné.' },
            couleur: {
              type: 'string',
              enum: ['argent', 'beige', 'blanc', 'bleu', 'bordeaux', 'brun', 'gris', 'jaune', 'marron', 'noir', 'orange', 'rouge', 'vert', 'violet', 'autre'],
              description: 'Couleur du véhicule. N\'utiliser que si explicitement mentionné.'
            },
            critair: {
              type: 'integer',
              enum: [0, 1, 2, 3, 4, 5],
              description: 'Vignette Crit\'Air. N\'utiliser que si explicitement mentionné.'
            },
            sort:  { type: 'string', enum: ['price', 'time'], description: 'Critère de tri : price (prix) ou time (date de publication).' },
            ordre: { type: 'string', enum: ['asc', 'desc'], description: 'Ordre de tri : asc (croissant) ou desc (décroissant).' }
          }
        },
        action: {
          type: 'fetch_nextdata',
          urlTemplate: 'https://www.leboncoin.fr/recherche?category=2&u_car_brand={marque}&u_car_model={modele}&fuel={carburant}&gearbox={boite}&vehicle_type={typeVehicule}&owner_type={typeVendeur}&doors={portes}&vehicule_color={couleur}&critair={critair}&sort={sort}&order={ordre}',
          valueMaps: {
            carburant: {
              'Essence': '1', 'Diesel': '2', 'GPL': '3', 'Électrique': '4',
              'Autre': '5', 'Hybride': '6', 'GNV': '7', 'Hybride Rechargeable': '8', 'Hydrogène': '9'
            },
            boite: { 'Manuelle': '1', 'Automatique': '2' }
          },
          rangeParams: {
            price:          ['prixMin', 'prixMax'],
            mileage:        ['kmMin', 'kmMax'],
            regdate:        ['anneeMin', 'anneeMax'],
            horse_power_din: ['puissanceDinMin', 'puissanceDinMax'],
            horsepower:     ['puissanceFiscaleMin', 'puissanceFiscaleMax']
          },
          findArrayByKey: 'list_id',
          flattenArrayKey: 'attributes',
          mapFields: {
            titre:            'subject',
            prix:             'price.0',
            url:              'url',
            localisation:     'location.city_label',
            annee:            'attributes.regdate.value_label',
            km:               'attributes.mileage.value_label',
            carburant:        'attributes.fuel.value_label',
            boite:            'attributes.gearbox.value_label',
            marque:           'attributes.u_car_brand.value',
            modele:           'attributes.u_car_model.value_label',
            version:          'attributes.u_car_version.value_label',
            couleur:          'attributes.vehicule_color.value_label',
            puissance_din:    'attributes.horse_power_din.value_label',
            puissance_fiscale: 'attributes.horsepower.value_label',
            type_vehicule:    'attributes.vehicle_type.value_label',
            bon_plan:         'attributes.car_price_positioning.value_label'
          },
          limit: 25
        }
      }
    ]
  }

  ,

  'www-lelynx-fr': {
    name: 'LeLynx Assurance Auto',
    hostname: 'www.lelynx.fr',
    waitFor: 'body',
    dismissOnLoad: [
      { selector: 'button', textMatch: 'Accepter et fermer', waitMs: 500 }
    ],
    tools: [
      {
        name: 'navigateTo',
        description: 'Naviguer vers le comparateur assurance auto LeLynx. Utiliser avant compareAssurancesAuto si on n\'est pas déjà sur www.lelynx.fr.',
        inputSchema: { type: 'object', properties: {} },
        action: {
          type: 'navigate',
          urlTemplate: 'https://www.lelynx.fr/assurance-auto/comparateur-auto#vehicule'
        }
      },
      {
        name: 'compareAssurancesAuto',
        description: 'Remplit entièrement le formulaire comparateur assurance auto LeLynx (6 étapes : véhicule, usage, conducteur, historique, prochain contrat, coordonnées) puis soumet. Après exécution, naviguer sur autoquote.lelynx.fr et appeler getResultatsAssuranceAuto pour récupérer les devis classés. Prérequis : être sur www.lelynx.fr avec le formulaire au début (étape véhicule). IMPORTANT : demander TOUS les paramètres à l\'utilisateur avant d\'appeler ce tool.',
        inputSchema: {
          type: 'object',
          properties: {
            immatriculation: { type: 'string', description: 'Plaque d\'immatriculation (ex: CH-242-GP)' },
            versionVehicule: { type: 'string', description: 'Version approximative du véhicule (ex: \'active\', \'bluehdi\', \'1.0\', \'hybride\'). LeLynx affiche plusieurs versions après reconnaissance de la plaque — le tool sélectionnera automatiquement la plus proche. Laisser vide pour sélectionner la première disponible.' },
            genre: { type: 'integer', enum: [1, 2], description: '1 = homme, 2 = femme' },
            dateNaissanceJour: { type: 'integer', description: 'Jour de naissance (1-31)' },
            dateNaissanceMois: { type: 'integer', description: 'Mois de naissance (1-12)' },
            dateNaissanceAnnee: { type: 'integer', description: 'Année de naissance (ex: 1975)' },
            moisPermis: { type: 'integer', description: 'Mois d\'obtention du permis (1-12)' },
            anneePermis: { type: 'integer', description: 'Année d\'obtention du permis (ex: 1995)' },
            bonusMalus: { type: 'string', description: 'Coefficient bonus-malus actuel (ex: \'0.50\' pour bonus maximum, \'1.00\' pour neutre, \'1.25\' en cas de malus). Demander à l\'utilisateur.' },
            assureurActuel: { type: 'string', description: 'Nom de l\'assureur auto actuel (ex: \'Maif\', \'Axa\', \'Matmut\', \'Direct Assurance\'). Demander à l\'utilisateur.' },
            typeFormuleSouhaitee: { type: 'string', description: 'Formule d\'assurance souhaitée telle qu\'affichée par LeLynx (ex: \'Au tiers\', \'Tiers +\', \'Tous risques\'). Demander à l\'utilisateur.' },
            adresse: { type: 'string', description: 'Numéro et rue de la résidence (ex: 12 rue de la Paix)' },
            prenom: { type: 'string' },
            nom: { type: 'string' },
            email: { type: 'string' },
            telephone: { type: 'string', description: 'Numéro de téléphone (10 chiffres)' }
          },
          required: ['immatriculation', 'genre', 'dateNaissanceJour', 'dateNaissanceMois', 'dateNaissanceAnnee', 'moisPermis', 'anneePermis', 'bonusMalus', 'assureurActuel', 'typeFormuleSouhaitee', 'adresse', 'prenom', 'nom', 'email', 'telephone']
        },
        action: {
          type: 'multi_step',
          requireUrl: 'lelynx.fr/assurance-auto/comparateur-auto-2',
          requireUrlTarget: 'https://www.lelynx.fr/assurance-auto/comparateur-auto-2#vehicule',
          requireUrlWaitFor: '#TInsuredCarTypePlate__1',
          steps: [
            // Étape 1 — Véhicule
            { type: 'click', selector: '#TInsuredCarTypePlate__1', skipIfPresent: '#LicencePlateNumber_freelicenceplatenumber', waitMs: 2500 },
            { type: 'fill_and_submit', waitForFirstFieldMs: 3000, fields: [{ selector: '#LicencePlateNumber_freelicenceplatenumber', argKey: 'immatriculation' }], submitSelector: '#LicencePlateNumber_licenceplatesubmit_btn', waitMs: 1000 },
            { type: 'click', selectorByText: { tag: 'label', argKey: 'versionVehicule', waitForMs: 7000, fuzzy: true }, waitMs: 1000 },
            { type: 'click', selector: "label[for='Month_6']", waitMs: 500 },
            { type: 'click', selector: "label[for='Year_2022']", waitMs: 500 },
            { type: 'click', selector: '#PurchaseDate_submit', waitMs: 2000 },
            // Étape 2 — Usage & infos
            { type: 'click', selector: '#Usage__1', waitMs: 600 },
            { type: 'click', selector: '#CarUsageFrequency__1', waitMs: 600 },
            { type: 'click', selector: '#NightParkingType__5', waitMs: 800 },
            { type: 'click', selector: '#NightParkingTypeB3__1', waitMs: 800 },
            { type: 'click', selector: '#WorkingInFrance__1', waitMs: 1200 },
            { type: 'slow_type', selector: '#ParkingDetails input.source-suggest-cap', value: '75001', waitMs: 2500, suggestionSelector: '.ui-autocomplete li:first-child' },
            { type: 'click', selector: '#PurchasingWay__1', waitMs: 600 },
            { type: 'click', selector: '#CarInsuredPeriod__1', waitMs: 600 },
            { type: 'click', selector: '#GrayCardOwner__1', waitMs: 600 },
            { type: 'click', selector: '#OldCarPeriod__6', waitMs: 600 },
            { type: 'click', selector: '#AnnualKMsActualValue_integercursorBtn', waitMs: 1000 },
            // Étape 3 — Conducteur
            { type: 'click', selectorTemplate: '#Gender__{genre}', waitMs: 800 },
            { type: 'fill_and_submit', fields: [
              { selector: '#BirthDate_Day', argKey: 'dateNaissanceJour' },
              { selector: '#BirthDate_Month', argKey: 'dateNaissanceMois' },
              { selector: '#BirthDate_Year', argKey: 'dateNaissanceAnnee' }
            ], submitSelector: '#BirthDate_singledatedmySubmit', waitMs: 1500 },
            { type: 'click', selectorTemplate: "#DriverLicenceDate label[for='Month_{moisPermis}']", waitMs: 500 },
            { type: 'click', selectorTemplate: "#DriverLicenceDate label[for='Year_{anneePermis}']", waitMs: 500 },
            { type: 'click', selector: '#DriverLicenceDate_submit', waitMs: 1000 },
            { type: 'click', selector: '#LicenseType__2', waitMs: 600 },
            { type: 'click', selector: '#LicenseCreditLost__1', waitMs: 600 },
            { type: 'click', selector: '#ProfessionB__0', waitMs: 600 },
            { type: 'click', selector: '#ProfessionA__2', waitMs: 600 },
            { type: 'slow_type', selector: '#ExactProfession input', value: 'Employ', optional: true, waitMs: 2000, suggestionSelector: '.ui-autocomplete li:first-child', submitSelector: '#ExactProfession_btn', submitWaitMs: 800 },
            { type: 'click', selector: '#MaritalStatus__1', waitMs: 600 },
            { type: 'click', selector: '#HaveChildren__2', waitMs: 600 },
            { type: 'click', selector: '#ResidenceType__1', waitMs: 600 },
            { type: 'click', selector: '#OccupancyStatus__1', waitMs: 600 },
            { type: 'click', selector: '#DriverAlreadyInsured__1', waitMs: 800 },
            { type: 'click', selector: '#IsInsured__1', waitMs: 600 },
            { type: 'click', selector: '#InsuredAsPrimaryOnOtherCar1__2', waitMs: 600 },
            { type: 'click', selector: '#InsuredAsPrimaryOnOtherCar2__2', waitMs: 600 },
            // Étape 4 — Historique assurance
            { type: 'click', selector: '#suggest-list_DriverAlreadyInsuredPeriod_15', waitMs: 400 },
            { type: 'click', selector: '#DriverAlreadyInsuredPeriod_submit_btn', waitMs: 1000 },
            { type: 'click', selector: '#BonusMalus_openCloseExpand', waitMs: 300 },
            { type: 'click', selectorRaw: "[id='suggest-list_BonusMalus_{bonusMalus}']", waitMs: 400 },
            { type: 'click', selector: '#BonusMalus_submit_btn', waitMs: 1000 },
            { type: 'click', selector: '#BonusMalusYears_openCloseExpand', waitMs: 300 },
            { type: 'click', selector: '#suggest-list_BonusMalusYears_4', waitMs: 400 },
            { type: 'click', selector: '#BonusMalusYears_submit_btn', waitMs: 1000 },
            { type: 'click', selector: '#FiredFromPolicy__1', waitMs: 600 },
            { type: 'click', selector: '#CurrentInsurer_openCloseExpand', waitMs: 300 },
            { type: 'click', selectorByText: { tag: 'li', argKey: 'assureurActuel' }, waitMs: 400 },
            { type: 'click', selector: '#CurrentInsurer_submit_btn', waitMs: 1000 },
            { type: 'click', selector: '#CurrentPolicyType__2', waitMs: 600 },
            { type: 'click', selector: '#CurrentContractExpiryDate__7', waitMs: 600 },
            { type: 'click', selector: '#IsOneYearOldContract__1', waitMs: 600 },
            { type: 'click', selector: '#G6G7n button.button--primary', waitMs: 800 },
            { type: 'click', selector: '#PrimaryDriverConvictions button.button--primary', waitMs: 800 },
            { type: 'click', selector: '#primarydriver_multiplechoice_morethan5years button.button--primary', waitMs: 800 },
            // Étape 5 — Prochain contrat + Coordonnées
            { type: 'click', selector: '#StepTransition button.button--primary', waitMs: 2000, crossPage: true, crossPageWaitFor: '#NewContractStartDateRadio__3' },
            { type: 'click', selector: '#NewContractStartDateRadio__3', waitMs: 600 },
            { type: 'click', selectorByText: { tag: 'label', argKey: 'typeFormuleSouhaitee' }, waitMs: 600 },
            { type: 'click', selector: '#ResidencePostalCode_Suggestionlist button', waitMs: 800 },
            { type: 'slow_type', selector: '#Address', argKey: 'adresse', waitMs: 2500, suggestionSelector: '#Address_Suggestionlist button', submitSelector: '#Validate_ResidencePostalCode_btn', submitWaitMs: 1500 },
            { type: 'click', selector: '#IsReceiveProposedOffers__2', waitMs: 600 },
            { type: 'fill_and_submit', fields: [
              { selector: '#FirstName', argKey: 'prenom' },
              { selector: '#LastName', argKey: 'nom' },
              { selector: '#EmailAddress', argKey: 'email' },
              { selector: '#Telephone', argKey: 'telephone' }
            ], submitSelector: '#checkbox__IsUserConsent', waitMs: 500 },
            { type: 'click', selector: '#ContactDetails button.button--primary', waitMs: 3000 }
          ]
        }
      }
    ]
  }

  ,

  'autoquote-lelynx-fr': {
    name: 'LeLynx Résultats Assurance Auto',
    hostname: 'autoquote.lelynx.fr',
    waitFor: 'quote-row',
    tools: [
      {
        name: 'getResultatsAssuranceAuto',
        description: 'Retourne la liste classée des offres d\'assurance auto après soumission du comparateur LeLynx. À appeler depuis autoquote.lelynx.fr après avoir utilisé compareAssurancesAuto sur www.lelynx.fr. Retourne chaque offre avec l\'assureur, le prix et la formule.',
        inputSchema: { type: 'object', properties: {} },
        action: {
          type: 'scrape',
          selector: 'quote-row.is-enabled',
          format: 'list',
          fields: {
            assureur: '.partner__name',
            prix: '.table__value',
            formule: '.paragraph'
          }
        }
      },
      {
        name: 'getPageText',
        description: 'Retourne le texte visible de la page courante. Utile pour vérifier où en est le chargement des résultats.',
        inputSchema: { type: 'object', properties: {} },
        action: { type: 'scrape', selector: 'body', format: 'text' }
      }
    ]
  }

  // Ajouter d'autres sites ici :
  // 'localhost': { ... }
  // 'monapp-example-com': { ... }
};
