import mongoose, { Connection, Types } from 'mongoose';

import { AppError } from '../../common/http/app-error';
import { CommentSchema, Comment as CommentModel } from '../social/schemas/interactions.schema';
import { Post as PostModel, PostSchema } from '../social/schemas/post.schema';
import { Product as ProductModel, ProductSchema } from '../catalog/schemas/product.schema';
import { Shop as ShopModel, ShopSchema } from '../shops/schemas/shop.schema';
import { User as UserModel, UserSchema } from '../users/schemas/user.schema';
import { BannedWord as BannedWordModel, BannedWordSchema } from './schemas/banned-word.schema';
import { Report as ReportModel, ReportSchema } from './schemas/report.schema';
import { Sanction as SanctionModel, SanctionSchema } from './schemas/sanction.schema';
import { UserBlock as UserBlockModel, UserBlockSchema } from './schemas/user-block.schema';
import { ModerationService } from './moderation.service';

/**
 * **Test d'intégration** — exige MongoDB en service (§12.1, même motif que
 * `routes-guard.integration-spec.ts`). Lancer `docker compose up -d` au
 * préalable ; `npm run test:integration`, pas `npm test`.
 *
 * Base dédiée (`allgo_test_moderation`, jamais `allgo`) sur le même serveur :
 * la logique de ce service — file de signalements, seuil de masquage
 * automatique, dispatch de suppression par type de cible — tient tout entière
 * dans ses requêtes MongoDB. La simuler avec des modèles factices aurait fini
 * par retester les mocks, pas le service.
 */
