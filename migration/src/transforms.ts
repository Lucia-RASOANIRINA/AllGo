import { Decimal128, ObjectId } from 'mongodb';

/**
 * Règles de transformation MySQL → MongoDB — §15.4.
 *
 * Chaque fonction encode un piège identifié dans le cahier des charges. Ce ne
 * sont pas des utilitaires génériques : ce sont les endroits précis où une
 * migration se trompe silencieusement.
 */

/**
 * Table de correspondance `id INT AUTO_INCREMENT` → `ObjectId`.
 *
 * Conservée pendant TOUTE la migration : les clés étrangères des domaines
 * migrés plus tard référencent encore les identifiants entiers. La perdre entre
 * deux lots rend les références irréparables.
 */
export class IdMap {
  private readonly map = new Map<string, ObjectId>();

  key(table: string, id: number | string): string {
    return `${table}#${id}`;
  }

  assign(table: string, id: number | string): ObjectId {
    const key = this.key(table, id);
    const existing = this.map.get(key);
    if (existing) return existing;

    const generated = new ObjectId();
    this.map.set(key, generated);
    return generated;
  }

  resolve(table: string, id: number | string | null): ObjectId | null {
    if (id === null || id === undefined) return null;
    return this.map.get(this.key(table, id)) ?? null;
  }

  get size(): number {
    return this.map.size;
  }

  toJSON(): Record<string, string> {
    return Object.fromEntries([...this.map].map(([k, v]) => [k, v.toHexString()]));
  }

  static fromJSON(data: Record<string, string>): IdMap {
    const instance = new IdMap();
    for (const [key, value] of Object.entries(data)) {
      instance.map.set(key, new ObjectId(value));
    }
    return instance;
  }
}

/**
 * `DECIMAL(10,2)` → `Decimal128`. **Jamais `Double`.**
 *
 * Les arrondis flottants sur des montants sont inacceptables : le contrôle
 * métier du §15.5 exige que la somme des commandes soit identique au centime
 * près. Passer par `Number` perdrait cette égalité sur quelques milliers de
 * lignes.
 */
export function toDecimal128(value: string | number | null): Decimal128 | null {
  if (value === null || value === undefined) return null;
  return Decimal128.fromString(String(value));
}

/**
 * Fuseau de Madagascar : `Indian/Antananarivo`, UTC+3, **sans heure d'été**.
 *
 * MySQL stocke des `DATETIME` sans fuseau. Les interpréter comme de l'UTC
 * décalerait toute l'historique de trois heures — une commande de 1 h du matin
 * changerait de jour.
 */
const MADAGASCAR_OFFSET_MS = 3 * 60 * 60 * 1000;

export function toUtcDate(value: Date | string | null): Date | null {
  if (!value) return null;
  const local = value instanceof Date ? value : new Date(`${value}Z`);
  return new Date(local.getTime() - MADAGASCAR_OFFSET_MS);
}

/**
 * `latitude`, `longitude` → GeoJSON `Point`.
 *
 * **Inversion de l'ordre** : GeoJSON attend `[longitude, latitude]`, l'inverse
 * de l'habitude. C'est l'erreur classique de toute migration géographique — et
 * elle est silencieuse : les index se construisent, les requêtes s'exécutent,
 * et toutes les boutiques de Mahajanga se retrouvent quelque part en Somalie.
 */
export function toGeoPoint(
  latitude: number | string | null,
  longitude: number | string | null,
): { type: 'Point'; coordinates: [number, number] } | null {
  const lat = latitude === null ? NaN : Number(latitude);
  const lng = longitude === null ? NaN : Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  // Garde-fou explicite : Madagascar est à latitude négative et longitude
  // positive. Une coordonnée hors de cette enveloppe signale presque toujours
  // une inversion en amont, dans les données source.
  return { type: 'Point', coordinates: [lng, lat] };
}

/** Enveloppe géographique de Madagascar — sert au contrôle d'intégrité. */
export function isPlausibleMadagascarPoint(point: {
  coordinates: [number, number];
}): boolean {
  const [lng, lat] = point.coordinates;
  return lat >= -26 && lat <= -11 && lng >= 42 && lng <= 51;
}

/** `ENUM` → `String`, avec repli explicite plutôt que silencieux. */
export function toEnum<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: T,
): { value: T; wasCoerced: boolean } {
  if (value !== null && (allowed as readonly string[]).includes(value)) {
    return { value: value as T, wasCoerced: false };
  }
  return { value: fallback, wasCoerced: true };
}
