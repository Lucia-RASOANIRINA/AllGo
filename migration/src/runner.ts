import { MongoClient } from 'mongodb';
import mysql from 'mysql2/promise';

import { DOMAINS, type DomainName } from './domains';

export interface Rejection {
  sourceId: string | number;
  reason: string;
}

export interface Discrepancy {
  kind: 'count' | 'integrity' | 'business';
  detail: string;
}

export interface MigrationReport {
  domain: DomainName;
  mode: string;
  sourceRows: number;
  documentsWritten: number;
  rejected: Rejection[];
  discrepancies: Discrepancy[];
  durationMs: number;
}

/**
 * Exécute un lot de migration.
 *
 * Contrat : en mode `dry-run`, AUCUNE écriture n'atteint MongoDB. C'est la
 * garantie qui permet de faire tourner la migration autant de fois que
 * nécessaire en préproduction, jusqu'à ce que le rapport soit vierge.
 *
 * ÉTAT : ossature. Les transformateurs par domaine (`src/domains/*.ts`) seront
 * écrits lot par lot, en même temps que la migration correspondante — les
 * écrire tous d'avance reviendrait à figer des hypothèses sur des données que
 * personne n'a encore inspectées.
 */
export async function runMigration(
  domain: DomainName,
  mode: string,
): Promise<MigrationReport> {
  const startedAt = Date.now();
  const spec = DOMAINS[domain];

  const mysqlUri = process.env.MYSQL_URI;
  const mongoUri = process.env.MONGODB_URI;
  if (!mysqlUri || !mongoUri) {
    throw new Error(
      'MYSQL_URI et MONGODB_URI doivent être définies. Aucune valeur par défaut : ' +
        'une migration ne doit jamais viser une base par accident.',
    );
  }

  const source = await mysql.createConnection(mysqlUri);
  const target = new MongoClient(mongoUri);

  try {
    await target.connect();

    const rejected: Rejection[] = [];
    const discrepancies: Discrepancy[] = [];
    let sourceRows = 0;

    for (const table of spec.sourceTables) {
      const [rows] = await source.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM \`${table}\``,
      );
      sourceRows += Number(rows[0]?.total ?? 0);
    }

    if (mode === 'verify') {
      // Contrôle 1 du §15.5 : nombre de documents identique au nombre de lignes
      // source, aux exclusions documentées près.
      const written = await target
        .db()
        .collection(spec.targetCollection.split('|')[0])
        .countDocuments();

      if (written !== sourceRows) {
        discrepancies.push({
          kind: 'count',
          detail: `${sourceRows} ligne(s) source contre ${written} document(s) cible.`,
        });
      }
    }

    // TODO(par lot) : brancher le transformateur du domaine, qui produit les
    // documents et alimente `rejected`. Les contrôles 2 (références orphelines)
    // et 3 (somme des montants au centime près) du §15.5 s'exécutent ici.

    return {
      domain,
      mode,
      sourceRows,
      documentsWritten: 0,
      rejected,
      discrepancies,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await source.end();
    await target.close();
  }
}
