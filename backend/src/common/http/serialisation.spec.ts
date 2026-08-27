import { Decimal128, ObjectId } from 'mongodb';
import { normaliseResponse } from './serialisation';

/**
 * Ces règles ne sont pas cosmétiques : chacune correspond à une forme que le
 * client Flutter ne sait pas lire, et qui a été constatée en exécutant l'API.
 */
describe('normaliseResponse', () => {
  it('renomme `_id` en `id`', () => {
    const id = new ObjectId();
    expect(normaliseResponse({ _id: id, name: 'Riz' })).toEqual({
      id: id.toHexString(),
      name: 'Riz',
    });
  });

  it('sérialise un Decimal128 en chaîne, jamais en `{ $numberDecimal }`', () => {
    // Forme constatée avant correction : `{"price":{"$numberDecimal":"5200"}}`.
    // Le client mobile lit un montant, pas un objet d'encodage BSON.
    const result = normaliseResponse({ price: Decimal128.fromString('5200') }) as {
      price: unknown;
    };
    expect(result.price).toBe('5200');
  });

  it('préserve la précision décimale au lieu de passer par un flottant', () => {
    const result = normaliseResponse({ total: Decimal128.fromString('19999999.99') }) as {
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
    const id = new ObjectId();
    const payload = {
      _id: id,
      items: [{ _id: id, unitPrice: Decimal128.fromString('5200'), quantity: 2 }],
      amounts: { total: Decimal128.fromString('13400') },
    };

    expect(normaliseResponse(payload)).toEqual({
      id: id.toHexString(),
      items: [{ id: id.toHexString(), unitPrice: '5200', quantity: 2 }],
      amounts: { total: '13400' },
    });
  });

  it('convertit une Map Mongoose en objet', () => {
    // `conversations.unread` est une Map : `Object.entries` la rendrait vide,
    // et les compteurs de non-lus disparaîtraient sans erreur visible.
    const payload = { unread: new Map<string, number>([['u1', 3]]) };
    expect(normaliseResponse(payload)).toEqual({ unread: { u1: 3 } });
  });

  it('passe par la transformation `toJSON` d’un document hydraté', () => {
    // C'est ainsi que le masquage de `passwordHash` déclaré sur le schéma
    // utilisateur reste appliqué : on n'inspecte jamais l'objet brut.
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
