/**
 * Horloge partagée « heure de Mahajanga » — décalage fixe UTC+3 (Madagascar,
 * pas de changement d'heure) : l'application ne cible qu'une seule ville,
 * déjà assumé ailleurs (repli géographique codé en dur).
 */
function nowAtShop(): { isoDay: number; hhmm: string } {
  const utcPlus3 = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const isoDay = utcPlus3.getUTCDay() === 0 ? 7 : utcPlus3.getUTCDay();
  const hhmm =
    String(utcPlus3.getUTCHours()).padStart(2, '0') +
    ':' +
    String(utcPlus3.getUTCMinutes()).padStart(2, '0');
  return { isoDay, hhmm };
}

/** Une ligne de la table `shop_opening_hours` (MySQL) — `opens_at`/`closes_at` en TIME. */
export interface OpeningHourRow {
  day_of_week: number;
  opens_at: Date;
  closes_at: Date;
}

/** MariaDB renvoie une colonne `TIME` comme une date épochée à 1970-01-01 UTC — on relit juste l'heure/minute. */
function hhmmOf(value: Date): string {
  return String(value.getUTCHours()).padStart(2, '0') + ':' + String(value.getUTCMinutes()).padStart(2, '0');
}

/**
 * « Ouvert maintenant » — pas de `closedDays` distinct côté MySQL (§ Phase 2) :
 * l'absence de toute ligne pour le jour courant signifie déjà « fermé »,
 * contrairement à Mongo où ce cas redondant était géré séparément.
 */
export function isShopOpenNow(hours: OpeningHourRow[]): boolean {
  const { isoDay, hhmm } = nowAtShop();
  return hours.some((h) => h.day_of_week === isoDay && hhmmOf(h.opens_at) <= hhmm && hhmmOf(h.closes_at) >= hhmm);
}

/** Ajoute `isOpenNow` à une boutique déjà chargée avec ses horaires. */
export function withOpenNow<T>(shop: T, hours: OpeningHourRow[]): T & { isOpenNow: boolean } {
  return { ...shop, isOpenNow: isShopOpenNow(hours) };
}
