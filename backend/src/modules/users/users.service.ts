import { Injectable } from '@nestjs/common';

import { AppError } from '../../common/http/app-error';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { AuthService } from '../auth/auth.service';
import type { RegisterDeviceDto } from '../auth/dto/auth.dto';
import type { CreateAddressDto, UpdateProfileDto } from './dto/profile.dto';

/** Adresse de substitution générée à l'inscription mobile — jamais montrée à l'utilisateur. */
const isPlaceholderEmail = (email: string): boolean => email.endsWith('@mobile.allgo.local');
const NOTIFICATION_CATEGORIES = ['orders', 'promotions', 'social', 'messages', 'delivery'] as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly auth: AuthService,
  ) {}

  /** Profil composé : 100 % MySQL depuis la Phase 6. */
  async findById(user: AuthenticatedUser): Promise<unknown> {
    const [mysqlUser, devices, courierProfile, presence] = await Promise.all([
      this.prisma.users.findUnique({ where: { id: user.mysqlId } }),
      this.prisma.device_tokens.findMany({ where: { user_id: user.mysqlId } }),
      this.prisma.courier_profiles.findUnique({ where: { user_id: user.mysqlId } }),
      this.prisma.user_presence.findUnique({ where: { user_id: user.mysqlId } }),
    ]);
    if (!mysqlUser) throw AppError.notFound('Utilisateur');

    return {
      id: user.id,
      phone: mysqlUser.phone,
      email: isPlaceholderEmail(mysqlUser.email) ? undefined : mysqlUser.email,
      firstName: mysqlUser.firstname,
      lastName: mysqlUser.lastname,
      avatar: mysqlUser.avatar ?? undefined,
      cover: mysqlUser.cover ?? undefined,
      bio: mysqlUser.bio ?? undefined,
      status: mysqlUser.status,
      roles: user.roles,
      emailVerifiedAt: isPlaceholderEmail(mysqlUser.email) ? undefined : mysqlUser.email_verified_at,
      phoneVerifiedAt: mysqlUser.phone_verified_at ?? undefined,
      createdAt: mysqlUser.created_at,
      updatedAt: mysqlUser.updated_at,
      devices: devices.map((d) => ({
        deviceId: d.device_id,
        fcmToken: d.fcm_token,
        platform: d.platform,
        lastSeenAt: d.last_seen_at ?? undefined,
      })),
      preferences: {
        locale: mysqlUser.locale,
        theme: mysqlUser.theme,
        pushEnabled: mysqlUser.push_enabled,
        pushCategories: (mysqlUser.push_categories as Record<string, boolean> | null) ?? {},
      },
      courierProfile: courierProfile
        ? {
            identityVerified: courierProfile.identity_verified,
            vehicle: courierProfile.vehicle ?? undefined,
            available: courierProfile.available,
          }
        : {},
      presence: presence ? { isOnline: presence.is_online, lastSeenAt: presence.last_seen ?? undefined } : { isOnline: false },
    };
  }

  async updateProfile(user: AuthenticatedUser, dto: UpdateProfileDto): Promise<unknown> {
    const mysqlUpdate: Record<string, unknown> = {};
    if (dto.firstName !== undefined) mysqlUpdate.firstname = dto.firstName;
    if (dto.lastName !== undefined) mysqlUpdate.lastname = dto.lastName;
    if (dto.bio !== undefined) mysqlUpdate.bio = dto.bio;
    if (dto.avatarKey) mysqlUpdate.avatar = this.media.publicUrls(dto.avatarKey).thumbUrl;
    if (dto.email !== undefined) {
      const email = dto.email.toLowerCase();
      const owner = await this.prisma.users.findUnique({ where: { email } });
      if (owner && owner.id !== user.mysqlId) {
        throw new AppError('EMAIL_ALREADY_USED', 'Cette adresse email est déjà utilisée.', 409);
      }
      mysqlUpdate.email = email;
      // Une nouvelle adresse remplace la précédente : elle repart non vérifiée.
      mysqlUpdate.email_verified_at = null;
    }
    if (dto.locale !== undefined) mysqlUpdate.locale = dto.locale;
    if (dto.theme !== undefined) mysqlUpdate.theme = dto.theme;
    if (dto.pushEnabled !== undefined) mysqlUpdate.push_enabled = dto.pushEnabled;
    if (dto.notificationCategories !== undefined) {
      const current = (await this.prisma.users.findUnique({ where: { id: user.mysqlId }, select: { push_categories: true } }))
        ?.push_categories as Record<string, boolean> | null;
      const merged = { ...(current ?? {}) };
      for (const [category, enabled] of Object.entries(dto.notificationCategories)) {
        if ((NOTIFICATION_CATEGORIES as readonly string[]).includes(category)) merged[category] = enabled;
      }
      mysqlUpdate.push_categories = merged;
    }

    if (Object.keys(mysqlUpdate).length > 0) {
      await this.prisma.users.update({ where: { id: user.mysqlId }, data: mysqlUpdate });
    }

    if (dto.courierAvailable !== undefined || dto.identityVerified !== undefined || dto.vehicle !== undefined) {
      await this.prisma.courier_profiles.upsert({
        where: { user_id: user.mysqlId },
        create: {
          user_id: user.mysqlId,
          available: dto.courierAvailable ?? false,
          identity_verified: dto.identityVerified ?? false,
          vehicle: dto.vehicle,
        },
        update: {
          ...(dto.courierAvailable !== undefined ? { available: dto.courierAvailable } : {}),
          ...(dto.identityVerified !== undefined ? { identity_verified: dto.identityVerified } : {}),
          ...(dto.vehicle !== undefined ? { vehicle: dto.vehicle } : {}),
        },
      });
    }

    return this.findById(user);
  }

  async listAddresses(user: AuthenticatedUser): Promise<unknown[]> {
    const rows = await this.prisma.addresses.findMany({ where: { user_id: user.mysqlId } });
    return rows.map(UsersService.addressToJson);
  }

  async addAddress(user: AuthenticatedUser, dto: CreateAddressDto): Promise<unknown[]> {
    // Une seule adresse par défaut : la précédente est retirée avant l'ajout.
    if (dto.isDefault) {
      await this.prisma.addresses.updateMany({
        where: { user_id: user.mysqlId },
        data: { is_default: false },
      });
    }
    await this.prisma.addresses.create({
      data: {
        user_id: user.mysqlId,
        label: dto.label,
        city: dto.city,
        district: dto.district,
        address_line: dto.line,
        longitude: dto.location?.coordinates[0],
        latitude: dto.location?.coordinates[1],
        is_default: dto.isDefault ?? false,
      },
    });
    return this.listAddresses(user);
  }

  async removeAddress(user: AuthenticatedUser, addressId: string): Promise<unknown[]> {
    await this.prisma.addresses.deleteMany({ where: { id: Number(addressId), user_id: user.mysqlId } });
    return this.listAddresses(user);
  }

  private static addressToJson(row: {
    id: number;
    label: string | null;
    city: string | null;
    district: string | null;
    address_line: string | null;
    latitude: unknown;
    longitude: unknown;
    is_default: boolean | null;
  }): unknown {
    const lat = row.latitude === null ? null : Number(row.latitude);
    const lng = row.longitude === null ? null : Number(row.longitude);
    return {
      id: row.id,
      label: row.label,
      city: row.city,
      district: row.district ?? undefined,
      line: row.address_line,
      location: lat === null || lng === null ? undefined : { type: 'Point', coordinates: [lng, lat] },
      isDefault: row.is_default ?? false,
    };
  }

  /**
   * Enregistrement d'un terminal pour le push.
   *
   * Idempotent par `deviceId` (contrainte `unique_device`) : réinstaller
   * l'application ou renouveler le jeton FCM met à jour l'entrée existante au
   * lieu d'en accumuler une nouvelle à chaque démarrage — sinon les
   * notifications partent en double.
   */
  async registerDevice(user: AuthenticatedUser, dto: RegisterDeviceDto): Promise<{ registered: boolean }> {
    await this.prisma.device_tokens.upsert({
      where: { user_id_device_id: { user_id: user.mysqlId, device_id: dto.deviceId } },
      create: {
        user_id: user.mysqlId,
        device_id: dto.deviceId,
        fcm_token: dto.fcmToken,
        platform: dto.platform,
        last_seen_at: new Date(),
      },
      update: { fcm_token: dto.fcmToken, platform: dto.platform, last_seen_at: new Date() },
    });
    return { registered: true };
  }

  /**
   * Suppression de compte — anonymisation, jamais suppression physique.
   *
   * Les commandes, avis et publications passés référencent cet identifiant
   * et doivent rester cohérents pour les autres utilisateurs et pour la
   * comptabilité des boutiques : les supprimer romprait cet historique. Le
   * téléphone anonymisé ne correspond plus à aucun numéro malgache valide, ce
   * qui empêche toute reconnexion par mot de passe ou OTP.
   *
   * Les adresses de livraison enregistrées ne sont pas supprimées : certaines
   * peuvent être référencées par des commandes passées (`orders.address_id`),
   * et un compte suspendu ne peut de toute façon plus les consulter ni s'y
   * reconnecter. Les terminaux enregistrés sont retirés : un compte supprimé
   * ne doit plus jamais recevoir de notification push.
   */
  async deleteAccount(user: AuthenticatedUser): Promise<{ deleted: true }> {
    const anonymisedEmail = `deleted-${user.mysqlId}@mobile.allgo.local`;
    const anonymisedPhone = `deleted+${user.mysqlId}`;

    const updated = await this.prisma.users.updateMany({
      where: { id: user.mysqlId },
      data: {
        firstname: 'Compte',
        lastname: 'supprimé',
        email: anonymisedEmail,
        phone: anonymisedPhone,
        avatar: null,
        cover: null,
        bio: null,
        status: 'suspended',
      },
    });
    if (updated.count === 0) throw AppError.notFound('Utilisateur');

    await this.prisma.device_tokens.deleteMany({ where: { user_id: user.mysqlId } });
    await this.auth.revokeAllSessions(user.mysqlId);
    return { deleted: true };
  }
}
