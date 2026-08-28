/**
 * Filtre Mongo « ouvert maintenant » — partagé entre `ShopsService` (liste) et
 * `GeoService` (carte), sur un décalage fixe UTC+3 (Madagascar, pas de
 * changement d'heure) — l'application ne cible qu'une seule ville
 * (Mahajanga), déjà assumé ailleurs (repli géographique codé en dur).
 * Comparaison de chaînes `HH:mm` zéro-paddées : valide pour du 24 h.
 */
export function openNowFilter(): Record<string, unknown> {
  const utcPlus3 = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const isoDay = utcPlus3.getUTCDay() === 0 ? 7 : utcPlus3.getUTCDay();
  const hhmm =
    String(utcPlus3.getUTCHours()).padStart(2, '0') +
    ':' +
    String(utcPlus3.getUTCMinutes()).padStart(2, '0');

  return {
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
