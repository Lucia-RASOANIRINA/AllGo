/** Configuration typée, alimentée exclusivement par l'environnement (§12.1). */
export interface AppConfig {
  env: string;
  port: number;
  apiPrefix: string;
  corsOrigins: string[];
  minSupportedAppVersion: string;
  mongoUri: string;
  redisUrl: string;
  jwt: {
    accessSecret: string;
    accessTtl: string;
    refreshSecret: string;
    refreshTtl: string;
  };
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
    forcePathStyle: boolean;
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
  mongoUri: required('MONGODB_URI'),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET'),
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshSecret: required('JWT_REFRESH_SECRET'),
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
  },
  s3: {
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? 'allgo-media',
    accessKey: required('S3_ACCESS_KEY'),
    secretKey: required('S3_SECRET_KEY'),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    publicBaseUrl: process.env.S3_PUBLIC_BASE_URL ?? 'http://localhost:9000/allgo-media',
  },
  // Absent en développement : `EmailService` journalise le lien au lieu
  // d'envoyer un courriel (§ décision de portée L0).
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    from: process.env.SMTP_FROM ?? 'no-reply@allgo.mg',
    verificationUrl: process.env.EMAIL_VERIFICATION_URL ?? 'https://app.allgo.mg/verifier-email',
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
