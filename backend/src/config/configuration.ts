import { resolve } from 'node:path';

/** Configuration typée, alimentée exclusivement par l'environnement (§12.1). */
export interface AppConfig {
  env: string;
  port: number;
  apiPrefix: string;
  corsOrigins: string[];
  minSupportedAppVersion: string;
  redisUrl: string;
  apiPublicBaseUrl: string;
  jwt: {
    accessSecret: string;
    accessTtl: string;
    refreshSecret: string;
    refreshTtl: string;
  };
  media: {
    storagePath: string;
    publicBaseUrl: string;
  };
  smtp: {
    host?: string;
    port: number;
    user?: string;
    password?: string;
    from: string;
    verificationUrl: string;
  };
  sms: {
    gatewayUrl?: string;
    apiKey?: string;
    senderId?: string;
  };
}

function required(name: string): string {
  const value = process.env[name];
  // Un secret manquant doit faire échouer le démarrage, jamais produire une
  // valeur par défaut silencieuse — c'est ainsi qu'un secret de développement
  // se retrouve en production.
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

export default (): AppConfig => ({
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  apiPrefix: process.env.API_PREFIX ?? 'v1',
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  minSupportedAppVersion: process.env.MIN_SUPPORTED_APP_VERSION ?? '1.0.0',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  // URL par laquelle le client mobile atteint CETTE API — sert à construire
  // `uploadUrl` (§ MediaService) en absolu, jamais relative à la machine du
  // serveur. Doit pointer sur le domaine public réel en production.
  apiPublicBaseUrl: (process.env.API_PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}/${process.env.API_PREFIX ?? 'v1'}`).replace(/\/$/, ''),
  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET'),
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshSecret: required('JWT_REFRESH_SECRET'),
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
  },
  // Stockage disque local (§ décision du 2026-09-10 : plus de S3/MinIO) — un
  // dossier servi statiquement par le serveur web existant (Apache/o2switch
  // en production, un simple dossier local en développement).
  media: {
    storagePath: process.env.MEDIA_STORAGE_PATH ?? resolve(process.cwd(), 'uploads'),
    publicBaseUrl: (process.env.MEDIA_PUBLIC_BASE_URL ?? 'http://localhost:3000/media').replace(/\/$/, ''),
  },
  // Absent en développement : `EmailService` journalise le lien au lieu
  // d'envoyer un courriel (§ décision de portée L0).
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    from: process.env.SMTP_FROM ?? 'no-reply@allgomada.com',
    verificationUrl: process.env.EMAIL_VERIFICATION_URL ?? 'https://allgomada.com/verifier-email',
  },
  // Absent tant qu'aucun fournisseur SMS n'est branché : `SmsService` répond
  // alors une indisponibilité explicite en production (§ décision du
  // 2026-09-09, mise en marché) plutôt qu'un faux succès silencieux.
  sms: {
    gatewayUrl: process.env.SMS_GATEWAY_URL,
    apiKey: process.env.SMS_GATEWAY_API_KEY,
    senderId: process.env.SMS_SENDER_ID,
  },
});
