import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type Redis from 'ioredis';
import sharp from 'sharp';

import { AppError } from '../../common/http/app-error';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.constants';

/** Types acceptés, et extension **imposée** par le serveur — jamais celle du client. */
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
};
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const URL_TTL_SECONDS = 300;

/** Miniature 200 px, aperçu 800 px, plein écran 1600 px, en WebP (§5.1). */
const VARIANTS: ReadonlyArray<{ suffix: string; width: number }> = [
  { suffix: '_200', width: 200 },
  { suffix: '_800', width: 800 },
  { suffix: '_1600', width: 1600 },
];

interface UploadTicket {
  key: string;
  contentType: string;
  maxBytes: number;
  userId: string;
}

/**
 * Stockage disque local (§ décision du 2026-09-10, mise en production sur
 * l'hébergement mutualisé o2switch — pas de S3/MinIO disponible).
 *
 * Le contrat HTTP côté mobile reste inchangé : `POST /media/upload-url` puis
 * `PUT <uploadUrl>` avec les octets bruts (`AuthInterceptor` mobile joint déjà
 * le jeton d'accès à toute requête du même client Dio, y compris celle-ci —
 * aucune modification de l'application n'est nécessaire). Seule la nature de
 * `uploadUrl` change : au lieu d'un présigné S3, c'est désormais une URL de
 * cette même API, protégée par un jeton Redis à usage unique.
 *
 * Ce détour par l'API permet aussi de fermer deux lacunes réelles qui
 * existaient avec le téléversement direct vers S3 :
 *   - le contenu du fichier n'était jamais vérifié au-delà du type MIME
 *     déclaré par le client (non fiable par nature) ;
 *   - le job de post-traitement censé générer les variantes 200/800/1600 px
 *     n'a jamais existé dans le code, malgré `sharp` déjà en dépendance —
 *     `publicUrls()` construisait des URL vers des fichiers qui n'ont jamais
 *     été créés.
 */
@Injectable()
export class MediaService implements OnModuleInit {
  private readonly logger = new Logger(MediaService.name);
  private readonly storagePath: string;
  private readonly publicBaseUrl: string;
  private readonly apiPublicBaseUrl: string;

  constructor(
    config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.storagePath = config.getOrThrow<string>('media.storagePath');
    this.publicBaseUrl = config.getOrThrow<string>('media.publicBaseUrl');
    this.apiPublicBaseUrl = config.getOrThrow<string>('apiPublicBaseUrl');
  }

  /**
   * Le dossier de stockage vit dans le docroot du site web historique
   * (Apache/PHP) — un `.htaccess` désactivant l'exécution de scripts y est
   * indispensable : sans lui, un fichier malicieux qui passerait les
   * contrôles de contenu (§ `receiveUpload`) pourrait s'exécuter côté serveur.
   */
  async onModuleInit(): Promise<void> {
    await mkdir(this.storagePath, { recursive: true });
    const htaccessPath = join(this.storagePath, '.htaccess');
    try {
      await access(htaccessPath);
    } catch {
      await writeFile(
        htaccessPath,
        [
          'php_flag engine off',
          'RemoveHandler .php .phtml .php3 .php4 .php5 .pl .py .cgi .asp .sh',
          '<FilesMatch "\\.(php\\d?|phtml|pl|py|cgi|sh|asp)$">',
          '  Require all denied',
          '</FilesMatch>',
          'Options -ExecCGI -Indexes',
          '',
        ].join('\n'),
        'utf8',
      );
      this.logger.log(`.htaccess de sécurité créé dans ${this.storagePath}`);
    }
  }

