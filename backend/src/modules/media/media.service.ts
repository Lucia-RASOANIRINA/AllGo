import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

import { AppError } from '../../common/http/app-error';

/** Types acceptés, et extension **imposée** par le serveur — jamais celle du client. */
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
};

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const URL_TTL_SECONDS = 300;

@Injectable()
export class MediaService {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    const s3 = config.getOrThrow<Record<string, string | boolean>>('s3');
    this.bucket = s3.bucket as string;
    this.s3 = new S3Client({
      endpoint: s3.endpoint as string,
      region: s3.region as string,
      forcePathStyle: s3.forcePathStyle as boolean,
      credentials: {
        accessKeyId: s3.accessKey as string,
        secretAccessKey: s3.secretKey as string,
      },
    });
  }

  /**
   * URL présignée de téléversement — §7.4.
   *
   * L'application n'envoie JAMAIS un fichier à l'API. Elle demande une URL,
   * téléverse directement vers le stockage objet, puis transmet la clé obtenue.
   *
   * Ce schéma ferme définitivement la faille d'exécution de fichier téléversé
   * du web, qui stocke les envois dans `public/uploads/`, un répertoire servi
   * par le serveur applicatif : **aucun fichier utilisateur n'atterrit jamais
   * dans un répertoire capable d'exécuter du code.**
   *
   * Trois verrous complémentaires :
   *   - le type MIME est validé ici, et re-vérifié par nombre magique dans le
   *     job de post-traitement (un en-tête déclaré n'est pas une preuve) ;
   *   - l'extension est réécrite par le serveur, jamais reprise du client ;
   *   - la taille est plafonnée dans la signature elle-même, donc opposable
   *     par le stockage objet et pas seulement par l'API.
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
      throw new AppError('FILE_TOO_LARGE', 'Ce fichier est trop volumineux.', 413, {
        maxBytes,
      });
    }

    // Chemin cloisonné par utilisateur et par date : ni collision, ni
    // énumération, ni répertoire unique de plusieurs millions d'objets.
    const now = new Date();
    const key = `uploads/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${userId}/${randomUUID()}.${extension}`;

    const uploadUrl = await getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: size,
      }),
      { expiresIn: URL_TTL_SECONDS },
    );

    return { uploadUrl, key, expiresIn: URL_TTL_SECONDS };
  }

  /**
   * URL publique des trois tailles générées par le job de post-traitement.
   *
   * Miniature 200 px, aperçu 800 px, plein écran 1600 px, en WebP (§5.1).
   * Un téléphone ne télécharge jamais une image de 4 Mo.
   */
  publicUrls(key: string): { url: string; previewUrl: string; thumbUrl: string } {
    const base = this.config.getOrThrow<string>('s3.publicBaseUrl');
    const stem = key.replace(/\.[^.]+$/, '');
    return {
      thumbUrl: `${base}/${stem}_200.webp`,
      previewUrl: `${base}/${stem}_800.webp`,
      url: `${base}/${stem}_1600.webp`,
    };
  }
}
