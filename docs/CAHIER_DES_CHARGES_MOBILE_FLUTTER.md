# Cahier des charges — Application mobile AllGo

**Version mobile Flutter de la plateforme de commerce social AllGo / Janga Market**

| | |
|---|---|
| **Projet** | AllGo Mobile — application Android & iOS |
| **Système existant** | Plateforme web PHP 8.2 / MariaDB (voir [CAHIER_DES_CHARGES_SYSTEME.md](CAHIER_DES_CHARGES_SYSTEME.md)) |
| **Technologies imposées** | Flutter (client mobile), MongoDB (base de données) |
| **Périmètre géographique** | Mahajanga, Madagascar |
| **Version du document** | 1.0 |
| **Date** | 18 août 2026 |
| **Nature** | Cahier des charges **prévisionnel** — spécification avant développement |
| **Auteur** | JAONARISON Soloniaina Ardino Urielly |

---

## Avertissement préalable — la décision structurante du projet

Flutter est un client. MongoDB est une base de données. Entre les deux, il manque une pièce que le cahier des charges ne nomme pas et qui détermine tout le reste : **le serveur d'API**.

La plateforme web actuelle n'expose aucune API. Six méthodes seulement renvoient du JSON, sur 278 routes : le reste produit du HTML assemblé côté serveur. Une application Flutter ne peut consommer aucune de ces routes.

Par conséquent, choisir MongoDB revient à **construire un backend entièrement nouveau**, distinct du code PHP existant. Trois trajectoires sont possibles :

| Trajectoire | Description | Verdict |
|---|---|---|
| **A. Double base durable** | MariaDB reste la référence du web, MongoDB sert le mobile, synchronisation permanente entre les deux | ❌ **Déconseillée.** Deux sources de vérité pour les mêmes commandes et le même stock produisent des divergences inévitables. La synchronisation bidirectionnelle d'un stock est un problème sans solution simple. |
| **B. Bascule immédiate** | Le web PHP est réécrit pour consommer la nouvelle API, MongoDB devient la seule base | ❌ **Irréaliste.** 24 436 lignes de PHP à reprendre avant la première ligne de Flutter. |
| **C. Migration progressive** *(recommandée)* | MongoDB devient la source de vérité par domaine, un domaine à la fois. Le PHP consomme l'API pour les domaines déjà migrés. MariaDB s'éteint progressivement. | ✅ **Retenue.** Détaillée au chapitre 15. |

**Le présent document est rédigé sous l'hypothèse de la trajectoire C.** Il spécifie l'application Flutter, l'API et le modèle MongoDB, ainsi que le plan de migration qui permet aux deux systèmes de coexister sans jamais dupliquer une source de vérité.

---

## Table des matières

