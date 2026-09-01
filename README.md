# AllGo Mobile

Monorepo de l'application mobile **AllGo** (Mahajanga, Madagascar) — portage mobile de la
plateforme de commerce social *Janga Market*.

Référence normative : [`docs/CAHIER_DES_CHARGES_MOBILE_FLUTTER.md`](docs/CAHIER_DES_CHARGES_MOBILE_FLUTTER.md).

## Contenu du dépôt

| Dossier | Rôle |
|---|---|
| `mobile/` | Application Flutter (Android / iOS) — architecture en couches §4.3 |
| `backend/` | API NestJS + Mongoose (MongoDB) — §5.1, §7 |
| `migration/` | Outillage de migration MariaDB → MongoDB — §15.3 |
| `docs/` | Cahier des charges, ADR, dictionnaire des collections |
| `docker-compose.yml` | MongoDB (replica set), Redis, MinIO, Mongo Express |

## Trajectoire retenue

**Trajectoire C — migration progressive par domaine.** MongoDB devient la source de vérité
un domaine à la fois ; MariaDB s'éteint au lot M7. Jamais deux sources de vérité pour un
même domaine. Voir chapitre 15 du cahier des charges.

## Démarrage

### 1. Infrastructure locale

```bash
docker compose up -d
# MongoDB      : mongodb://localhost:27017/allgo?replicaSet=rs0
# Redis        : localhost:6379
# MinIO        : http://localhost:9001  (minioadmin / minioadmin)
# Mongo Express: http://localhost:8081
```

Le *replica set* est **obligatoire** : sans lui, les transactions multi-documents de la
création de commande (§6.3) n'existent pas. Le service `mongo-init` l'initialise
automatiquement au premier démarrage.

### 2. API

```bash
cd backend
cp .env.example .env      # renseigner les secrets — aucun secret n'est versionné (§12.1)
npm install
npm run seed              # jeu de données Mahajanga : 1 boutique, 3 produits
npm run start:dev         # http://localhost:3000/v1
                          # OpenAPI : http://localhost:3000/docs
```

Générer les deux secrets JWT :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Comptes du jeu de données : `+261340000001` (commerçant) et `+261340000002`
(client), mot de passe `MotDePasse2026`.

#### Données de test disponibles

Chaque exécution de `npm run seed` réinitialise les collections de développement et
génère de nouveaux `ObjectId`. Le script affiche les IDs de la boutique et des produits
à la fin. Les valeurs stables à utiliser dans les tests sont :

| Type | Valeur | Détail |
|---|---|---|
| Boutique | `epicerie-mahavoky` | Épicerie Mahavoky, Avenue de France, Mahajanga |
| Catégorie | `alimentation` | Catégorie racine |
| Catégorie | `epicerie` | Sous-catégorie des produits |
| Produit | `6001234567890` | Riz Makalioka 5 kg, 22 000 MGA, promo 19 500 MGA, stock 48 |
| Produit | `6001234567891` | Huile végétale 1 L, 9 500 MGA, stock 120 |
| Produit | `6001234567892` | Sucre roux 1 kg, 5 200 MGA, stock 4, seuil 15 |
| Position | `-15.7167, 46.3167` | Latitude, longitude du centre de test |

Exemples de vérification après le démarrage de l'API :

```bash
curl "http://localhost:3000/v1/products?limit=20"
curl "http://localhost:3000/v1/geo/shops?lat=-15.7167&lng=46.3167&radius=5"
curl "http://localhost:3000/v1/products/barcode/6001234567890"
```

Sur l'émulateur Android, l'application doit viser `10.0.2.2` et non `localhost`.
Sous Windows PowerShell, utiliser `npm.cmd run ...` si la politique d'exécution bloque
`npm.ps1`.

**Tests**

```bash
npm test              # unitaires — aucune infrastructure requise
npm run test:integration   # exige `docker compose up -d` (test d'ossature des routes)
npm run openapi:export     # écrit openapi.json depuis les DTO
```

