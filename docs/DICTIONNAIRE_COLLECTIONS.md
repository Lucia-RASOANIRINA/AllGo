# Dictionnaire des collections MongoDB

Référence : chapitre 6 du [cahier des charges](CAHIER_DES_CHARGES_MOBILE_FLUTTER.md).
**18 collections** remplacent les 59 tables du web.

Ce document décrit ce qui est réellement déclaré dans `backend/src/modules/*/schemas/`.
Il est mis à jour à chaque modification de schéma, jamais après coup.

## Règles d'arbitrage appliquées

| Règle | Où elle s'applique ici |
|---|---|
| Embarquer ce qui est lu ensemble et **borné** | `products.media`, `orders.items`, `users.addresses`, `shops.team` |
| Référencer ce qui croît **sans limite** | `comments`, `messages`, `reactions`, `follows`, `stockMovements` |
| Dénormaliser les instantanés d'affichage | `posts.author`, `products.shop`, `conversations.lastMessage` |
| Figer les instantanés **contractuels** | `orders.items` — nom et prix figés à l'achat, jamais réécrits |
| Jamais de tableau non borné dans un document | Aucun — voir les antipatrons proscrits §6.5 |
| Index avant mise en production | Tout index est déclaré dans le fichier de schéma, à côté du champ |

## Collections

| Collection | Fichier | Index notables |
|---|---|---|
| `users` | `modules/users/schemas/user.schema.ts` | `phone` unique · `email` unique sparse · `roles.shopId + roles.role` · `addresses.location` **2dsphere** |
| `shops` | `modules/shops/schemas/shop.schema.ts` | `slug` unique · `location` **2dsphere** · `status + isFeatured` · `team.userId` · textuel `name`/`description` |
| `products` | `modules/catalog/schemas/product.schema.ts` | `shopId + status` · `categoryPath + status` · `barcode` sparse · `location` 2dsphere · textuel pondéré 10/2 |
| `categories` | `modules/catalog/schemas/category.schema.ts` | `slug` unique · `ancestors` · `parentId + order` |
| `orders` | `modules/orders/schemas/order.schema.ts` | `orderNumber` **unique** · `userId + createdAt` · `shopId + status + createdAt` · `delivery.courierId + status` |
| `carts` | `modules/orders/schemas/cart.schema.ts` | `_id` = identifiant utilisateur |
| `counters` | `modules/orders/schemas/counter.schema.ts` | `_id` = clé de séquence |
| `invoices` | `modules/orders/schemas/invoice.schema.ts` | `invoiceNumber` unique · `shopId + createdAt` |
| `refunds` | `modules/orders/schemas/invoice.schema.ts` | `orderId` |
| `posts` | `modules/social/schemas/post.schema.ts` | `authorId + createdAt` · `kind + request.status + request.categoryId` · `hashtags` · `location` 2dsphere |
| `comments` | `modules/social/schemas/interactions.schema.ts` | `postId + createdAt` · `parentId + createdAt` |
| `reactions` | idem | `targetId + userId` **unique** |
| `follows` | idem | `followerId + targetType + targetId` **unique** |
| `favorites` | idem | `userId + productId` **unique** |
| `stories` | `modules/social/schemas/story.schema.ts` | `expiresAt` **TTL** (`expireAfterSeconds: 0`) |
| `conversations` | `modules/messaging/schemas/conversation.schema.ts` | `participants.userId + updatedAt` |
| `messages` | idem | `conversationId + createdAt` |
| `notifications` | `modules/notifications/schemas/notification.schema.ts` | `userId + createdAt` · `expiresAt` **TTL** 90 j |
| `stockMovements` | `modules/stock/schemas/stock-movement.schema.ts` | `shopId + at` · `productId + at` — **collection ordinaire, voir ADR 0002** |
| `refreshTokens` | `modules/auth/schemas/refresh-token.schema.ts` | `sid` unique · `expiresAt` TTL |

## Points de vigilance

**Coordonnées** — GeoJSON attend `[longitude, latitude]`. L'ordre inverse de
l'habitude est l'erreur classique, et elle est **silencieuse** : les index se
construisent, les requêtes s'exécutent, et les boutiques de Mahajanga se
retrouvent quelque part en Somalie. `migration/src/transforms.ts` porte un
garde-fou sur l'enveloppe géographique de Madagascar.

**Montants** — `Decimal128`, jamais `Double`. Le contrôle métier du §15.5 exige
que la somme des commandes migrées soit identique au centime près ; un flottant
détruirait cette égalité sur quelques milliers de lignes.

**`stockMovements` n'est pas une collection de séries temporelles**, contrairement
à ce que prescrit le §6.2. MongoDB interdit d'insérer dans une telle collection
au sein d'une transaction multi-documents, ce qu'exige pourtant le §6.3 pour la
création de commande. Les deux exigences sont incompatibles ; l'intégrité du
journal l'emporte sur la compression. Le détail du conflit et de l'arbitrage est
dans [ADR 0002](adr/0002-stockmovements-series-temporelles-vs-transactions.md).

La règle **append-only** demeure — un mouvement n'est jamais réécrit, une
correction s'enregistre comme un nouveau mouvement de type `correction` — mais
elle est désormais tenue par le service, non par le moteur. À vérifier en revue
de code, puisque plus rien ne l'impose techniquement.

**Réponses HTTP** — `_id` devient `id` et tout `Decimal128` est sérialisé en
chaîne, à la frontière HTTP (`common/http/serialisation.ts`). Sans cela, la
forme du corps dépend de la façon dont la donnée a été lue : `.lean()` renvoie
`_id`, un document hydraté renvoie `id`, et un montant sort en
`{"$numberDecimal":"5200"}`. Le traitement n'est pas fait par un plugin Mongoose
`toJSON` parce que `.lean()` le court-circuiterait — donc précisément sur les
requêtes de liste, les plus fréquentes.

**Empreintes de mots de passe** — `users.passwordHash` porte `select: false`.
Elle n'est jamais renvoyée par une requête ordinaire ; il faut la demander
explicitement. La colonne `temp_password` du web, qui stocke les mots de passe
en clair, n'est pas reprise.

## Ce qui n'est pas migré

`advertisements`, `post_hashtags`, `invoice_items`, `password_resets` — tables
mortes du web. Les reprendre serait transporter la dette plutôt que la solder.

## Fusions

| Web | Mobile | Motif |
|---|---|---|
| `posts` (+ 8 colonnes de `add_post_fields.sql`) **et** `client_requests` | `posts` avec `kind` | Deux systèmes parallèles portant la même information coexistaient |
| `invoices` **et** `sales_invoices` | `invoices` | Deux numérotations indépendantes pour un même objet métier |
| `role` + `admin_level` + `shop_team_members.team_role` | `users.roles[]` | Trois mécanismes superposés, à l'origine d'une faille d'accès |