  /**
   * Jeton d'upload à usage unique (Redis, TTL 5 min) — remplace la signature
   * S3. `key` garde exactement la même forme qu'avant (cloisonnement par
   * utilisateur et par date) pour ne rien changer côté consommateurs de
   * `publicUrls()`.
   */
  async createUploadUrl(
    userId: string,
    contentType: string,
    size: number,
  ): Promise<{ uploadUrl: string; key: string; expiresIn: number }> {
    const extension = ALLOWED_TYPES[contentType];
    if (!extension) {
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Ce format de fichier n’est pas accepté.', 415, {
        allowed: Object.keys(ALLOWED_TYPES),
      });
    }

    const maxBytes = contentType.startsWith('video/') ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (size <= 0 || size > maxBytes) {
      throw new AppError('FILE_TOO_LARGE', 'Ce fichier est trop volumineux.', 413, { maxBytes });
    }

    const now = new Date();
    const key = `uploads/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${userId}/${randomUUID()}.${extension}`;
    const token = randomUUID();
    const ticket: UploadTicket = { key, contentType, maxBytes, userId };
    await this.redis.set(`media:upload:${token}`, JSON.stringify(ticket), 'EX', URL_TTL_SECONDS);

    return {
      uploadUrl: `${this.apiPublicBaseUrl}/media/upload/${token}`,
      key,
      expiresIn: URL_TTL_SECONDS,
    };
  }

  /**
   * Reçoit les octets du `PUT` sur `uploadUrl`. Le jeton est consommé
   * (`GETDEL`) avant toute validation de contenu : un jeton ne sert qu'une
   * fois, qu'il aboutisse ou non — rejouer un jeton expiré/déjà utilisé ne
   * doit jamais réussir.
   */
  async receiveUpload(token: string, userId: string, buffer: Buffer): Promise<{ key: string }> {
    const raw = await this.redis.getdel(`media:upload:${token}`);
    if (!raw) {
      throw new AppError('UPLOAD_TOKEN_INVALID', 'Ce lien de téléversement est invalide ou expiré.', 410);
    }
    const ticket = JSON.parse(raw) as UploadTicket;
    if (ticket.userId !== userId) {
      throw new AppError('UPLOAD_TOKEN_INVALID', 'Ce lien de téléversement est invalide ou expiré.', 410);
    }
    if (buffer.length === 0 || buffer.length > ticket.maxBytes) {
      throw new AppError('FILE_TOO_LARGE', 'Ce fichier est trop volumineux.', 413, { maxBytes: ticket.maxBytes });
    }

    const destination = join(this.storagePath, ticket.key);
    await mkdir(dirname(destination), { recursive: true });

    if (IMAGE_TYPES.has(ticket.contentType)) {
      // Décoder réellement l'image valide son contenu — un fichier déguisé en
      // JPEG (mauvais octets, type MIME menti) échoue ici plutôt que d'être
      // stocké tel quel sous une extension serveur de confiance.
      try {
        await sharp(buffer).metadata();
      } catch {
        throw new AppError('INVALID_IMAGE', 'Ce fichier n’est pas une image valide.', 422);
      }

      await writeFile(destination, buffer);
      const stem = destination.replace(/\.[^.]+$/, '');
      await Promise.all(
        VARIANTS.map(({ suffix, width }) =>
          sharp(buffer)
            .resize({ width, withoutEnlargement: true })
            .webp({ quality: 82 })
            .toFile(`${stem}${suffix}.webp`),
        ),
      );
    } else {
      // Vidéo : aucune bibliothèque de décodage vidéo en dépendance — contrôle
      // sommaire par signature (boîte `ftyp` MPEG-4 proche du début du fichier).
      if (!buffer.subarray(4, 12).toString('ascii').includes('ftyp')) {
        throw new AppError('INVALID_VIDEO', 'Ce fichier n’est pas une vidéo valide.', 422);
      }
      await writeFile(destination, buffer);
    }

    return { key: ticket.key };
  }

  /**
   * URL publiques des trois tailles générées par `receiveUpload()`. Une
   * vidéo n'a pas de variante WebP (pas de génération de vignette vidéo pour
   * l'instant) : les trois champs pointent alors vers le fichier original.
   */
  publicUrls(key: string): { url: string; previewUrl: string; thumbUrl: string } {
    if (key.endsWith('.mp4')) {
      const original = `${this.publicBaseUrl}/${key}`;
      return { url: original, previewUrl: original, thumbUrl: original };
    }
    const stem = key.replace(/\.[^.]+$/, '');
    return {
      thumbUrl: `${this.publicBaseUrl}/${stem}_200.webp`,
      previewUrl: `${this.publicBaseUrl}/${stem}_800.webp`,
      url: `${this.publicBaseUrl}/${stem}_1600.webp`,
    };
  }
}
