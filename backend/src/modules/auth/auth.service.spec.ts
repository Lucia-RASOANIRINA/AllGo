import * as bcrypt from 'bcryptjs';

import { Role } from '../../common/rbac/roles';
import { buildRoleAssignments } from '../users/mysql-role-mapper';
import { AuthService } from './auth.service';

describe('AuthService — fonctions pures', () => {
  describe('toLocalPhoneFormat', () => {
    it('convertit +261XXXXXXXXX en 0XXXXXXXXX, format des lignes existantes du web', () => {
      expect(AuthService.toLocalPhoneFormat('+261341234567')).toBe('0341234567');
    });

    it('laisse intact un numéro déjà local', () => {
      expect(AuthService.toLocalPhoneFormat('0341234567')).toBe('0341234567');
    });
  });

  describe('last9Digits', () => {
    it('extrait les 9 derniers chiffres, quel que soit le format', () => {
      expect(AuthService.last9Digits('+261341234567')).toBe('341234567');
      expect(AuthService.last9Digits('0341234567')).toBe('341234567');
    });
  });

  describe('bcryptCompare', () => {
    // Format confirmé sur les 7 lignes réelles de la base live : les hash
    // PHP/Laravel portent `$2y$`, que `bcryptjs` ne reconnaît pas tel quel.
    it('valide un hash `$2y$` réel (Laravel/PHP), pas seulement `$2a$`/`$2b$`', async () => {
      const phpStyleHash = (await bcrypt.hash('motdepasse123', 10)).replace(/^\$2[ab]\$/, '$2y$');
      expect(await AuthService.bcryptCompare('motdepasse123', phpStyleHash)).toBe(true);
      expect(await AuthService.bcryptCompare('mauvais', phpStyleHash)).toBe(false);
    });
  });
});

describe('buildRoleAssignments', () => {
  it('attribue seulement le rôle client par défaut', () => {
    expect(
      buildRoleAssignments({ roleId: 3, adminLevel: null, ownedShopIds: [], teamMembership: null }),
    ).toEqual([{ role: Role.Client }]);
  });

  it('ajoute PlatformAdmin si role_id=1 (admin)', () => {
    const roles = buildRoleAssignments({ roleId: 1, adminLevel: null, ownedShopIds: [], teamMembership: null });
    expect(roles).toContainEqual({ role: Role.PlatformAdmin });
  });

  it('ajoute PlatformAdmin si admin_level est renseigné, même avec role_id=3', () => {
    const roles = buildRoleAssignments({
      roleId: 3,
      adminLevel: 'moderator',
      ownedShopIds: [],
      teamMembership: null,
    });
    expect(roles).toContainEqual({ role: Role.PlatformAdmin });
  });

  it('ajoute ShopOwner pour chaque boutique possédée', () => {
    const roles = buildRoleAssignments({
      roleId: 2,
      adminLevel: null,
      ownedShopIds: [10, 11],
      teamMembership: null,
    });
    expect(roles).toContainEqual({ role: Role.ShopOwner, shopId: '10' });
    expect(roles).toContainEqual({ role: Role.ShopOwner, shopId: '11' });
  });

  it('mappe un membre d’équipe actif vers le rôle correspondant', () => {
    const roles = buildRoleAssignments({
      roleId: 3,
      adminLevel: null,
      ownedShopIds: [],
      teamMembership: { shopId: 5, teamRole: 'caissier', status: 'active' },
    });
    expect(roles).toContainEqual({ role: Role.ShopCashier, shopId: '5' });
  });

  it('ignore un membre d’équipe suspendu', () => {
    const roles = buildRoleAssignments({
      roleId: 3,
      adminLevel: null,
      ownedShopIds: [],
      teamMembership: { shopId: 5, teamRole: 'manager', status: 'suspended' },
    });
    expect(roles).not.toContainEqual(expect.objectContaining({ role: Role.ShopManager }));
  });
});

describe('AuthService — normalisation et durées', () => {
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
