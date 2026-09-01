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

/**
 * Filtre Mongo « ouvert maintenant » — partagé entre `ShopsService` (liste)
 * et `GeoService` (carte). Un jour de fermeture déclaré (`closedDays`) exclut
 * la boutique même si des horaires du jour existent par erreur.
 * Comparaison de chaînes `HH:mm` zéro-paddées : valide pour du 24 h.
 */
export function openNowFilter(): Record<string, unknown> {
  const { isoDay, hhmm } = nowAtShop();

  return {
    closedDays: { $ne: isoDay },
    openingHours: { $elemMatch: { day: isoDay, open: { $lte: hhmm }, close: { $gte: hhmm } } },
  };
}

/**
 * Filtre Mongo « fermé maintenant » — strict complément de `openNowFilter()`
 * via `$nor`, plutôt qu'une reformulation indépendante : une boutique sans
 * aucun horaire déclaré tombe aussi dans « fermée », sans qu'il faille
 * décider séparément ce que « pas d'horaires » signifie.
 */
export function closedNowFilter(): Record<string, unknown> {
  return { $nor: [openNowFilter()] };
}

/**
 * Même règle que `openNowFilter()`, évaluée en mémoire sur un document déjà
 * chargé — pour annoter une fiche ou une carte d'un statut « ouvert/fermé »
 * sans reformuler une seconde requête.
 */
export function isShopOpenNow(shop: {
  openingHours?: Array<{ day: number; open: string; close: string }>;
  closedDays?: number[];
}): boolean {
  const { isoDay, hhmm } = nowAtShop();
  if (shop.closedDays?.includes(isoDay)) return false;
  return (shop.openingHours ?? []).some(
    (h) => h.day === isoDay && h.open <= hhmm && h.close >= hhmm,
  );
}

/** Ajoute `isOpenNow` à un document boutique déjà chargé (`.lean()` inclus). */
export function withOpenNow<T extends { openingHours?: Array<{ day: number; open: string; close: string }>; closedDays?: number[] }>(
  shop: T,
): T & { isOpenNow: boolean } {
  return { ...shop, isOpenNow: isShopOpenNow(shop) };
}
