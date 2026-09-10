# AllGo Mobile

Monorepo de l'application mobile **AllGo** (Mahajanga, Madagascar) — portage mobile de la
plateforme de commerce social *Janga Market*.

Référence normative : [`docs/CAHIER_DES_CHARGES_MOBILE_FLUTTER.md`](docs/CAHIER_DES_CHARGES_MOBILE_FLUTTER.md).

## Contenu du dépôt

| Dossier | Rôle |

| `mobile/` | Application Flutter (Android / iOS) — architecture en couches §4.3 |
| `backend/` | API NestJS + Prisma (MySQL) — §5.1, §7 |
| `migration/` | `dumps/` (exports phpMyAdmin, alimentent la base MariaDB locale) toujours utilisés ; l'outil CLI MariaDB→MongoDB qui l'accompagne est obsolète depuis la Phase 6 (migration terminée dans l'autre sens : tout est resté/revenu sur MySQL) |
| `docs/` | Cahier des charges, ADR, dictionnaire des collections |
| `docker-compose.yml` | MariaDB, Redis |

## Trajectoire retenue

**Trajectoire C — migration progressive par domaine**, achevée. Le backend est
désormais **100 % MySQL** : MongoDB a été entièrement retiré (Phase 6, voir
ci-dessous). Voir chapitre 15 du cahier des charges pour l'historique de la
démarche.

## Migration MySQL (o2switch) — état et accès de test

**Migration terminée (Phase 6).** Tous les domaines — Auth/Utilisateurs
(Phase 1), Catalogue/Boutiques/Géolocalisation (Phase 2), Commandes/Panier/
Paiements/Finance/Livreur (Phase 3), Réseau social/Messagerie/Stories/
Campagnes (Phase 4), Modération/Avis (Phase 5), Notifications (Phase 5-bis),
et Stock/Retraits livreur/Retraits marchand/Profil livreur/Préférences/
Terminaux (Phase 6) — lisent et écrivent directement sur la vraie base de
production o2switch (`arur4976_janga_market`, partagée avec le site web
JangaMarket) via Prisma. **MongoDB, Argon2, `@nestjs/mongoose`,
`mongodb-memory-server` ont été entièrement retirés du code et des
dépendances** — l'application démarre sans aucun conteneur Mongo (vérifié en
direct, Phase 6).

L'identité de session (`AuthenticatedUser.id`) est désormais l'entier MySQL
direct — la bascule depuis l'ancien pont miroir Mongo a entraîné une
**déconnexion globale ponctuelle de tous les comptes** (assumée, décidée à
l'avance). Le stockage média est passé de S3/MinIO à un **dossier local**
(`MediaService`, voir la section Médias plus bas).

**Docker (MariaDB + Redis)** reste utile en développement local : MariaDB
héberge un clone de la base réelle (dumps phpMyAdmin), Redis porte les OTP,
les jetons de téléversement à usage unique, les verrous d'idempotence et les
compteurs de tentatives de connexion.

**SMS et paiements mobile money réels ne sont pas encore branchés** — décision
assumée (§ mise en marché) : plutôt qu'un faux succès silencieux, l'API
renvoie une indisponibilité explicite (`503`) tant qu'aucun fournisseur n'est
configuré. Voir `SmsService`/`PaymentProvider.isAvailable()` — le paiement à
la livraison (`cod`) reste pleinement fonctionnel dans tous les cas.

**Accès à la base réelle** : hébergement mutualisé, pas d'accès MySQL direct
depuis l'extérieur — un tunnel SSH est nécessaire :

```bash
ssh -i <clé> -N -L 3307:/tmp/mysql.sock arur4976@grenier.o2switch.net
# DATABASE_URL="mysql://arur4976_janga_user:***@127.0.0.1:3307/arur4976_janga_market"
```

L'IP sortante doit être autorisée dans cPanel → **Autorisation SSH** (entrée
+ sortie, port 22) : une IP qui change (redémarrage box, nouveau réseau) sans
être réautorisée se traduit par un tunnel qui *time-out silencieusement* (pas
de refus explicite) — vérifier `curl https://api.ipify.org` en cas de blocage
inexpliqué.

