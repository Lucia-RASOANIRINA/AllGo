#!/usr/bin/env node
/**
 * Outillage de migration MariaDB → MongoDB — §15.3.
 *
 *   migrate <domaine> --dry-run    lecture MySQL, transformation, rapport, AUCUNE écriture
 *   migrate <domaine> --execute    migration réelle, journal complet
 *   migrate <domaine> --verify     comparaison exhaustive des deux bases
 *   migrate <domaine> --rollback   restauration depuis l'instantané pris avant migration
 *
 * Chaque exécution produit un rapport : nombre de documents, écarts détectés,
 * enregistrements rejetés avec leur motif.
 *
 * `--dry-run` est le mode par DÉFAUT. Une migration ne s'exécute jamais par
 * inadvertance : il faut réclamer `--execute` explicitement.
 */

import { DOMAINS, type DomainName } from './domains';
import { runMigration } from './runner';

type Mode = 'dry-run' | 'execute' | 'verify' | 'rollback';

function usage(): never {
  const names = Object.keys(DOMAINS).join(' | ');
  process.stderr.write(
    `Usage : migrate <${names}> [--dry-run | --execute | --verify | --rollback]\n\n` +
      `Séquence recommandée (§15.2), du risque le plus faible au plus élevé :\n` +
      `  M1 categories, settings      → référentiels\n` +
      `  M2 shops, products, media    → catalogue\n` +
      `  M3 posts, comments, stories  → social\n` +
      `  M4 users                     → comptes et authentification\n` +
      `  M5 orders, invoices          → commerce\n` +
      `  M6 stock                     → ERP\n\n` +
      `Un lot n'est terminé qu'après les cinq contrôles du §15.5, dont la\n` +
      `RESTAURATION TESTÉE de l'instantané pris avant bascule.\n`,
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const [domain, ...flags] = process.argv.slice(2);

  if (!domain || !(domain in DOMAINS)) usage();

  const mode: Mode = flags.includes('--execute')
    ? 'execute'
    : flags.includes('--verify')
      ? 'verify'
      : flags.includes('--rollback')
        ? 'rollback'
        : 'dry-run';

  const report = await runMigration(domain as DomainName, mode);

  process.stdout.write(
    [
      '',
      `── Domaine « ${domain} » · mode ${mode} ──`,
      `Lignes source lues      : ${report.sourceRows}`,
      `Documents produits      : ${report.documentsWritten}`,
      `Rejetés                 : ${report.rejected.length}`,
      `Écarts détectés         : ${report.discrepancies.length}`,
      `Durée                   : ${report.durationMs} ms`,
      '',
    ].join('\n'),
  );

  for (const rejection of report.rejected.slice(0, 20)) {
    process.stdout.write(`  ✗ id ${rejection.sourceId} — ${rejection.reason}\n`);
  }
  if (report.rejected.length > 20) {
    process.stdout.write(`  … et ${report.rejected.length - 20} autres (voir le rapport JSON)\n`);
  }

  // Un rejet ou un écart fait échouer la commande : la CI doit s'arrêter, pas
  // afficher un avertissement que personne ne lira.
  process.exit(report.rejected.length + report.discrepancies.length > 0 ? 2 : 0);
}

void main().catch((error: unknown) => {
  process.stderr.write(`Échec : ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
