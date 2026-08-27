/**
 * Séquence de migration — §15.2.
 *
 * Un domaine à la fois, dans un ordre de risque croissant. À chaque étape, une
 * SEULE source de vérité pour le domaine concerné. La double base durable
 * (trajectoire A) est explicitement écartée : deux sources de vérité pour le
 * même stock produisent des divergences inévitables.
 */

export interface DomainSpec {
  /** Lot de migration (M1 à M6). */
  lot: 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6';
  /** Tables MySQL source. */
  sourceTables: readonly string[];
  /** Collection MongoDB cible. */
  targetCollection: string;
  risk: 'très faible' | 'faible' | 'moyen' | 'élevé';
  /** Domaines devant être migrés avant celui-ci. */
  dependsOn: readonly string[];
  notes?: string;
}

export const DOMAINS = {
  categories: {
    lot: 'M1',
    sourceTables: ['categories'],
    targetCollection: 'categories',
    risk: 'très faible',
    dependsOn: [],
    notes: 'Arborescence reconstruite en ancêtres matérialisés (`ancestors`, `depth`).',
  },

  settings: {
    lot: 'M1',
    sourceTables: ['settings'],
    targetCollection: 'settings',
    risk: 'très faible',
    dependsOn: [],
  },

  shops: {
    lot: 'M2',
    sourceTables: ['shops', 'shop_team_members'],
    targetCollection: 'shops',
    risk: 'faible',
    dependsOn: ['categories'],
    notes:
      'L’équipe est embarquée dans le document. La contrainte UNIQUE sur ' +
      '`shop_team_members.user_id` disparaît : un utilisateur peut désormais ' +
      'appartenir à plusieurs boutiques (§3.1).',
  },

  products: {
    lot: 'M2',
    sourceTables: ['products', 'product_media', 'product_variants'],
    targetCollection: 'products',
    risk: 'faible',
    dependsOn: ['shops', 'categories'],
    notes: 'Médias et variantes embarqués ; `categoryPath` calculé depuis l’arbre.',
  },

  posts: {
    lot: 'M3',
    sourceTables: ['posts', 'client_requests'],
    targetCollection: 'posts',
    risk: 'faible',
    dependsOn: ['shops'],
    notes:
      'FUSION des deux systèmes concurrents du web : la table `posts` enrichie ' +
      'de 8 colonnes de demande, ET la table `client_requests` séparée. Le ' +
      'document cible porte `kind: "post" | "request"` (§6.2).',
  },

  social: {
    lot: 'M3',
    sourceTables: ['comments', 'reactions', 'follows', 'favorites', 'stories'],
    targetCollection: 'comments|reactions|follows|favorites|stories',
    risk: 'faible',
    dependsOn: ['posts'],
    notes:
      'Les index uniques composés rejettent les doublons présents en base ' +
      'source (aucune contrainte côté MySQL) : ces rejets sont attendus et ' +
      'doivent être documentés au rapport, pas contournés.',
  },

  users: {
    lot: 'M4',
    sourceTables: ['users', 'shop_team_members'],
    targetCollection: 'users',
    risk: 'moyen',
    dependsOn: ['shops'],
    notes:
      'Refonte du modèle de rôles : `role` + `admin_level` + `team_role` → ' +
      '`roles[]` avec portée. La colonne `temp_password` (mots de passe en ' +
      'CLAIR) n’est PAS migrée. Les empreintes bcrypt sont conservées telles ' +
      'quelles et re-hachées en Argon2id à la première connexion réussie.',
  },

  orders: {
    lot: 'M5',
    sourceTables: ['orders', 'order_items', 'invoices', 'sales_invoices'],
    targetCollection: 'orders|invoices',
    risk: 'élevé',
    dependsOn: ['users', 'products'],
    notes:
      'Les lignes deviennent des instantanés contractuels figés. Les deux ' +
      'systèmes de facturation (`invoices` et `sales_invoices`) sont fusionnés ' +
      'avec renumérotation, la correspondance ancien → nouveau numéro étant ' +
      'conservée au rapport.',
  },

  stock: {
    lot: 'M6',
    sourceTables: ['stock_movements', 'inventories'],
    targetCollection: 'stockMovements',
    risk: 'élevé',
    dependsOn: ['products'],
    notes:
      'Collection de séries temporelles : les documents ne sont ni modifiés ni ' +
      'supprimés après écriture. Un rejeu partiel impose donc de repartir de ' +
      'l’instantané, pas de corriger sur place.',
  },
} as const satisfies Record<string, DomainSpec>;

export type DomainName = keyof typeof DOMAINS;

/**
 * Tables mortes du web, explicitement NON migrées (§15.4).
 * Les reprendre serait transporter la dette plutôt que la solder.
 */
export const DEAD_TABLES: readonly string[] = [
  'advertisements',
  'post_hashtags',
  'invoice_items',
  'password_resets',
];
