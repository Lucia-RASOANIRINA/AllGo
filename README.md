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
npm run seed              # jeu de données Mahajanga : 6 comptes, 2 boutiques, 7 produits
npm run start:dev         # http://localhost:3000/v1
                          # OpenAPI : http://localhost:3000/docs
```

Générer les deux secrets JWT :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

> Si votre base MongoDB existait déjà avant cette mise à jour (schémas antérieurs
> aux favoris génériques, aux avis à cible unique ou aux boutiques à deux),
> repartez d'un volume propre avant de réensemencer :
> `docker compose down -v && docker compose up -d && npm run seed`. Un index
> unique hérité d'un ancien schéma ne se supprime jamais tout seul — MongoDB
> ajoute les index déclarés, il ne retire jamais ceux qui ne le sont plus.

#### Données de test disponibles

Chaque exécution de `npm run seed` réinitialise les collections de développement et
génère de nouveaux `ObjectId` — un compte par rôle, et au moins un document par
fonctionnalité livrée depuis le lot L0. Le script affiche les identifiants exacts
(boutiques, commandes) à la fin de son exécution.

**Comptes** (mot de passe unique : `MotDePasse2026`) :

| Rôle | Téléphone | Nom | Détail |
|---|---|---|---|
| Client | `+261340000002` | Soa Randria | Adresse enregistrée, avis déposés, litige ouvert |
| Client | `+261340000006` | Fara Ravelo | Second compte client, sans historique |
| Commerçant | `+261340000001` | Hery Rakoto | Propriétaire d'Épicerie Mahavoky |
| Commerçant | `+261340000003` | Lala Andriamampianina | Propriétaire de Sahaza Mode |
| Livreur | `+261340000004` | Tovo Rabe | Identité vérifiée, une mission en cours, un bonus et un retrait en attente |
| Administrateur | `+261340000005` | Admin AllGo | Rôle `platform_admin` |

**Catalogue et commerce** :

| Type | Valeur | Détail |
|---|---|---|
| Boutique | `epicerie-mahavoky` | Épicerie, catégorie Alimentation, ouverte tous les jours sauf dimanche |
| Boutique | `sahaza-mode` | Mode et vêtements, avec variantes de taille |
| Produit | `6001234567890` | Riz Makalioka 5 kg, 22 000 Ar, promo 19 500 Ar |
| Produit vedette | Chemise homme en coton | Sujette à la promotion flash ci-dessous |
| Code promo générique | `BIENVENUE10` | 10 %, minimum 5 000 Ar, plafond 10 000 Ar |
| Code promo boutique | `MAHAVOKY5` | 2 000 Ar de réduction, Épicerie Mahavoky uniquement |
| Promotion flash | Chemises Sahaza Mode | -20 %, active 48 h, liée à une story |
| Commande livrée | `ALG-2026-0001` | Payée, avis déposés dessus, litige ouvert |
| Commande en livraison | `ALG-2026-0002` | Étape « vers le client », livreur affecté |
| Position | `-15.7167, 46.3167` | Latitude, longitude du centre de test |

Publications, story (liée à un produit et à la promotion flash), conversation avec
messages, favori et abonnement sont également en place — de quoi peupler chaque écran
sans étape manuelle.

Exemples de vérification après le démarrage de l'API :

```bash
curl "http://localhost:3000/v1/products?limit=20"
curl "http://localhost:3000/v1/geo/shops?lat=-15.7167&lng=46.3167&radius=5"
curl "http://localhost:3000/v1/products/barcode/6001234567890"
curl "http://localhost:3000/v1/campaigns/flash"
curl "http://localhost:3000/v1/search?q=riz"
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
> **pour ces seuls hôtes de développement**, jamais globalement. Pour tester sur un
> téléphone physique plutôt qu'un émulateur, ajouter l'IP locale du poste de
> développement à ce fichier et la passer à `--dart-define=API_BASE_URL=` — le
> téléphone doit être sur le même réseau Wi-Fi, et le pare-feu Windows doit
> autoriser les connexions entrantes sur le port 3000.

Le dossier `ios/` n'est pas généré (poste Windows) :
`flutter create . --platforms=ios` le produira sur macOS.

**Générer l'APK** :

```bash
cd mobile
flutter build apk --release \
  --dart-define=API_BASE_URL=http://<IP-DU-POSTE>:3000/v1 \
  --dart-define=SOCKET_URL=http://<IP-DU-POSTE>:3000
# Sortie : mobile/build/app/outputs/flutter-apk/app-release.apk
```

