import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AppError } from '../../common/http/app-error';
import { MediaService } from '../media/media.service';
import type { RegisterDeviceDto } from '../auth/dto/auth.dto';
import type { CreateAddressDto, UpdateProfileDto } from './dto/profile.dto';
import { User, type UserDocument } from './schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly media: MediaService,
  ) {}

  async findById(id: string): Promise<unknown> {
    const user = await this.users.findById(id);
    if (!user) throw AppError.notFound('Utilisateur');
    return user.toJSON();
  }

  async updateProfile(id: string, dto: UpdateProfileDto): Promise<unknown> {
    const update: Record<string, unknown> = {};

    for (const field of ['firstName', 'lastName', 'bio'] as const) {
      if (dto[field] !== undefined) update[field] = dto[field];
    }
    if (dto.email !== undefined) update.email = dto.email.toLowerCase();
    if (dto.avatarKey) update.avatar = this.media.publicUrls(dto.avatarKey).thumbUrl;

    for (const field of ['locale', 'theme', 'pushEnabled'] as const) {
      if (dto[field] !== undefined) update[`preferences.${field}`] = dto[field];
    }
    if (dto.notificationCategories !== undefined) {
      for (const [category, enabled] of Object.entries(dto.notificationCategories)) {
        if (['orders', 'promotions', 'social', 'messages', 'delivery'].includes(category)) {
          update[`preferences.pushCategories.${category}`] = enabled;
        }
        for (const [field, value] of Object.entries({
          available: dto.courierAvailable,
          identityVerified: dto.identityVerified,
          vehicle: dto.vehicle,
          documents: dto.documents,
        })) {
          if (value !== undefined) update[`courierProfile.${field}`] = value;
        }
      }
    }

    const user = await this.users.findByIdAndUpdate(id, { $set: update }, { new: true });
    if (!user) throw AppError.notFound('Utilisateur');
    return user.toJSON();
  }

  async listAddresses(id: string): Promise<unknown[]> {
    const user = await this.users.findById(id).select('addresses').lean();
    return user?.addresses ?? [];
  }

  async addAddress(id: string, dto: CreateAddressDto): Promise<unknown[]> {
    // Une seule adresse par défaut : la précédente est retirée avant l'ajout.
    if (dto.isDefault) {
      await this.users.updateOne({ _id: id }, { $set: { 'addresses.$[].isDefault': false } });
    }
    await this.users.updateOne({ _id: id }, { $push: { addresses: dto } });
    return this.listAddresses(id);
  }

  async removeAddress(id: string, addressId: string): Promise<unknown[]> {
    await this.users.updateOne(
      { _id: id },
      { $pull: { addresses: { _id: new Types.ObjectId(addressId) } } },
    );
    return this.listAddresses(id);
  }

  /**
   * Enregistrement d'un terminal pour le push.
   *
   * Idempotent par `deviceId` : réinstaller l'application ou renouveler le
   * jeton FCM met à jour l'entrée existante au lieu d'en accumuler une nouvelle
   * à chaque démarrage — sinon les notifications partent en double.
   */
  async registerDevice(id: string, dto: RegisterDeviceDto): Promise<{ registered: boolean }> {
    const updated = await this.users.updateOne(
      { _id: id, 'devices.deviceId': dto.deviceId },
      {
        $set: {
          'devices.$.fcmToken': dto.fcmToken,
          'devices.$.platform': dto.platform,
          'devices.$.lastSeenAt': new Date(),
        },
      },
    );

    if (updated.matchedCount === 0) {
      await this.users.updateOne(
        { _id: id },
        { $push: { devices: { ...dto, lastSeenAt: new Date() } } },
      );
    }
    return { registered: true };
  }
}
