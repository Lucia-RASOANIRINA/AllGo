import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as argon2 from 'argon2';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Model, Types } from 'mongoose';
import type Redis from 'ioredis';
import type { users as MysqlUser } from '@prisma/client';

import { REDIS_CLIENT } from '../../infrastructure/redis/redis.constants';
import { AppError } from '../../common/http/app-error';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { buildRoleAssignments } from '../users/mysql-role-mapper';
import { User, type UserDocument } from '../users/schemas/user.schema';
import { EmailService } from './email.service';
import { SmsService } from './sms.service';
import type { LoginDto, RegisterDto } from './dto/auth.dto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Paramètres Argon2id — utilisés UNIQUEMENT pour le hash placebo du miroir
 * Mongo (§ ci-dessous, `mirrorUser`) : ce hash n'est jamais vérifié, l'unique
 * source de vérité pour l'authentification est désormais `users.password`
 * (MySQL, bcrypt — écrit par le site web comme par l'inscription mobile).
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const OTP_TTL_SECONDS = 5 * 60;
const OTP_MAX_ATTEMPTS = 3;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(User.name) private readonly mirror: Model<UserDocument>,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly sms: SmsService,
  ) {}

  // ─────────────────────────────────────────────────────────── Inscription ──

  async register(dto: RegisterDto): Promise<{ user: unknown } & TokenPair> {
    const localPhone = AuthService.toLocalPhoneFormat(AuthService.normalisePhone(dto.phone));
    const last9 = AuthService.last9Digits(localPhone);

    const existing = await this.prisma.users.findMany({ where: { phone: { endsWith: last9 } } });
    if (existing.length > 0) {
      throw new AppError('PHONE_ALREADY_USED', 'Ce numéro est déjà associé à un compte.', 409);
    }

    // La colonne partagée `email` est `UNIQUE NOT NULL` côté web : une
    // inscription mobile sans email reçoit une adresse de substitution
    // déterministe, invisible pour l'utilisateur (§ décision confirmée).
    const email = dto.email?.toLowerCase() ?? `m${last9}@mobile.allgo.local`;
    if (await this.prisma.users.findUnique({ where: { email } })) {
      throw new AppError('EMAIL_ALREADY_USED', 'Cette adresse email est déjà utilisée.', 409);
    }

    const mysqlUser = await this.prisma.users.create({
      data: {
        role_id: 3,
        firstname: dto.firstName,
        lastname: dto.lastName,
        email,
        phone: localPhone,
        password: await bcrypt.hash(dto.password, 12),
        status: 'active',
      },
    });

    const tokens = await this.issueTokens(mysqlUser);
    const mirrored = await this.mirror.findOne({ mysqlId: mysqlUser.id });
    return { user: mirrored?.toJSON(), ...tokens };
  }

  // ───────────────────────────────────────────────────────────── Connexion ──

  async login(dto: LoginDto, context: { ip?: string; userAgent?: string }): Promise<TokenPair> {
    const phone = AuthService.normalisePhone(dto.phone);
    await this.assertNotLockedOut(phone, context.ip);

    // Plusieurs comptes réels partagent le même suffixe de téléphone (doublons
    // constatés en base) : on essaie chaque candidat plutôt que de supposer
    // l'unicité — `findFirst`/`findUnique` masqueraient silencieusement les
    // autres comptes valides.
    const candidates = await this.prisma.users.findMany({
      where: { phone: { endsWith: AuthService.last9Digits(phone) } },
    });

    let matched: MysqlUser | undefined;
    for (const candidate of candidates) {
      if (await AuthService.bcryptCompare(dto.password, candidate.password)) {
        matched = candidate;
        break;
      }
    }

    if (!matched) {
      // Vérification à durée constante même si aucun compte ne correspond :
      // sans ce leurre, le temps de réponse révèle quels numéros existent.
      await AuthService.bcryptCompare(dto.password, await bcrypt.hash('decoy', 10));
      await this.recordFailedAttempt(phone, context.ip);
      throw AppError.invalidCredentials();
    }
    if (matched.status !== 'active') {
      throw new AppError('ACCOUNT_SUSPENDED', 'Ce compte est suspendu.', 403);
    }

    await this.clearFailedAttempts(phone, context.ip);

    return this.issueTokens(matched, { ...context, deviceId: dto.deviceId });
  }

  // ──────────────────────────────────────────────────────── Rafraîchissement ──

  /**
   * Rotation du jeton de rafraîchissement, avec détection de vol.
   *
   * Présenter un jeton déjà consommé signifie qu'une copie circule : toutes les
   * sessions de l'utilisateur sont alors révoquées.
   */
  async refresh(rawToken: string): Promise<TokenPair> {
    let payload: { sub: string; sid: string };
    try {
      payload = await this.jwt.verifyAsync(rawToken, {
        secret: this.config.getOrThrow<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new AppError('INVALID_REFRESH_TOKEN', 'Votre session a expiré. Reconnectez-vous.', 401);
    }

    const stored = await this.prisma.refresh_tokens.findUnique({ where: { sid: payload.sid } });
    if (!stored || stored.token_hash !== AuthService.hashToken(rawToken)) {
      throw new AppError('INVALID_REFRESH_TOKEN', 'Votre session a expiré. Reconnectez-vous.', 401);
    }

    if (stored.revoked_at) {
      this.logger.warn(
        { userId: stored.user_id, sid: stored.sid },
        'Jeton de rafraîchissement réutilisé — révocation de toutes les sessions',
      );
      await this.revokeAllSessions(stored.user_id);
      throw new AppError(
        'TOKEN_REUSE_DETECTED',
        'Une anomalie de sécurité a été détectée. Reconnectez-vous.',
        401,
      );
    }

    const mysqlUser = await this.prisma.users.findUnique({ where: { id: stored.user_id } });
    if (!mysqlUser || mysqlUser.status !== 'active') {
      throw new AppError('INVALID_REFRESH_TOKEN', 'Votre session a expiré. Reconnectez-vous.', 401);
    }

    const tokens = await this.issueTokens(mysqlUser, {
      deviceId: stored.device_id ?? undefined,
      ip: stored.ip ?? undefined,
      userAgent: stored.user_agent ?? undefined,
    });

    await this.prisma.refresh_tokens.update({
      where: { id: stored.id },
      data: {
        revoked_at: new Date(),
        replaced_by: this.jwt.decode<{ sid: string }>(tokens.refreshToken)?.sid,
      },
    });

    return tokens;
  }

  /**
   * Résout l'ObjectId du miroir Mongo pour un utilisateur MySQL donné — pour
   * les modules pas encore migrés qui référencent un utilisateur par ObjectId
   * (ex. `MessagingService.resolveShopParticipant`). Ne CRÉE jamais de miroir
   * ici (contrairement à `ShopsService.resolveMirrorId`) : un miroir
   * utilisateur exige des champs obligatoires (téléphone, mot de passe...)
   * qu'on ne peut pas fabriquer à partir du seul id — s'il n'existe pas,
   * c'est que cet utilisateur ne s'est jamais connecté depuis la migration.
   */
  async resolveMirrorId(mysqlId: number): Promise<string | null> {
    const doc = await this.mirror.findOne({ mysqlId }).select('_id').lean();
    return doc ? String(doc._id) : null;
  }

  /**
   * Sens inverse — pour les champs déjà migrés vers MySQL (auteur d'une
   * publication, expéditeur d'un message, cible d'un blocage...) qui doivent
   * néanmoins continuer à s'exposer au format miroir tant que
   * `AuthenticatedUser.id` (session courante) n'a pas basculé sur l'entier
   * MySQL direct (Phase 6) : le mobile compare ces champs à `/me.id` pour ses
   * « est-ce moi » (`isMine`), ils doivent rester dans le même référentiel.
   */
  async resolveMysqlId(mirrorId: string): Promise<number | null> {
    if (!Types.ObjectId.isValid(mirrorId)) return null;
    const doc = await this.mirror.findById(mirrorId).select('mysqlId').lean();
    return doc?.mysqlId ?? null;
  }

  async logout(sid: string): Promise<void> {
    await this.prisma.refresh_tokens.updateMany({
      where: { sid },
      data: { revoked_at: new Date() },
    });
  }

  async revokeAllSessions(userId: number): Promise<void> {
    await this.prisma.refresh_tokens.updateMany({
      where: { user_id: userId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
  }

  // ───────────────────────────────────────────────────────────────── OTP ──

  /**
   * Envoi d'un code à usage unique par SMS — §12.2.
   *
   * À Mahajanga, le numéro de téléphone est un identifiant plus fiable que
   * l'adresse email : c'est le canal principal d'authentification.
   *
   * La réponse est identique que le numéro existe ou non : l'API ne doit jamais
   * servir à énumérer les comptes.
   */
  async sendOtp(rawPhone: string): Promise<{ expiresIn: number }> {
    // Vérifié AVANT toute écriture Redis : pas de code généré pour un canal
    // qui ne le délivrera jamais (§ décision du 2026-09-09, mise en marché).
    this.sms.assertAvailable();

    const phone = AuthService.normalisePhone(rawPhone);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

    await this.redis.set(
      `otp:${phone}`,
      JSON.stringify({ hash: AuthService.hashToken(code), attempts: 0 }),
      'EX',
      OTP_TTL_SECONDS,
    );

    await this.sms.send(phone, `Votre code AllGo : ${code} (valable ${OTP_TTL_SECONDS / 60} minutes).`);

    return { expiresIn: OTP_TTL_SECONDS };
  }

  async verifyOtp(rawPhone: string, code: string): Promise<TokenPair> {
    const phone = AuthService.normalisePhone(rawPhone);
    const key = `otp:${phone}`;
    const raw = await this.redis.get(key);

    if (!raw) {
      throw new AppError('OTP_EXPIRED', 'Ce code a expiré. Demandez-en un nouveau.', 410);
    }

    const state = JSON.parse(raw) as { hash: string; attempts: number };

    if (state.attempts >= OTP_MAX_ATTEMPTS) {
      await this.redis.del(key);
      throw new AppError(
        'OTP_TOO_MANY_ATTEMPTS',
        'Trop de tentatives. Demandez un nouveau code.',
        429,
      );
    }

    if (!AuthService.constantTimeEquals(state.hash, AuthService.hashToken(code))) {
      state.attempts += 1;
      await this.redis.set(key, JSON.stringify(state), 'KEEPTTL');
      throw new AppError('OTP_INVALID', 'Code incorrect.', 400);
    }

    await this.redis.del(key);

    const candidates = await this.prisma.users.findMany({
      where: { phone: { endsWith: AuthService.last9Digits(phone) } },
    });
    const user = candidates[0];
    if (!user) throw AppError.notFound('Compte');

    if (!user.phone_verified_at) {
      await this.prisma.users.update({ where: { id: user.id }, data: { phone_verified_at: new Date() } });
    }

    return this.issueTokens(user);
  }

  // ──────────────────────────────────────────────── Mot de passe oublié ──

  /**
   * Réellement implémentée, contrairement au web (§7.3, §12.1).
   * Réponse constante : l'existence d'un compte n'est jamais divulguée.
   */
  async forgotPassword(rawPhone: string): Promise<void> {
    // Même garde qu'à l'envoi d'OTP, et pour la même raison — vérifiée avant
    // toute requête, y compris avant de savoir si le compte existe : l'état
    // d'indisponibilité de la plateforme ne dépend jamais d'un compte
    // particulier, la propriété « réponse constante » anti-énumération reste
    // intacte.
    this.sms.assertAvailable();

    const phone = AuthService.normalisePhone(rawPhone);
    const candidates = await this.prisma.users.findMany({
      where: { phone: { endsWith: AuthService.last9Digits(phone) } },
    });
    const user = candidates[0];
    if (!user) return;

    const token = randomBytes(32).toString('base64url');
    await this.redis.set(`pwreset:${AuthService.hashToken(token)}`, String(user.id), 'EX', 30 * 60);

    await this.sms.send(phone, `Réinitialisez votre mot de passe AllGo : ${token} (valable 30 minutes).`);
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const key = `pwreset:${AuthService.hashToken(token)}`;
    const rawId = await this.redis.get(key);

    if (!rawId) {
      throw new AppError('RESET_TOKEN_INVALID', 'Ce lien a expiré. Refaites une demande.', 410);
    }
    await this.redis.del(key);

    const userId = Number(rawId);
    await this.prisma.users.update({
      where: { id: userId },
      data: {
        password: await bcrypt.hash(password, 12),
        // Invalide immédiatement tous les jetons d'accès déjà émis.
        sessions_invalid_before: new Date(),
      },
    });

    // Réinitialiser un mot de passe déconnecte partout : si le compte était
    // compromis, l'attaquant perd son accès au même instant.
    await this.revokeAllSessions(userId);
  }

  // ───────────────────────────────────────────────── Vérification email ──

  /**
   * `EmailService.sendVerification` existait déjà mais n'était appelée par
   * aucune route (code mort) : ces deux méthodes referment la boucle, sur le
   * même schéma jeton-Redis à usage unique que `forgotPassword`.
   */
  async sendEmailVerification(mysqlId: number): Promise<void> {
    const user = await this.prisma.users.findUnique({ where: { id: mysqlId } });
    if (!user) throw AppError.notFound('Utilisateur');
    // `email` est NOT NULL côté MySQL (une adresse de substitution est toujours
    // présente) : « pas d'email » signifie ici « jamais remplacée par une vraie ».
    if (user.email.endsWith('@mobile.allgo.local')) {
      throw new AppError(
        'EMAIL_MISSING',
        'Ajoutez une adresse email à votre profil avant de la vérifier.',
        400,
      );
    }
    if (user.email_verified_at) return;

    const token = randomBytes(32).toString('base64url');
    await this.redis.set(`emailverify:${AuthService.hashToken(token)}`, String(user.id), 'EX', 30 * 60);

    if (this.config.get('env') !== 'production') {
      this.logger.debug(`Jeton de vérification email pour ${user.email} : ${token}`);
    }
    await this.email.sendVerification(user.email, token);
  }

  async verifyEmail(token: string): Promise<void> {
    const key = `emailverify:${AuthService.hashToken(token)}`;
    const rawId = await this.redis.get(key);
    if (!rawId) {
      throw new AppError(
        'EMAIL_VERIFICATION_TOKEN_INVALID',
        'Ce lien a expiré. Redemandez une vérification.',
        410,
      );
    }
    await this.redis.del(key);
    await this.prisma.users.update({
      where: { id: Number(rawId) },
      data: { email_verified_at: new Date() },
    });
  }

  // ──────────────────────────────────────────────────────────── Internes ──

  /**
   * Construit `AuthenticatedUser`, tient à jour le miroir Mongo (§ décision du
   * 2026-09-09) et émet la paire de jetons.
   *
   * Le miroir existe pour les modules pas encore migrés qui font
   * `new Types.ObjectId(user.id)`/`.populate('userId')` et attendent un vrai
   * document `User` (nom, avatar, rôles...) — sans lui, tout module encore sur
   * Mongo verrait des profils vides dès la première connexion post-bascule.
   */
  private async issueTokens(
    mysqlUser: MysqlUser,
    context: { deviceId?: string; ip?: string; userAgent?: string } = {},
  ): Promise<TokenPair> {
    const [ownedShops, teamMembership] = await Promise.all([
      this.prisma.shops.findMany({ where: { user_id: mysqlUser.id }, select: { id: true } }),
      this.prisma.shop_team_members.findUnique({ where: { user_id: mysqlUser.id } }),
    ]);
    const roles = buildRoleAssignments({
      roleId: mysqlUser.role_id,
      adminLevel: mysqlUser.admin_level,
      ownedShopIds: ownedShops.map((s) => s.id),
      teamMembership: teamMembership
        ? { shopId: teamMembership.shop_id, teamRole: teamMembership.team_role, status: teamMembership.status }
        : null,
    });

    const mirrored = await this.mirrorUser(mysqlUser, roles);
    const sid = randomBytes(16).toString('base64url');

    const claims: AuthenticatedUser & { sub: string } = {
      sub: String(mirrored._id),
      id: String(mirrored._id),
      mysqlId: mysqlUser.id,
      phone: mysqlUser.phone ?? '',
      roles,
      sid,
    };

    const accessTtl = this.config.getOrThrow<string>('jwt.accessTtl');
    const refreshTtl = this.config.getOrThrow<string>('jwt.refreshTtl');

    const accessToken = await this.jwt.signAsync(claims, {
      secret: this.config.getOrThrow<string>('jwt.accessSecret'),
      expiresIn: accessTtl,
    });

    const refreshToken = await this.jwt.signAsync(
      { sub: claims.id, sid },
      { secret: this.config.getOrThrow<string>('jwt.refreshSecret'), expiresIn: refreshTtl },
    );

    await this.prisma.refresh_tokens.create({
      data: {
        user_id: mysqlUser.id,
        sid,
        token_hash: AuthService.hashToken(refreshToken),
        device_id: context.deviceId,
        ip: context.ip,
        user_agent: context.userAgent,
        expires_at: new Date(Date.now() + AuthService.parseTtlMs(refreshTtl)),
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: Math.floor(AuthService.parseTtlMs(accessTtl) / 1000),
    };
  }

  /**
   * Upsert du miroir Mongo par `mysqlId`, avec les champs affichés en direct
   * ailleurs dans l'app (nom, rôles) synchronisés à chaque émission de jetons.
   * Le hash placebo n'est écrit qu'à la création — jamais lu, jamais comparé.
   */
  private async mirrorUser(mysqlUser: MysqlUser, roles: AuthenticatedUser['roles']): Promise<UserDocument> {
    const doc = await this.mirror.findOneAndUpdate(
      { mysqlId: mysqlUser.id },
      {
        $set: {
          phone: mysqlUser.phone ?? `mysql-${mysqlUser.id}`,
          email: mysqlUser.email,
          firstName: mysqlUser.firstname,
          lastName: mysqlUser.lastname,
          avatar: mysqlUser.avatar ?? undefined,
          bio: mysqlUser.bio ?? undefined,
          status: mysqlUser.status ?? 'active',
          roles,
        },
        $setOnInsert: {
          mysqlId: mysqlUser.id,
          passwordHash: await argon2.hash(randomBytes(32).toString('hex'), ARGON2_OPTIONS),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return doc;
  }

  /** Limitation de débit sur l'authentification — 5 tentatives / 15 min (§12.1). */
  private async assertNotLockedOut(phone: string, ip?: string): Promise<void> {
    for (const key of AuthService.attemptKeys(phone, ip)) {
      const attempts = Number(await this.redis.get(key)) || 0;
      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        throw AppError.accountLocked((await this.redis.ttl(key)) || LOGIN_WINDOW_SECONDS);
      }
    }
  }

  private async recordFailedAttempt(phone: string, ip?: string): Promise<void> {
    for (const key of AuthService.attemptKeys(phone, ip)) {
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, LOGIN_WINDOW_SECONDS);
    }
  }

  private async clearFailedAttempts(phone: string, ip?: string): Promise<void> {
    await this.redis.del(...AuthService.attemptKeys(phone, ip));
  }

  /** Compteurs par compte ET par IP : ni le blocage ciblé ni le balayage massif. */
  private static attemptKeys(phone: string, ip?: string): string[] {
    return ip ? [`login:phone:${phone}`, `login:ip:${ip}`] : [`login:phone:${phone}`];
  }

  /** Normalise un numéro malgache en `+261XXXXXXXXX`. */
  static normalisePhone(input: string): string {
    const digits = input.replace(/[\s.-]/g, '');
    if (digits.startsWith('+261')) return digits;
    if (digits.startsWith('261')) return `+${digits}`;
    if (digits.startsWith('0')) return `+261${digits.slice(1)}`;
    return digits;
  }

  /**
   * `+261XXXXXXXXX` → `0XXXXXXXXX` — format conservé par les lignes existantes
   * de la colonne partagée `users.phone`, écrites par le site PHP.
   */
  static toLocalPhoneFormat(normalised: string): string {
    return normalised.startsWith('+261') ? `0${normalised.slice(4)}` : normalised;
  }

  /** Les 9 derniers chiffres — seule portion fiable entre les deux formats de téléphone. */
  static last9Digits(phone: string): string {
    return phone.replace(/\D/g, '').slice(-9);
  }

  /**
   * `bcryptjs` attend le préfixe `$2a$`/`$2b$` ; les hash réels du site web
   * (Laravel/PHP) portent `$2y$`, une variante strictement équivalente mais
   * non reconnue telle quelle par toutes les versions de la librairie.
   */
  static async bcryptCompare(plain: string, hash: string): Promise<boolean> {
    const normalised = hash.replace(/^\$2y\$/, '$2b$');
    return bcrypt.compare(plain, normalised).catch(() => false);
  }

  private static hashToken(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private static constantTimeEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  }

  /** Convertit `15m`, `30d`, `12h`, `3600s` en millisecondes. */
  static parseTtlMs(ttl: string): number {
    const match = /^(\d+)([smhd])$/.exec(ttl.trim());
    if (!match) throw new Error(`Durée de jeton invalide : ${ttl}`);
    const units = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    return Number(match[1]) * units[match[2] as keyof typeof units];
  }
}