### 3. Application Flutter

Vérifié avec **Flutter 3.47.1 / Dart 3.13.1**.

```bash
cd mobile
flutter pub get
dart run build_runner build     # freezed, json_serializable, drift
flutter analyze                 # doit être vierge
flutter test
```

Lancement sur émulateur, l'API et Docker étant déjà démarrés :

```bash
flutter run -d <appareil> \
  --dart-define=API_BASE_URL=http://10.0.2.2:3000/v1 \
  --dart-define=SOCKET_URL=http://10.0.2.2:3000
```

> `10.0.2.2` est l'alias de la machine hôte vu depuis l'émulateur Android.
> Android bloque le HTTP en clair depuis l'API 28 :
> `android/app/src/main/res/xml/network_security_config.xml` ouvre l'exception
> **pour ces seuls hôtes de développement**, jamais globalement.

Le dossier `ios/` n'est pas généré (poste Windows) :
`flutter create . --platforms=ios` le produira sur macOS.

### Correspondance avec le cahier des charges mobile

Le cahier des charges est prévisionnel. L'état réel du dépôt est le suivant :

| Lot | État dans ce dépôt | Reste à livrer |
|---|---|---|
| L0 — Socle | Partiellement livré | CI/CD complète, SQLCipher, durcissement final et publication |
| L1 — Découverte | Partiellement livré | Panier local complet, synchronisation avancée et tests d'intégration |
| L2 — Achat | Partiellement livré | Fournisseurs mobile money et suivi GPS avancé du livreur |
| L3 — Social | Non livré | Fil, publications, stories, réactions, commentaires et abonnements |
| L4 — Communication | Non livré | Messagerie temps réel, notifications push et demandes clients |
| L5 — Commerçant | Non livré | Tableau de bord, équipe, encaissement et factures |
| L6 — Livreur | Non livré | Tournées, navigation, suivi GPS et preuve de livraison |
| L7 — Consolidation | Non livré | Accessibilité, malgache validé, performance et migration finale |

Les routes non livrées affichent volontairement `ComingSoonScreen`; elles ne doivent pas
être présentées comme fonctionnelles dans une démonstration. Les critères d'acceptation
correspondants sont définis dans [le cahier des charges mobile](docs/CAHIER_DES_CHARGES_MOBILE_FLUTTER.md),
notamment aux sections 8 à 10, 14 et 16 à 19.

**Icônes de lanceur** — régénérées depuis le SVG, jamais éditées à la main :

```bash
node tool/generate_icons.js      # 5 densités + icône adaptative + logo applicatif
```

**Contraintes de version à ne pas relâcher sans vérifier :**

| Paquet | Contrainte | Motif |
|---|---|---|
| `intl` | `^0.20.3` | imposée par `flutter_localizations` du SDK |
| `build_runner` | `>=2.15.1 <2.15.2` | 2.15.2+ exige `analyzer` ≥ 13, que `freezed 3.2.5` refuse |
| `freezed` | `^3.2.5` | la 2.x embarque un `analyzer` en langage 3.9 qui plante sur la syntaxe Dart 3.13 |

`custom_lint`, `riverpod_lint`, `riverpod_annotation` et `retrofit` sont
délibérément écartés — chaque motif est inscrit dans `pubspec.yaml`.

### 4. Migration

```bash
cd migration
npm install
npm run migrate -- categories --dry-run
```

## Écarts assumés par rapport au cahier des charges

Les décisions qui s'écartent de la spécification sont consignées en ADR, jamais
laissées implicites dans le code :