describe('ModerationService (intégration Mongo)', () => {
  let connection: Connection;
  let service: ModerationService;

  let reports: mongoose.Model<any>;
  let sanctions: mongoose.Model<any>;
  let blocks: mongoose.Model<any>;
  let bannedWords: mongoose.Model<any>;
  let posts: mongoose.Model<any>;
  let comments: mongoose.Model<any>;
  let products: mongoose.Model<any>;
  let shops: mongoose.Model<any>;
  let users: mongoose.Model<any>;

  beforeAll(async () => {
    const base = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/allgo?replicaSet=rs0&directConnection=true';
    const testUri = base.replace(/\/[^/?]+(\?|$)/, '/allgo_test_moderation$1');
    connection = mongoose.createConnection(testUri);
    await connection.asPromise();

    reports = connection.model(ReportModel.name, ReportSchema);
    sanctions = connection.model(SanctionModel.name, SanctionSchema);
    blocks = connection.model(UserBlockModel.name, UserBlockSchema);
    bannedWords = connection.model(BannedWordModel.name, BannedWordSchema);
    posts = connection.model(PostModel.name, PostSchema);
    comments = connection.model(CommentModel.name, CommentSchema);
    products = connection.model(ProductModel.name, ProductSchema);
    shops = connection.model(ShopModel.name, ShopSchema);
    users = connection.model(UserModel.name, UserSchema);

    service = new ModerationService(
      reports as any,
      sanctions as any,
      blocks as any,
      bannedWords as any,
      posts as any,
      comments as any,
      products as any,
      shops as any,
      users as any,
    );
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await connection.close();
  });

  afterEach(async () => {
    await Promise.all(
      [reports, sanctions, blocks, bannedWords, posts, comments, products, shops, users].map((model) =>
        model.collection.deleteMany({}),
      ),
    );
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
      const targetId = oid();
      await service.fileReport({ reporterId: oid(), targetType: 'shop', targetId, reason: 'a' });
      await service.fileReport({ reporterId: oid(), targetType: 'shop', targetId, reason: 'b' });
      await expect(reports.countDocuments({ targetId: new Types.ObjectId(targetId) })).resolves.toBe(2);
    });

    it('accepte un signalement système sans signalant (`reporterId: null`)', async () => {
      const targetId = oid();
      await service.fileReport({ reporterId: null, targetType: 'post', targetId, automatic: true });
      const [stored] = await reports.find({}).lean();
      expect(stored.reporterId).toBeNull();
      expect(stored.automatic).toBe(true);
      expect(stored.reasonCode).toBe('automatic_filter');
    });

    it('masque automatiquement une publication dès son 3ᵉ signalement en attente', async () => {
      const postId = await seed(posts, { reported: false, counters: { comments: 0 } });
      await service.fileReport({ reporterId: oid(), targetType: 'post', targetId: postId, reason: '1' });
      await service.fileReport({ reporterId: oid(), targetType: 'post', targetId: postId, reason: '2' });
      await expect(posts.findById(postId).lean()).resolves.toMatchObject({ reported: false });

      await service.fileReport({ reporterId: oid(), targetType: 'post', targetId: postId, reason: '3' });
      await expect(posts.findById(postId).lean()).resolves.toMatchObject({ reported: true });
    });

    it('masque un produit après le seuil, via `isHidden`/`isReported` plutôt que `reported`', async () => {
      const productId = await seed(products, { isHidden: false, isReported: false });
      for (let i = 0; i < 3; i += 1) {
        await service.fileReport({ reporterId: oid(), targetType: 'product', targetId: productId, reason: String(i) });
      }
      await expect(products.findById(productId).lean()).resolves.toMatchObject({
        isHidden: true,
        isReported: true,
      });
    });

    it("n'applique aucun masquage automatique à un compte ou une boutique — seuls le contenu peut être masqué, pas un compte", async () => {
      const userId = await seed(users, { status: 'active' });
      for (let i = 0; i < 5; i += 1) {
        await service.fileReport({ reporterId: oid(), targetType: 'user', targetId: userId, reason: String(i) });
      }
      await expect(users.findById(userId).lean()).resolves.toMatchObject({ status: 'active' });
    });
  });

  describe('resolveReport', () => {
    it('classer sans suite ne change ni le contenu ni le compte visé', async () => {
      const postId = await seed(posts, { reported: false, counters: { comments: 0 } });
      const report = await reports.create({ reporterId: oid(), targetType: 'post', targetId: postId, reason: 'x' });

      const resolved = await service.resolveReport(String(report._id), oid(), { status: 'dismissed' });
      expect(resolved.status).toBe('dismissed');
      expect(resolved.action).toBe('none');
      await expect(posts.findById(postId).lean()).resolves.toMatchObject({ reported: false });
    });

    it('action « content_removed » supprime réellement la publication visée', async () => {
      const postId = await seed(posts, { reported: false, counters: { comments: 0 } });
      const report = await reports.create({ reporterId: oid(), targetType: 'post', targetId: postId, reason: 'x' });

      await service.resolveReport(String(report._id), oid(), { status: 'actioned', action: 'content_removed' });

      await expect(posts.findById(postId)).resolves.toBeNull();
    });

    it('exige `sanctionUserId` pour sanctionner un compte — un signalement porte sur un contenu, pas forcément sur son auteur', async () => {
      const report = await reports.create({ reporterId: oid(), targetType: 'user', targetId: oid(), reason: 'x' });
      await expect(
        service.resolveReport(String(report._id), oid(), { status: 'actioned', action: 'suspension' }),
      ).rejects.toThrow('Précisez le compte');
    });

    it('action « suspension » avec durée pose une sanction expirante et suspend le compte', async () => {
      const userId = await seed(users, { status: 'active' });
      const report = await reports.create({ reporterId: oid(), targetType: 'user', targetId: userId, reason: 'x' });

      await service.resolveReport(String(report._id), oid(), {
        status: 'actioned',
        action: 'suspension',
        sanctionUserId: userId,
        suspensionDays: 7,
        resolution: 'Comportement suspect confirmé',
      });

      await expect(users.findById(userId).lean()).resolves.toMatchObject({ status: 'suspended' });
      const [sanction] = await sanctions.find({ userId: new Types.ObjectId(userId) }).lean();
      expect(sanction.type).toBe('suspension');
      expect(sanction.expiresAt).toBeInstanceOf(Date);
      expect(sanction.reportId.toString()).toBe(String(report._id));
    });

    it('un avertissement (« warning ») sanctionne sans jamais suspendre le compte', async () => {
      const userId = await seed(users, { status: 'active' });
      const report = await reports.create({ reporterId: oid(), targetType: 'user', targetId: userId, reason: 'x' });

      await service.resolveReport(String(report._id), oid(), {
        status: 'actioned',
        action: 'warning',
        sanctionUserId: userId,
      });

      await expect(users.findById(userId).lean()).resolves.toMatchObject({ status: 'active' });
      await expect(sanctions.countDocuments({ userId: new Types.ObjectId(userId) })).resolves.toBe(1);
    });

    it('un signalement introuvable est un 404 explicite', async () => {
      await expect(service.resolveReport(oid(), oid(), { status: 'dismissed' })).rejects.toThrow(AppError);
    });
  });

  describe('removeContent', () => {
    it('post : suppression définitive', async () => {
      const postId = await seed(posts, { reported: false, counters: { comments: 0 } });
      await service.removeContent('post', postId);
      await expect(posts.findById(postId)).resolves.toBeNull();
    });

    it('comment : suppression et décrément du compteur de la publication parente', async () => {
      const postId = await seed(posts, { reported: false, counters: { comments: 3 } });
      const commentId = await seed(comments, { postId: new Types.ObjectId(postId), reported: false });

      await service.removeContent('comment', commentId);

      await expect(comments.findById(commentId)).resolves.toBeNull();
      await expect(posts.findById(postId).lean()).resolves.toMatchObject({ counters: { comments: 2 } });
    });

    it('product : archivé et masqué, jamais supprimé (un historique de commandes peut le référencer)', async () => {
      const productId = await seed(products, { status: 'published', isHidden: false, isReported: false });
      await service.removeContent('product', productId);
      await expect(products.findById(productId).lean()).resolves.toMatchObject({
        status: 'archived',
        isHidden: true,
        isReported: true,
      });
    });

    it('shop : suspendue, jamais supprimée', async () => {
      const shopId = await seed(shops, { status: 'approved' });
      await service.removeContent('shop', shopId);
      await expect(shops.findById(shopId).lean()).resolves.toMatchObject({ status: 'suspended' });
    });

    it('user : compte suspendu, jamais supprimé', async () => {
      const userId = await seed(users, { status: 'active' });
      await service.removeContent('user', userId);
      await expect(users.findById(userId).lean()).resolves.toMatchObject({ status: 'suspended' });
    });
  });

  describe('blocage compte-à-compte', () => {
    it('refuse qu’un compte se bloque lui-même', async () => {
      const id = oid();
      await expect(service.blockUser(id, id)).rejects.toThrow('vous-même');
    });

    it('bloquer puis débloquer retire bien le blocage', async () => {
      const a = oid();
      const b = oid();
      await service.blockUser(a, b);
      await expect(service.listBlockedUsers(a)).resolves.toHaveLength(1);

      await service.unblockUser(a, b);
      await expect(service.listBlockedUsers(a)).resolves.toHaveLength(0);
    });

    it('bloquer deux fois la même personne ne crée pas de doublon (upsert)', async () => {
      const a = oid();
      const b = oid();
      await service.blockUser(a, b);
      await service.blockUser(a, b);
      await expect(blocks.countDocuments({})).resolves.toBe(1);
    });

    it('isBlockedEitherWay est vrai quel que soit le sens du blocage', async () => {
      const a = oid();
      const b = oid();
      const c = oid();
      await service.blockUser(a, b);

      await expect(service.isBlockedEitherWay(a, b)).resolves.toBe(true);
      await expect(service.isBlockedEitherWay(b, a)).resolves.toBe(true);
      await expect(service.isBlockedEitherWay(a, c)).resolves.toBe(false);
    });

    it('blockedAuthorIds renvoie les cibles bloquées par un compte donné, pour filtrer un fil', async () => {
      const me = oid();
      const blocked1 = oid();
      const blocked2 = oid();
      await service.blockUser(me, blocked1);
      await service.blockUser(me, blocked2);

      const ids = (await service.blockedAuthorIds(me)).map(String).sort();
      expect(ids).toEqual([blocked1, blocked2].sort());
    });
  });

  describe('sanctions et liste noire', () => {
    it('sanctionsFor renvoie l’historique du plus récent au plus ancien', async () => {
      const userId = oid();
      await service.sanctionUser({ userId, type: 'warning', reason: 'a', issuedBy: oid() });
      await service.sanctionUser({ userId, type: 'suspension', reason: 'b', issuedBy: oid() });

      const history = await service.sanctionsFor(userId);
      expect(history).toHaveLength(2);
      expect(history[0].reason).toBe('b');
    });

    it('une suspension antérieure reste dans l’historique même après réactivation du compte', async () => {
      const userId = await seed(users, { status: 'suspended' });
      await service.sanctionUser({ userId, type: 'suspension', reason: 'a', issuedBy: oid() });
      await users.updateOne({ _id: new Types.ObjectId(userId) }, { $set: { status: 'active' } });

      await expect(service.sanctionsFor(userId)).resolves.toHaveLength(1);
    });

    it('blacklist ne liste que les comptes suspendus', async () => {
      await seed(users, { status: 'active', phone: '+261340000010' });
      const suspendedId = await seed(users, { status: 'suspended', phone: '+261340000011' });

      const list = await service.blacklist();
      expect(list.map((u: any) => u._id.toString())).toEqual([suspendedId]);
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
      const postId = await seed(posts, { reported: false, counters: { comments: 0 } });
      const result = await service.autoModerate('post', postId, 'Un contenu tout à fait normal');
      expect(result).toBeNull();
      await expect(posts.findById(postId).lean()).resolves.toMatchObject({ reported: false });
      await expect(reports.countDocuments({})).resolves.toBe(0);
    });

    it('autoModerate masque le contenu et dépose un signalement système au premier mot interdit', async () => {
      await service.addBannedWord('arnaque', oid());
      const postId = await seed(posts, { reported: false, counters: { comments: 0 } });

      const result = await service.autoModerate('post', postId, 'Attention, grosse arnaque à éviter');

      expect(result).toMatchObject({ reported: true });
      await expect(posts.findById(postId).lean()).resolves.toMatchObject({ reported: true });
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
