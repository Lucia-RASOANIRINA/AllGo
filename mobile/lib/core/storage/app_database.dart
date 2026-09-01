import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

part 'app_database.g.dart';

/// Catalogue mis en cache, interrogeable hors ligne.
///
/// Le cache doit être **interrogeable** : filtrer par catégorie et par prix
/// sans réseau impose du SQL, ce qu'une base clé-valeur ne permet pas (§5.2).
@DataClassName('CachedProduct')
class CachedProducts extends Table {
  TextColumn get id => text()();
  TextColumn get shopId => text()();
  TextColumn get shopName => text()();
  TextColumn get shopSlug => text().withDefault(const Constant(''))();
  TextColumn get name => text()();
  TextColumn get description => text().nullable()();
  TextColumn get categoryId => text().nullable()();

  /// Prix en Ariary, en entier : l'Ariary n'a pas de subdivision en usage, et
  /// un entier évite tout arrondi flottant sur un montant.
  IntColumn get price => integer()();
  IntColumn get promoPrice => integer().nullable()();
  IntColumn get stock => integer().withDefault(const Constant(0))();

  TextColumn get thumbUrl => text().nullable()();
  TextColumn get barcode => text().nullable()();

  RealColumn get latitude => real().nullable()();
  RealColumn get longitude => real().nullable()();

  /// Horodatage d'écriture locale — pilote l'expiration (§9.2).
  DateTimeColumn get cachedAt => dateTime()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

@DataClassName('CachedShop')
class CachedShops extends Table {
  TextColumn get id => text()();
  TextColumn get slug => text()();
  TextColumn get name => text()();
  TextColumn get logo => text().nullable()();
  TextColumn get city => text().nullable()();
  RealColumn get latitude => real().nullable()();
  RealColumn get longitude => real().nullable()();
  RealColumn get rating => real().withDefault(const Constant(0))();
  DateTimeColumn get cachedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

@DataClassName('CachedCategory')
class CachedCategories extends Table {
  TextColumn get id => text()();
  TextColumn get name => text()();
  TextColumn get slug => text()();
  TextColumn get parentId => text().nullable()();
  IntColumn get depth => integer().withDefault(const Constant(0))();
  IntColumn get sortOrder => integer().withDefault(const Constant(0))();
  DateTimeColumn get cachedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

@DataClassName('CachedOrder')
class CachedOrders extends Table {
  TextColumn get id => text()();
  TextColumn get orderNumber => text()();
  TextColumn get shopName => text()();
  IntColumn get total => integer()();
  TextColumn get status => text()();
  DateTimeColumn get createdAt => dateTime()();
  IntColumn get itemCount => integer()();
  DateTimeColumn get cachedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

/// File d'actions différées — §9.3.
///
/// Toute mutation réalisée hors ligne atterrit ici avant d'être rejouée.
/// `idempotencyKey` est généré **au moment de la mise en file**, pas à
/// l'émission : c'est ce qui garantit qu'une reprise ne crée jamais de doublon.
@DataClassName('PendingActionRow')
class PendingActions extends Table {
  TextColumn get id => text()();
  TextColumn get type => text()();
  TextColumn get payload => text()(); // JSON sérialisé
  TextColumn get idempotencyKey => text()();
  TextColumn get status => text().withDefault(const Constant('pending'))();
  IntColumn get retryCount => integer().withDefault(const Constant(0))();
  TextColumn get lastError => text().nullable()();
  DateTimeColumn get createdAt => dateTime()();
  DateTimeColumn get nextAttemptAt => dateTime().nullable()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

@DriftDatabase(
  tables: [CachedProducts, CachedShops, CachedCategories, CachedOrders, PendingActions],
)
class AppDatabase extends _$AppDatabase {
  AppDatabase() : super(_open());

  /// Version du schéma local. Toute modification de table exige une migration
  /// versionnée : une mise à jour de l'application ne doit jamais effacer un
  /// panier ni une action en file d'attente.
  @override
  int get schemaVersion => 3;

  @override
  MigrationStrategy get migration => MigrationStrategy(
        onCreate: (m) => m.createAll(),
        onUpgrade: (m, from, to) async {
          // v2 : `shopSlug` sur les produits en cache, pour ouvrir la fiche
          // boutique hors ligne sans requête supplémentaire. La colonne a une
          // valeur par défaut : les lignes déjà en cache restent lisibles, elles
          // se compléteront à la prochaine synchronisation.
          if (from < 2) await m.addColumn(cachedProducts, cachedProducts.shopSlug);
          if (from < 3) await m.createTable(cachedOrders);
        },
        beforeOpen: (details) async {
          await customStatement('PRAGMA foreign_keys = ON');
        },
      );

  /// Recherche locale sur le catalogue en cache.
  ///
  /// Cible : moins de 200 ms sur 5 000 produits en cache (§16.3). C'est ce que
  /// permet SQL, et qui serait hors de portée d'un filtrage en mémoire Dart.
  Future<List<CachedProduct>> searchProducts({
    String? query,
    String? categoryId,
    int? minPrice,
    int? maxPrice,
    bool inStockOnly = false,
    int limit = 50,
  }) {
    final statement = select(cachedProducts)
      ..where((t) {
        Expression<bool> predicate = const Constant(true);
        if (query != null && query.isNotEmpty) {
          predicate = predicate & t.name.like('%$query%');
        }
        if (categoryId != null) predicate = predicate & t.categoryId.equals(categoryId);
        if (minPrice != null) predicate = predicate & t.price.isBiggerOrEqualValue(minPrice);
        if (maxPrice != null) predicate = predicate & t.price.isSmallerOrEqualValue(maxPrice);
        if (inStockOnly) predicate = predicate & t.stock.isBiggerThanValue(0);
        return predicate;
      })
      ..orderBy([(t) => OrderingTerm.desc(t.updatedAt)])
      ..limit(limit);

    return statement.get();
  }

  /// Purge des entrées périmées, selon la politique de rétention du §9.2.
  Future<void> evictExpired() async {
    final productCutoff = DateTime.now().subtract(const Duration(days: 30));
    final shopCutoff = DateTime.now().subtract(const Duration(days: 7));

    await (delete(cachedProducts)..where((t) => t.cachedAt.isSmallerThanValue(productCutoff))).go();
    await (delete(cachedShops)..where((t) => t.cachedAt.isSmallerThanValue(shopCutoff))).go();
  }

  Future<List<CachedOrder>> loadOrders() => (select(cachedOrders)
        ..orderBy([(t) => OrderingTerm.desc(t.createdAt)]))
      .get();

  Future<void> replaceOrders(List<CachedOrdersCompanion> orders) async {
    await transaction(() async {
      await delete(cachedOrders).go();
      await batch((batch) => batch.insertAll(cachedOrders, orders));
    });
  }
}

/// Ouvre la base dans le répertoire de documents de l'application.
///
// TODO(L0): brancher SQLCipher avec la clé de `TokenStore.readDatabaseKey`
// (`PRAGMA key`) — le chiffrement local est exigé au §12.2.
LazyDatabase _open() {
  return LazyDatabase(() async {
    final directory = await getApplicationDocumentsDirectory();
    return NativeDatabase.createInBackground(
      File(p.join(directory.path, 'allgo.sqlite')),
    );
  });
}
