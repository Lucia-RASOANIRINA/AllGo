import { AppError } from '../http/app-error';
import { cursorFilter, decodeCursor, encodeCursor } from './cursor';

describe('Pagination par curseur (§7.1)', () => {
  describe('encodage et décodage', () => {
    it('restitue la charge utile à l’identique', () => {
      const payload = { value: '2026-08-18T06:00:00.000Z', id: '6712ab0000000000000000ff' };
      expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
    });

    it('accepte une valeur de tri numérique', () => {
      const payload = { value: 19500, id: '6712ab0000000000000000ff' };
      expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
    });

    it('produit un curseur opaque, sans caractère à échapper dans une URL', () => {
      const cursor = encodeCursor({ value: 'a+b/c=d', id: 'x' });
      expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(encodeURIComponent(cursor)).toBe(cursor);
    });

    it('rejette un curseur corrompu avec un message affichable', () => {
      expect(() => decodeCursor('pas-du-base64!!')).toThrow(AppError);
      try {
        decodeCursor('pas-du-base64!!');
      } catch (error) {
        expect((error as AppError).code).toBe('INVALID_CURSOR');
        expect((error as AppError).message).not.toMatch(/JSON|base64|parse/i);
      }
    });

    it('rejette un curseur bien encodé mais de forme invalide', () => {
      const forged = Buffer.from(JSON.stringify({ autre: 1 })).toString('base64url');
      expect(() => decodeCursor(forged)).toThrow(AppError);
    });
  });

  describe('cursorFilter', () => {
    const cursor = { value: '2026-08-18T06:00:00.000Z', id: '6712ab0000000000000000ff' };

    it('départage les égalités par `_id` — sans quoi des documents seraient perdus', () => {
      // Deux commandes créées à la même milliseconde ne sont pas un cas d'école :
      // une importation en lot en produit des milliers.
      const filter = cursorFilter('createdAt', cursor) as { $or: Array<Record<string, unknown>> };

      expect(filter.$or).toHaveLength(2);
      expect(filter.$or[0]).toEqual({ createdAt: { $lt: cursor.value } });
      expect(filter.$or[1]).toEqual({ createdAt: cursor.value, _id: { $lt: cursor.id } });
    });

    it('inverse les comparateurs en tri croissant', () => {
      const filter = cursorFilter('createdAt', cursor, 'asc') as {
        $or: Array<Record<string, unknown>>;
      };

      expect(filter.$or[0]).toEqual({ createdAt: { $gt: cursor.value } });
      expect(filter.$or[1]).toEqual({ createdAt: cursor.value, _id: { $gt: cursor.id } });
    });
  });
});
