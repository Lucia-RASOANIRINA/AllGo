import 'reflect-metadata';
// Ce script s'exécute HORS du contexte Nest : `ConfigModule` ne l'a pas chargé
// pour lui, il doit donc lire `.env` lui-même.
import 'dotenv/config';
import * as argon2 from 'argon2';
import { Db, Decimal128, MongoClient, ObjectId } from 'mongodb';

/**
 * Jeu de données de développement — Mahajanga.
 *
 * Coordonnées réelles : la ville est à environ 15,72° S et 46,32° E. Des
 * positions plausibles sont indispensables pour éprouver `$geoNear` : avec des
 * points aléatoires, une erreur d'inversion `[lat, lng]` passerait inaperçue.
 *
 *   npm run seed
 *
 * REFUSE de s'exécuter en production : un jeu de test écrasant des données
 * réelles est le genre d'accident qu'on ne répare pas.
 */

const MAHAJANGA = { lat: -15.7167, lng: 46.3167 };

const PASSWORD = 'MotDePasse2026';

/** Décale un point de quelques centaines de mètres, de façon déterministe. */
function nearMahajanga(offsetIndex: number): { type: 'Point'; coordinates: [number, number] } {
  const deltas: Array<[number, number]> = [
    [0.004, 0.006],
    [-0.008, 0.003],
    [0.012, -0.009],
    [-0.015, -0.011],
    [0.021, 0.017],
  ];
  const [dLat, dLng] = deltas[offsetIndex % deltas.length];
  // Ordre GeoJSON : [longitude, latitude] — l'inverse de l'habitude (§15.4).
  return { type: 'Point', coordinates: [MAHAJANGA.lng + dLng, MAHAJANGA.lat + dLat] };
}

interface CategoryIds {
  alimentation: ObjectId;
  epicerie: ObjectId;
  mode: ObjectId;
}