### Comptes de test (base réelle)

Créés pour vérifier en direct le parcours complet panier → commande →
paiement → litige → remboursement → livreur, sans jamais toucher aux comptes
réels de production. Mot de passe unique : `TestAllgo2026`.

| Rôle | Téléphone | `mysqlId` | Détail |

| Client | `+261339990001` | 16 | Compte d'achat, sans historique |
| Propriétaire boutique | `+261339990002` | 17 | Propriétaire de « Boutique Test Phase3 » (id 3) |
| Livreur | `+261339990003` | 18 | Membre d'équipe (`shop_courier`) de la boutique de test |
| Administrateur | `+261339990004` | 19 | `role_id = 1` (`platform_admin`) |

**Boutique et produit** : `Boutique Test Phase3` (id 3, slug
`boutique-test-phase3`) / `Produit Test Phase3` (id 3, 5 000 Ar, stock 50).
Les commandes/paiements/litiges créés lors des vérifications sont nettoyés
après coup — seuls ces comptes, la boutique et le produit restent en base
comme jeu de test réutilisable.

### Défauts trouvés en exécutant ce parcours contre la base réelle

Aucun n'était détectable par `tsc`/les tests unitaires — seule l'exécution
réelle (connexion, checkout, livraison) les a révélés :

1. **`RoleAssignment.shopId` (miroir Mongo `User`) était resté typé en
   ObjectId** (`ref: 'Shop'`) alors que les boutiques sont des entiers MySQL
   depuis la Phase 2 — Mongoose plantait en tentant de caster `"3"` en
   ObjectId dès qu'un propriétaire de boutique ou un membre d'équipe se
   reconnectait (`/auth/login` → `INTERNAL_ERROR`). **Tout propriétaire de
   boutique réel était donc bloqué hors de son compte** dès l'expiration de
   son jeton. Corrigé : `shopId` en `Number`.
2. **`SHOP_TEAM_ROLES` (validateur DTO) omettait `shop_courier`** — aucun
   livreur ne pouvait jamais être ajouté à l'équipe d'une boutique via l'API,
   alors que le service et les permissions le permettaient déjà.
3. **`payments.service.ts`/`.controller.ts`/`.module.ts` n'avaient jamais été
   migrés** : ils interrogeaient encore le schéma Mongo `Order` (`_id`,
   `payment.status`, `amounts.total`), inexistant depuis la bascule des
   commandes sur MySQL (Phase 3) — tout appel à `/payments/initiate` ou au
   rappel fournisseur échouait silencieusement. Réécrit sur la vraie table
   `payments` (une ligne par tentative) + `orders.payment_status`.
4. **Le `timeout` par défaut de Prisma (5 s) pour une transaction
   interactive** est trop court dès qu'il y a plusieurs allers-retours réseau
   non négligeables vers la base (tunnel SSH compris) — la création de
   commande échouait après le décrément de stock mais avant l'écriture de
   l'historique. Porté à 15 s pour `OrdersService.create()`.
5. **Suspendre un compte depuis la modération ne l'empêchait pas de se
   reconnecter** — `ModerationService`/`AdministrationService` n'écrivaient
   que le miroir Mongo `User.status`, jamais `prisma.users.status`, la seule
   colonne que vérifie réellement `AuthService.login()`. Vérifié en direct :
   un compte de test suspendu via `/moderation/reports/:id` (action
   `suspension`) pouvait toujours se connecter avant le correctif, plus
   après. Corrigé par résolution du miroir vers l'entier MySQL réel avant
   toute suspension (`ModerationService.suspendMirroredUser`).
