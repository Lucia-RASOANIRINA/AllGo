import { AuthService } from './auth.service';

describe('AuthService — fonctions pures', () => {
  describe('normalisePhone', () => {
    // Un utilisateur saisit son numéro de six façons différentes. Sans
    // normalisation, `phone` en index unique laisserait passer six comptes pour
    // la même personne.
    it.each([
      ['0341234567', '+261341234567'],
      ['+261341234567', '+261341234567'],
      ['261341234567', '+261341234567'],
      ['034 12 345 67', '+261341234567'],
      ['034-12-345-67', '+261341234567'],
      ['034.12.345.67', '+261341234567'],
    ])('normalise « %s » en %s', (input, expected) => {
      expect(AuthService.normalisePhone(input)).toBe(expected);
    });

    it('laisse intact un numéro déjà international non malgache', () => {
      expect(AuthService.normalisePhone('+33612345678')).toBe('+33612345678');
    });
  });

  describe('parseTtlMs', () => {
    it.each([
      ['15m', 15 * 60_000],
      ['30d', 30 * 86_400_000],
      ['12h', 12 * 3_600_000],
      ['45s', 45_000],
    ])('convertit %s', (ttl, expected) => {
      expect(AuthService.parseTtlMs(ttl)).toBe(expected);
    });

    it('échoue bruyamment sur une durée mal formée', () => {
      // Une durée invalide silencieusement repliée sur une valeur par défaut
      // produirait des jetons d'une durée que personne n'a choisie.
      expect(() => AuthService.parseTtlMs('15 minutes')).toThrow(/invalide/i);
      expect(() => AuthService.parseTtlMs('')).toThrow();
      expect(() => AuthService.parseTtlMs('15y')).toThrow();
    });
  });
});
