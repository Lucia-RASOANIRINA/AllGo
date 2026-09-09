#!/usr/bin/env node
/**
 * Test de connexion à la base MySQL/MariaDB en ligne — §15.3.
 *
 * STRICTEMENT en lecture seule : aucune écriture, aucune modification de
 * schéma. Sert à vérifier que la base hébergée est bien joignable depuis
 * l'extérieur, et à lister ce qu'elle contient réellement (48 tables
 * attendues) avant d'écrire le moindre mappeur de domaine.
 *
 * Variables séparées (MYSQL_HOST/PORT/USER/PASSWORD/DATABASE) plutôt qu'une
 * URL `mysql://user:pass@host` unique : un mot de passe contenant `@`, `;`
 * ou d'autres caractères réservés casserait le format URI. La forme objet de
 * `mysql2` prend le mot de passe tel quel, sans encodage.
 */

import 'dotenv/config';
import mysql from 'mysql2/promise';

async function main(): Promise<void> {
  const { MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE } = process.env;
  if (!MYSQL_HOST || !MYSQL_USER || !MYSQL_PASSWORD) {
    process.stderr.write(
      'MYSQL_HOST, MYSQL_USER et MYSQL_PASSWORD doivent être définies — voir migration/.env.example.\n',
    );
    process.exit(1);
  }

  process.stdout.write(`Connexion à ${MYSQL_USER}@${MYSQL_HOST}:${MYSQL_PORT ?? 3306}…\n`);
  const started = Date.now();

  const connection = await mysql.createConnection({
    host: MYSQL_HOST,
    port: MYSQL_PORT ? Number(MYSQL_PORT) : 3306,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    connectTimeout: 25_000,
  });

  try {
    process.stdout.write(`Connecté en ${Date.now() - started} ms.\n\n`);

    const [dbRows] = await connection.query<mysql.RowDataPacket[]>('SHOW DATABASES');
    const databases = dbRows.map((row) => Object.values(row)[0] as string);
    process.stdout.write(`Bases accessibles à cet utilisateur : ${databases.join(', ')}\n\n`);

    const target = MYSQL_DATABASE || databases.find((d) => d.includes('janga_market')) || null;
    if (!target) {
      process.stdout.write(
        'Aucune base cible déterminée (ni MYSQL_DATABASE, ni base contenant ' +
          '« janga_market » dans la liste ci-dessus) — arrêt ici.\n',
      );
      return;
    }

    await connection.changeUser({ database: target });
    process.stdout.write(`Base sélectionnée : ${target}\n\n`);

    const [tables] = await connection.query<mysql.RowDataPacket[]>('SHOW TABLES');
    const tableNames = tables.map((row) => Object.values(row)[0] as string).sort();

    process.stdout.write(`${tableNames.length} table(s) trouvée(s) :\n`);
    for (const name of tableNames) {
      const [countRows] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM \`${name}\``,
      );
      const total = countRows[0]?.total ?? 0;
      process.stdout.write(`  ${name.padEnd(28)} ${total} ligne(s)\n`);
    }

    // Vérification ciblée après une modification de schéma (§ colonnes
    // messagerie) : liste les colonnes des tables concernées, en lecture
    // seule, sans jamais y écrire.
    const verifyTables = (process.env.VERIFY_COLUMNS ?? '').split(',').map((t) => t.trim()).filter(Boolean);
    for (const name of verifyTables) {
      if (!tableNames.includes(name)) {
        process.stdout.write(`\n« ${name} » n'existe pas dans cette base.\n`);
        continue;
      }
      const [columns] = await connection.query<mysql.RowDataPacket[]>(`DESCRIBE \`${name}\``);
      process.stdout.write(`\nColonnes de « ${name} » :\n`);
      for (const col of columns) {
        process.stdout.write(`  ${String(col.Field).padEnd(28)} ${col.Type}\n`);
      }
    }

    process.stdout.write('\nAucune écriture effectuée — lecture seule.\n');
  } finally {
    await connection.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`Échec de connexion : ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