Sans `--dart-define`, l'APK vise `10.0.2.2` (émulateur uniquement — voir
`lib/core/env/environment.dart`). L'IP est figée au moment de la compilation :
une IP locale qui change (nouveau réseau, bail DHCP renouvelé) exige de
reconstruire l'APK.

### Correspondance avec le cahier des charges mobile

Le cahier des charges est prévisionnel. L'état réel du dépôt est le suivant —
mis à jour après une passe d'exécution réelle bout en bout (API démarrée, jeu de
données chargé, chaque fonctionnalité appelée par au moins une requête), pas
seulement une relecture du code :

| Lot | État dans ce dépôt | Reste à livrer |
|---|---|---|
| L0 — Socle | Livré | Durcissement final (SQLCipher, CI/CD complète) et publication sur les stores |
| L1 — Découverte | Livré | Tests d'intégration supplémentaires sur la synchronisation hors ligne |
| L2 — Achat | Partiellement livré | **Fournisseurs mobile money réels** — l'architecture est prête, mais MVola/Orange Money/Airtel Money tournent en mode démo faute d'identifiants marchands réels ; ni carte bancaire ni portefeuille AllGo (les deux étaient optionnels) |
| L3 — Social | Livré | Aucun moteur de recommandation par apprentissage — le rail « recommandé » utilise un heuristique par catégorie, décision assumée plutôt qu'un manque |
| L4 — Communication | Livré | — |
| L5 — Commerçant | Livré | Écran dédié aux statistiques de story (le point d'entrée existe, l'écran de liste des vues est le seul côté story) |
| L6 — Livreur | Livré | — |
| L7 — Consolidation | Non livré | Accessibilité, malgache validé, performance à grande échelle et migration finale |

Le passage de L3–L6 à « Livré » corrige une évaluation antérieure de ce document,
qui datait d'avant l'implémentation réelle de ces lots et n'avait plus été mise à
jour depuis — voir « Vérifié en exécution » plus bas pour ce que cette relecture a
changé, et « État d'avancement » pour le détail fonctionnalité par fonctionnalité.

Une seule route affiche encore `ComingSoonScreen` : `/confidentialite` (texte de
politique de confidentialité, volontairement embarqué plutôt que chargé du réseau —
§12.3). Toute autre destination enregistrée dans `Routes.all` pointe vers un écran
réel, relié à l'API. Les critères d'acceptation détaillés restent définis dans
[le cahier des charges mobile](docs/CAHIER_DES_CHARGES_MOBILE_FLUTTER.md).

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

Ce dépôt couvre l'ensemble des espaces du cahier des charges — client, commerçant,
livreur, administration. Chaque ligne ci-dessous a été vérifiée par une requête réelle
contre l'API en exécution, pas seulement relue dans le code : voir « Vérifié en
exécution » pour la liste des défauts que cette vérification a trouvés et corrigés.

| Domaine | État |
|---|---|
| Rôles, permissions, gardes | Complet, avec test d'ossature bloquant en CI |
| Authentification (mot de passe, OTP, mot de passe oublié, rotation de jetons, **vérification email**, **suppression de compte**) | Complet |
| Catalogue, boutiques, recherche géographique `$geoNear`, **recherche globale**, **produits similaires** | Complet |
| Panier multi-boutiques, **code promo**, **pourboire livreur**, commande transactionnelle | Complet |
| Statut ouvert/fermé calculé (carte, recherche, fiche boutique) | Complet — code déjà écrit mais jamais branché avant cette révision |
| Stock : mouvements, alertes, **import de produits en masse** | Complet |
| Favoris génériques (produit, boutique, promotion, publication) | Complet — ajout idempotent, bascule optimiste |
| Réseau social : publications (**dont publications de boutique**), réactions, commentaires, **partage**, **signalement** | Complet |
| Stories : création, lien produit/promotion, **statistiques de vues** | Complet |
| Messagerie temps réel, **blocage**, **signalement** | Complet |
| Avis (produit, boutique, livreur), **reçu de commande imprimable/partageable** | Complet |
| Espace commerçant : tableau de bord, produits, stock, commandes, promotions (**flash, code promo**), équipe | Complet |
| Espace livreur : missions, suivi GPS, revenus, **bonus**, retraits | Complet |
| Administration : utilisateurs, boutiques, produits, commandes, **litiges** | Complet |
| Synchronisation delta et file d'actions différées | Complet |
| Mobile money | Architecture complète (webhooks, idempotence) ; fournisseurs en **mode démo**, aucun identifiant marchand réel |
| Paiement par carte, portefeuille AllGo, paiement partiel | Non livré — optionnels au cahier des charges |
| Accessibilité, malgache validé, performance à grande échelle | Non livré — lot L7 |

