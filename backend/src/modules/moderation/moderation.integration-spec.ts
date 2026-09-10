import mongoose, { Connection, Types } from 'mongoose';

import { AppError } from '../../common/http/app-error';
import { User as UserModel, UserSchema } from '../users/schemas/user.schema';
import { BannedWord as BannedWordModel, BannedWordSchema } from './schemas/banned-word.schema';
import { Report as ReportModel, ReportSchema } from './schemas/report.schema';
import { Sanction as SanctionModel, SanctionSchema } from './schemas/sanction.schema';
import { ModerationService } from './moderation.service';

/**
 * **Test d'intégration** — exige MongoDB en service (§12.1, même motif que
 * `routes-guard.integration-spec.ts`). Lancer `docker compose up -d` au
 * préalable ; `npm run test:integration`, pas `npm test`.
 *
 * `product`/`shop` (Phase 2) et `post`/`comment`/`user_blocks` (Phase 4) ont
 * migré vers MySQL : `PrismaService` est ici un double de test (`jest.fn()`),
 * les assertions sur ces cibles portent sur l'appel Prisma plutôt que sur un
 * document Mongo relu — cohérent avec `auth.service.spec.ts`. `Report`/
 * `Sanction`/`BannedWord` restent sur Mongo (pas de table réelle
 * équivalente) : testés contre une vraie base dédiée (`allgo_test_moderation`).
 * `User` (miroir) reste aussi sur Mongo (Phase 6) : seedé ici uniquement pour
 * vérifier la résolution ObjectId miroir → entier MySQL avant suspension réelle.
 */
