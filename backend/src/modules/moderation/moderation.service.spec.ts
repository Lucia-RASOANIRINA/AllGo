import { AppError } from '../../common/http/app-error';
import { ModerationService } from './moderation.service';

/**
 * `ModerationService` ne dépend d'aucune infrastructure réelle depuis la
 * Phase 5 (`reports`/`sanctions`/`banned_words` sont des tables MySQL,
 * `PrismaService` en double) : un test unitaire ordinaire suffit, plus
 * besoin de `docker compose up` ni de `npm run test:integration`. Depuis la
 * Phase 6 (bascule d'identité), tous les identifiants sont des entiers
 * MySQL directs — plus de résolution miroir à simuler.
 */
describe('ModerationService', () => {
  let service: ModerationService;
  let prisma: any;

  /** Fausse table `user_blocks` en mémoire — assez fidèle pour couvrir la dé-duplication et les requêtes des deux sens. */
  let blockRows: Array<{ blocker_id: number; blocked_id: number }>;

  beforeEach(() => {
    blockRows = [];
    prisma = {
      reports: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      posts: { update: jest.fn(), delete: jest.fn() },
      comments: { update: jest.fn(), delete: jest.fn() },
      products: { update: jest.fn() },
      shops: { update: jest.fn() },
      users: { update: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      sanctions: {
        create: jest.fn().mockResolvedValue({ id: 1, type: 'warning', reason: 'a', report_id: null, expires_at: null, created_at: new Date() }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      banned_words: {
        upsert: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user_blocks: {
        upsert: jest.fn(({ create }: { create: { blocker_id: number; blocked_id: number } }) => {
          if (!blockRows.some((r) => r.blocker_id === create.blocker_id && r.blocked_id === create.blocked_id)) {
            blockRows.push(create);
          }
          return Promise.resolve(create);
        }),
        deleteMany: jest.fn(({ where }: { where: { blocker_id: number; blocked_id: number } }) => {
          blockRows = blockRows.filter((r) => !(r.blocker_id === where.blocker_id && r.blocked_id === where.blocked_id));
          return Promise.resolve({ count: 1 });
        }),
        count: jest.fn(({ where }: { where: { OR: Array<{ blocker_id: number; blocked_id: number }> } }) =>
          Promise.resolve(
            blockRows.filter((r) => where.OR.some((c) => c.blocker_id === r.blocker_id && c.blocked_id === r.blocked_id)).length,
          ),
        ),
        findMany: jest.fn(({ where }: { where: { blocker_id: number } }) =>
          Promise.resolve(blockRows.filter((r) => r.blocker_id === where.blocker_id).map((r) => ({ blocked_id: r.blocked_id }))),
        ),
      },
    };
    service = new ModerationService(prisma);
  });

  describe('fileReport', () => {
    it('crée un signalement et refuse un doublon en attente du même signalant', async () => {
      await service.fileReport({ reporterId: 1, targetType: 'user', targetId: '2', reason: 'Comportement suspect' });
      expect(prisma.reports.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ reporter_id: 1, reportable_type: 'user', reportable_id: 2 }),
      });

      prisma.reports.findFirst.mockResolvedValue({ id: 1 });
      await expect(
        service.fileReport({ reporterId: 1, targetType: 'user', targetId: '2', reason: 'Encore' }),
      ).rejects.toThrow('déjà signalé');
    });

    it('accepte un signalement système sans signalant (`reporterId: null`)', async () => {
      await service.fileReport({ reporterId: null, targetType: 'post', targetId: '7', automatic: true });
      expect(prisma.reports.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ reporter_id: null, automatic: true, reason_code: 'automatic_filter' }),
      });
    });

    it('masque automatiquement une publication dès le seuil de signalements en attente', async () => {
      prisma.reports.count.mockResolvedValue(3);
      await service.fileReport({ reporterId: 1, targetType: 'post', targetId: '11', reason: 'x' });
      expect(prisma.posts.update).toHaveBeenCalledWith({
        where: { id: 11 },
        data: { reported: true, report_reason: expect.stringContaining('3 signalements') },
      });
    });

    it('sous le seuil, ne masque rien', async () => {
      prisma.reports.count.mockResolvedValue(2);
      await service.fileReport({ reporterId: 1, targetType: 'post', targetId: '11', reason: 'x' });
      expect(prisma.posts.update).not.toHaveBeenCalled();
    });

    it('masque un produit après le seuil, via `is_hidden`', async () => {
      prisma.reports.count.mockResolvedValue(3);
      await service.fileReport({ reporterId: 1, targetType: 'product', targetId: '7', reason: 'x' });
      expect(prisma.products.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { is_hidden: true } });
    });

    it("n'applique aucun masquage automatique à un compte ou une boutique", async () => {
      prisma.reports.count.mockResolvedValue(5);
      await service.fileReport({ reporterId: 1, targetType: 'user', targetId: '9', reason: 'x' });
      expect(prisma.users.update).not.toHaveBeenCalled();
    });
  });

  describe('resolveReport', () => {
    it('classer sans suite ne supprime ni ne sanctionne rien', async () => {
      prisma.reports.findUnique.mockResolvedValue({ id: 1, reportable_type: 'post', reportable_id: 11, reason: 'x' });
      prisma.reports.update.mockResolvedValue({ id: 1, status: 'dismissed', action: 'none' });

      const resolved: any = await service.resolveReport('1', 99, { status: 'dismissed' });
      expect(resolved.status).toBe('dismissed');
      expect(prisma.posts.delete).not.toHaveBeenCalled();
    });

    it('action « content_removed » supprime réellement la publication visée', async () => {
      prisma.reports.findUnique.mockResolvedValue({ id: 1, reportable_type: 'post', reportable_id: 11, reason: 'x' });
      prisma.reports.update.mockResolvedValue({ id: 1, status: 'actioned', action: 'content_removed' });

      await service.resolveReport('1', 99, { status: 'actioned', action: 'content_removed' });
      expect(prisma.posts.delete).toHaveBeenCalledWith({ where: { id: 11 } });
    });

    it('exige `sanctionUserId` pour sanctionner un compte', async () => {
      prisma.reports.findUnique.mockResolvedValue({ id: 1, reportable_type: 'user', reportable_id: 2, reason: 'x' });
      await expect(
        service.resolveReport('1', 99, { status: 'actioned', action: 'suspension' }),
      ).rejects.toThrow('Précisez le compte');
    });

    it('action « suspension » avec durée pose une sanction expirante et suspend le compte réel', async () => {
      prisma.reports.findUnique.mockResolvedValue({ id: 1, reportable_type: 'user', reportable_id: 2, reason: 'x' });
      prisma.reports.update.mockResolvedValue({ id: 1, status: 'actioned', action: 'suspension' });

      await service.resolveReport('1', 99, {
        status: 'actioned',
        action: 'suspension',
        sanctionUserId: '501',
        suspensionDays: 7,
        resolution: 'Comportement suspect confirmé',
      });

      expect(prisma.sanctions.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ user_id: 501, type: 'suspension', issued_by: 99, report_id: 1 }),
      });
      expect(prisma.users.update).toHaveBeenCalledWith({ where: { id: 501 }, data: { status: 'suspended' } });
    });

    it('un avertissement ne suspend jamais le compte', async () => {
      prisma.reports.findUnique.mockResolvedValue({ id: 1, reportable_type: 'user', reportable_id: 2, reason: 'x' });
      prisma.reports.update.mockResolvedValue({ id: 1, status: 'actioned', action: 'warning' });

      await service.resolveReport('1', 99, { status: 'actioned', action: 'warning', sanctionUserId: '502' });
      expect(prisma.users.update).not.toHaveBeenCalled();
      expect(prisma.sanctions.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'warning' }) });
    });

    it('un signalement introuvable est un 404 explicite', async () => {
      prisma.reports.findUnique.mockResolvedValue(null);
      await expect(service.resolveReport('999', 99, { status: 'dismissed' })).rejects.toThrow(AppError);
    });
  });

  describe('removeContent', () => {
    it('post : suppression définitive', async () => {
      await service.removeContent('post', '11');
      expect(prisma.posts.delete).toHaveBeenCalledWith({ where: { id: 11 } });
    });

    it('comment : suppression, sans compteur dénormalisé à décrémenter', async () => {
      await service.removeContent('comment', '9');
      expect(prisma.comments.delete).toHaveBeenCalledWith({ where: { id: 9 } });
    });

    it('product : archivé et masqué, jamais supprimé', async () => {
      await service.removeContent('product', '7');
      expect(prisma.products.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { status: 'archived', is_hidden: true } });
    });

    it('shop : suspendue, jamais supprimée', async () => {
      await service.removeContent('shop', '42');
      expect(prisma.shops.update).toHaveBeenCalledWith({ where: { id: 42 }, data: { status: 'suspended' } });
    });

    it('user : compte réel suspendu, jamais supprimé', async () => {
      await service.removeContent('user', '503');
      expect(prisma.users.update).toHaveBeenCalledWith({ where: { id: 503 }, data: { status: 'suspended' } });
    });
  });

  describe('blocage compte-à-compte', () => {
    it('refuse qu’un compte se bloque lui-même', async () => {
      await expect(service.blockUser(1, 1)).rejects.toThrow('vous-même');
    });

    it('bloquer puis débloquer retire bien le blocage', async () => {
      await service.blockUser(1, 2);
      await expect(service.listBlockedUsers(1)).resolves.toHaveLength(1);
      await service.unblockUser(1, 2);
      await expect(service.listBlockedUsers(1)).resolves.toHaveLength(0);
    });

    it('bloquer deux fois la même personne ne crée pas de doublon (upsert)', async () => {
      await service.blockUser(1, 2);
      await service.blockUser(1, 2);
      expect(blockRows).toHaveLength(1);
    });

    it('isBlockedEitherWay est vrai quel que soit le sens du blocage', async () => {
      await service.blockUser(1, 2);
      await expect(service.isBlockedEitherWay(1, 2)).resolves.toBe(true);
      await expect(service.isBlockedEitherWay(2, 1)).resolves.toBe(true);
      await expect(service.isBlockedEitherWay(1, 3)).resolves.toBe(false);
    });

    it('blockedAuthorIds renvoie les cibles bloquées par un compte donné', async () => {
      await service.blockUser(1, 2);
      await service.blockUser(1, 3);
      expect((await service.blockedAuthorIds(1)).sort()).toEqual([2, 3]);
    });
  });

  describe('sanctions et liste noire', () => {
    it('sanctionUser écrit la sanction réelle', async () => {
      await service.sanctionUser({ userId: '504', type: 'warning', reason: 'a', issuedBy: 99 });
      expect(prisma.sanctions.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ user_id: 504, type: 'warning', issued_by: 99 }),
      });
    });

    it('sanctionsFor renvoie une liste vide pour un identifiant invalide', async () => {
      await expect(service.sanctionsFor('unknown')).resolves.toEqual([]);
    });

    it('blacklist interroge `prisma.users` filtré sur `suspended`', async () => {
      prisma.users.findMany.mockResolvedValue([{ id: 9, status: 'suspended' }]);
      const list = await service.blacklist();
      expect(prisma.users.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'suspended' } }));
      expect(list).toHaveLength(1);
    });
  });

  describe('modération automatique (mots interdits)', () => {
    it('findBannedWord détecte une sous-chaîne, insensible à la casse', async () => {
      prisma.banned_words.findMany.mockResolvedValue([{ word: 'arnaque' }]);
      await expect(service.findBannedWord('Ceci est une ARNAQUE évidente')).resolves.toBe('arnaque');
      await expect(service.findBannedWord('Contenu tout à fait normal')).resolves.toBeNull();
      await expect(service.findBannedWord(undefined)).resolves.toBeNull();
    });

    it("autoModerate ne fait rien quand le contenu est propre", async () => {
      prisma.banned_words.findMany.mockResolvedValue([]);
      const result = await service.autoModerate('post', '11', 'Un contenu tout à fait normal');
      expect(result).toBeNull();
      expect(prisma.posts.update).not.toHaveBeenCalled();
      expect(prisma.reports.create).not.toHaveBeenCalled();
    });

    it('autoModerate masque le contenu et dépose un signalement système au premier mot interdit', async () => {
      prisma.banned_words.findMany.mockResolvedValue([{ word: 'arnaque' }]);
      const result = await service.autoModerate('post', '11', 'Attention, grosse arnaque à éviter');

      expect(result).toMatchObject({ reported: true });
      expect(prisma.posts.update).toHaveBeenCalledWith({ where: { id: 11 }, data: expect.objectContaining({ reported: true }) });
      expect(prisma.reports.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ reporter_id: null, automatic: true, reportable_type: 'post', reportable_id: 11 }),
      });
    });

    it('addBannedWord normalise la casse (upsert sur le mot normalisé)', async () => {
      prisma.banned_words.upsert.mockResolvedValue({ id: 1, word: 'arnaque', created_at: new Date() });
      await service.addBannedWord('ARNAQUE', 1);
      expect(prisma.banned_words.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { word: 'arnaque' }, create: { word: 'arnaque', added_by: 1 } }),
      );
    });

    it('removeBannedWord retire un mot de la liste', async () => {
      await expect(service.removeBannedWord('1')).resolves.toEqual({ deleted: true });
      expect(prisma.banned_words.deleteMany).toHaveBeenCalledWith({ where: { id: 1 } });
    });
  });
});
