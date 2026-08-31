import { ORDER_STATUSES, ORDER_TRANSITIONS, type OrderStatus } from './order.schema';

describe('Machine à états des commandes (§6.2)', () => {
  it('déclare une transition pour chaque statut', () => {
    for (const status of ORDER_STATUSES) {
      expect(ORDER_TRANSITIONS[status]).toBeDefined();
    }
  });

  it('ne cible que des statuts existants', () => {
    const known = new Set<string>(ORDER_STATUSES);
    for (const [from, targets] of Object.entries(ORDER_TRANSITIONS)) {
      for (const to of targets) {
        expect(known.has(to)).toBe(true);
        expect(to).not.toBe(from);
      }
    }
  });

  it('intercale `preparing` puis `ready` entre `confirmed` et `shipped`', () => {
    // Le web ne permet pas de distinguer « commande acceptée » de « commande en
    // préparation », ce qui rend le suivi client imprécis.
    expect(ORDER_TRANSITIONS.confirmed).toContain('preparing');
    expect(ORDER_TRANSITIONS.confirmed).not.toContain('shipped');
    expect(ORDER_TRANSITIONS.confirmed).not.toContain('ready');
    expect(ORDER_TRANSITIONS.preparing).toContain('ready');
    expect(ORDER_TRANSITIONS.preparing).not.toContain('shipped');
  });

  it('depuis `ready`, distingue la branche livraison de la branche retrait', () => {
    // `courier_assigned → shipped` est la livraison ; `ready → delivered`
    // directement est le retrait en boutique (§ décisions de portée : pas de
    // statut « retrait en boutique » distinct de `delivered`).
    expect(ORDER_TRANSITIONS.ready).toContain('courier_assigned');
    expect(ORDER_TRANSITIONS.ready).toContain('delivered');
    expect(ORDER_TRANSITIONS.courier_assigned).toContain('shipped');
    expect(ORDER_TRANSITIONS.courier_assigned).not.toContain('delivered');
  });

  it('rend `delivered` et `cancelled` terminaux', () => {
    expect(ORDER_TRANSITIONS.delivered).toEqual([]);
    expect(ORDER_TRANSITIONS.cancelled).toEqual([]);
  });

  it('permet l’annulation à toute étape antérieure à la livraison', () => {
    const cancellable: OrderStatus[] = [
      'pending',
      'confirmed',
      'preparing',
      'ready',
      'courier_assigned',
      'shipped',
    ];
    for (const status of cancellable) {
      expect(ORDER_TRANSITIONS[status]).toContain('cancelled');
    }
  });

  it('n’autorise aucun retour en arrière', () => {
    const rank = new Map<OrderStatus, number>(
      (
        [
          'pending',
          'confirmed',
          'preparing',
          'ready',
          'courier_assigned',
          'shipped',
          'delivered',
        ] as OrderStatus[]
      ).map((s, i) => [s, i]),
    );

    for (const [from, targets] of Object.entries(ORDER_TRANSITIONS) as Array<
      [OrderStatus, readonly OrderStatus[]]
    >) {
      for (const to of targets) {
        if (to === 'cancelled' || !rank.has(from) || !rank.has(to)) continue;
        // Une commande expédiée qui redeviendrait « en préparation » rendrait
        // l'historique de la timeline inexploitable.
        expect(rank.get(to)!).toBeGreaterThan(rank.get(from)!);
      }
    }
  });

  it('rend tout statut atteignable depuis `pending`', () => {
    const seen = new Set<OrderStatus>(['pending']);
    const queue: OrderStatus[] = ['pending'];

    while (queue.length > 0) {
      for (const next of ORDER_TRANSITIONS[queue.shift()!]) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }

    expect([...seen].sort()).toEqual([...ORDER_STATUSES].sort());
  });
});