6. **`SHOP_TEAM_ROLES` (validateur DTO)** listait déjà `shop_courier` avant
   ce constat n°2 plus haut, mais la table `favorites` (générique, héritée du
   web) n'était en réalité **jamais utilisée** par `FavoritesService` malgré
   la migration Phase 2 — `product`/`shop`/`promotion`/`post` écrivaient tous
   dans l'ancienne collection Mongo `Favorite`. Découvert en relisant le
   code avant la Phase 4, corrigé en même temps que la migration des trois
   autres types.
7. **Suspendre un compte depuis le panneau `/admin/users/:id` (et pas
   seulement `/moderation/reports`, voir n°5) avait le même défaut** :
   `AdministrationService.updateUser/removeUser` n'écrivaient eux aussi que
   le miroir Mongo. Corrigé au même endroit du code, vérifié en direct par
   le même scénario (suspension → tentative de connexion refusée →
   réactivation → connexion à nouveau possible).
8. **`GET /reviews?targetType=…&targetId=…` renvoyait `INTERNAL_ERROR` dès
   que `limit` n'était pas fourni explicitement** — `@Query('limit') limit?:
   number` sans DTO dédié ne convertit ni ne borne rien : Mongoose tolérait
   silencieusement un `.limit(NaN)` (aucun filtre appliqué), Prisma rejette
   `take: NaN` avec une erreur de validation. Invisible tant que `reviews`
   restait sur Mongo, découvert dès la première lecture réelle après la
   migration Phase 5. Corrigé par un `ReviewsQueryDto` dédié (même motif que
   `ShopQueryDto`/`FavoritesQueryDto`), qui borne aussi `limit` à 100.
9. **Régression introduite par la Phase 4 elle-même** : `ShopsService.dashboard()`
   (statistiques `publicationEngagement`/`promotionPerformance`) et
   `ShopsService.postsFor()` (onglet « Publications » d'une boutique)
   continuaient d'interroger les collections Mongo `Post`/`Promotion`,
   devenues silencieusement mortes en écriture dès que la Phase 4 a basculé
   les publications/promotions sur MySQL — le tableau de bord d'une boutique
   affichait donc des statistiques figées à zéro et la liste de ses
   publications restait vide, sans jamais lever d'erreur. Corrigé par un
   `$queryRaw` à sous-requêtes corrélées (comptes posts/réactions/commentaires/
   partages par `shop_id`) et un `prisma.promotions.count()` pour le tableau
   de bord, et une réécriture complète de `postsFor()` sur `prisma.posts`.
   Vérifié en direct : création d'une publication + réaction + commentaire
   test sur « Boutique Test Phase3 », confirmation que les compteurs du
   tableau de bord et la liste des publications reflètent bien ce contenu,
   puis suppression du contenu de test et retour à zéro confirmé.
10. **`NotificationsService` écrivait dans une collection Mongo entièrement
    séparée de la vraie table MySQL `notifications`** (déjà utilisée par le
    site web, colonnes `id`/`user_id`/`type`/`data`/`is_read`/`created_at`,
    sans jamais avoir de trace côté mobile) — une notification créée côté
    mobile (nouveau message, commande…) n'apparaissait jamais côté web, et
    inversement : deux silos qui ne se voient pas, découvert lors de l'audit
    final post-Phase 5 (aucun module ne dépendait plus de Mongo à ce point,
    sauf celui-ci). Colonnes `title`/`body`/`expires_at` ajoutées à la table
    (le mobile attend un texte déjà localisé, la table héritée du web ne
    stockait que `type`/`data`) ; réécrit sur `prisma.notifications`, purge
    automatique horaire (`NotificationsCleanupService`, `@Cron`) remplaçant
    l'index TTL Mongo. Vérifié en direct : message test client → boutique,
    notification réelle créée en base avec le bon titre/corps, marquage
    comme lue, puis nettoyage (notification, message, conversation de test
    supprimés).
11. **Le pipeline de redimensionnement d'image n'a jamais existé** —
    `sharp`/`bullmq` étaient en dépendance depuis le début, mais aucun code
    ne les utilisait : `MediaService.publicUrls()` construisait des URL vers
    des variantes `_200`/`_800`/`_1600.webp` qui n'ont jamais été générées,
    quel que soit l'environnement (S3/MinIO en local comme en tests). Le
    téléversement direct vers S3 rendait ce traitement server-side
    structurellement impossible (le serveur ne voit jamais les octets).
    Découvert en concevant le remplacement par un stockage disque local
    (§ décision du 2026-09-10) : le nouveau flux fait transiter les octets
    par l'API (jeton Redis à usage unique au lieu d'un présigné S3), ce qui a
    permis d'implémenter réellement `sharp` à la réception. Vérifié en
    direct : upload d'une image de test, les 3 fichiers WebP existent bien
    sur disque et sont servis avec le bon type MIME ; un fichier déguisé
    (mauvais octets sous une extension `.jpg`) est rejeté (`INVALID_IMAGE`).
12. **Trois envois temps réel n'ont jamais atteint leur destinataire** —
    `events.gateway.ts` (position du livreur) et `orders.service.ts`
    (changement de statut, ×2) appelaient `emitToUser(String(mysqlId), ...)`
    alors que les sockets rejoignaient un salon nommé d'après l'ObjectId du
    miroir Mongo (`user:${claims.sub}`) : les deux formats ne coïncidaient
    jamais, ces trois poussées étaient silencieusement perdues depuis leur
    écriture. Corrigé de facto par la bascule d'identité (Phase 6) —
    `claims.sub` est désormais le même entier MySQL que celui déjà utilisé
    par ces trois appels.
13. **`GET /moderation/sanctions/me` renvoyait toujours une liste vide** —
    passait `user.id` (l'ObjectId miroir) à une méthode qui n'acceptait que
    des entiers MySQL ; `Number(ObjectId)` échoue silencieusement. Corrigé en
    passant `user.mysqlId` explicitement, indépendamment de la bascule
    d'identité générale.

## Déploiement o2switch (cPanel « Setup Node.js App »)

Node.js y tourne derrière **Phusion Passenger** — contraintes déjà
respectées par le code : un seul appel `app.listen(port, '0.0.0.0')`
(`src/main.ts`), et `PORT` lu depuis l'environnement
(`src/config/configuration.ts`). `app.js` à la racine du dépôt sert de point
d'entrée Passenger (`require('./dist/main.js')`) — renseigner directement
`dist/main.js` comme « Application startup file » dans l'UI cPanel fonctionne
aussi tout aussi bien, `app.js` n'est qu'un raccourci.

**Depuis la Phase 6, plus aucune infrastructure externe n'est requise** —
MongoDB, S3/MinIO ont été entièrement retirés. Le backend ne dépend plus que
de MySQL (déjà en place, partagé avec le site web) et de Redis (Redis Manager
cPanel, **version 7.x recommandée** — pleinement compatible avec
`ioredis@5.4.1`, une version ≥ 6.2 convient aussi si c'est la seule
disponible).

Marche à suivre :

1. **Setup Node.js App** (cPanel) → créer une application : version Node
   ≥ 20 (`engines.node` du `package.json`), dossier racine = ce dépôt
   (`backend/`), mode **Production**, fichier de démarrage `app.js`.
2. Variables d'environnement dans l'onglet dédié de cPanel — **jamais de
   `.env` versionné** :
   - `NODE_ENV=production`
   - `DATABASE_URL` (Prisma → `arur4976_janga_market`, en local sur le
     serveur o2switch lui-même — plus de tunnel SSH nécessaire une fois déployé)
   - `REDIS_URL` (Redis Manager cPanel, généralement
     `redis://:<mot-de-passe>@127.0.0.1:6379` — à confirmer dans l'écran cPanel)
   - `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` (générés pour la prod, jamais
     réutilisés du `.env` de dev)
   - `API_PUBLIC_BASE_URL` (`https://allgomada.com/v1` — domaine réel,
     certificat Let's Encrypt valide ; `arur4976.odns.fr` est le domaine
     technique temporaire d'o2switch, dont la zone DNS parente `odns.fr`
     empêche Let's Encrypt d'y émettre un certificat, § SERVFAIL CAA constaté
     en direct) — sert à construire les liens de téléversement média, doit
     pointer sur le domaine public réel
   - `MEDIA_STORAGE_PATH` (chemin absolu serveur vers un dossier du docroot
     public, ex. `/home/arur4976/public_html/media`) et
     `MEDIA_PUBLIC_BASE_URL` (`https://allgomada.com/media`) — le
     dossier est créé automatiquement au démarrage, avec un `.htaccess` qui y
     désactive l'exécution de scripts (§ sécurité, `MediaService`)
   - `CORS_ORIGINS`
   - **Ne pas définir `PAYMENTS_DEMO_MODE`** (absent = mode démo désactivé,
     § décision mise en marché). `SMS_GATEWAY_*` absents tant qu'aucun
     fournisseur n'est branché (comportement « indisponible » assumé).
