import { normaliseResponse } from './serialisation';

/**
 * Ces règles ne sont pas cosmétiques : chacune correspond à une forme que le
 * client Flutter ne sait pas lire, et qui a été constatée en exécutant l'API
 * à l'époque où ce backend était Mongo-natif. Le paquet `mongodb` a disparu
 * avec la Phase 6 (bascule complète vers MySQL) — ces objets factices
 * reproduisent juste la forme reconnue par `normaliseResponse` (`_bsontype`),
 * pour ne pas perdre la couverture de cette règle de sérialisation.
 */
function fakeObjectId(hex: string): { _bsontype: string; toString(): string } {
  return { _bsontype: 'ObjectId', toString: () => hex };
}

function fakeDecimal128(value: string): { _bsontype: string; toString(): string } {
  return { _bsontype: 'Decimal128', toString: () => value };
}

describe('normaliseResponse', () => {
  it('renomme `_id` en `id`', () => {
    const id = fakeObjectId('507f1f77bcf86cd799439011');
    expect(normaliseResponse({ _id: id, name: 'Riz' })).toEqual({
      id: '507f1f77bcf86cd799439011',
      name: 'Riz',
    });
  });

  it('sérialise un Decimal128 en chaîne, jamais en `{ $numberDecimal }`', () => {
    // Forme constatée avant correction : `{"price":{"$numberDecimal":"5200"}}`.
    // Le client mobile lit un montant, pas un objet d'encodage BSON.
    const result = normaliseResponse({ price: fakeDecimal128('5200') }) as {
      price: unknown;
    };
    expect(result.price).toBe('5200');
  });

  it('préserve la précision décimale au lieu de passer par un flottant', () => {
    const result = normaliseResponse({ total: fakeDecimal128('19999999.99') }) as {
      total: string;
    };
    expect(result.total).toBe('19999999.99');
  });

  it('retire `__v`', () => {
    expect(normaliseResponse({ name: 'Riz', __v: 3 })).toEqual({ name: 'Riz' });
  });

  it('laisse les dates intactes, pour que JSON.stringify produise de l’ISO 8601', () => {
    const date = new Date('2026-08-18T06:00:00.000Z');
    const result = normaliseResponse({ createdAt: date }) as { createdAt: Date };
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(JSON.parse(JSON.stringify(result)).createdAt).toBe('2026-08-18T06:00:00.000Z');
  });

  it('traverse les tableaux et les objets imbriqués', () => {
    const id = fakeObjectId('507f1f77bcf86cd799439011');
    const payload = {
      _id: id,
      items: [{ _id: id, unitPrice: fakeDecimal128('5200'), quantity: 2 }],
      amounts: { total: fakeDecimal128('13400') },
    };

    expect(normaliseResponse(payload)).toEqual({
      id: '507f1f77bcf86cd799439011',
      items: [{ id: '507f1f77bcf86cd799439011', unitPrice: '5200', quantity: 2 }],
      amounts: { total: '13400' },
    });
  });

  it('convertit une Map en objet', () => {
    // `conversations.unread` était une Map côté Mongo : `Object.entries` la
    // rendrait vide, et les compteurs de non-lus disparaîtraient sans erreur
    // visible.
    const payload = { unread: new Map<string, number>([['u1', 3]]) };
    expect(normaliseResponse(payload)).toEqual({ unread: { u1: 3 } });
  });

  it('passe par la transformation `toJSON` d’un objet qui en expose une', () => {
    const document = {
      toJSON: () => ({ _id: 'abc', name: 'Soa' }),
      passwordHash: 'secret',
    };
    expect(normaliseResponse(document)).toEqual({ id: 'abc', name: 'Soa' });
  });

  it('laisse passer les valeurs simples et nulles', () => {
    expect(normaliseResponse(null)).toBeNull();
    expect(normaliseResponse(undefined)).toBeUndefined();
    expect(normaliseResponse(42)).toBe(42);
    expect(normaliseResponse('texte')).toBe('texte');
    expect(normaliseResponse(false)).toBe(false);
  });

  it('n’altère pas un objet déjà normalisé', () => {
    const payload = { id: 'abc', price: '5200', items: [] };
    expect(normaliseResponse(payload)).toEqual(payload);
  });
});