1. [Objet, portée et objectifs](#1-objet-portée-et-objectifs)
2. [Périmètre mobile — ce qui va sur mobile et ce qui reste sur le web](#2-périmètre-mobile)
3. [Acteurs et rôles](#3-acteurs-et-rôles)
4. [Architecture cible](#4-architecture-cible)
5. [Choix technologiques et justifications](#5-choix-technologiques-et-justifications)
6. [Modèle de données MongoDB](#6-modèle-de-données-mongodb)
7. [Spécification de l'API](#7-spécification-de-lapi)
8. [Spécifications fonctionnelles — écrans et parcours](#8-spécifications-fonctionnelles)
9. [Mode hors ligne et synchronisation](#9-mode-hors-ligne-et-synchronisation)
10. [Notifications push et temps réel](#10-notifications-push-et-temps-réel)
11. [Design system et ergonomie mobile](#11-design-system-et-ergonomie-mobile)
12. [Sécurité](#12-sécurité)
13. [Exigences non fonctionnelles](#13-exigences-non-fonctionnelles)
14. [Paiements mobile money](#14-paiements-mobile-money)
15. [Stratégie de migration MariaDB → MongoDB](#15-stratégie-de-migration)
16. [Tests et qualité](#16-tests-et-qualité)
17. [CI/CD, distribution et exploitation](#17-cicd-distribution-et-exploitation)
18. [Planning par lots et charge](#18-planning-par-lots-et-charge)
19. [Livrables](#19-livrables)
20. [Risques et mesures de maîtrise](#20-risques-et-mesures-de-maîtrise)
21. [Annexes](#21-annexes)

---

## 1. Objet, portée et objectifs

### 1.1 Objet

Spécifier l'application mobile native AllGo, portage de la plateforme web de commerce social vers Android et iOS, ainsi que le backend d'API et la base MongoDB qui la servent.

### 1.2 Contexte et justification du projet

Le web actuel est responsive, mais un site responsive et une application mobile ne rendent pas le même service dans le contexte de Mahajanga :

| Contrainte locale | Ce que le web ne peut pas faire | Ce que l'application apporte |
|---|---|---|
| Connexion 3G intermittente, coupures fréquentes | Chaque page exige un aller-retour réseau | Consultation hors ligne du catalogue, du panier et des commandes ; file d'attente des actions |
| Coût des données mobiles | Rechargement complet du HTML à chaque navigation | Échanges JSON compressés, images redimensionnées côté serveur, cache local |
| Terminaux d'entrée de gamme | Rendu HTML lourd, 8 517 lignes de CSS | Rendu natif compilé en AOT |
| Notifications | Sondage HTTP toutes les 5 secondes, uniquement onglet ouvert | Push système, application fermée |
| Métiers de terrain (livreur, commercial) | GPS approximatif, pas d'appareil photo natif | GPS continu, appareil photo, scan de code-barres, appel direct |
| Mobile money | Saisie manuelle de la référence | Intégration des API MVola, Orange Money, Airtel Money |

### 1.3 Objectifs

**Objectif principal** — Mettre à disposition des habitants et des commerçants de Mahajanga une application utilisable dans les conditions réelles du terrain : réseau instable, terminaux modestes, données coûteuses.

**Objectifs opérationnels**

| # | Objectif | Indicateur de réussite |
|---|---|---|
| O1 | Consultation du catalogue sans connexion | 100 % du dernier catalogue consulté reste accessible hors ligne |
| O2 | Démarrage rapide | Démarrage à froid < 2 s sur Android d'entrée de gamme (4 Go de RAM) |
| O3 | Frugalité réseau | < 1,5 Mo de données pour une session type de 5 minutes |
| O4 | Notifications fiables | Livraison push < 10 s, application fermée |
| O5 | Adoption commerçant | 60 % des commandes traitées depuis mobile à 6 mois |
| O6 | Correction des failles du web | Les 3 failles critiques du chapitre 10.2 du document système sont fermées par conception |

### 1.4 Portée

**Inclus** : application Flutter Android et iOS, backend d'API, base MongoDB, stockage objet des médias, notifications push, temps réel, outillage de migration, CI/CD.

**Exclus** : refonte de l'interface web (traitée par la migration progressive du chapitre 15), version tablette optimisée (l'application reste utilisable mais non optimisée), application de bureau, module ERP complet sur mobile (voir chapitre 2).

---

## 2. Périmètre mobile

Porter les 278 routes web sur mobile serait une erreur de conception. Un téléphone n'est pas un poste de gestion : la saisie d'un inventaire de 400 références, l'import CSV ou la configuration des rôles n'ont pas leur place sur un écran de 6 pouces.

Le périmètre est donc arbitré **métier par métier**, selon que l'activité est de terrain ou de bureau.

### 2.1 Arbitrage par rôle

| Rôle | Couverture mobile | Justification |
|---|---|---|
| **Client** | 🟢 **Complète** | Cœur de cible. Tout le parcours d'achat et social. |
| **Livreur** | 🟢 **Complète et enrichie** | Métier 100 % terrain : GPS, navigation, preuve de livraison photo, appel client. Le mobile est *supérieur* au web. |
| **Commercial** | 🟢 **Complète et enrichie** | Prospection et réponse aux demandes clients en déplacement. Appareil photo pour publier un produit sur le fil. |
| **Caissier** | 🟢 **Complète** | Encaissement au comptoir depuis un téléphone, facture envoyée par WhatsApp ou SMS. |
| **Admin Commerçant** | 🟡 **Pilotage et validation** | Tableaux de bord, alertes, validation de commandes, gestion d'équipe. Configuration fine renvoyée au web. |
| **Manager (ERP)** | 🟡 **Opérations de terrain uniquement** | Consultation du stock, entrée/sortie unitaire, scan de code-barres, alertes. **Inventaire complet, import/export et rapports restent sur le web.** |
| **Stock** | 🟡 **Mouvements et alertes** | Idem Manager, périmètre réduit. |
| **Marketing** | 🟡 **Consultation** | Suivi des campagnes ; création renvoyée au web. |
| **Administrateur plateforme** | 🔴 **Hors périmètre mobile** | Modération, validation de boutiques et paramétrage restent sur le back-office web. Une application d'administration séparée pourra être envisagée ultérieurement. |

### 2.2 Fonctionnalités exclusivement mobiles

Fonctions impossibles ou dégradées sur le web, qui justifient à elles seules le projet :

| Fonction | Bénéficiaire |
|---|---|
| Scan de code-barres / QR pour identifier un produit | Manager, Stock, Caissier |
| Preuve de livraison par photo horodatée et géolocalisée | Livreur |
| Navigation GPS turn-by-turn vers l'adresse de livraison | Livreur |
| Suivi de livraison en direct sur carte | Client |
| Publication depuis l'appareil photo, avec compression avant envoi | Tous |
| Notifications push application fermée | Tous |
| Appel téléphonique et WhatsApp en un geste depuis une commande | Commercial, Livreur, Client |
| Partage natif d'un produit vers WhatsApp, Facebook, SMS | Client |
| Alerte de proximité : « 3 commerces de votre liste d'envies à moins de 500 m » | Client |
| Mode hors ligne complet | Tous |

---

## 3. Acteurs et rôles

Le modèle de rôles du web est **simplifié et corrigé**. Le système actuel superpose trois mécanismes indépendants (rôle de plateforme, niveau d'administration, rôle d'équipe) et enregistre un caissier comme `merchant`, ce qui a directement causé la faille d'accès du chapitre 10.2 du document système.

### 3.1 Modèle unifié retenu

Un utilisateur porte **une liste de rôles**, chacun éventuellement rattaché à une portée (`scope`) :

```json
{
  "roles": [
    { "role": "client" },
    { "role": "shop_manager",   "shopId": "6712ab…" },
    { "role": "shop_cashier",   "shopId": "6798cd…" }
  ]
}
```

| Rôle | Portée | Remplace, dans le web |
|---|---|---|
| `client` | globale | `client` |
| `shop_owner` | boutique | `merchant` propriétaire |
| `shop_manager` | boutique | `team_role = manager` |
| `shop_sales` | boutique | `team_role = commercial` |
| `shop_cashier` | boutique | `team_role = caissier` |
| `shop_stock` | boutique | `team_role = stock` |
| `shop_courier` | boutique | `team_role = livreur` |
| `shop_marketing` | boutique | `team_role = marketing` |
| `platform_admin` | globale | `admin` + `admin_level` |

**Trois gains décisifs par rapport au web :**

1. Un utilisateur peut cumuler des rôles dans plusieurs boutiques — impossible aujourd'hui (`shop_team_members.user_id` est en contrainte `UNIQUE`).
2. Chaque rôle porte sa portée : une autorisation ne peut plus s'appliquer accidentellement à toute la plateforme, ce qui est exactement l'origine de la faille `/admin/merchant-accounts/*`.
3. Un seul mécanisme à comprendre, donc un seul endroit où se tromper.

### 3.2 Permissions

Les permissions sont des chaînes explicites (`order:read`, `order:update_status`, `stock:move`, `team:manage`…), attribuées par rôle dans une table de référence versionnée. Chaque point d'entrée d'API déclare la permission et la portée qu'il exige. **Aucune route ne peut être publiée sans déclaration explicite** — un test automatisé de l'ossature échoue si une route n'a pas de garde.

---

## 4. Architecture cible

### 4.1 Vue d'ensemble

```
┌──────────────────────────────────────────────────────────────────┐
│                        CLIENTS                                    │
│                                                                   │
│   ┌─────────────────────────┐      ┌──────────────────────────┐  │
│   │   AllGo Mobile          │      │   AllGo Web (PHP)        │  │
│   │   Flutter — iOS/Android │      │   existant, migré par     │  │
│   │   • cache local Drift   │      │   domaines successifs     │  │
│   │   • file d'actions      │      │                          │  │
│   └───────────┬─────────────┘      └────────────┬─────────────┘  │
└───────────────┼──────────────────────────────────┼───────────────┘
                │ HTTPS / REST + WebSocket         │ HTTPS / REST
                ▼                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│                    API AllGo — NestJS (TypeScript)                │
│                                                                   │
│   Gardes JWT + permissions │ Validation DTO │ OpenAPI généré      │
│   Modules : auth · catalog · orders · social · messaging ·        │
│             stock · billing · geo · notifications · admin         │
│   Passerelle WebSocket (Socket.IO)                                │
│   Jobs asynchrones (BullMQ) : images, push, exports, relances     │
└──────┬─────────────────┬──────────────────┬──────────────┬───────┘
       ▼                 ▼                  ▼              ▼
┌────────────┐   ┌──────────────┐   ┌──────────────┐  ┌──────────┐
│  MongoDB   │   │    Redis     │   │ Stockage S3  │  │   FCM    │
│  Replica   │   │ cache · file │   │ MinIO / R2   │  │  Push    │
│  Set       │   │ sessions WS  │   │ médias       │  │          │
└────────────┘   └──────────────┘   └──────────────┘  └──────────┘
       │
       │ (phase de transition uniquement — chapitre 15)
       ▼
┌────────────────────────────────────────────┐
│  MariaDB existante — lecture seule,         │
│  domaine par domaine, jusqu'à extinction    │
└────────────────────────────────────────────┘
```

### 4.2 Principes d'architecture

| Principe | Application concrète |
|---|---|
| **API d'abord** | Le contrat OpenAPI est écrit et validé avant le code. Flutter et backend se développent en parallèle contre un serveur simulé. |
| **Source de vérité unique** | Chaque domaine métier a exactement une base de référence à un instant donné. Jamais de double écriture. |
| **Hors ligne d'abord** | L'interface lit toujours le cache local. Le réseau alimente le cache, il ne bloque jamais l'affichage. |
| **Sécurité par défaut** | Toute route est refusée sauf déclaration explicite d'une permission. L'inverse du modèle web actuel. |
| **Frugalité** | Charges utiles minimales, pagination par curseur, images dimensionnées par le serveur, compression Brotli. |
| **Observabilité** | Journalisation structurée corrélée par identifiant de requête, du geste utilisateur jusqu'à la requête MongoDB. |

### 4.3 Découpage en couches — application Flutter

```
lib/
├── main.dart
├── app/                    Amorçage, thème, routage, injection
├── core/
│   ├── network/            Client Dio, intercepteurs, gestion des erreurs
│   ├── storage/            Drift (cache), secure storage (jetons)
│   ├── sync/               File d'actions différées, moteur de synchronisation
│   ├── error/              Types d'échec, correspondance vers messages utilisateur
│   └── utils/              Formatage Ariary, dates, distances
├── features/               Un dossier par domaine métier
│   └── <domaine>/
│       ├── data/           Sources distante et locale, implémentations de dépôts
│       ├── domain/         Entités, contrats de dépôts, cas d'usage
│       └── presentation/   Écrans, composants, contrôleurs Riverpod
└── shared/                 Composants, design system, localisation
```

**Règle de dépendance** : `presentation → domain ← data`. La couche `domain` ne dépend d'aucune bibliothèque externe : elle reste testable sans Flutter ni réseau.

---

## 5. Choix technologiques et justifications

Flutter et MongoDB sont imposés. Le reste de la pile est arbitré ci-dessous, chaque choix étant motivé par une contrainte du projet et non par une préférence générale.

### 5.1 Backend

| Besoin | Choix | Justification |
|---|---|---|
| Cadre applicatif | **NestJS** (TypeScript) | Modules, gardes et intercepteurs reproduisent les concepts déjà maîtrisés du web (contrôleurs, middlewares) — la courbe d'apprentissage est réduite. TypeScript partage son modèle de types avec Dart, ce qui simplifie la génération des modèles clients. Génération OpenAPI native. |
| Accès MongoDB | **Mongoose** | Schémas explicites, validation, hooks, population. Un ODM à schéma est indispensable : sans lui, une base documentaire dérive en quelques mois. |
| Validation d'entrée | **class-validator** + **class-transformer** | Validation déclarative sur chaque DTO. Corrige directement la « validation inégale selon les contrôleurs » constatée sur le web. |
| Authentification | **JWT** (accès 15 min + rafraîchissement 30 j) + **Argon2id** | Argon2id remplace bcrypt : résistant au calcul GPU, lauréat du concours de hachage de mots de passe. Jeton de rafraîchissement rotatif et révocable. |
| Temps réel | **Socket.IO** | Remplace le sondage HTTP de 5 secondes. Repli automatique en interrogation longue quand les WebSockets sont bloquées — fréquent sur les réseaux mobiles malgaches. |
| File de traitement | **BullMQ** sur Redis | Traitement d'images, envoi de push, exports, relances de paiement — hors du cycle de requête. |
| Cache | **Redis** | Catalogue, résultats géographiques, compteurs de limitation de débit, sessions WebSocket. |
| Stockage des médias | **MinIO** (auto-hébergé) ou **Cloudflare R2** | Compatible S3. Sort les médias du système de fichiers applicatif — le web les stocke aujourd'hui dans `public/uploads/`, ce qui est précisément la cause de la faille d'exécution de fichier téléversé. R2 ne facture pas la bande passante sortante, argument fort pour la diffusion d'images. |
| Traitement d'images | **sharp** | Génération de 3 tailles (miniature 200 px, aperçu 800 px, plein écran 1600 px) en WebP à l'envoi. Un téléphone ne télécharge jamais une image de 4 Mo. |
| Documentation d'API | **OpenAPI 3.1** généré depuis les DTO | Contrat exécutable, jamais désynchronisé du code. Alimente la génération des modèles Dart. |
| Journalisation | **Pino** en JSON structuré | Corrélation par `requestId` traversant HTTP, jobs et requêtes base. |
| Supervision | **Sentry** + **OpenTelemetry** | Erreurs, traces, latences. |

### 5.2 Application Flutter

| Besoin | Choix | Justification |
|---|---|---|
| SDK | **Flutter 3.x / Dart 3.x** | Imposé. Compilation AOT native, une base de code pour deux plateformes. |
| Gestion d'état | **Riverpod** | Sans dépendance au `BuildContext`, donc testable hors widget. Invalidation et rechargement natifs — adaptés à un modèle hors ligne d'abord. Sûr à la compilation, contrairement à `Provider`. |
| Navigation | **go_router** | Routage déclaratif par URL, gardes de redirection selon les rôles, liens profonds — indispensables pour ouvrir un produit depuis une notification push ou un partage WhatsApp. |
| Client HTTP | **Dio** + **retrofit** | Intercepteurs pour le rafraîchissement de jeton, la reprise sur erreur avec délai exponentiel et le cache. `retrofit` génère le client depuis des annotations. |
| Modèles de données | **freezed** + **json_serializable** | Classes immuables, égalité structurelle, unions scellées pour les états d'écran, sérialisation générée. Supprime une classe entière de bugs. |
| Base locale | **Drift** (SQLite) | Requêtes typées et vérifiées à la compilation, migrations versionnées, réactivité par flux. Choisi plutôt qu'une base clé-valeur car le cache doit être **interrogeable** : filtrer un catalogue hors ligne par catégorie et par prix impose du SQL. |
| Stockage sécurisé | **flutter_secure_storage** | Jetons dans le Keychain iOS et le Keystore Android. Jamais dans `SharedPreferences`. |
| Cartographie | **flutter_map** (OpenStreetMap) | Cohérent avec Leaflet déjà utilisé sur le web — mêmes fonds de carte, mêmes conventions. Aucun coût de licence, contrairement à Google Maps qui facturerait chaque chargement de carte de WiFiMarkets. |
| Géolocalisation | **geolocator** + **geocoding** | Position, suivi continu pour le livreur, géocodage inverse. |
| Push | **firebase_messaging** + **flutter_local_notifications** | FCM couvre Android et iOS via APNs. Notifications locales pour l'affichage au premier plan. |
| Images | **cached_network_image** | Cache disque et mémoire, images de remplacement, dégradé progressif. |
| Appareil photo & scan | **image_picker**, **mobile_scanner** | Prise de vue, sélection en galerie, scan de codes-barres et QR. |
| Compression | **flutter_image_compress** | Réduction **avant** envoi. Sur un forfait de données malgache, envoyer une photo de 4 Mo au lieu de 400 Ko n'est pas acceptable. |
| Internationalisation | **flutter_localizations** + ARB | Français par défaut, **malgache** en seconde langue. |
| Analytique | **Firebase Analytics** | Parcours, entonnoirs de conversion, taux de rebond par écran. |
| Journalisation d'erreurs | **Sentry Flutter** | Rapports de plantage avec cartes de symboles, journal d'événements précédant l'erreur. |
| Tests | **flutter_test**, **mocktail**, **integration_test** | Unitaires, widgets, bout en bout. |
| Génération de code | **build_runner** | freezed, json_serializable, retrofit, drift, riverpod_generator. |

### 5.3 Infrastructure

| Composant | Choix | Justification |
|---|---|---|
| Hébergement API | **VPS Docker** (o2switch VPS, Hetzner ou Scaleway) | Un hébergement mutualisé ne peut pas faire tourner Node, Redis et des WebSockets. |
| MongoDB | **Atlas M10** (région Europe) ou auto-hébergé en jeu de réplicas 3 nœuds | Le jeu de réplicas est **obligatoire** : les transactions multi-documents, indispensables à la création de commande, n'existent pas sur une instance isolée. |
| Orchestration | **Docker Compose** puis Kubernetes si la charge le justifie | Ne pas sur-dimensionner au démarrage. |
| Proxy inverse | **Caddy** | HTTPS automatique par Let's Encrypt, configuration en dix lignes, HTTP/3. |
| CDN | **Cloudflare** | Diffusion des médias au plus près, protection contre les attaques par déni de service, compression Brotli. |
| CI/CD | **GitHub Actions** + **Fastlane** | Analyse statique, tests, compilation, signature, publication automatisées. |
| Distribution bêta | **Firebase App Distribution** | Testeurs internes avant publication sur les magasins. |
| Secrets | **Variables d'environnement** + coffre du fournisseur | **Aucun identifiant dans le dépôt** — correction explicite du constat du chapitre 10.2 du document système. |

---

## 6. Modèle de données MongoDB

C'est le chapitre le plus sensible du projet. Traduire 59 tables relationnelles en documents ne consiste pas à créer 59 collections : cela reviendrait à obtenir les inconvénients des deux modèles sans les avantages d'aucun.

### 6.1 Règles d'arbitrage retenues

| Règle | Application |
|---|---|
| **Embarquer ce qui est lu ensemble et borné** | Les médias d'un produit, les lignes d'une commande, les adresses d'un utilisateur |
| **Référencer ce qui croît sans limite** | Commentaires, messages, mouvements de stock, abonnements |
| **Dénormaliser les instantanés d'affichage** | Un post porte `{ author: { id, name, avatar } }` pour être affiché sans jointure |
| **Figer les instantanés contractuels** | Une ligne de commande fige le nom et le prix du produit **au moment de l'achat** — un changement de tarif ultérieur ne doit jamais réécrire l'historique |
| **Jamais de tableau non borné dans un document** | Antipatron principal de MongoDB : plafond de 16 Mo par document et réécriture intégrale à chaque modification |
| **Index avant mise en production** | Toute requête de production s'appuie sur un index déclaré ; l'absence est détectée en intégration continue |

### 6.2 Collections

**18 collections** remplacent les 59 tables. Les tables mortes du web (`advertisements`, `post_hashtags`, `invoice_items`, `password_resets`) ne sont pas reprises, et le double système de facturation est unifié.

---

#### `users`

```js
{
  _id, phone, email, passwordHash,          // Argon2id
  firstName, lastName, avatar, cover, bio,
  birthDate, gender,
  status: "active" | "suspended" | "pending",
  roles: [ { role: "shop_cashier", shopId: ObjectId } ],   // ← modèle unifié §3.1
  addresses: [ {                                            // embarqué : borné
      _id, label, city, district, line,
      location: { type: "Point", coordinates: [lng, lat] },
      isDefault
  } ],
  devices: [ { deviceId, fcmToken, platform, lastSeenAt } ],// borné
  preferences: { locale: "fr", theme: "system", pushEnabled },
  presence: { isOnline, lastSeenAt },
  emailVerifiedAt, createdAt, updatedAt
}
```

Index : `{ phone: 1 } unique`, `{ email: 1 } unique sparse`, `{ "roles.shopId": 1, "roles.role": 1 }`, `{ "addresses.location": "2dsphere" }`.

> **Correction de sécurité.** La colonne `temp_password`, qui stocke aujourd'hui les mots de passe en clair, **n'est pas reprise**. Le mot de passe généré est affiché une seule fois à la création et n'est jamais persisté.

---

#### `shops`

```js
{
  _id, ownerId, slug, name, description, logo, banner,
  categoryId, categoryName,                    // dénormalisé pour l'affichage
  contact: { phone, whatsapp, facebook, instagram },
  address: { city, line },
  location: { type: "Point", coordinates: [lng, lat] },
  deliveryRadiusKm,
  openingHours: [ { day: 1, open: "08:00", close: "18:00" } ],
  team: [ {                                     // embarqué : quelques dizaines au plus
      userId, name, avatar, role: "shop_cashier",
      status: "active" | "suspended", invitedBy, joinedAt
  } ],
  status: "pending" | "approved" | "rejected" | "suspended",
  isFeatured,
  stats: { productCount, orderCount, rating, reviewCount, followerCount },
  createdAt, updatedAt
}
```

Index : `{ slug: 1 } unique`, **`{ location: "2dsphere" }`**, `{ status: 1, isFeatured: -1 }`, `{ "team.userId": 1 }`, index textuel sur `name` et `description`.

> **Le gain le plus net de MongoDB sur ce projet.** WiFiMarkets calcule aujourd'hui la distance par une formule de Haversine écrite à la main en SQL, sans index possible : chaque recherche parcourt l'intégralité de la table des boutiques. Avec un index `2dsphere`, la même recherche devient :
> ```js
> db.shops.aggregate([
>   { $geoNear: {
>       near: { type: "Point", coordinates: [lng, lat] },
>       distanceField: "distanceM", maxDistance: radiusKm * 1000,
>       spherical: true, query: { status: "approved", categoryId }
>   } },
>   { $limit: 50 }
> ])
> ```
> Indexée, triée par distance, et correcte sur l'ellipsoïde terrestre.

---

#### `products`

```js
{
  _id, shopId,
  shop: { name, slug, logo, city },            // instantané d'affichage
  name, slug, description, sku, barcode,
  categoryId, categoryPath: [ObjectId],        // ancêtres matérialisés
  price, promoPrice, costPrice, currency: "MGA",
  stock, minStock,
  media: [ { url, thumbUrl, type: "image"|"video", isMain, order } ],
  variants: [ { _id, name, sku, priceDelta, stock } ],
  status: "draft" | "published" | "archived",
  stats: { views, sales, rating, reviewCount },
  location: { type: "Point", coordinates: [lng, lat] },  // recopié de la boutique
  createdAt, updatedAt
}
```

Index : `{ shopId: 1, status: 1 }`, `{ categoryPath: 1, status: 1 }`, `{ status: 1, "stats.views": -1 }`, `{ barcode: 1 } sparse` *(scan)*, `{ location: "2dsphere" }`, index textuel pondéré `name` (10) / `description` (2).

`categoryPath` permet de récupérer en une requête indexée tous les produits d'une catégorie **et de ses sous-catégories** — ce qui exige aujourd'hui une jointure récursive.

---

#### `categories`

```js
{ _id, name, slug, icon, parentId, ancestors: [ObjectId], depth, order, productCount }
```

---

#### `orders`

```js
{
  _id, orderNumber: "ALG-2026-0001",           // séquence atomique, pas de collision
  userId, customer: { name, phone },
  shopId, shop: { name, slug, logo },
  items: [ {                                    // embarqué : figé au moment de l'achat
      productId, variantId,
      name, image, unitPrice, quantity, subtotal   // ← INSTANTANÉ, jamais réécrit
  } ],
  amounts: { subtotal, shippingFee, discount, total },
  coupon: { code, type, value },
  delivery: {
    method: "delivery" | "pickup",
    address, city, phone, note,
    location: { type: "Point", coordinates: [lng, lat] },
    courierId,
    proof: { photoUrl, capturedAt, location }   // preuve de livraison mobile
  },
  payment: {
    method: "cod"|"mvola"|"orange_money"|"airtel_money"|"card",
    status: "unpaid"|"pending"|"paid"|"refunded",
    reference, paidAt, providerTxId
  },
  status: "pending"|"confirmed"|"preparing"|"shipped"|"delivered"|"cancelled",
  timeline: [ { status, at, byUserId, note } ], // historique complet, borné
  invoiceId,
  createdAt, updatedAt
}
```

Index : `{ orderNumber: 1 } unique`, `{ userId: 1, createdAt: -1 }`, `{ shopId: 1, status: 1, createdAt: -1 }`, `{ "delivery.courierId": 1, status: 1 }`, `{ "payment.status": 1 }`.

> **Deux corrections par rapport au web.** (1) Le numéro de commande est aujourd'hui `JM-<année>-<6 caractères de uniqid()>` : collision possible, non détectée car aucune contrainte d'unicité n'existe. Il devient une séquence atomique avec index unique. (2) Le statut `preparing` est ajouté entre `confirmed` et `shipped` — le web ne permet pas de distinguer « commande acceptée » de « commande en préparation », ce qui rend le suivi client imprécis.

---

#### `carts`

```js
{ _id: userId, items: [ { productId, variantId, quantity, addedAt, snapshot: {…} } ], updatedAt }
```
Un document par utilisateur, clé primaire = identifiant utilisateur. Lecture et écriture en une opération.

---

#### `posts`

```js
{
  _id, authorId,
  author: { name, avatar, type: "user"|"shop", shopId },  // instantané
  kind: "post" | "request",                                // ← unification
  content, media: [ { url, thumbUrl, type } ],
  productId, product: { name, price, image },
  request: {                                               // si kind = "request"
    type: "search"|"need"|"buy", title, description,
    categoryId, quantity, budget, desiredDate,
    urgency: "normal"|"urgent"|"very_urgent",
    status: "active"|"discussing"|"done"|"expired",
    responseCount
  },
  visibility: "public" | "followers",
  location: { type: "Point", coordinates: [lng, lat] },
  counters: { reactions, comments, shares, views },        // compteurs incrémentaux
  hashtags: [String],
  createdAt, updatedAt
}
```

Index : `{ authorId: 1, createdAt: -1 }`, `{ visibility: 1, createdAt: -1 }`, `{ "request.status": 1, "request.categoryId": 1 }`, `{ hashtags: 1 }`, `{ location: "2dsphere" }`.

> **Unification.** Le web maintient deux systèmes parallèles : la table `posts` a reçu 8 colonnes de demande via `add_post_fields.sql`, **et** une table `client_requests` séparée porte les mêmes informations. Les deux coexistent. Le modèle mobile n'en retient qu'un : un document `post` avec `kind: "request"`.

---

#### `comments`, `reactions`, `follows`, `favorites`

Collections séparées — croissance non bornée.

```js
comments  { _id, postId, userId, author:{…}, content, parentId, createdAt }
reactions { _id, targetType: "post"|"comment", targetId, userId,
            type: "like"|"love"|"haha"|"wow"|"sad"|"angry", createdAt }
follows   { _id, followerId, targetType: "user"|"shop", targetId, createdAt }
favorites { _id, userId, productId, createdAt }
```

Index uniques composés pour interdire les doublons : `reactions { targetId, userId } unique`, `follows { followerId, targetType, targetId } unique`, `favorites { userId, productId } unique`.

---

#### `stories`

```js
{ _id, authorId, author:{…}, media:{ url, type }, viewCount,
  createdAt, expiresAt }
```

Index : **`{ expiresAt: 1 }, expireAfterSeconds: 0`** — MongoDB supprime automatiquement les stories expirées. Le web n'a aucun mécanisme de purge : la table `stories` croît indéfiniment.

---

#### `conversations` et `messages`

```js
conversations {
  _id, participants: [ { userId, name, avatar, shopId } ],
  lastMessage: { content, senderId, sentAt },     // instantané pour la liste
  unread: { "<userId>": 3 },                       // compteur par participant
  updatedAt
}
messages { _id, conversationId, senderId, content,
           attachments:[…], readBy:[userId], createdAt }
```

Index : `conversations { "participants.userId": 1, updatedAt: -1 }`, `messages { conversationId: 1, createdAt: -1 }`.

---

#### `notifications`

```js
{ _id, userId, type, title, body, data: {…}, isRead,
  createdAt, expiresAt }
```
Index TTL sur `expiresAt` (90 jours) : purge automatique.

---

#### `stockMovements`

**Collection de séries temporelles** (`timeseries`, champ temporel `at`, méta `shopId`) — volume d'écriture élevé, lecture chronologique, compression native par MongoDB.

```js
{ at, shopId, productId, type: "in"|"out"|"correction",
  reason, quantity, stockBefore, stockAfter,
  unitCost, supplier, note, userId }
```

---

#### `invoices`, `refunds`, `inventories`, `promotions`, `coupons`, `reports`, `settings`, `auditLogs`

Collections directes. `invoices` **unifie** les deux systèmes concurrents du web (`invoices` et `sales_invoices`). `auditLogs` porte un index TTL de 2 ans.

### 6.3 Transactions

MongoDB supporte les transactions multi-documents sur un jeu de réplicas. Elles sont **obligatoires** dans trois cas :

| Opération | Documents concernés |
|---|---|
| **Création de commande** | `orders` (une par boutique) + `products.stock` + `stockMovements` + `carts` |
| **Encaissement** | `orders.payment` + `invoices` + `auditLogs` |
| **Remboursement** | `refunds` + `orders.payment` + `products.stock` + `stockMovements` |

> Corrige directement le constat §8.2 du document système : la création de commande du web n'est encapsulée dans aucune transaction. Une erreur après l'insertion de la commande laisse une commande sans lignes, avec un stock déjà décrémenté.

### 6.4 Décrément de stock sans surréservation

```js
db.products.updateOne(
  { _id: productId, stock: { $gte: quantity } },   // condition atomique
  { $inc: { stock: -quantity } }
)
// matchedCount === 0  →  stock insuffisant, la transaction est annulée
```

Le web exécute `UPDATE products SET stock = stock - :qty` sans condition : le stock peut devenir négatif si deux clients commandent simultanément le dernier article.

### 6.5 Antipatrons explicitement proscrits

| Antipatron | Pourquoi il est interdit ici |
|---|---|
| Tableau `comments[]` dans `posts` | Croissance non bornée, plafond de 16 Mo, réécriture complète du document à chaque commentaire |
| Tableau `messages[]` dans `conversations` | Idem, aggravé par le volume |
| Tableau `followers[]` dans `users` | Une boutique populaire dépasserait la limite |
| `$lookup` en chaîne pour reconstituer un affichage | Si une jointure est nécessaire à chaque lecture, le modèle est mal découpé — dénormaliser un instantané |
| Une collection par table SQL | Reproduit le relationnel sans ses garanties |
| Absence d'index sur un champ de tri | `sort` en mémoire, plafonné à 32 Mo, échec en production |

---

## 7. Spécification de l'API

### 7.1 Conventions

| Élément | Règle |
|---|---|
| Style | REST, JSON, `application/json; charset=utf-8` |
| Base | `https://api.allgo.mg/v1` |
| Versionnement | Préfixe d'URL. `v1` maintenue 12 mois après la sortie de `v2` |
| Authentification | `Authorization: Bearer <jwt>` |
| Pagination | **Par curseur** — `?limit=20&cursor=<opaque>`. Le décalage numérique est proscrit : il dérive dès qu'un élément est inséré pendant la pagination |
| Tri et filtres | `?sort=-createdAt&status=active&category=…` |
| Champs partiels | `?fields=id,name,price,media` — réduction du volume sur réseau lent |
| Idempotence | En-tête `Idempotency-Key` obligatoire sur toute création de commande ou de paiement |
| Limitation de débit | 100 req/min par utilisateur, 10 req/min sur l'authentification |
| Compression | Brotli, repli gzip |
| Cache | `ETag` + `If-None-Match` sur le catalogue et les catégories |

### 7.2 Format de réponse

```jsonc
// succès
{ "data": { … }, "meta": { "nextCursor": "…", "hasMore": true } }

// erreur
{ "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Stock insuffisant pour « Riz 5 kg ».",  // affichable tel quel
    "details": { "productId": "…", "available": 3, "requested": 10 },
    "requestId": "01J8X…"
} }
```

Le message est **prêt à afficher et localisé** : le client mobile ne compose jamais de texte d'erreur métier lui-même.

### 7.3 Points d'entrée principaux

| Domaine | Méthode et chemin | Rôle |
|---|---|---|
| **Auth** | `POST /auth/register` · `POST /auth/login` · `POST /auth/refresh` · `POST /auth/logout` | Cycle de session |
| | `POST /auth/otp/send` · `POST /auth/otp/verify` | Connexion par SMS — voir §12.2 |
| | `POST /auth/password/forgot` · `POST /auth/password/reset` | **Réellement implémenté**, contrairement au web |
| **Profil** | `GET|PATCH /me` · `GET|POST|DELETE /me/addresses` · `POST /me/devices` | Compte |
| **Catalogue** | `GET /products` · `GET /products/:id` · `GET /products/barcode/:code` | Consultation, scan |
| | `GET /categories` · `GET /shops` · `GET /shops/:slug` | — |
| **Géo** | `GET /geo/shops?lat&lng&radius&category` | WiFiMarkets — `$geoNear` |
| **Recherche** | `GET /search?q=` · `GET /search/suggest?q=` | Index textuel |
| **Panier** | `GET /cart` · `POST /cart/items` · `PATCH|DELETE /cart/items/:id` | — |
| **Commandes** | `POST /orders` *(idempotent, transactionnel)* · `GET /orders` · `GET /orders/:id` | — |
| | `PATCH /orders/:id/status` · `POST /orders/:id/cancel` | — |
| **Paiement** | `POST /payments/initiate` · `POST /payments/webhook/:provider` | Mobile money |
| **Social** | `GET /feed` · `POST /posts` · `GET|DELETE /posts/:id` | — |
| | `POST|DELETE /posts/:id/reactions` · `GET|POST /posts/:id/comments` | — |
| | `GET /stories` · `POST /stories` · `POST /stories/:id/view` | — |
| | `POST|DELETE /follows` | — |
| **Demandes** | `GET|POST /requests` · `GET /requests/:id` · `POST /requests/:id/responses` | — |
| | `POST /requests/:id/responses/:rid/accept` | — |
| **Messagerie** | `GET /conversations` · `GET /conversations/:id/messages` · `POST /conversations/:id/messages` | — |
| **Notifications** | `GET /notifications` · `POST /notifications/read` | — |
| **Commerçant** | `GET /shop/:id/dashboard` · `GET /shop/:id/orders` · `PATCH /shop/:id/products/:pid` | — |
| | `POST /shop/:id/stock/movements` · `GET /shop/:id/stock/alerts` | — |
| | `POST /shop/:id/invoices` · `GET /shop/:id/invoices/:iid/pdf` | — |
| **Livreur** | `GET /courier/deliveries` · `POST /courier/deliveries/:id/position` | — |
| | `POST /courier/deliveries/:id/proof` | Photo + GPS |
| **Sync** | `POST /sync/batch` · `GET /sync/changes?since=` | Mode hors ligne |
| **Médias** | `POST /media/upload-url` | URL présignée S3 |

### 7.4 Envoi des médias

L'application **n'envoie jamais un fichier à l'API**. Elle demande une URL présignée, téléverse directement vers le stockage objet, puis transmet la clé obtenue.

```
1. POST /media/upload-url { type: "image/jpeg", size: 412000 }
     → { uploadUrl, key, expiresIn: 300 }
2. PUT <uploadUrl>  (directement vers S3, sans passer par l'API)
3. POST /posts { media: [{ key }] }
4. Un job BullMQ génère les 3 tailles en WebP et met le document à jour
```

Ce schéma ferme définitivement la faille d'exécution de fichier téléversé du web : **aucun fichier utilisateur n'atterrit jamais dans un répertoire servi par le serveur applicatif.**

### 7.5 Événements temps réel (Socket.IO)

| Événement | Charge utile | Destinataire |
|---|---|---|
| `message:new` | message + conversation | Participants |
| `order:status` | commande + ancien/nouveau statut | Client, boutique |
| `order:new` | commande | Équipe de la boutique |
| `delivery:position` | position GPS du livreur | Client concerné |
| `notification:new` | notification | Utilisateur |
| `stock:alert` | produit sous le seuil | Manager, Stock |
| `presence:update` | statut en ligne | Contacts |

Espaces de noms par portée (`/user/:id`, `/shop/:id`), autorisation vérifiée à la connexion. **Remplace intégralement le sondage HTTP toutes les 5 secondes du web** — qui génère aujourd'hui 720 requêtes par heure et par onglet ouvert.

---

## 8. Spécifications fonctionnelles

### 8.1 Inventaire des écrans

**52 écrans** répartis en 8 modules.

#### Module 1 — Accueil et découverte (6 écrans)

| Écran | Contenu |
|---|---|
| Accueil | Recherche, catégories, boutiques proches, produits populaires, nouveautés, stories |
| Recherche | Suggestions instantanées, historique, filtres, résultats produits et boutiques |
| Catalogue | Grille avec filtres : catégorie, prix, distance, note, disponibilité |
| Fiche produit | Galerie plein écran, prix et promotion, stock, variantes, avis, boutique, actions |
| Boutique | Bannière, informations, horaires, carte, catalogue, fil, abonnement |
| Carte WiFiMarkets | Carte plein écran, rayon ajustable, filtres, liste glissante, itinéraire |

#### Module 2 — Achat (7 écrans)

Panier · Récapitulatif · Livraison · Paiement · Instructions de paiement · Confirmation · Suivi de commande avec position du livreur en direct.

#### Module 3 — Social (8 écrans)

Fil d'actualité · Détail de publication · Composition · Visionneuse de stories · Création de story · Profil utilisateur · Abonnements · Publications enregistrées.

#### Module 4 — Demandes clients (5 écrans)

Mes demandes · Création · Détail et réponses · Comparaison des propositions · File des demandes (côté commercial).

#### Module 5 — Messagerie et notifications (4 écrans)

Conversations · Fil de discussion · Nouvelle conversation · Notifications.

#### Module 6 — Compte (7 écrans)

Profil · Édition · Adresses · Commandes · Factures · Favoris · Paramètres.

#### Module 7 — Espaces commerçant (10 écrans)

| Écran | Rôle |
|---|---|
| Tableau de bord boutique | Owner, Manager |
| Commandes à traiter | Owner, Manager, Sales |
| Détail de commande | Tous rôles boutique |
| Produits et stock | Manager, Stock |
| Mouvement de stock avec scan | Manager, Stock |
| Alertes de stock | Manager, Stock |
| Encaissement | Cashier |
| Factures | Cashier |
| Demandes clients | Sales |
| Équipe | Owner |

#### Module 8 — Livreur (5 écrans)

Tournée du jour · Détail de livraison · Navigation GPS · Preuve de livraison (photo + signature + GPS) · Historique.

### 8.2 Parcours clé — commande d'un client

```
Accueil → recherche « riz »
   → Fiche produit (galerie, prix, stock, avis)
   → « Ajouter au panier »            [optimiste : mise à jour immédiate de l'interface]
   → Panier → « Commander »
   → Livraison : adresse enregistrée ou position actuelle
   → Paiement : MVola sélectionné
   → Récapitulatif → « Confirmer »
        │
        ├─ Idempotency-Key généré côté client
        ├─ POST /orders  ──► transaction MongoDB
        │     • une commande par boutique
        │     • décrément conditionnel du stock
        │     • écriture des mouvements de stock
        │     • vidage du panier
        │     • Socket.IO → équipe de la boutique
        │     • FCM → caissiers
        │
   → Écran de paiement MVola (redirection ou USSD)
   → Rappel du fournisseur → payment.status = "paid" → facture émise
   → Suivi : pending → confirmed → preparing → shipped → delivered
        └─ carte en direct pendant « shipped »
   → Notation du produit et de la boutique
```

**Comportement hors ligne** : si le réseau tombe entre « Confirmer » et la réponse, la commande est placée en file locale, l'utilisateur voit « Commande en attente d'envoi », et l'envoi reprend automatiquement. L'`Idempotency-Key` garantit qu'une reprise ne crée jamais de doublon.

### 8.3 Parcours clé — livraison

```
Notification push : « 3 livraisons vous sont assignées »
   → Tournée du jour, triée par proximité
   → Détail : client, articles, montant à encaisser, téléphone
   → « Démarrer »  → suivi GPS émis toutes les 30 s (Socket.IO)
                     le client voit la progression en direct
   → « Arrivé »    → appel client en un geste
   → Preuve : photo du colis remis + signature tactile + position GPS
   → Encaissement si paiement à la livraison
   → Statut « delivered », notification au client et à la boutique
```

---

## 9. Mode hors ligne et synchronisation

### 9.1 Principe

**L'interface lit toujours la base locale.** Le réseau ne fait qu'alimenter cette base. Aucun écran n'affiche jamais un indicateur de chargement bloquant si une donnée en cache existe.

```
Widget → Riverpod → Repository ──► Drift (local)   ──► affichage IMMÉDIAT
                          │
                          └────► API (arrière-plan) ──► mise à jour du cache
                                                    └─► rafraîchissement réactif
```

### 9.2 Politique de cache par domaine

| Donnée | Fraîcheur | Rétention hors ligne |
|---|---|---|
| Catégories | 24 h | Permanente |
| Catalogue consulté | 1 h | 7 jours |
| Fiches produit consultées | 30 min | 30 jours |
| Boutiques proches | 1 h | 7 jours |
| Fil d'actualité | 5 min | 50 dernières publications |
| Panier | temps réel | Permanente |
| Mes commandes | 5 min | Permanente |
| Conversations | temps réel | 200 derniers messages |
| Stock (commerçant) | 1 min | Non mis en cache — critique |

### 9.3 File d'actions différées

Les mutations réalisées hors ligne sont mises en file dans Drift :

```dart
PendingAction {
  id, type, payload, idempotencyKey,
  createdAt, retryCount, lastError,
  status: pending | syncing | failed | done
}
```

| Action | Autorisée hors ligne | Motif |
|---|---|---|
| Ajouter au panier | ✅ | Sans effet de bord serveur |
| Réagir, commenter, suivre | ✅ | Idempotent, tolérant au retard |
| Modifier le profil | ✅ | Dernière écriture gagnante |
| **Passer commande** | ✅ *avec réserve explicite* | File d'attente, `Idempotency-Key`, **stock revérifié à l'envoi** ; l'utilisateur est averti si le produit n'est plus disponible |
| **Encaisser un paiement** | ❌ | Exige la confirmation du fournisseur |
| **Mouvement de stock** | ❌ | Source de vérité partagée entre plusieurs employés |

Reprise avec délai exponentiel (1 s, 2 s, 4 s… plafonné à 5 min), abandon après 24 h avec notification à l'utilisateur.

### 9.4 Résolution des conflits

| Conflit | Règle |
|---|---|
| Profil modifié des deux côtés | Dernière écriture gagnante, par champ |
| Article du panier devenu indisponible | Retiré, l'utilisateur est notifié à la reconnexion |
| Commande envoyée en double après reprise | Neutralisée par `Idempotency-Key` |
| Stock insuffisant à l'envoi différé | Commande refusée, motif explicite, panier conservé |

### 9.5 Synchronisation delta

`GET /sync/changes?since=<timestamp>&collections=products,orders` renvoie uniquement les documents modifiés depuis l'horodatage — jamais un catalogue complet. Sur un forfait de données malgache, la différence est décisive.

---

## 10. Notifications push et temps réel

### 10.1 Catalogue des notifications

| Type | Destinataire | Déclencheur | Canal |
|---|---|---|---|
| `order.created` | Boutique | Nouvelle commande | Push + WS |
| `order.status_changed` | Client | Changement de statut | Push + WS |
| `order.awaiting_payment` | Caissier | Commande à encaisser | Push + WS |
| `delivery.assigned` | Livreur | Affectation | Push |
| `delivery.started` | Client | Départ du livreur | Push + WS |
| `message.received` | Destinataire | Nouveau message | Push + WS |
| `request.response` | Client | Réponse à une demande | Push |
| `request.new_match` | Commercial | Demande dans sa catégorie | Push |
| `stock.low` | Manager, Stock | Stock ≤ seuil | Push + WS |
| `social.reaction` / `social.comment` | Auteur | Interaction | Push (groupé) |
| `promo.nearby` | Client | Promotion d'une boutique suivie à proximité | Push géodéclenché |

### 10.2 Règles de bonne conduite

- **Groupement** — « 12 personnes ont réagi » plutôt que 12 notifications.
- **Heures calmes** — aucune notification non critique entre 21 h et 7 h, heure locale.
- **Granularité** — l'utilisateur active ou coupe chaque catégorie indépendamment.
- **Liens profonds** — chaque notification ouvre directement l'écran concerné.
- **Sans réseau** — la charge utile contient le titre et le corps, affichables sans appel API.

---

## 11. Design system et ergonomie mobile

### 11.1 Fondations

| Élément | Spécification |
|---|---|
| Base | **Material 3**, avec adaptations Cupertino sur iOS (retour par balayage, feuilles d'action) |
| Couleur principale | Vert AllGo `#198754` — reprise de l'identité web (`ui-avatars` et l'interface actuelle) |
| Thèmes | Clair, sombre et système — parité avec le web qui propose déjà la bascule |
| Typographie | Inter ou Roboto, échelle Material 3, taille minimale 14 sp |
| Espacement | Grille de 4 dp |
| Zones tactiles | 48 × 48 dp minimum |
| Coins | 12 dp (cartes), 8 dp (champs), 24 dp (feuilles) |
| Icônes | Material Symbols |
| Devise | Formatage `1 250 000 Ar` — séparateur d'espace insécable, symbole suffixé |

### 11.2 Navigation

```
Barre de navigation inférieure — 5 onglets, adaptés au rôle actif

CLIENT :      Accueil │ Explorer │ Publier │ Messages │ Compte
COMMERÇANT :  Bord    │ Commandes│ Produits│ Messages │ Compte
LIVREUR :     Tournée │ Carte    │ —       │ Messages │ Compte
```

Un sélecteur de profil en en-tête permet de basculer entre les rôles d'un même compte — un commerçant reste un client sur AllGo.

### 11.3 États d'interface obligatoires

Chaque écran implémente **cinq états**, sans exception :

| État | Traitement |
|---|---|
| Chargement | Squelettes animés, jamais un cercle plein écran |
| Chargé | — |
| Vide | Illustration, message explicatif, action proposée |
| Erreur | Cause, conséquence, bouton « Réessayer » |
| **Hors ligne** | Bandeau persistant, données en cache affichées, actions différées signalées |

### 11.4 Accessibilité

Contraste AA (4,5:1), compatibilité TalkBack et VoiceOver, respect de la taille de police système jusqu'à 200 %, aucune information portée par la couleur seule, libellés sémantiques sur chaque élément interactif.

### 11.5 Localisation

Français par défaut. **Malgache** en seconde langue — l'application vise Mahajanga, où le malgache est la langue d'usage. Formats de date, de nombre et de devise localisés. Chaînes externalisées en fichiers ARB dès la première ligne de code, jamais rétro-ajoutées.

---

## 12. Sécurité

Le chapitre 10.2 du document système recense trois failles critiques et cinq écarts majeurs sur la plateforme web. **Chacun est traité par conception ici**, et non par correctif.

### 12.1 Correspondance failles web → traitement mobile

| Faille du web | Traitement dans l'architecture mobile |
|---|---|
| 🔴 **Aucune protection CSRF** | Sans objet : l'API est sans état, authentifiée par jeton `Bearer` et non par cookie. Aucun navigateur ne joint automatiquement d'identifiant. Origine vérifiée par CORS strict. |
| 🔴 **30 routes d'administration protégées par la seule session** | Modèle inverse : **toute route est refusée par défaut**. Chaque point d'entrée déclare sa permission et sa portée. Un test d'ossature échoue en intégration continue si une route n'a pas de garde. |
| 🔴 **Migrations exécutables par tout compte connecté** | Aucune route de migration exposée. Les migrations s'exécutent en ligne de commande au déploiement, jamais par HTTP. |
| 🟠 **Uploads non filtrés dans un répertoire exécutable** | Aucun fichier utilisateur n'atteint le serveur applicatif : URL présignée → stockage objet → traitement par job. Type MIME vérifié par nombre magique, extension réécrite, taille plafonnée, analyse antivirus optionnelle. Le domaine des médias ne sert **aucun** code. |
| 🟠 **Mots de passe en clair (`temp_password`)** | Colonne non reprise. Argon2id uniquement. Le mot de passe généré est affiché une fois, jamais persisté. |
| 🟠 **Identifiants de production versionnés** | Zéro secret dans le dépôt. Variables d'environnement et coffre du fournisseur. Analyse anti-fuite de secrets en intégration continue. |
| 🟡 **Politique de mot de passe faible, aucune limitation** | 10 caractères minimum, vérification contre les listes de mots de passe compromis, limitation de débit (5 tentatives / 15 min / compte + IP), verrouillage temporaire progressif. |
| 🟡 **Aucune transaction sur la création de commande** | Transaction MongoDB obligatoire (§6.3). |
| 🟡 **Récupération de mot de passe non implémentée** | Implémentée : jeton à usage unique de 30 min, envoi par SMS ou email, invalidation de toutes les sessions après réinitialisation. |

### 12.2 Mesures propres au mobile

| Domaine | Mesure |
|---|---|
| **Stockage des jetons** | Keychain iOS / Keystore Android via `flutter_secure_storage`. Jamais `SharedPreferences`. |
| **Cycle de vie des jetons** | Accès 15 min, rafraîchissement 30 jours **rotatif** — un jeton de rafraîchissement réutilisé invalide toute la chaîne (détection de vol). |
| **Épinglage de certificat** | Empreinte du certificat de l'API épinglée, avec certificat de secours pour permettre la rotation. |
| **Détection de compromission** | Détection root/jailbreak : avertissement, blocage des opérations de paiement. |
| **Protection à l'écran** | `FLAG_SECURE` sur les écrans de paiement et de facture — pas de capture d'écran. |
| **Biométrie** | Empreinte ou visage pour rouvrir la session et confirmer un paiement. |
| **Chiffrement local** | Base Drift chiffrée par SQLCipher, clé conservée dans le stockage sécurisé. |
| **Connexion par SMS** | OTP à 6 chiffres, valide 5 min, 3 tentatives — adapté à une population où le numéro de téléphone est plus fiable que l'adresse email. |
| **Purge à la déconnexion** | Effacement complet du cache et des jetons. |
| **Obscurcissement** | ProGuard/R8 en production, symboles Dart séparés et transmis à Sentry. |

### 12.3 Conformité et vie privée

Consentement explicite pour la géolocalisation, avec explication de l'usage. Localisation en arrière-plan **uniquement** pour le rôle livreur, en service au premier plan visible. Politique de confidentialité et conditions accessibles hors ligne. Export et suppression des données personnelles sur demande. Aucune donnée envoyée à un tiers hors Firebase, Sentry et les fournisseurs de paiement, tous documentés dans la fiche de confidentialité des magasins.

---

## 13. Exigences non fonctionnelles

### 13.1 Performance

| Indicateur | Cible | Mesure |
|---|---|---|
| Démarrage à froid | < 2 s | Android 4 Go de RAM |
| Démarrage à chaud | < 500 ms | — |
| Affichage d'un écran en cache | < 100 ms | Aucune requête bloquante |
| Réponse API (P95) | < 300 ms | Hors latence réseau |
| Recherche géographique | < 150 ms | `$geoNear` indexé, 10 000 boutiques |
| Fluidité | 60 fps constants | Aucune image sautée au défilement |
| Taille de l'APK | < 25 Mo | Découpé par ABI |
| Consommation d'une session de 5 min | < 1,5 Mo | Réseau |
| Mémoire | < 200 Mo | Usage normal |

### 13.2 Compatibilité

| Plateforme | Minimum | Cible |
|---|---|---|
| Android | 8.0 (API 26) — couvre > 95 % du parc malgache | 15 (API 35) |
| iOS | 14.0 | 18 |
| Écrans | 320 dp à 600 dp de large | Tablette utilisable, non optimisée |
| Orientation | Portrait ; paysage sur la galerie, la carte et le scan | — |

### 13.3 Disponibilité et robustesse

Disponibilité de l'API : 99,5 % hors fenêtres de maintenance annoncées. L'application reste **utilisable en lecture** même API indisponible. Aucune perte de données en cas de fermeture forcée pendant une saisie. Reprise automatique après changement de réseau (Wi-Fi ↔ mobile).

### 13.4 Maintenabilité

Couverture de tests ≥ 70 % sur `domain` et `data`. Analyse statique `very_good_analysis` sans avertissement toléré. Aucune fonction de plus de 50 lignes, aucun fichier de plus de 400 lignes. Documentation `dartdoc` sur toute API publique. Journal des versions tenu à jour.

---

## 14. Paiements mobile money

### 14.1 Fournisseurs

| Fournisseur | Part de marché estimée à Mahajanga | Intégration |
|---|---|---|
| **MVola** (Telma) | ~50 % | API du portail développeur MVola |
| **Orange Money** | ~30 % | API Orange Developer |
| **Airtel Money** | ~15 % | API Airtel Africa |
| **Espèces à la livraison** | — | Encaissement par le livreur |

### 14.2 Architecture d'intégration

Une **interface d'abstraction** unique, une implémentation par fournisseur :

```typescript
interface PaymentProvider {
  initiate(order, phone): Promise<{ txId, redirectUrl?, ussdCode? }>
  verify(txId): Promise<PaymentStatus>
  refund(txId, amount): Promise<RefundResult>
}
```

### 14.3 Flux nominal

```
1. POST /payments/initiate { orderId, provider, phone }  [Idempotency-Key]
2. L'API crée une transaction en statut "pending"
3. Appel au fournisseur → code USSD ou lien de confirmation
4. Le client confirme sur son téléphone (code PIN mobile money)
5. Rappel du fournisseur → POST /payments/webhook/:provider
      • signature vérifiée
      • statut mis à jour dans une transaction MongoDB
      • facture émise
      • Socket.IO + push vers le client et la boutique
6. Filet de sécurité : job de vérification toutes les 2 min pendant 30 min
      (les rappels de ces fournisseurs sont connus pour être peu fiables)
7. Sans confirmation après 30 min → commande annulée, stock restitué
```

### 14.4 Mode dégradé

Si l'API d'un fournisseur est indisponible, l'application propose la **saisie manuelle de la référence de transaction**, validée ensuite par le caissier — mode de fonctionnement actuel du web, conservé comme repli et non comme mode nominal.

---

## 15. Stratégie de migration

### 15.1 Principe : arrêt progressif par domaine

Aucune bascule générale. Un domaine à la fois, dans un ordre choisi selon le risque croissant. À chaque étape, **une seule source de vérité** pour le domaine concerné.

### 15.2 Séquence

| Lot | Domaine migré | Source de vérité après le lot | Le web PHP… | Risque |
|---|---|---|---|---|
| **M0** | *Aucun* — mise en place de l'API, de MongoDB et de la CI | MariaDB | inchangé | Nul |
| **M1** | Référentiels : catégories, paramètres | MongoDB | lit l'API pour ces domaines | Très faible |
| **M2** | Catalogue : produits, boutiques, médias | MongoDB | lit l'API | Faible |
| **M3** | Social : publications, réactions, commentaires, stories | MongoDB | lit l'API | Faible |
| **M4** | Comptes et authentification | MongoDB | délègue l'authentification à l'API | **Moyen** |
| **M5** | Commerce : panier, commandes, paiements, factures | MongoDB | lit l'API | **Élevé** |
| **M6** | Stock et ERP | MongoDB | lit l'API | **Élevé** |
| **M7** | Extinction de MariaDB | MongoDB | — | — |

### 15.3 Outillage de migration

Un utilitaire Node dédié, versionné dans le dépôt :

```
migrate <domaine> --dry-run     lecture MySQL, transformation, rapport, aucune écriture
migrate <domaine> --execute     migration réelle, journal complet
migrate <domaine> --verify      comparaison exhaustive des deux bases
migrate <domaine> --rollback    restauration depuis l'instantané pris avant migration
```

Chaque exécution produit un rapport : nombre de documents, écarts détectés, enregistrements rejetés avec leur motif.

### 15.4 Règles de transformation

| MySQL | MongoDB | Point d'attention |
|---|---|---|
| `id INT AUTO_INCREMENT` | `ObjectId` | Table de correspondance conservée pendant toute la migration |
| Clé étrangère | Référence ou document embarqué | Selon les règles §6.1 |
| `DECIMAL(10,2)` | `Decimal128` | **Jamais `Double`** — les arrondis sur des montants sont inacceptables |
| `DATETIME` | `Date` UTC | Conversion depuis `Indian/Antananarivo` (UTC+3) |
| `ENUM` | `String` + validation de schéma | — |
| `latitude`, `longitude` | `GeoJSON Point [lng, lat]` | **Inversion de l'ordre** — erreur classique |
| `posts` + `client_requests` | `posts` avec `kind` | Fusion des deux systèmes |
| `invoices` + `sales_invoices` | `invoices` | Fusion |
| `shop_team_members` + `admin_level` | `users.roles[]` | Refonte du modèle de rôles |
| `advertisements`, `post_hashtags`, `invoice_items`, `password_resets` | *non migrées* | Tables mortes |

### 15.5 Critères de validation d'un lot

Un lot n'est déclaré terminé qu'après vérification des cinq points :

1. Nombre de documents identique au nombre de lignes source, aux exclusions documentées près.
2. Contrôle d'intégrité : aucune référence orpheline.
3. Contrôle métier : somme des montants de commandes identique au centime près.
4. Tests de non-régression du web verts sur le domaine migré.
5. Instantané de sauvegarde pris et **restauration testée** avant bascule.

---

## 16. Tests et qualité

Le système web ne comporte aucun test automatisé. Ce point ne sera pas reconduit.

### 16.1 Pyramide de tests

| Niveau | Périmètre | Outils | Objectif |
|---|---|---|---|
| **Unitaires** | Cas d'usage, dépôts, formateurs, moteur de synchronisation | `flutter_test`, `mocktail` | ≥ 80 % sur `domain` |
| **Widgets** | Composants, états, formulaires | `flutter_test` | Écrans critiques |
| **Intégration** | Parcours complets sur émulateur | `integration_test` | 8 parcours clés |
| **Contrat d'API** | Conformité au schéma OpenAPI | Dredd / Schemathesis | 100 % des routes |
| **Backend unitaires** | Services, gardes, validateurs | Jest | ≥ 80 % |
| **Backend intégration** | Routes + MongoDB en mémoire | Jest + `mongodb-memory-server` | 100 % des routes |
| **Charge** | 500 utilisateurs simultanés | k6 | P95 < 300 ms |
| **Sécurité** | Analyse de dépendances, secrets, OWASP Mobile Top 10 | Snyk, gitleaks, MobSF | Zéro faille critique |

### 16.2 Parcours de bout en bout obligatoires

1. Inscription → vérification OTP → première connexion
2. Recherche → fiche produit → panier → commande → paiement → suivi
3. Publication avec photo → réaction → commentaire
4. Publication d'une demande → réponse d'un commercial → acceptation
5. Commerçant : réception d'une commande → confirmation → expédition
6. Caissier : encaissement → émission de facture
7. Livreur : tournée → navigation → preuve de livraison
8. **Mode avion** : consultation, ajout au panier, reconnexion, synchronisation

### 16.3 Tests spécifiques au terrain

| Scénario | Critère d'acceptation |
|---|---|
| Réseau 2G simulé (50 kbit/s) | L'application reste utilisable, images en dégradé progressif |
| Coupure réseau en cours de commande | Commande en file, reprise automatique, aucun doublon |
| Bascule Wi-Fi → mobile | Aucune déconnexion visible, WebSocket rétablie |
| Terminal 4 Go, Android 8 | 60 fps au défilement du catalogue |
| Batterie faible, mode économie | Suivi GPS livreur maintenu |
| 5 000 produits en cache | Recherche locale < 200 ms |

---

## 17. CI/CD, distribution et exploitation

### 17.1 Chaîne d'intégration continue

```
Pull request
   ├─ dart analyze  ·  dart format --set-exit-if-changed
   ├─ flutter test --coverage        (seuil bloquant)
   ├─ backend : lint · jest · tests de contrat
   ├─ gitleaks  ·  audit des dépendances
   └─ compilation APK de debug → commentaire avec la taille du binaire

Fusion sur main
   ├─ compilation AAB et IPA signés
   ├─ Firebase App Distribution → testeurs internes
   └─ déploiement de l'API en préproduction

Étiquette de version
   ├─ Google Play (canal de test fermé → production progressive 10/50/100 %)
   ├─ App Store Connect → TestFlight → revue
   ├─ déploiement API en production
   └─ envoi des symboles de débogage à Sentry
```

### 17.2 Politique de versions

Versionnement sémantique `MAJEUR.MINEUR.CORRECTIF+BUILD`. Publication progressive systématique sur Android : 10 % pendant 24 h, 50 % pendant 24 h, puis 100 %. Interruption automatique si le taux de plantage sans reprise dépasse 0,5 %.

### 17.3 Mise à jour forcée

L'API renvoie `minSupportedVersion`. Une version antérieure affiche un écran bloquant invitant à la mise à jour — indispensable pour retirer une version comportant une faille ou une incompatibilité de schéma.

### 17.4 Supervision

| Domaine | Outil | Alerte |
|---|---|---|
| Plantages | Sentry | Taux sans reprise > 0,5 % |
| Performance API | OpenTelemetry + Grafana | P95 > 500 ms |
| Disponibilité | Sonde externe | 2 échecs consécutifs |
| MongoDB | Atlas / Prometheus | Requête sans index détectée, latence, saturation disque |
| Métier | Tableau de bord | Chute du taux de conversion, pic d'échecs de paiement |
| Usage | Firebase Analytics | Rétention J1/J7/J30, entonnoirs |

### 17.5 Sauvegarde et reprise

Sauvegarde MongoDB continue avec restauration à un instant donné (7 jours) et instantané quotidien conservé 30 jours. Stockage objet répliqué avec versionnage. **Restauration testée chaque trimestre** — une sauvegarde jamais restaurée n'est pas une sauvegarde. Objectifs : RPO 1 h, RTO 4 h.

---

## 18. Planning par lots et charge

Estimation pour une équipe de **3 personnes** : 1 développeur Flutter, 1 développeur backend, 1 profil mixte design et qualité.

| Lot | Contenu | Durée | Livrable |
|---|---|---|---|
| **L0 — Socle** | Architecture, CI/CD, design system, ossature API, schémas MongoDB, authentification | 4 sem. | Application coquille, connexion fonctionnelle |
| **L1 — Découverte** | Accueil, recherche, catalogue, fiche produit, boutique, WiFiMarkets, cache hors ligne | 5 sem. | Version consultable |
| **L2 — Achat** | Panier, tunnel, commandes, suivi, paiements mobile money | 6 sem. | **MVP commercialisable** |
| **L3 — Social** | Fil, publications, stories, réactions, commentaires, abonnements, profils | 5 sem. | Réseau social complet |
| **L4 — Communication** | Messagerie temps réel, notifications push, demandes clients | 4 sem. | Version 1.0 publique |
| **L5 — Commerçant** | Tableau de bord, commandes, produits, stock avec scan, encaissement, factures | 6 sem. | Version 1.1 |
| **L6 — Livreur** | Tournée, navigation, suivi en direct, preuve de livraison | 3 sem. | Version 1.2 |
| **L7 — Consolidation** | Migration M5–M7, optimisation, accessibilité, malgache, durcissement | 4 sem. | Version 2.0 |

**Durée totale : 37 semaines**, soit environ 9 mois. Publication du MVP à la fin du lot L2, en **semaine 15**.

Les lots de migration M0 à M4 se déroulent en parallèle des lots L0 à L4, portés par le développeur backend.

---

## 19. Livrables

### 19.1 Logiciels

- Code source Flutter, backend NestJS et outillage de migration, versionnés.
- Application Android publiée sur Google Play, application iOS publiée sur l'App Store.
- API déployée en production et en préproduction.
- Base MongoDB en jeu de réplicas, sauvegardée et supervisée.

### 19.2 Documentation

| Document | Contenu |
|---|---|
| Documentation d'API | OpenAPI 3.1 publiée, avec console d'essai |
| Dictionnaire des collections | Schémas, index, règles de validation |
| Documentation d'architecture | Décisions techniques et leurs motifs (ADR) |
| Guide de développement | Installation, conventions, procédure de contribution |
| Guide de déploiement | Infrastructure, secrets, procédure de bascule |
| **Manuel utilisateur** | Un par rôle : client, commerçant, livreur — *absent du projet web, exigé au chapitre 13 du cahier des charges initial* |
| Rapport de migration | Un par lot, avec preuves de validation |
| **Rapport de tests** | Couverture, résultats, campagne terrain — *absent du projet web* |
| Politique de confidentialité | Publiée et accessible hors ligne |

### 19.3 Recette

Campagne de tests en conditions réelles à Mahajanga : 10 clients, 5 commerçants, 2 livreurs, sur 2 semaines, avec relevé des incidents et des retours d'usage.

---

## 20. Risques et mesures de maîtrise

| # | Risque | Probabilité | Impact | Mesure de maîtrise |
|---|---|---|---|---|
| R1 | **Double base MariaDB/MongoDB pérennisée par défaut d'arbitrage** | Élevée | **Critique** | Trajectoire C contractualisée, jalons de migration inscrits au planning, date d'extinction de MariaDB fixée dès L0 |
| R2 | API mobile money instable ou documentation lacunaire | Élevée | Élevé | Abstraction par interface, mode dégradé manuel, vérification périodique en complément des rappels |
| R3 | Modèle documentaire mal découpé, découvert tardivement | Moyenne | Élevé | Revue de modélisation avant L1, tests de charge sur volumétrie réaliste dès L2 |
| R4 | Délais de revue sur l'App Store | Moyenne | Moyen | Soumission d'une version pilote dès L1, conformité aux règles vérifiée en amont |
| R5 | Adoption commerçant plus lente que prévu | Moyenne | Élevé | Formation terrain, accompagnement des 10 premières boutiques, période de coexistence web/mobile |
| R6 | Performance dégradée sur terminaux d'entrée de gamme | Moyenne | Moyen | Terminal de référence à 4 Go de RAM en CI, budgets de performance bloquants |
| R7 | Coût des données mobiles dissuasif à l'usage | Moyenne | Élevé | Budget réseau contractuel (< 1,5 Mo / 5 min), mode économie de données, images WebP dimensionnées |
| R8 | Départ du développeur unique sur un domaine | Moyenne | Élevé | Revue de code croisée obligatoire, documentation d'architecture tenue à jour, aucune zone à propriétaire unique |

---

## 21. Annexes

### Annexe A — Correspondance web → mobile

| Module web | Routes | Écrans mobiles | Couverture |
|---|---|---|---|
| Site vitrine | 5 | 1 (Accueil) | Adaptée |
| Authentification | 10 | 5 | Complète + OTP |
| Catalogue et boutiques | 8 | 4 | Complète |
| WiFiMarkets | 2 | 1 | Enrichie (GPS natif) |
| Panier et commande | 17 | 7 | Complète |
| Social | 20 | 8 | Complète |
| Demandes clients | 12 | 5 | Complète |
| Messagerie | 10 | 4 | Enrichie (temps réel) |
| Compte | 18 | 7 | Complète |
| Espaces commerçant | 103 | 10 | **Partielle — opérations de terrain** |
| Administration commerciale | 24 | 1 (tableau de bord) | Partielle |
| Back-office plateforme | 49 | 0 | **Hors périmètre** |

### Annexe B — Dépendances Flutter principales

```yaml
dependencies:
  flutter_riverpod        # gestion d'état
  riverpod_annotation
  go_router               # navigation et liens profonds
  dio                     # client HTTP
  retrofit                # génération du client d'API
  freezed_annotation      # modèles immuables
  json_annotation
  drift                   # cache local SQLite interrogeable
  sqlcipher_flutter_libs  # chiffrement du cache
  flutter_secure_storage  # jetons
  flutter_map             # cartographie OpenStreetMap
  latlong2
  geolocator              # position et suivi
  geocoding
  firebase_core
  firebase_messaging      # push
  firebase_analytics
  flutter_local_notifications
  cached_network_image
  image_picker
  mobile_scanner          # codes-barres et QR
  flutter_image_compress
  socket_io_client        # temps réel
  connectivity_plus       # détection réseau
  local_auth              # biométrie
  share_plus
  url_launcher            # appel, WhatsApp, SMS
  intl                    # localisation, formatage Ariary
  sentry_flutter

dev_dependencies:
  build_runner
  freezed
  json_serializable
  retrofit_generator
  drift_dev
  riverpod_generator
  mocktail
  integration_test
  very_good_analysis
```

### Annexe C — Comparatif des index géographiques

| | Web actuel (MariaDB) | Mobile (MongoDB) |
|---|---|---|
| Méthode | Haversine écrite à la main en SQL | `$geoNear` sur index `2dsphere` |
| Index utilisable | **Aucun** — calcul sur chaque ligne | Arbre géospatial |
| Complexité | O(n) sur toutes les boutiques | O(log n) |
| Tri par distance | En mémoire, après calcul complet | Natif, intégré à l'index |
| Filtres combinés | Après calcul de distance | Intégrés à l'étape `$geoNear` |
| Modèle terrestre | Sphère approximée | Ellipsoïde |
| Estimation à 10 000 boutiques | ~800 ms | **< 150 ms** |

### Annexe D — Glossaire

| Terme | Définition |
|---|---|
| **Instantané** (snapshot) | Copie figée de données au moment d'un événement — nom et prix d'un produit dans une commande |
| **Dénormalisation** | Duplication volontaire d'une donnée pour éviter une jointure à la lecture |
| **Pagination par curseur** | Pagination par pointeur opaque plutôt que par décalage numérique, stable en cas d'insertion |
| **Idempotence** | Propriété d'une opération dont la répétition produit le même résultat qu'une exécution unique |
| **Index TTL** | Index MongoDB supprimant automatiquement les documents après expiration |
| **Séries temporelles** | Type de collection MongoDB optimisé pour les données horodatées à fort volume d'écriture |
| **Mise à jour optimiste** | Affichage immédiat du résultat attendu, avant confirmation du serveur |
| **Strangler fig** | Motif de migration remplaçant un système par domaines successifs plutôt qu'en une bascule |

---

*Ce cahier des charges est un document prévisionnel. Il doit être révisé à chaque fin de lot et confronté à la réalisation, comme l'a été le cahier des charges du système web dans [CAHIER_DES_CHARGES_SYSTEME.md](CAHIER_DES_CHARGES_SYSTEME.md).*
