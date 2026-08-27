/**
 * Normalisation du corps de réponse — rend le contrat d'API uniforme.
 *
 * Sans elle, la forme dépend de la façon dont la donnée a été lue :
 *
 *   - `.lean()` et les agrégations renvoient `_id`, les documents hydratés
 *     renvoient `id` via leur transformation `toJSON`. Le client devrait donc
 *     écrire `json['id'] ?? json['_id']` partout, et se tromper une fois ;
 *   - un `Decimal128` se sérialise en `{"$numberDecimal":"5200"}`, une forme
 *     que le client mobile ne sait pas lire et qui n'a aucune raison de lui
 *     être imposée.
 *
 * Le traitement se fait ici, à la frontière HTTP, plutôt que par un plugin
 * Mongoose : un plugin `toJSON` est court-circuité par `.lean()`, donc
 * précisément par les requêtes de liste les plus fréquentes.
 */

/** Objets BSON reconnaissables sans importer mongoose dans la couche HTTP. */
const BSON_AS_STRING = new Set(['ObjectId', 'Decimal128', 'Long', 'Double', 'Int32']);

export function normaliseResponse(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  // Les dates sont laissées à `JSON.stringify`, qui produit de l'ISO 8601.
  if (value instanceof Date) return value;

  if (typeof value !== 'object') return value;

  const bsonType = (value as { _bsontype?: string })._bsontype;
  if (bsonType && BSON_AS_STRING.has(bsonType)) return String(value);

  if (Array.isArray(value)) return value.map(normaliseResponse);

  // `Map` Mongoose (compteurs de non-lus, préférences de notification) :
  // `Object.entries` renverrait un objet vide.
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([key, item]) => [String(key), normaliseResponse(item)]),
    );
  }

  // Document Mongoose hydraté : on repasse par sa propre transformation, qui
  // porte les règles du schéma (masquage de `passwordHash`, par exemple).
  const withToJson = value as { toJSON?: () => unknown };
  if (typeof withToJson.toJSON === 'function') {
    const plain = withToJson.toJSON();
    if (plain !== value) return normaliseResponse(plain);
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === '__v') continue;
    output[key === '_id' ? 'id' : key] = normaliseResponse(item);
  }
  return output;
}
