import { AppError } from '../http/app-error';

/**
 * Pagination par curseur — §7.1.
 *
 * Le décalage numérique (`OFFSET`) est proscrit : il dérive dès qu'un élément
 * est inséré pendant la pagination. Sur un fil d'actualité alimenté en continu,
 * l'utilisateur voit alors des doublons ou saute des publications.
 *
 * Le curseur encode la position exacte du dernier élément rendu : la valeur du
 * champ de tri et l'`_id`, ce dernier départageant les égalités.
 */
export interface CursorPayload {
  /** Valeur du champ de tri sur le dernier élément rendu (date ISO, nombre, chaîne). */
  value: string | number;
  /** `_id` du dernier élément — départage les valeurs de tri identiques. */
  id: string;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed.id !== 'string' || parsed.value === undefined) {
      throw new Error('forme invalide');
    }
    return parsed as CursorPayload;
  } catch {
    throw new AppError('INVALID_CURSOR', 'La page demandée est invalide. Rechargez la liste.');
  }
}

/**
 * Construit le filtre MongoDB de reprise après curseur.
 *
 * Tri décroissant : `(champ < valeur) OU (champ = valeur ET _id < id)`.
 * Le second terme est indispensable — sans lui, deux documents partageant la
 * même date de création font perdre ou répéter des éléments.
 */
export function cursorFilter(
  field: string,
  cursor: CursorPayload,
  direction: 'asc' | 'desc' = 'desc',
): Record<string, unknown> {
  const strict = direction === 'desc' ? '$lt' : '$gt';
  return {
    $or: [
      { [field]: { [strict]: cursor.value } },
      { [field]: cursor.value, _id: { [strict]: cursor.id } },
    ],
  };
}