async function seedCategories(db: Db): Promise<CategoryIds> {
  const ids: CategoryIds = {
    alimentation: new ObjectId(),
    epicerie: new ObjectId(),
    mode: new ObjectId(),
  };

  const now = new Date();

  await db.collection('categories').deleteMany({});
  await db.collection('categories').insertMany([
    {
      _id: ids.alimentation,
      name: 'Alimentation',
      slug: 'alimentation',
      icon: 'restaurant',
      parentId: null,
      ancestors: [],
      depth: 0,
      order: 1,
      productCount: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: ids.epicerie,
      name: 'Épicerie',
      slug: 'epicerie',
      icon: 'shopping_basket',
      parentId: ids.alimentation,
      // La chaîne complète depuis la racine : filtrer sur `categoryPath`
      // ramène la catégorie ET ses descendantes, en une requête indexée.
      ancestors: [ids.alimentation],
      depth: 1,
      order: 1,
      productCount: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: ids.mode,
      name: 'Mode et vêtements',
      slug: 'mode-vetements',
      icon: 'checkroom',
      parentId: null,
      ancestors: [],
      depth: 0,
      order: 2,
      productCount: 0,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  return ids;
}

async function seedUsers(
  db: Db,
  shopId: ObjectId,
): Promise<{ ownerId: ObjectId; clientId: ObjectId }> {
  // Argon2id dès le jeu de test : jamais de mot de passe en clair, même en
  // développement — c'est ainsi qu'une habitude s'installe.
  const passwordHash = await argon2.hash(PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  const ownerId = new ObjectId();
  const clientId = new ObjectId();
  const now = new Date();
  const preferences = { locale: 'fr', theme: 'system', pushEnabled: true, pushCategories: {} };

  await db.collection('users').deleteMany({});
  await db.collection('users').insertMany([
    {
      _id: ownerId,
      phone: '+261340000001',
      passwordHash,
      firstName: 'Hery',
      lastName: 'Rakoto',
      status: 'active',
      // Rôles cumulés avec portée : un commerçant reste un client (§3.1).
      roles: [{ role: 'client' }, { role: 'shop_owner', shopId }],
      addresses: [],
      devices: [],
      preferences,
      presence: { isOnline: false },
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: clientId,
      phone: '+261340000002',
      passwordHash,
      firstName: 'Soa',
      lastName: 'Randria',
      status: 'active',
      roles: [{ role: 'client' }],
      addresses: [
        {
          _id: new ObjectId(),
          label: 'Domicile',
          city: 'Mahajanga',
          district: 'Mahavoky Atsimo',
          line: 'Lot II M 45 bis, près de la station Jovenna',
          location: nearMahajanga(1),
          isDefault: true,
        },
      ],
      devices: [],
      preferences,
      presence: { isOnline: false },
      createdAt: now,
      updatedAt: now,
    },
  ]);

  return { ownerId, clientId };
}

async function seedShop(
  db: Db,
  shopId: ObjectId,
  ownerId: ObjectId,
  categoryId: ObjectId,
): Promise<void> {
  const now = new Date();

  await db.collection('shops').deleteMany({});
  await db.collection('shops').insertOne({
    _id: shopId,
    ownerId,
    slug: 'epicerie-mahavoky',
    name: 'Épicerie Mahavoky',
    description: 'Produits de première nécessité, livraison dans tout Mahajanga.',
    categoryId,
    categoryName: 'Épicerie',
    contact: { phone: '+261340000001', whatsapp: '+261340000001' },
    address: { city: 'Mahajanga', line: 'Avenue de France' },
    location: nearMahajanga(0),
    deliveryRadiusKm: 8,
    openingHours: [1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '07:00', close: '19:00' })),
    team: [
      {
        userId: ownerId,
        name: 'Hery Rakoto',
        role: 'shop_owner',
        status: 'active',
        joinedAt: now,
      },
    ],
    status: 'approved',
    isFeatured: true,
    stats: { productCount: 3, orderCount: 0, rating: 4.5, reviewCount: 12, followerCount: 34 },
    createdAt: now,
    updatedAt: now,
  });
}

async function seedProducts(db: Db, shopId: ObjectId, categories: CategoryIds): Promise<string[]> {
  const now = new Date();
  const shop = { name: 'Épicerie Mahavoky', slug: 'epicerie-mahavoky', city: 'Mahajanga' };
  const categoryPath = [categories.alimentation, categories.epicerie];

  const base = {
    shopId,
    shop,
    categoryId: categories.epicerie,
    categoryPath,
    currency: 'MGA',
    media: [],
    variants: [],
    status: 'published',
    location: nearMahajanga(0),
    createdAt: now,
    updatedAt: now,
  };

  await db.collection('products').deleteMany({});
  const result = await db.collection('products').insertMany([
    {
      ...base,
      name: 'Riz Makalioka 5 kg',
      slug: 'riz-makalioka-5kg',
      description: 'Riz local de qualité, sac de 5 kilogrammes.',
      barcode: '6001234567890',
      // Decimal128, jamais Double : un arrondi sur un montant est inacceptable.
      price: Decimal128.fromString('22000'),
      promoPrice: Decimal128.fromString('19500'),
      stock: 48,
      minStock: 10,
      stats: { views: 0, sales: 0, rating: 4.6, reviewCount: 8 },
    },
    {
      ...base,
      name: 'Huile végétale 1 L',
      slug: 'huile-vegetale-1l',
      barcode: '6001234567891',
      price: Decimal128.fromString('9500'),
      stock: 120,
      minStock: 20,
      stats: { views: 0, sales: 0, rating: 4.2, reviewCount: 3 },
    },
    {
      ...base,
      name: 'Sucre roux 1 kg',
      slug: 'sucre-roux-1kg',
      barcode: '6001234567892',
      price: Decimal128.fromString('5200'),
      // Sous le seuil : alimente l'écran d'alertes de stock (§8.1, module 7).
      stock: 4,
      minStock: 15,
      stats: { views: 0, sales: 0, rating: 0, reviewCount: 0 },
    },
  ]);

  return Object.values(result.insertedIds).map((id) => id.toHexString());
}

async function seed(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Le jeu de données de développement ne s’exécute pas en production.');
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI doit être définie.');

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  try {
    const shopId = new ObjectId();

    const categories = await seedCategories(db);
    const { ownerId } = await seedUsers(db, shopId);
    await seedShop(db, shopId, ownerId, categories.epicerie);
    const productIds = await seedProducts(db, shopId, categories);

    await db.collection('carts').deleteMany({});
    await db.collection('counters').deleteMany({});

    process.stdout.write(
      [
        '',
        'Jeu de données de développement en place.',
        '  3 catégories · 2 utilisateurs · 1 boutique · 3 produits',
        '',
        `  Commerçant : +261340000001 / ${PASSWORD}`,
        `  Client     : +261340000002 / ${PASSWORD}`,
        '',
        `  Boutique   : ${shopId.toHexString()} (epicerie-mahavoky)`,
        `  Produits   : ${productIds.join(', ')}`,
        '',
        `  Test WiFiMarkets : GET /v1/geo/shops?lat=${MAHAJANGA.lat}&lng=${MAHAJANGA.lng}&radius=5`,
        '',
      ].join('\n'),
    );
  } finally {
    await client.close();
  }
}

void seed().catch((error: unknown) => {
  process.stderr.write(`Échec du jeu de données : ${String(error)}\n`);
  process.exit(1);
});