3. Sur le terminal cPanel (ou SSH) **directement sur le serveur, jamais
   depuis un poste Windows** : bouton « Run NPM Install » (ou `npm install`),
   puis `npx prisma generate` (télécharge le moteur natif Linux — copier un
   `node_modules` généré sous Windows casserait Prisma), puis `npm run
   build`. Point de vigilance supplémentaire : `sharp` (traitement d'image)
   embarque lui aussi un binaire natif par plateforme — un `npm install`
   exécuté sur le serveur cible le récupère automatiquement, une copie
   Windows non.
4. Redémarrer l'application depuis l'UI « Setup Node.js App ».
5. Vérifier `GET /v1/docs` (Swagger) et un endpoint réel derrière le proxy
   Passenger.

## Démarrage

### 1. Infrastructure locale

```bash
docker compose up -d
# MariaDB : localhost:3306 (clone local, alimenté par migration/dumps/*.sql)
# Redis   : localhost:6379
```

### 2. API

```bash
cd backend
cp .env.example .env      # renseigner les secrets — aucun secret n'est versionné (§12.1)
npm install
npm run start:dev         # http://localhost:3000/v1
                          # OpenAPI : http://localhost:3000/docs
```

Générer les deux secrets JWT :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

**Données de test** : il n'y a plus de script `npm run seed` — la base de
développement est un clone MariaDB de la vraie base (dumps phpMyAdmin sous
`migration/dumps/`), ou directement la base de production o2switch via le
tunnel SSH (§ ci-dessus). Les comptes de test réutilisables sont documentés
dans « Comptes de test (base réelle) » plus haut.

Exemples de vérification après le démarrage de l'API :

```bash
curl "http://localhost:3000/v1/products?limit=20"
curl "http://localhost:3000/v1/geo/shops?lat=-15.7167&lng=46.3167&radius=5"
curl "http://localhost:3000/v1/campaigns/flash"
curl "http://localhost:3000/v1/search?q=riz"
```

Sur l'émulateur Android, l'application doit viser `10.0.2.2` et non `localhost`.
Sous Windows PowerShell, utiliser `npm.cmd run ...` si la politique d'exécution bloque
`npm.ps1`.

Tests**

```bash
npm test              # unitaires — aucune infrastructure requise
npm run test:integration   # exige `docker compose up -d` (Redis)
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
flutter build apk --release --no-tree-shake-icons \
  --dart-define=API_BASE_URL=http://<IP-DU-POSTE>:3000/v1 \
  --dart-define=SOCKET_URL=http://<IP-DU-POSTE>:3000
# Sortie : mobile/build/app/outputs/flutter-apk/app-release.apk
```

Sans `--dart-define`, l'APK vise `10.0.2.2` (émulateur uniquement — voir
`lib/core/env/environment.dart`). L'IP est figée au moment de la compilation :
une IP locale qui change (nouveau réseau, bail DHCP renouvelé) exige de
reconstruire l'APK.

