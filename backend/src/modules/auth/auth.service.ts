import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Model, Types } from 'mongoose';
import type Redis from 'ioredis';

import { REDIS_CLIENT } from '../../infrastructure/redis/redis.constants';
import { AppError } from '../../common/http/app-error';
import { Role } from '../../common/rbac/roles';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { User, type UserDocument } from '../users/schemas/user.schema';
import { RefreshToken, type RefreshTokenDocument } from './schemas/refresh-token.schema';
import { EmailService } from './email.service';
import type { LoginDto, RegisterDto } from './dto/auth.dto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Paramètres Argon2id — §5.1.
 *
 * Argon2id remplace bcrypt : résistant au calcul GPU, lauréat du concours de
 * hachage de mots de passe. 19 Mio et 2 passes correspondent à la
 * recommandation OWASP, tenable sur un VPS modeste.
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
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(RefreshToken.name) private readonly refreshTokens: Model<RefreshTokenDocument>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  // ─────────────────────────────────────────────────────────── Inscription ──

  async register(dto: RegisterDto): Promise<{ user: unknown } & TokenPair> {
    const phone = AuthService.normalisePhone(dto.phone);

    if (await this.users.exists({ phone })) {
      throw new AppError('PHONE_ALREADY_USED', 'Ce numéro est déjà associé à un compte.', 409);
    }
    if (dto.email && (await this.users.exists({ email: dto.email.toLowerCase() }))) {
      throw new AppError('EMAIL_ALREADY_USED', 'Cette adresse email est déjà utilisée.', 409);
    }

    const user = await this.users.create({
      phone,
      email: dto.email?.toLowerCase(),
      passwordHash: await argon2.hash(dto.password, ARGON2_OPTIONS),
      firstName: dto.firstName,
      lastName: dto.lastName,
      roles: [{ role: Role.Client }],
      status: 'active',
    });

    const tokens = await this.issueTokens(user);
    return { user: user.toJSON(), ...tokens };
  }

  // ───────────────────────────────────────────────────────────── Connexion ──

  async login(dto: LoginDto, context: { ip?: string; userAgent?: string }): Promise<TokenPair> {
    const phone = AuthService.normalisePhone(dto.phone);
    await this.assertNotLockedOut(phone, context.ip);

    const user = await this.users.findOne({ phone }).select('+passwordHash');

    // Vérification à durée constante même si le compte n'existe pas : sans ce
    // leurre, le temps de réponse révèle quels numéros sont enregistrés.
    const hash =
      user?.passwordHash ??
      '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const valid = await argon2.verify(hash, dto.password).catch(() => false);

    if (!user || !valid) {
      await this.recordFailedAttempt(phone, context.ip);
      throw AppError.invalidCredentials();
    }
    if (user.status !== 'active') {
      throw new AppError('ACCOUNT_SUSPENDED', 'Ce compte est suspendu.', 403);
    }

    await this.clearFailedAttempts(phone, context.ip);

    // Ré-empreinte transparente si les paramètres Argon2 ont durci depuis.
    if (argon2.needsRehash(user.passwordHash, ARGON2_OPTIONS)) {
      user.passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);
      await user.save();
    }

    return this.issueTokens(user, { ...context, deviceId: dto.deviceId });
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

    const stored = await this.refreshTokens.findOne({ sid: payload.sid });
    if (!stored || stored.tokenHash !== AuthService.hashToken(rawToken)) {
      throw new AppError('INVALID_REFRESH_TOKEN', 'Votre session a expiré. Reconnectez-vous.', 401);
    }

    if (stored.revokedAt) {
      this.logger.warn(
        { userId: String(stored.userId), sid: stored.sid },
        'Jeton de rafraîchissement réutilisé — révocation de toutes les sessions',
      );
      await this.revokeAllSessions(stored.userId);
      throw new AppError(
        'TOKEN_REUSE_DETECTED',
        'Une anomalie de sécurité a été détectée. Reconnectez-vous.',
        401,
      );
    }

    const user = await this.users.findById(stored.userId);
    if (!user || user.status !== 'active') {
      throw new AppError('INVALID_REFRESH_TOKEN', 'Votre session a expiré. Reconnectez-vous.', 401);
    }

    const tokens = await this.issueTokens(user, {
      deviceId: stored.deviceId,
      ip: stored.ip,
      userAgent: stored.userAgent,
    });

    stored.revokedAt = new Date();
    stored.replacedBy = this.jwt.decode<{ sid: string }>(tokens.refreshToken)?.sid;
    await stored.save();

    return tokens;
  }

  async logout(sid: string): Promise<void> {
    await this.refreshTokens.updateOne({ sid }, { $set: { revokedAt: new Date() } });
  }

  async revokeAllSessions(userId: Types.ObjectId | string): Promise<void> {
    await this.refreshTokens.updateMany(
      { userId, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date() } },
    );
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
    const phone = AuthService.normalisePhone(rawPhone);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

    await this.redis.set(
      `otp:${phone}`,
      JSON.stringify({ hash: AuthService.hashToken(code), attempts: 0 }),
      'EX',
      OTP_TTL_SECONDS,
    );

    // TODO(L0) : brancher la passerelle SMS. En développement, le code est
    // journalisé — jamais en production, où ce journal serait une faille.
    if (this.config.get('env') !== 'production') {
      this.logger.debug(`OTP pour ${phone} : ${code}`);
    }

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

    const user = await this.users.findOne({ phone });
    if (!user) throw AppError.notFound('Compte');

    if (!user.phoneVerifiedAt) {
      user.phoneVerifiedAt = new Date();
      await user.save();
    }

    return this.issueTokens(user);
  }

  // ──────────────────────────────────────────────── Mot de passe oublié ──

  /**
   * Réellement implémentée, contrairement au web (§7.3, §12.1).
   * Réponse constante : l'existence d'un compte n'est jamais divulguée.
   */
  async forgotPassword(rawPhone: string): Promise<void> {
    const phone = AuthService.normalisePhone(rawPhone);
    const user = await this.users.findOne({ phone });
    if (!user) return;

    const token = randomBytes(32).toString('base64url');
    await this.redis.set(
      `pwreset:${AuthService.hashToken(token)}`,
      String(user._id),
      'EX',
      30 * 60,
    );

    if (this.config.get('env') !== 'production') {
      this.logger.debug(`Jeton de réinitialisation pour ${phone} : ${token}`);
    }
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const key = `pwreset:${AuthService.hashToken(token)}`;
    const userId = await this.redis.get(key);

    if (!userId) {
      throw new AppError('RESET_TOKEN_INVALID', 'Ce lien a expiré. Refaites une demande.', 410);
    }

    await this.redis.del(key);

    await this.users.updateOne(
      { _id: userId },
      {
        $set: {
          passwordHash: await argon2.hash(password, ARGON2_OPTIONS),
          // Invalide immédiatement tous les jetons d'accès déjà émis.
          sessionsInvalidBefore: new Date(),
        },
      },
    );

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
  async sendEmailVerification(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) throw AppError.notFound('Utilisateur');
    if (!user.email) {
      throw new AppError(
        'EMAIL_MISSING',
        'Ajoutez une adresse email à votre profil avant de la vérifier.',
        400,
      );
    }
    if (user.emailVerifiedAt) return;

    const token = randomBytes(32).toString('base64url');
    await this.redis.set(`emailverify:${AuthService.hashToken(token)}`, String(user._id), 'EX', 30 * 60);

    if (this.config.get('env') !== 'production') {
      this.logger.debug(`Jeton de vérification email pour ${user.email} : ${token}`);
    }
    await this.email.sendVerification(user.email, token);
  }

  async verifyEmail(token: string): Promise<void> {
    const key = `emailverify:${AuthService.hashToken(token)}`;
    const userId = await this.redis.get(key);
    if (!userId) {
      throw new AppError(
        'EMAIL_VERIFICATION_TOKEN_INVALID',
        'Ce lien a expiré. Redemandez une vérification.',
        410,
      );
    }
    await this.redis.del(key);
    await this.users.updateOne({ _id: userId }, { $set: { emailVerifiedAt: new Date() } });
  }

  // ──────────────────────────────────────────────────────────── Internes ──

  private async issueTokens(
    user: UserDocument,
    context: { deviceId?: string; ip?: string; userAgent?: string } = {},
  ): Promise<TokenPair> {
    const sid = randomBytes(16).toString('base64url');

    const claims: AuthenticatedUser & { sub: string } = {
      sub: String(user._id),
      id: String(user._id),
      phone: user.phone,
      roles: user.roles.map((r) => ({
        role: r.role,
        ...(r.shopId ? { shopId: String(r.shopId) } : {}),
      })),
      sid,
    };

    const accessTtl = this.config.getOrThrow<string>('jwt.accessTtl');
    const refreshTtl = this.config.getOrThrow<string>('jwt.refreshTtl');

    const accessToken = await this.jwt.signAsync(claims, {
      secret: this.config.getOrThrow<string>('jwt.accessSecret'),
      expiresIn: accessTtl,
    });

    const refreshToken = await this.jwt.signAsync(
      { sub: String(user._id), sid },
      { secret: this.config.getOrThrow<string>('jwt.refreshSecret'), expiresIn: refreshTtl },
    );

    await this.refreshTokens.create({
      userId: user._id,
      sid,
      tokenHash: AuthService.hashToken(refreshToken),
      deviceId: context.deviceId,
      ip: context.ip,
      userAgent: context.userAgent,
      expiresAt: new Date(Date.now() + AuthService.parseTtlMs(refreshTtl)),
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: Math.floor(AuthService.parseTtlMs(accessTtl) / 1000),
    };
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
