import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';

/**
 * Exporte le contrat OpenAPI 3.1 dans un fichier.
 *
 * Le contrat est **exécutable et jamais désynchronisé du code** (§5.1) puisqu'il
 * est généré depuis les DTO. Ce fichier alimente :
 *   - les tests de conformité de schéma (Dredd / Schemathesis, §16.1) ;
 *   - la génération des modèles Dart côté Flutter ;
 *   - le serveur simulé contre lequel le mobile se développe en parallèle du
 *     backend (§4.2 — « API d'abord »).
 *
 *   npm run openapi:export -- openapi.json
 */
async function exportSpec(): Promise<void> {
  const target = process.argv[2] ?? 'openapi.json';

  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('v1');

  const config = new DocumentBuilder()
    .setTitle('API AllGo')
    .setDescription('Contrat généré depuis les DTO — ne pas éditer à la main.')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .addServer('https://api.allgo.mg/v1', 'Production')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  writeFileSync(target, JSON.stringify(document, null, 2), 'utf8');

  await app.close();

  process.stdout.write(
    `Contrat écrit dans ${target} — ${Object.keys(document.paths).length} chemins.\n`,
  );
}

void exportSpec().catch((error: unknown) => {
  process.stderr.write(`Échec de l'export : ${String(error)}\n`);
  process.exit(1);
});