> **`--no-tree-shake-icons` est obligatoire, pas optionnel.** De nombreuses
> icônes de l'application sont choisies dynamiquement (table de correspondance
> catégorie→icône, `switch` selon un statut, onglet actif de la barre de
> navigation…). L'outil de tree-shaking de Flutter ne détecte que les icônes
> référencées comme constante littérale (`Icons.xxx` en dur) : toute icône
> choisie dynamiquement est supprimée de la police embarquée en `--release`,
> et s'affiche comme un simple carré vide au lieu du glyphe attendu — un bogue
> invisible en `--debug` (où le tree-shaking est désactivé), qui n'apparaît
> qu'à l'installation réelle. Omettre ce drapeau réintroduit silencieusement
> des icônes cassées dans toute l'application.

### Correspondance avec le cahier des charges mobile

Le cahier des charges est prévisionnel. L'état réel du dépôt est le suivant —
mis à jour après une passe d'exécution réelle bout en bout (API démarrée, jeu de
données chargé, chaque fonctionnalité appelée par au moins une requête), pas
seulement une relecture du code :

| Lot | État dans ce dépôt | Reste à livrer |

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

| `intl` | `^0.20.3` | imposée par `flutter_localizations` du SDK |
| `build_runner` | `>=2.15.1 <2.15.2` | 2.15.2+ exige `analyzer` ≥ 13, que `freezed 3.2.5` refuse |
| `freezed` | `^3.2.5` | la 2.x embarque un `analyzer` en langage 3.9 qui plante sur la syntaxe Dart 3.13 |