Une seule route affiche encore `ComingSoonScreen` (`/confidentialite`) ;
`test/app/router_test.dart` vérifie que chaque onglet pointe vers un écran réel.

### Vérifié en exécution

Contre la pile Docker réelle, avec le jeu de données de Mahajanga :

| Comportement | Résultat |
|---|---|
| `$geoNear` sur index `2dsphere` | 8–9 ms à chaud (cible §13.1 : < 150 ms) |
| Route protégée sans jeton | 401 `UNAUTHENTICATED` + `requestId` |
| Création de commande transactionnelle | stock décrémenté, mouvement journalisé, panier vidé |
| Stock retombé sous la quantité commandée | `INSUFFICIENT_STOCK`, stock intact, **aucune commande créée** |
| Rejeu d'une `Idempotency-Key` | même numéro de commande, aucun doublon |
| Portée des rôles | propriétaire de la boutique A sur la boutique B → 403 |
| Code promo générique et code promo boutique | réduction correcte, panier multi-boutiques, usage compté une seule fois |
| Import de produits en masse | lignes valides créées, ligne invalide isolée sans bloquer les autres |
| Blocage de conversation | envoi refusé (`CONVERSATION_BLOCKED`) après blocage, dans les deux sens |
| Suppression de compte | connexion impossible ensuite avec le même numéro |

L'exécution bout en bout de cette révision a révélé et corrigé **sept défauts
invisibles au typecheck et aux tests unitaires**, qu'aucune relecture de code
n'aurait trouvés :

1. **`OrdersModule` n'exportait pas `MongooseModule`** — `CourierEarningsModule` ne
   pouvait pas injecter le modèle `Order` ; l'application entière refusait de démarrer.
2. **`PermissionsGuard` verrouillait tout l'espace livreur** — `ShopCourier` est un
   rôle de portée boutique par construction (§3.1), mais les routes de missions et de
   revenus ne nomment aucune boutique. Sans une liste explicite de permissions
   dispensées de cette portée, aucun livreur ne pouvait jamais consulter ses propres
   revenus. Voir `PERMISSIONS_WITHOUT_SHOP_SCOPE` dans `common/rbac/permissions.ts`.
3. **`@Query() query: PaginationQueryDto` combiné à un `@Query('champ')` séparé**
   faisait rejeter la requête entière (`VALIDATION_FAILED`) dès qu'un des deux
   champs était fourni — `q`/`openNow`/`sort` sur `/shops`, `type` sur les favoris,
   `status`/`q` sur les commandes commerçant. Corrigé en déclarant un DTO dédié par
   route, seule façon dont `whitelist`/`forbidNonWhitelisted` peuvent cohabiter avec
   des paramètres de requête supplémentaires.
4. **`NotificationsService.create()` plantait pour tout compte n'ayant jamais
   personnalisé ses préférences** — `.lean()` ne reconstruit jamais un `Map` Mongoose,
   il renvoie l'objet brut stocké en base ; appeler `.get()` dessus levait
   `TypeError`. Ce chemin est emprunté à chaque message envoyé : la messagerie
   entière était inutilisable dès qu'un compte gardait ses réglages par défaut.
5. **`SocialService.create()` ne posait jamais `author.type: 'shop'`** — même
   lorsqu'un commerçant publiait avec un `shopId`, l'auteur restait enregistré
   comme un particulier. L'onglet « Publications » de toute fiche boutique
   (`ShopsService.postsFor()`, filtré sur `author.type: 'shop'`) était donc
   structurellement vide, quel que soit le nombre de publications réelles.