| ADR | Sujet | Écart |
|---|---|---|
| [0001](docs/adr/0001-serveur-api-et-trajectoire-de-migration.md) | Serveur d'API et trajectoire | Le cahier des charges ne nomme pas le serveur d'API ; NestJS est retenu, trajectoire C |
| [0002](docs/adr/0002-stockmovements-series-temporelles-vs-transactions.md) | `stockMovements` | Le §6.2 (série temporelle) et le §6.3 (transaction) sont **incompatibles** sous MongoDB ; l'intégrité l'emporte, la collection redevient ordinaire |

## Conventions

- **Sécurité par défaut** : toute route d'API est refusée sauf déclaration explicite d'une
  permission via `@RequirePermission()`. Un test d'ossature échoue en CI si une route n'a
  pas de garde (§3.2, §12.1).
- **Hors ligne d'abord** : l'interface Flutter lit toujours Drift ; le réseau alimente le
  cache, il ne bloque jamais l'affichage (§9.1).
- **Montants** : `Decimal128` côté MongoDB, jamais `Double` (§15.4).
- **Coordonnées** : GeoJSON `[longitude, latitude]` — l'ordre est inversé par rapport à
  l'habitude `lat, lng` (§15.4).
- **Instantanés contractuels** : une ligne de commande fige nom et prix au moment de
  l'achat ; un changement de tarif ne réécrit jamais l'historique (§6.1).

## État d'avancement

Ce dépôt correspond au **lot L0 — Socle** : architecture, schémas MongoDB, ossature d'API,
authentification, design system, CI. Les lots L1 à L7 sont décrits au chapitre 18 du
cahier des charges.

| Domaine | État |
|---|---|
| Rôles, permissions, gardes | Complet, avec test d'ossature bloquant en CI |
| Authentification (mot de passe, OTP, réinitialisation, rotation de jetons) | Complet |
| Catalogue, boutiques, recherche géographique `$geoNear` | Complet |
| Panier et création de commande transactionnelle | Complet |
| Stock : mouvements et alertes | Complet |
| Médias : URL présignée | Complet |
| Synchronisation delta et file d'actions différées | Complet |
| Favoris | Complet — ajout idempotent, bascule optimiste |
| Écrans d'accès | Connexion, **inscription**, **code SMS**, **mot de passe oublié** |
| Écran boutique | Complet — horaires du jour, appel, WhatsApp, catalogue |
| Filtres du catalogue | Prix et catégorie, avec retrait explicite de chaque filtre |
| Social, messagerie | Schémas et index seulement — lots L3 et L4 |
| Mobile money | Contrat d'interface figé, implémentations au lot L2 |
| Écrans commerçant et livreur | Écrans d'attente annonçant leur lot — L5 et L6 |

Les écrans non encore livrés affichent `ComingSoonScreen`, qui nomme le lot concerné :
une destination visible mais non enregistrée ferait planter la navigation, et
`test/app/router_test.dart` vérifie que chaque onglet pointe vers un écran réel.

### Vérifié en exécution

Contre la pile Docker réelle, avec le jeu de données de Mahajanga :

| Comportement | Résultat |
|---|---|
| `$geoNear` sur index `2dsphere` | 8–9 ms à chaud (cible §13.1 : < 150 ms) |
| Route protégée sans jeton | 401 `UNAUTHENTICATED` + `requestId` |
| Création de commande transactionnelle | `ALG-2026-0001` · stock 4→2 · mouvement journalisé · panier vidé |
| Stock retombé sous la quantité commandée | `INSUFFICIENT_STOCK`, stock intact, **aucune commande créée** |
| Rejeu d'une `Idempotency-Key` | même numéro de commande, aucun doublon |
| Portée des rôles | propriétaire de la boutique A sur la boutique B → 403 |
| Contrat OpenAPI généré | 39 chemins, 20 schémas |

L'exécution a révélé quatre défauts invisibles au typecheck, dont
`readPreference: 'primaryPreferred'` qui rendait **toute transaction impossible**,
et le conflit de l'ADR 0002. C'est la justification concrète de la règle du §4.2 :
le contrat est validé avant le code, et « validé » signifie *exécuté*.