`custom_lint`, `riverpod_lint`, `riverpod_annotation` et `retrofit` sont
délibérément écartés — chaque motif est inscrit dans `pubspec.yaml`.

### 4. Migration (obsolète)

`migration/` contenait l'outillage CLI d'une migration MariaDB → MongoDB
domaine par domaine — direction abandonnée : la Phase 6 a confirmé MySQL
comme source de vérité définitive pour l'ensemble du backend. Seul
`migration/dumps/` (exports phpMyAdmin) reste utile, pour alimenter la base
MariaDB locale de développement (§ Démarrage). Le reste du paquet peut être
retiré du dépôt à l'occasion, il n'est plus exécuté par rien.

## Écarts assumés par rapport au cahier des charges

Les décisions qui s'écartent de la spécification sont consignées en ADR, jamais
laissées implicites dans le code :

| ADR | Sujet | Écart |

| [0001](docs/adr/0001-serveur-api-et-trajectoire-de-migration.md) | Serveur d'API et trajectoire | Le cahier des charges ne nomme pas le serveur d'API ; NestJS est retenu, trajectoire C |
| 0002 (levée) | `stockMovements` | Gardait cette collection sur Mongo pour contourner une incompatibilité §6.2/§6.3 propre à MongoDB (série temporelle vs transaction) — sans objet depuis la Phase 6 : `stock_movements` est une table MySQL ordinaire comme le reste du domaine boutique |

## Conventions

- **Sécurité par défaut** : toute route d'API est refusée sauf déclaration explicite d'une
  permission via `@RequirePermission()`. Un test d'ossature échoue en CI si une route n'a
  pas de garde (§3.2, §12.1).
- **Hors ligne d'abord** : l'interface Flutter lit toujours Drift ; le réseau alimente le
  cache, il ne bloque jamais l'affichage (§9.1).
- **Montants** : `Decimal`/`DECIMAL` côté MySQL (Prisma), jamais `Double`/`Float` (§15.4).
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

8.**Le client annonçait `Accept-Encoding: br, gzip`** — l'intergiciel de
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
