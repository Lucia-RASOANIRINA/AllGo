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
});