describe('ModerationService (Prisma en double, Mongo réel pour Report/Sanction/BannedWord)', () => {
  let connection: Connection;
  let service: ModerationService;
  let prisma: {
    posts: { update: jest.Mock; delete: jest.Mock };
    comments: { update: jest.Mock; delete: jest.Mock };
    products: { update: jest.Mock };
    shops: { update: jest.Mock };
    users: { update: jest.Mock; findMany: jest.Mock };
    user_blocks: { upsert: jest.Mock; deleteMany: jest.Mock; count: jest.Mock; findMany: jest.Mock };
  };

  /** Fausse table `user_blocks` en mémoire — assez fidèle pour couvrir la dé-duplication et les requêtes des deux sens, sans base réelle. */
  let blockRows: Array<{ blocker_id: number; blocked_id: number }>;

  let reports: mongoose.Model<any>;
  let sanctions: mongoose.Model<any>;
  let bannedWords: mongoose.Model<any>;
  let users: mongoose.Model<any>;

  beforeAll(async () => {
    const base = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/allgo?replicaSet=rs0&directConnection=true';
    const testUri = base.replace(/\/[^/?]+(\?|$)/, '/allgo_test_moderation$1');
    connection = mongoose.createConnection(testUri);
    await connection.asPromise();

    reports = connection.model(ReportModel.name, ReportSchema);
    sanctions = connection.model(SanctionModel.name, SanctionSchema);
    bannedWords = connection.model(BannedWordModel.name, BannedWordSchema);
    users = connection.model(UserModel.name, UserSchema);
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await connection.close();
  });

  beforeEach(() => {
    blockRows = [];
    prisma = {
      posts: { update: jest.fn(), delete: jest.fn() },
      comments: { update: jest.fn(), delete: jest.fn() },
      products: { update: jest.fn() },
      shops: { update: jest.fn() },
      users: { update: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
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
    service = new ModerationService(reports as any, sanctions as any, bannedWords as any, users as any, prisma as any);
  });

  afterEach(async () => {
    await Promise.all([reports, sanctions, bannedWords, users].map((model) => model.collection.deleteMany({})));
  });

  function oid(): string {
    return new Types.ObjectId().toString();
  }

  /** Insère un document minimal directement via le pilote — la validation Mongoose n'a rien à faire ici : ce sont les requêtes du service qui sont testées, pas la forme des schémas cibles. */
  async function seed(model: mongoose.Model<any>, doc: Record<string, unknown>): Promise<string> {
    const _id = new Types.ObjectId();
    await model.collection.insertOne({ _id, ...doc });
    return _id.toString();
  }

  /** Miroir d'un utilisateur MySQL — nécessaire pour tout test résolvant `targetId`/`userId` 'user' vers un entier réel. */
  async function seedMirror(mysqlId: number): Promise<string> {
    return seed(users, { mysqlId, status: 'active' });
  }

  describe('fileReport', () => {
    it('crée un signalement et refuse un doublon en attente du même signalant', async () => {
      const reporterId = oid();
      const targetId = oid();

      await service.fileReport({ reporterId, targetType: 'user', targetId, reason: 'Comportement suspect' });
      const stored = await reports.find({}).lean();
      expect(stored).toHaveLength(1);
      expect(stored[0].status).toBe('pending');
      expect(stored[0].reporterId.toString()).toBe(reporterId);

      await expect(
        service.fileReport({ reporterId, targetType: 'user', targetId, reason: 'Encore' }),
      ).rejects.toThrow('déjà signalé');
    });

    it('accepte des signalements du même contenu par des signalants distincts', async () => {
      // `shop` : entier MySQL depuis la migration (Phase 2).
      const targetId = '42';
      await service.fileReport({ reporterId: oid(), targetType: 'shop', targetId, reason: 'a' });
      await service.fileReport({ reporterId: oid(), targetType: 'shop', targetId, reason: 'b' });
      await expect(reports.countDocuments({ targetId: 42 })).resolves.toBe(2);
    });

    it('accepte un signalement système sans signalant (`reporterId: null`)', async () => {
      const targetId = '7';
      await service.fileReport({ reporterId: null, targetType: 'post', targetId, automatic: true });
      const [stored] = await reports.find({}).lean();
      expect(stored.reporterId).toBeNull();
      expect(stored.automatic).toBe(true);
      expect(stored.reasonCode).toBe('automatic_filter');
    });

    it('masque automatiquement une publication dès son 3ᵉ signalement en attente', async () => {
      const postId = '11';
      await service.fileReport({ reporterId: oid(), targetType: 'post', targetId: postId, reason: '1' });
      await service.fileReport({ reporterId: oid(), targetType: 'post', targetId: postId, reason: '2' });
      expect(prisma.posts.update).not.toHaveBeenCalled();

      await service.fileReport({ reporterId: oid(), targetType: 'post', targetId: postId, reason: '3' });
      expect(prisma.posts.update).toHaveBeenCalledWith({
        where: { id: 11 },
        data: { reported: true, report_reason: expect.stringContaining('3 signalements') },
      });
    });

    it('masque un produit après le seuil, via Prisma (`is_hidden`) plutôt que `reported`', async () => {
      const productId = '7';
      for (let i = 0; i < 3; i += 1) {
        await service.fileReport({ reporterId: oid(), targetType: 'product', targetId: productId, reason: String(i) });
      }
      expect(prisma.products.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { is_hidden: true } });
    });

    it("n'applique aucun masquage automatique à un compte ou une boutique — seuls le contenu peut être masqué, pas un compte", async () => {
      const userId = oid();
      for (let i = 0; i < 5; i += 1) {
        await service.fileReport({ reporterId: oid(), targetType: 'user', targetId: userId, reason: String(i) });
      }
      expect(prisma.users.update).not.toHaveBeenCalled();
    });
  });

  describe('resolveReport', () => {
    it('classer sans suite ne change ni le contenu ni le compte visé', async () => {
      const report = await reports.create({ reporterId: oid(), targetType: 'post', targetId: 11, reason: 'x' });

      const resolved = await service.resolveReport(String(report._id), oid(), { status: 'dismissed' });
      expect(resolved.status).toBe('dismissed');
      expect(resolved.action).toBe('none');
      expect(prisma.posts.delete).not.toHaveBeenCalled();
    });

    it('action « content_removed » supprime réellement la publication visée', async () => {
      const report = await reports.create({ reporterId: oid(), targetType: 'post', targetId: 11, reason: 'x' });
      await service.resolveReport(String(report._id), oid(), { status: 'actioned', action: 'content_removed' });
      expect(prisma.posts.delete).toHaveBeenCalledWith({ where: { id: 11 } });
    });

    it('exige `sanctionUserId` pour sanctionner un compte — un signalement porte sur un contenu, pas forcément sur son auteur', async () => {
      const report = await reports.create({ reporterId: oid(), targetType: 'user', targetId: oid(), reason: 'x' });
      await expect(
        service.resolveReport(String(report._id), oid(), { status: 'actioned', action: 'suspension' }),
      ).rejects.toThrow('Précisez le compte');
    });

    it('action « suspension » avec durée pose une sanction expirante et suspend le compte réel (résolu depuis le miroir)', async () => {
      const mirrorId = await seedMirror(501);
      const report = await reports.create({ reporterId: oid(), targetType: 'user', targetId: mirrorId, reason: 'x' });

      await service.resolveReport(String(report._id), oid(), {
        status: 'actioned',
        action: 'suspension',
        sanctionUserId: mirrorId,
        suspensionDays: 7,
        resolution: 'Comportement suspect confirmé',
      });

      expect(prisma.users.update).toHaveBeenCalledWith({ where: { id: 501 }, data: { status: 'suspended' } });
      const [sanction] = await sanctions.find({ userId: new Types.ObjectId(mirrorId) }).lean();
      expect(sanction.type).toBe('suspension');
      expect(sanction.expiresAt).toBeInstanceOf(Date);
      expect(sanction.reportId.toString()).toBe(String(report._id));
    });

    it('un avertissement (« warning ») sanctionne sans jamais suspendre le compte', async () => {
      const mirrorId = await seedMirror(502);
      const report = await reports.create({ reporterId: oid(), targetType: 'user', targetId: mirrorId, reason: 'x' });

      await service.resolveReport(String(report._id), oid(), {
        status: 'actioned',
        action: 'warning',
        sanctionUserId: mirrorId,
      });

      expect(prisma.users.update).not.toHaveBeenCalled();
      await expect(sanctions.countDocuments({ userId: new Types.ObjectId(mirrorId) })).resolves.toBe(1);
    });

    it('un signalement introuvable est un 404 explicite', async () => {
      await expect(service.resolveReport(oid(), oid(), { status: 'dismissed' })).rejects.toThrow(AppError);
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

    it('product : archivé et masqué, jamais supprimé (un historique de commandes peut le référencer)', async () => {
      await service.removeContent('product', '7');
      expect(prisma.products.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { status: 'archived', is_hidden: true },
      });
    });

    it('shop : suspendue, jamais supprimée', async () => {
      await service.removeContent('shop', '42');
      expect(prisma.shops.update).toHaveBeenCalledWith({ where: { id: 42 }, data: { status: 'suspended' } });
    });

    it('user : compte réel suspendu (résolu depuis le miroir), jamais supprimé', async () => {
      const mirrorId = await seedMirror(503);
      await service.removeContent('user', mirrorId);
      expect(prisma.users.update).toHaveBeenCalledWith({ where: { id: 503 }, data: { status: 'suspended' } });
    });

    it('user : miroir introuvable — ne tente aucune écriture', async () => {
      await service.removeContent('user', oid());
      expect(prisma.users.update).not.toHaveBeenCalled();
    });
  });

  describe('blocage compte-à-compte (table réelle `user_blocks`, Prisma en double)', () => {
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

    it('blockedAuthorIds renvoie les cibles bloquées par un compte donné, pour filtrer un fil', async () => {
      await service.blockUser(1, 2);
      await service.blockUser(1, 3);
      const ids = (await service.blockedAuthorIds(1)).sort();
      expect(ids).toEqual([2, 3]);
    });
  });

  describe('sanctions et liste noire', () => {
    it('sanctionsFor renvoie l’historique du plus récent au plus ancien', async () => {
      const mirrorId = await seedMirror(504);
      await service.sanctionUser({ userId: mirrorId, type: 'warning', reason: 'a', issuedBy: oid() });
      await service.sanctionUser({ userId: mirrorId, type: 'suspension', reason: 'b', issuedBy: oid() });

      const history = await service.sanctionsFor(mirrorId);
      expect(history).toHaveLength(2);
      expect(history[0].reason).toBe('b');
    });

    it('une suspension antérieure reste dans l’historique même après réactivation du compte', async () => {
      const mirrorId = await seedMirror(505);
      await service.sanctionUser({ userId: mirrorId, type: 'suspension', reason: 'a', issuedBy: oid() });
      await users.updateOne({ _id: new Types.ObjectId(mirrorId) }, { $set: { status: 'active' } });

      await expect(service.sanctionsFor(mirrorId)).resolves.toHaveLength(1);
    });

    it('blacklist liste les comptes réellement suspendus (MySQL, via Prisma)', async () => {
      prisma.users.findMany.mockResolvedValue([
        { id: 9, phone: '+261340000011', email: 'a@a.mg', firstname: 'A', lastname: 'B', status: 'suspended', created_at: new Date() },
      ]);

      const list = await service.blacklist();
      expect(prisma.users.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'suspended' } }));
      expect(list).toHaveLength(1);
    });
  });

  describe('modération automatique (mots interdits)', () => {
    it('addBannedWord normalise la casse et ignore les doublons', async () => {
      await service.addBannedWord('Arnaque', oid());
      await service.addBannedWord('ARNAQUE', oid());
      await expect(bannedWords.countDocuments({})).resolves.toBe(1);
      const [word] = await service.listBannedWords();
      expect(word.word).toBe('arnaque');
    });

    it('findBannedWord détecte une sous-chaîne, insensible à la casse', async () => {
      await service.addBannedWord('arnaque', oid());
      await expect(service.findBannedWord('Ceci est une ARNAQUE évidente')).resolves.toBe('arnaque');
      await expect(service.findBannedWord('Contenu tout à fait normal')).resolves.toBeNull();
      await expect(service.findBannedWord(undefined)).resolves.toBeNull();
    });

    it("autoModerate ne fait rien quand le contenu est propre", async () => {
      const result = await service.autoModerate('post', '11', 'Un contenu tout à fait normal');
      expect(result).toBeNull();
      expect(prisma.posts.update).not.toHaveBeenCalled();
      await expect(reports.countDocuments({})).resolves.toBe(0);
    });

    it('autoModerate masque le contenu et dépose un signalement système au premier mot interdit', async () => {
      await service.addBannedWord('arnaque', oid());

      const result = await service.autoModerate('post', '11', 'Attention, grosse arnaque à éviter');

      expect(result).toMatchObject({ reported: true });
      expect(prisma.posts.update).toHaveBeenCalledWith({
        where: { id: 11 },
        data: expect.objectContaining({ reported: true }),
      });
      const [report] = await reports.find({}).lean();
      expect(report.automatic).toBe(true);
      expect(report.reporterId).toBeNull();
      expect(report.targetType).toBe('post');
    });

    it('removeBannedWord retire un mot de la liste', async () => {
      await service.addBannedWord('arnaque', oid());
      const [word] = await service.listBannedWords();
      await service.removeBannedWord(String(word._id));
      await expect(service.listBannedWords()).resolves.toHaveLength(0);
    });
  });
});