6. **Deux schémas d'avis orphelins** (`shops/schemas/review.schema.ts`,
   `catalog/schemas/product-review.schema.ts`) avaient laissé un index unique
   `{shopId, userId}` sur la collection `reviews`, jamais retiré par Mongoose — un
   client déposant un deuxième avis sur la même commande (produit puis boutique)
   provoquait une erreur de clé dupliquée. Même défaut sur `favorites`
   (`{userId, productId}` hérité de l'ancien schéma à cible unique). Les schémas
   morts sont supprimés ; les index hérités doivent être retirés à la main sur une
   base de développement préexistante (voir l'avertissement en tête de section
   « Démarrage »).
7. **`readPreference: 'primaryPreferred'`** (trouvé lors d'une révision antérieure)
   rendait déjà toute transaction impossible — mentionné ici pour mémoire, la classe
   de défaut est la même : invisible tant que le code n'est pas réellement exécuté.

C'est la justification concrète de la règle du §4.2 : le contrat est validé avant
le code, et « validé » signifie *exécuté* — jamais seulement relu ou typé.

#### Deuxième passe — test manuel complet sur émulateur

Une seconde vérification bout en bout, cette fois sur un émulateur Android réel
(catalogue, accueil, fiche produit, panier, espace commerçant, réseau social,
stories) plutôt que par simple `curl`, a trouvé et corrigé **quatre défauts
supplémentaires**, tous invisibles à l'exécution des tests automatisés parce
qu'ils ne se manifestent que sous un vrai moteur de rendu Flutter ou un vrai
client HTTP mobile :

8. **Le client annonçait `Accept-Encoding: br, gzip`** — l'intergiciel de
   compression du serveur répond alors en Brotli dès qu'une réponse dépasse son
   seuil de taille, or l'adaptateur HTTP par défaut de Dio (`dart:io`) ne sait
   décompresser que le gzip. Toute réponse volumineuse (catalogue, catégories,
   rails d'accueil) arrivait donc en bytes Brotli bruts, faisait échouer le
   parseur JSON, et affichait l'écran d'erreur générique — alors que l'API
   elle-même répondait correctement (confirmé par `curl`). Seules les réponses
   sous le seuil de compression (une promotion flash isolée) passaient. Corrigé
   en n'annonçant plus que `gzip` dans `core/network/api_client.dart`.
9. **`AuthInterceptor` (un `QueuedInterceptor`, qui sérialise toutes les
   requêtes une par une) rejouait la requête et rafraîchissait le jeton en
   repassant par le même client `Dio`** — cette nouvelle requête entrait dans la
   même file, derrière la requête en cours de traitement qui attendait
   justement sa fin. Blocage mutuel garanti à chaque expiration du jeton d'accès
   (15 minutes) : l'écran concerné restait bloqué en chargement indéfiniment,
   bien au-delà du budget de nouvelle tentative + délai d'expiration. Corrigé en
   donnant à `AuthInterceptor` un second client `Dio` sans intercepteur, dédié
   au rafraîchissement et à la requête rejouée.
10. **Trois boîtes de dialogue (`showDialog`) capturaient le `context` de
    l'écran appelant au lieu de celui, propre, fourni par leur `builder`** —
    `merchant_orders_screen.dart` (reçu de commande), `merchant_products_screen.dart`
    (suppression d'un produit) et `courier_earnings_screen.dart` (demande de
    retrait). `Navigator.pop(context)` remontait alors jusqu'au `Navigator`
    racine de GoRouter et dépilait l'écran entier plutôt que la boîte de
    dialogue, laissant le routeur sans page à afficher (« *You have popped the
    last page off of the stack* ») — un écran noir, pas un plantage visible
    dans l'interface. Corrigé en nommant et en utilisant le `dialogContext` du
    `builder` dans chacune des trois boîtes.
11. **Le thème global fixe `minimumSize: Size.fromHeight(48)` à tout
    `FilledButton`** — `Size.fromHeight` construit `Size(double.infinity, 48)` :
    une largeur minimale infinie, choix voulu pour les boutons d'appel à
    l'action pleine largeur (« Se connecter », « Ajouter au panier »), qui sont
    enfants d'une `Column`. Mais tout `FilledButton` posé comme enfant simple
    d'un `Row` (le bouton « Créer » du compositeur de publication, dans
    `social_feed_screen.dart`) hérite du même minimum et demande une largeur
    infinie à un parent qui ne peut pas la lui offrir — plantage de mise en
    page, écran « Réseau AllGo » entièrement blanc, sans aucune erreur
    visible ni dans l'interface ni dans les journaux Dart habituels (les
    erreurs de rendu ne sont pas remontées par `AsyncValue`). Corrigé
    localement (`FilledButton.styleFrom(minimumSize: Size.zero)`) plutôt qu'au
    niveau du thème, pour ne pas rétrécir les boutons pleine largeur qui
    dépendent de ce défaut ailleurs dans l'application.

Les défauts n° 8 et 9 expliquent à eux seuls la quasi-totalité des rails
d'accueil et de l'écran Explorer restés vides lors des essais initiaux sur
appareil physique/émulateur — un symptôme qui n'avait aucune cause côté API et
n'apparaît qu'en présence d'un vrai client HTTP mobile et d'un vrai délai
d'expiration de jeton, jamais dans un test unitaire ou un `curl` isolé.
