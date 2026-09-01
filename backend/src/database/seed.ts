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
 *
 * Couvre désormais un compte par rôle (client, commerçant × 2, livreur,
 * administrateur plateforme) et au moins un document par fonctionnalité
 * ajoutée depuis le lot L0 : coupon, promotion flash + code promo, commande
 * livrée ET commande en cours de livraison, avis, litige, publication,
 * story liée à un produit, conversation, bonus et retrait livreur.
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
  boissons: ObjectId;
  mode: ObjectId;
}

async function seedCategories(db: Db): Promise<CategoryIds> {
  const ids: CategoryIds = {
    alimentation: new ObjectId(),
    epicerie: new ObjectId(),
    boissons: new ObjectId(),
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
      _id: ids.boissons,
      name: 'Boissons',
      slug: 'boissons',
      icon: 'local_drink',
      parentId: ids.alimentation,
      ancestors: [ids.alimentation],
      depth: 1,
      order: 2,
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

interface UserIds {
  owner1: ObjectId;
  owner2: ObjectId;
  client1: ObjectId;
  client2: ObjectId;
  courier: ObjectId;
  admin: ObjectId;
}

async function seedUsers(db: Db, shop1Id: ObjectId, shop2Id: ObjectId): Promise<UserIds> {
  // Argon2id dès le jeu de test : jamais de mot de passe en clair, même en
  // développement — c'est ainsi qu'une habitude s'installe.
  const passwordHash = await argon2.hash(PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  const ids: UserIds = {
    owner1: new ObjectId(),
    owner2: new ObjectId(),
    client1: new ObjectId(),
    client2: new ObjectId(),
    courier: new ObjectId(),
    admin: new ObjectId(),
  };
  const now = new Date();
  const preferences = { locale: 'fr', theme: 'system', pushEnabled: true, pushCategories: {} };

  await db.collection('users').deleteMany({});
  await db.collection('users').insertMany([
    {
      _id: ids.owner1,
      phone: '+261340000001',
      email: 'hery.rakoto@allgo.mg',
      passwordHash,
      firstName: 'Hery',
      lastName: 'Rakoto',
      status: 'active',
      // Rôles cumulés avec portée : un commerçant reste un client (§3.1).
      roles: [{ role: 'client' }, { role: 'shop_owner', shopId: shop1Id }],
      addresses: [],
      devices: [],
      preferences,
      presence: { isOnline: false },
      emailVerifiedAt: now,
      phoneVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: ids.client1,
      phone: '+261340000002',
      email: 'soa.randria@allgo.mg',
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
      phoneVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: ids.owner2,
      phone: '+261340000003',
      email: 'lala.andria@allgo.mg',
      passwordHash,
      firstName: 'Lala',
      lastName: 'Andriamampianina',
      status: 'active',
      roles: [{ role: 'client' }, { role: 'shop_owner', shopId: shop2Id }],
      addresses: [],
      devices: [],
      preferences,
      presence: { isOnline: false },
      phoneVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: ids.courier,
      phone: '+261340000004',
      passwordHash,
      firstName: 'Tovo',
      lastName: 'Rabe',
      status: 'active',
      // Portée boutique par construction du modèle (§3.1) — en pratique, les
      // missions de livraison ne filtrent pas par boutique (§26).
      roles: [{ role: 'client' }, { role: 'shop_courier', shopId: shop1Id }],
      courierProfile: {
        identityVerified: true,
        vehicle: 'Moto',
        documents: ['permis-conduire.jpg', 'carte-identite.jpg'],
        available: true,
      },
      addresses: [],
      devices: [],
      preferences,
      presence: { isOnline: true },
      phoneVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: ids.admin,
      phone: '+261340000005',
      email: 'admin@allgo.mg',
      passwordHash,
      firstName: 'Admin',
      lastName: 'AllGo',
      status: 'active',
      roles: [{ role: 'client' }, { role: 'platform_admin' }],
      addresses: [],
      devices: [],
      preferences,
      presence: { isOnline: false },
      emailVerifiedAt: now,
      phoneVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: ids.client2,
      phone: '+261340000006',
      passwordHash,
      firstName: 'Fara',
      lastName: 'Ravelo',
      status: 'active',
      roles: [{ role: 'client' }],
      addresses: [
        {
          _id: new ObjectId(),
          label: 'Bureau',
          city: 'Mahajanga',
          district: 'Tsaramandroso',
          line: 'Immeuble Zafy, 2e étage',
          location: nearMahajanga(2),
          isDefault: true,
        },
      ],
      devices: [],
      preferences,
      presence: { isOnline: false },
      phoneVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  return ids;
}

async function seedShops(
  db: Db,
  shop1Id: ObjectId,
  shop2Id: ObjectId,
  owner1Id: ObjectId,
  owner2Id: ObjectId,
  courierId: ObjectId,
  categories: CategoryIds,
): Promise<void> {
  const now = new Date();

  await db.collection('shops').deleteMany({});
  await db.collection('shops').insertMany([
    {
      _id: shop1Id,
      ownerId: owner1Id,
      slug: 'epicerie-mahavoky',
      name: 'Épicerie Mahavoky',
      description: 'Produits de première nécessité, livraison dans tout Mahajanga.',
      categoryId: categories.epicerie,
      categoryName: 'Épicerie',
      contact: { phone: '+261340000001', whatsapp: '+261340000001' },
      address: { city: 'Mahajanga', line: 'Avenue de France' },
      location: nearMahajanga(0),
      deliveryRadiusKm: 8,
      deliveryAvailable: true,
      pickupAvailable: true,
      deliveryFee: 2000,
      closedDays: [7],
      openingHours: [1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '07:00', close: '19:00' })),
      team: [
        { userId: owner1Id, name: 'Hery Rakoto', role: 'shop_owner', status: 'active', joinedAt: now },
        {
          userId: courierId,
          name: 'Tovo Rabe',
          role: 'shop_courier',
          status: 'active',
          invitedBy: owner1Id,
          joinedAt: now,
        },
      ],
      status: 'approved',
      isFeatured: true,
      stats: { productCount: 4, orderCount: 2, rating: 4.5, reviewCount: 1, followerCount: 34 },
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: shop2Id,
      ownerId: owner2Id,
      slug: 'sahaza-mode',
      name: 'Sahaza Mode',
      description: 'Vêtements et accessoires tendance, du sur-mesure à la pièce prête à porter.',
      categoryId: categories.mode,
      categoryName: 'Mode et vêtements',
      contact: { phone: '+261340000003', whatsapp: '+261340000003' },
      address: { city: 'Mahajanga', line: 'Rue du Commerce, Mahabibo' },
      location: nearMahajanga(2),
      deliveryRadiusKm: 6,
      deliveryAvailable: true,
      pickupAvailable: true,
      deliveryFee: 3000,
      closedDays: [],
      openingHours: [1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '08:30', close: '18:30' })),
      team: [{ userId: owner2Id, name: 'Lala Andriamampianina', role: 'shop_owner', status: 'active', joinedAt: now }],
      status: 'approved',
      isFeatured: false,
      stats: { productCount: 3, orderCount: 1, rating: 0, reviewCount: 0, followerCount: 5 },
      createdAt: now,
      updatedAt: now,
    },
  ]);
}

interface ProductIds {
  riz: ObjectId;
  huile: ObjectId;
  sucre: ObjectId;
  eau: ObjectId;
  robe: ObjectId;
  chemise: ObjectId;
  sandales: ObjectId;
}

async function seedProducts(
  db: Db,
  shop1Id: ObjectId,
  shop2Id: ObjectId,
  categories: CategoryIds,
): Promise<ProductIds> {
  const now = new Date();
  const shop1 = { name: 'Épicerie Mahavoky', slug: 'epicerie-mahavoky', city: 'Mahajanga' };
  const shop2 = { name: 'Sahaza Mode', slug: 'sahaza-mode', city: 'Mahajanga' };
  const epicerieCategoryPath = [categories.alimentation, categories.epicerie];
  const boissonsCategoryPath = [categories.alimentation, categories.boissons];

  const image = (seed: string) => ({
    isMain: true,
    thumbUrl: `https://images.unsplash.com/${seed}?auto=format&fit=crop&w=1200&q=80`,
    previewUrl: `https://images.unsplash.com/${seed}?auto=format&fit=crop&w=1200&q=80`,
  });

  const ids: ProductIds = {
    riz: new ObjectId(),
    huile: new ObjectId(),
    sucre: new ObjectId(),
    eau: new ObjectId(),
    robe: new ObjectId(),
    chemise: new ObjectId(),
    sandales: new ObjectId(),
  };

  await db.collection('products').deleteMany({});
  await db.collection('products').insertMany([
    {
      _id: ids.riz,
      shopId: shop1Id,
      shop: shop1,
      categoryId: categories.epicerie,
      categoryPath: epicerieCategoryPath,
      currency: 'MGA',
      name: 'Riz Makalioka 5 kg',
      slug: 'riz-makalioka-5kg',
      description: 'Riz local de qualité, sac de 5 kilogrammes.',
      barcode: '6001234567890',
      media: [image('photo-1586201375761-83865001e31d'), image('photo-1604908556856-ff686c9fe616')],
      variants: [],
      // Decimal128, jamais Double : un arrondi sur un montant est inacceptable.
      price: Decimal128.fromString('22000'),
      promoPrice: Decimal128.fromString('19500'),
      stock: 48,
      minStock: 10,
      isAvailable: true,
      isFeatured: true,
      isHidden: false,
      status: 'published',
      location: nearMahajanga(0),
      stats: { views: 42, sales: 12, rating: 5, reviewCount: 1 },
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: ids.huile,
      shopId: shop1Id,
      shop: shop1,
      categoryId: categories.epicerie,
      categoryPath: epicerieCategoryPath,
      currency: 'MGA',
      name: 'Huile végétale 1 L',
      slug: 'huile-vegetale-1l',
      barcode: '6001234567891',
      media: [image('photo-1577311364431-2358a7f306d9'), image('photo-1542838132-92c53300491e')],
      variants: [],
      price: Decimal128.fromString('9500'),
      stock: 120,
      minStock: 20,
      isAvailable: true,
      isFeatured: false,
      isHidden: false,
      status: 'published',
      location: nearMahajanga(0),
      stats: { views: 18, sales: 30, rating: 4.2, reviewCount: 3 },
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: ids.sucre,
      shopId: shop1Id,
      shop: shop1,
      categoryId: categories.epicerie,
      categoryPath: epicerieCategoryPath,
      currency: 'MGA',
      name: 'Sucre roux 1 kg',
      slug: 'sucre-roux-1kg',
      barcode: '6001234567892',
      media: [image('photo-1596040033229-a9821ebd058d'), image('photo-1502741338009-cac2772e18bc')],
      variants: [],
      price: Decimal128.fromString('5200'),
      // Sous le seuil : alimente l'écran d'alertes de stock (§8.1, module 7).
      stock: 4,
      minStock: 15,
      isAvailable: true,
      isFeatured: false,
      isHidden: false,
      status: 'published',
      location: nearMahajanga(0),
      stats: { views: 6, sales: 2, rating: 0, reviewCount: 0 },
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: ids.eau,
      shopId: shop1Id,
      shop: shop1,
      categoryId: categories.boissons,
      categoryPath: boissonsCategoryPath,
      currency: 'MGA',
      name: 'Eau minérale 1,5 L (pack de 6)',
      slug: 'eau-minerale-1-5l-pack-6',
      barcode: '6001234567893',
      media: [image('photo-1560023907-5f339617ea30')],
      variants: [],
      price: Decimal128.fromString('7200'),
      stock: 60,
      minStock: 10,
      isAvailable: true,
      isFeatured: false,
      isHidden: false,
      status: 'published',
      location: nearMahajanga(0),
      stats: { views: 9, sales: 5, rating: 0, reviewCount: 0 },
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: ids.robe,
      shopId: shop2Id,
      shop: shop2,
      categoryId: categories.mode,
      categoryPath: [categories.mode],
      currency: 'MGA',
      name: 'Robe imprimée lamba',
      slug: 'robe-imprimee-lamba',
      description: 'Robe en tissu imprimé local, coupe évasée.',
      media: [image('photo-1595777457583-95e059d581b8')],
      variants: [
        { _id: new ObjectId(), name: 'S', sku: 'ROBE-S', size: 'S', priceDelta: Decimal128.fromString('0'), stock: 5 },
        { _id: new ObjectId(), name: 'M', sku: 'ROBE-M', size: 'M', priceDelta: Decimal128.fromString('0'), stock: 8 },
        { _id: new ObjectId(), name: 'L', sku: 'ROBE-L', size: 'L', priceDelta: Decimal128.fromString('2000'), stock: 3 },
      ],
      price: Decimal128.fromString('45000'),
      promoPrice: Decimal128.fromString('36000'),
      stock: 16,
      minStock: 5,
      isAvailable: true,
      isFeatured: true,
      isHidden: false,
      status: 'published',
      location: nearMahajanga(2),
      stats: { views: 27, sales: 4, rating: 0, reviewCount: 0 },
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: ids.chemise,
      shopId: shop2Id,
      shop: shop2,
      categoryId: categories.mode,
      categoryPath: [categories.mode],
      currency: 'MGA',
      name: 'Chemise homme en coton',
      slug: 'chemise-homme-coton',
      description: 'Chemise manches longues, coton respirant, plusieurs coloris.',
      media: [image('photo-1602810318383-e386cc2a3ccf')],
      variants: [
        { _id: new ObjectId(), name: 'M', sku: 'CHEM-M', size: 'M', priceDelta: Decimal128.fromString('0'), stock: 6 },
        { _id: new ObjectId(), name: 'L', sku: 'CHEM-L', size: 'L', priceDelta: Decimal128.fromString('0'), stock: 4 },
      ],
      price: Decimal128.fromString('28000'),
      stock: 10,
      minStock: 4,
      isAvailable: true,
      isFeatured: false,
      isHidden: false,
      status: 'published',
      location: nearMahajanga(2),
      stats: { views: 15, sales: 1, rating: 0, reviewCount: 0 },
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: ids.sandales,
      shopId: shop2Id,
      shop: shop2,
      categoryId: categories.mode,
      categoryPath: [categories.mode],
      currency: 'MGA',
      name: 'Sandales en cuir artisanales',
      slug: 'sandales-cuir-artisanales',
      media: [image('photo-1543163521-1bf539c55dd2')],
      variants: [],
      price: Decimal128.fromString('18000'),
      stock: 22,
      minStock: 5,
      isAvailable: true,
      isFeatured: false,
      isHidden: false,
      status: 'published',
      location: nearMahajanga(2),
      stats: { views: 11, sales: 2, rating: 0, reviewCount: 0 },
      createdAt: now,
      updatedAt: now,
    },
  ]);

  return ids;
}

async function seedCoupon(db: Db): Promise<void> {
  const now = new Date();
  await db.collection('coupons').deleteMany({});
  await db.collection('coupons').insertOne({
    _id: new ObjectId(),
    code: 'BIENVENUE10',
    discountType: 'percent',
    discountValue: Decimal128.fromString('10'),
    minOrderAmount: Decimal128.fromString('5000'),
    maxDiscount: Decimal128.fromString('10000'),
    usageLimit: 200,
    usageCount: 0,
    active: true,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedPromotions(
  db: Db,
  shop1Id: ObjectId,
  shop2Id: ObjectId,
  chemiseId: ObjectId,
): Promise<ObjectId> {
  const now = new Date();
  const flashPromoId = new ObjectId();

  await db.collection('promotions').deleteMany({});
  await db.collection('promotions').insertMany([
    {
      _id: new ObjectId(),
      shopId: shop1Id,
      name: 'Fidélité Mahavoky',
      type: 'fixed',
      value: 2000,
      startsAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      endsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      couponCode: 'MAHAVOKY5',
      flash: false,
      specialOffer: false,
      active: true,
      redeemedCount: 0,
    },
    {
      _id: flashPromoId,
      shopId: shop2Id,
      name: 'Vente flash — chemises',
      type: 'percent',
      value: 20,
      startsAt: now,
      endsAt: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
      quantityLimit: 10,
      flash: true,
      specialOffer: true,
      productId: chemiseId,
      active: true,
      redeemedCount: 0,
    },
  ]);

  return flashPromoId;
}

interface OrderIds {
  delivered: ObjectId;
  inTransit: ObjectId;
}

async function seedOrders(
  db: Db,
  shop1Id: ObjectId,
  shop2Id: ObjectId,
  client1Id: ObjectId,
  courierId: ObjectId,
  products: ProductIds,
): Promise<OrderIds> {
  const now = new Date();
  const year = now.getUTCFullYear();
  const deliveredId = new ObjectId();
  const inTransitId = new ObjectId();

  const deliveredCreatedAt = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

  await db.collection('orders').deleteMany({});
  await db.collection('orders').insertMany([
    {
      _id: deliveredId,
      orderNumber: `ALG-${year}-0001`,
      userId: client1Id,
      customer: { name: 'Soa Randria', phone: '+261340000002' },
      shopId: shop1Id,
      shop: { name: 'Épicerie Mahavoky', slug: 'epicerie-mahavoky' },
      items: [
        {
          productId: products.riz,
          name: 'Riz Makalioka 5 kg',
          unitPrice: Decimal128.fromString('19500'),
          quantity: 1,
          subtotal: Decimal128.fromString('19500'),
        },
        {
          productId: products.huile,
          name: 'Huile végétale 1 L',
          unitPrice: Decimal128.fromString('9500'),
          quantity: 2,
          subtotal: Decimal128.fromString('19000'),
        },
      ],
      amounts: {
        subtotal: Decimal128.fromString('38500'),
        shippingFee: Decimal128.fromString('2000'),
        discount: Decimal128.fromString('0'),
        tip: Decimal128.fromString('1000'),
        total: Decimal128.fromString('41500'),
      },
      delivery: {
        method: 'delivery',
        address: 'Lot II M 45 bis, près de la station Jovenna',
        city: 'Mahajanga',
        phone: '+261340000002',
        location: nearMahajanga(1),
        courierId,
        workflowStatus: 'delivered',
        otpCode: '4821',
        proof: {
          photoUrl:
            'https://images.unsplash.com/photo-1594732832278-abd644401426?auto=format&fit=crop&w=800&q=80',
          capturedAt: new Date(deliveredCreatedAt.getTime() + 45 * 60 * 1000),
          location: nearMahajanga(1),
        },
        tip: Decimal128.fromString('1000'),
      },
      payment: { method: 'mvola', status: 'paid', paidAt: deliveredCreatedAt },
      status: 'delivered',
      timeline: [
        { status: 'pending', at: deliveredCreatedAt, byUserId: client1Id },
        { status: 'confirmed', at: new Date(deliveredCreatedAt.getTime() + 5 * 60 * 1000), byUserId: client1Id },
        { status: 'preparing', at: new Date(deliveredCreatedAt.getTime() + 15 * 60 * 1000), byUserId: client1Id },
        { status: 'shipped', at: new Date(deliveredCreatedAt.getTime() + 30 * 60 * 1000), byUserId: courierId },
        { status: 'delivered', at: new Date(deliveredCreatedAt.getTime() + 50 * 60 * 1000), byUserId: courierId },
      ],
      createdAt: deliveredCreatedAt,
      updatedAt: new Date(deliveredCreatedAt.getTime() + 50 * 60 * 1000),
    },
    {
      _id: inTransitId,
      orderNumber: `ALG-${year}-0002`,
      userId: client1Id,
      customer: { name: 'Soa Randria', phone: '+261340000002' },
      shopId: shop2Id,
      shop: { name: 'Sahaza Mode', slug: 'sahaza-mode' },
      items: [
        {
          productId: products.chemise,
          name: 'Chemise homme en coton',
          unitPrice: Decimal128.fromString('28000'),
          quantity: 1,
          subtotal: Decimal128.fromString('28000'),
        },
      ],
      amounts: {
        subtotal: Decimal128.fromString('28000'),
        shippingFee: Decimal128.fromString('3000'),
        discount: Decimal128.fromString('0'),
        tip: Decimal128.fromString('0'),
        total: Decimal128.fromString('31000'),
      },
      delivery: {
        method: 'delivery',
        address: 'Lot II M 45 bis, près de la station Jovenna',
        city: 'Mahajanga',
        phone: '+261340000002',
        location: nearMahajanga(1),
        courierId,
        workflowStatus: 'to_client',
        otpCode: '7734',
      },
      payment: { method: 'cod', status: 'unpaid' },
      status: 'shipped',
      timeline: [
        { status: 'pending', at: new Date(now.getTime() - 60 * 60 * 1000), byUserId: client1Id },
        { status: 'confirmed', at: new Date(now.getTime() - 50 * 60 * 1000), byUserId: client1Id },
        { status: 'preparing', at: new Date(now.getTime() - 40 * 60 * 1000), byUserId: client1Id },
        { status: 'shipped', at: new Date(now.getTime() - 20 * 60 * 1000), byUserId: courierId },
      ],
      createdAt: new Date(now.getTime() - 60 * 60 * 1000),
      updatedAt: new Date(now.getTime() - 20 * 60 * 1000),
    },
  ]);

  // Séquence atomique alignée sur les commandes déjà insérées : la prochaine
  // commande créée par l'application prendra ALG-<année>-0003, sans collision.
  // Le compteur de commandes est indexé par une clé textuelle (`order:<année>`),
  // pas par un `ObjectId` — un type explicite est nécessaire ici seulement.
  const counters = db.collection<{ _id: string; seq: number }>('counters');
  await counters.deleteMany({});
  await counters.insertOne({ _id: `order:${year}`, seq: 2 });

  return { delivered: deliveredId, inTransit: inTransitId };
}

async function seedReviews(
  db: Db,
  client1Id: ObjectId,
  shop1Id: ObjectId,
  courierId: ObjectId,
  deliveredOrderId: ObjectId,
  rizId: ObjectId,
): Promise<void> {
  const now = new Date();
  await db.collection('reviews').deleteMany({});
  await db.collection('reviews').insertMany([
    {
      _id: new ObjectId(),
      userId: client1Id,
      orderId: deliveredOrderId,
      targetType: 'product',
      targetId: rizId,
      rating: 5,
      comment: 'Riz de très bonne qualité, comme toujours.',
      photos: [],
      verified: true,
      reported: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: new ObjectId(),
      userId: client1Id,
      orderId: deliveredOrderId,
      targetType: 'shop',
      targetId: shop1Id,
      rating: 4,
      comment: 'Livraison rapide, boutique sérieuse.',
      photos: [],
      verified: true,
      reported: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: new ObjectId(),
      userId: client1Id,
      orderId: deliveredOrderId,
      targetType: 'courier',
      targetId: courierId,
      rating: 5,
      comment: 'Livreur ponctuel et courtois.',
      photos: [],
      verified: true,
      reported: false,
      createdAt: now,
      updatedAt: now,
    },
  ]);
}

async function seedDispute(db: Db, client1Id: ObjectId, deliveredOrderId: ObjectId): Promise<void> {
  await db.collection('disputes').deleteMany({});
  await db.collection('disputes').insertOne({
    _id: new ObjectId(),
    orderId: deliveredOrderId,
    raisedBy: client1Id,
    reason: "L'huile végétale reçue avait un bouchon endommagé et une partie du contenu avait fui.",
    status: 'open',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function seedSocial(
  db: Db,
  owner1Id: ObjectId,
  owner2Id: ObjectId,
  shop1Id: ObjectId,
  shop2Id: ObjectId,
  chemiseId: ObjectId,
  flashPromoId: ObjectId,
): Promise<void> {
  const now = new Date();

  // `authorId` reste TOUJOURS l'utilisateur qui a publié (§ `SocialService.
  // create` — `resolveShopAuthor`) : une boutique ne « poste » jamais
  // elle-même, c'est son propriétaire ou son community manager qui publie
  // en son nom. Seul `author.type`/`author.shopId` porte l'attribution
  // affichée.
  await db.collection('posts').deleteMany({});
  await db.collection('posts').insertMany([
    {
      _id: new ObjectId(),
      authorId: owner1Id,
      author: { name: 'Épicerie Mahavoky', type: 'shop', shopId: shop1Id },
      kind: 'post',
      content: 'Réassort frais ce matin : riz, huile et sucre disponibles en quantité. Livraison dans tout Mahajanga.',
      media: [
        {
          url: 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1200&q=80',
          thumbUrl: 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1200&q=80',
          type: 'image',
          isMain: true,
          order: 0,
        },
      ],
      visibility: 'public',
      counters: { reactions: 6, comments: 2, shares: 1, views: 40 },
      hashtags: ['epicerie', 'mahajanga'],
      reported: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: new ObjectId(),
      authorId: owner2Id,
      author: { name: 'Sahaza Mode', type: 'shop', shopId: shop2Id },
      kind: 'post',
      content: 'Vente flash sur nos chemises en coton — 20 % pendant 48 h seulement !',
      media: [],
      productId: chemiseId,
      promotionId: flashPromoId,
      shopId: shop2Id,
      visibility: 'public',
      counters: { reactions: 3, comments: 0, shares: 0, views: 21 },
      hashtags: ['mode', 'promo'],
      reported: false,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await db.collection('stories').deleteMany({});
  await db.collection('stories').insertOne({
    _id: new ObjectId(),
    authorId: owner2Id,
    author: { name: 'Sahaza Mode' },
    media: {
      url: 'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=1200&q=80',
      type: 'image',
    },
    productId: chemiseId,
    promotionId: flashPromoId,
    viewCount: 0,
    viewers: [],
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    createdAt: now,
  });
}

async function seedMessaging(db: Db, client1Id: ObjectId, owner1Id: ObjectId, shop1Id: ObjectId): Promise<void> {
  const now = new Date();
  const conversationId = new ObjectId();

  await db.collection('conversations').deleteMany({});
  await db.collection('conversations').insertOne({
    _id: conversationId,
    participants: [
      { userId: client1Id, name: 'Soa Randria' },
      { userId: owner1Id, name: 'Épicerie Mahavoky', shopId: shop1Id },
    ],
    lastMessage: {
      content: 'Merci, votre commande part dans 10 minutes.',
      senderId: owner1Id,
      sentAt: now,
    },
    unread: { [client1Id.toHexString()]: 1, [owner1Id.toHexString()]: 0 },
    blockedBy: [],
    reported: false,
    createdAt: new Date(now.getTime() - 60 * 60 * 1000),
    updatedAt: now,
  });

  await db.collection('messages').deleteMany({});
  await db.collection('messages').insertMany([
    {
      _id: new ObjectId(),
      conversationId,
      senderId: client1Id,
      content: 'Bonjour, mon riz sera-t-il livré aujourd’hui ?',
      attachments: [],
      readBy: [client1Id, owner1Id],
      createdAt: new Date(now.getTime() - 30 * 60 * 1000),
    },
    {
      _id: new ObjectId(),
      conversationId,
      senderId: owner1Id,
      content: 'Bonjour Soa, oui tout à fait !',
      attachments: [],
      readBy: [owner1Id],
      createdAt: new Date(now.getTime() - 20 * 60 * 1000),
    },
    {
      _id: new ObjectId(),
      conversationId,
      senderId: owner1Id,
      content: 'Merci, votre commande part dans 10 minutes.',
      attachments: [],
      readBy: [owner1Id],
      createdAt: now,
    },
  ]);
}

async function seedFavoritesAndFollows(
  db: Db,
  client1Id: ObjectId,
  shop2Id: ObjectId,
  huileId: ObjectId,
): Promise<void> {
  await db.collection('favorites').deleteMany({});
  await db.collection('favorites').insertOne({
    _id: new ObjectId(),
    userId: client1Id,
    targetType: 'product',
    targetId: huileId,
    createdAt: new Date(),
  });

  await db.collection('follows').deleteMany({});
  await db.collection('follows').insertOne({
    _id: new ObjectId(),
    followerId: client1Id,
    targetType: 'shop',
    targetId: shop2Id,
    createdAt: new Date(),
  });
}

async function seedCourierEarnings(db: Db, courierId: ObjectId, adminId: ObjectId): Promise<void> {
  const now = new Date();

  await db.collection('courier_bonuses').deleteMany({});
  await db.collection('courier_bonuses').insertOne({
    _id: new ObjectId(),
    courierId,
    amount: 5000,
    reason: 'Ponctualité sur les livraisons de la semaine.',
    grantedBy: adminId,
    createdAt: now,
    updatedAt: now,
  });

  await db.collection('courier_withdrawals').deleteMany({});
  await db.collection('courier_withdrawals').insertOne({
    _id: new ObjectId(),
    courierId,
    amount: 10000,
    method: 'mvola',
    account: '+261340000004',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  });
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
    const shop1Id = new ObjectId();
    const shop2Id = new ObjectId();

    const categories = await seedCategories(db);
    const users = await seedUsers(db, shop1Id, shop2Id);
    await seedShops(db, shop1Id, shop2Id, users.owner1, users.owner2, users.courier, categories);
    const products = await seedProducts(db, shop1Id, shop2Id, categories);
    await seedCoupon(db);
    const flashPromoId = await seedPromotions(db, shop1Id, shop2Id, products.chemise);
    const orders = await seedOrders(db, shop1Id, shop2Id, users.client1, users.courier, products);
    await seedReviews(db, users.client1, shop1Id, users.courier, orders.delivered, products.riz);
    await seedDispute(db, users.client1, orders.delivered);
    await seedSocial(db, users.owner1, users.owner2, shop1Id, shop2Id, products.chemise, flashPromoId);
    await seedMessaging(db, users.client1, users.owner1, shop1Id);
    await seedFavoritesAndFollows(db, users.client1, shop2Id, products.huile);
    await seedCourierEarnings(db, users.courier, users.admin);

    await db.collection('carts').deleteMany({});

    process.stdout.write(
      [
        '',
        'Jeu de données de développement en place.',
        '  4 catégories · 6 utilisateurs · 2 boutiques · 7 produits',
        '  1 coupon · 2 promotions (dont 1 flash) · 2 commandes (1 livrée, 1 en livraison)',
        '  3 avis · 1 litige · 2 publications · 1 story · 1 conversation (3 messages)',
        '  1 favori · 1 abonnement · 1 bonus livreur · 1 retrait livreur',
        '',
        `  Client         : +261340000002 / ${PASSWORD}  (Soa Randria)`,
        `  Client 2       : +261340000006 / ${PASSWORD}  (Fara Ravelo)`,
        `  Commerçant 1   : +261340000001 / ${PASSWORD}  (Hery Rakoto — Épicerie Mahavoky)`,
        `  Commerçant 2   : +261340000003 / ${PASSWORD}  (Lala Andriamampianina — Sahaza Mode)`,
        `  Livreur        : +261340000004 / ${PASSWORD}  (Tovo Rabe)`,
        `  Administrateur : +261340000005 / ${PASSWORD}  (Admin AllGo)`,
        '',
        `  Boutique 1 : ${shop1Id.toHexString()} (epicerie-mahavoky)`,
        `  Boutique 2 : ${shop2Id.toHexString()} (sahaza-mode)`,
        `  Code promo générique : BIENVENUE10 (10 %, min. 5000 Ar)`,
        `  Code promo boutique  : MAHAVOKY5 (2000 Ar, Épicerie Mahavoky)`,
        `  Commande livrée      : ${orders.delivered.toHexString()} (ALG-${new Date().getUTCFullYear()}-0001)`,
        `  Commande en livraison: ${orders.inTransit.toHexString()} (ALG-${new Date().getUTCFullYear()}-0002)`,
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
