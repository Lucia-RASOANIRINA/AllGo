import { ConfigService } from '@nestjs/config';

import { AirtelMoneyProvider } from './airtel-money.provider';
import { MvolaProvider } from './mvola.provider';
import { OrangeMoneyProvider } from './orange-money.provider';

/**
 * Le mode démo (succès simulé sans appel réseau) exige désormais un double
 * verrou — `env !== 'production'` ET `PAYMENTS_DEMO_MODE=true` explicite —
 * pour qu'un `NODE_ENV` mal positionné ne suffise jamais, à lui seul, à
 * ouvrir une faille financière (§ décision du 2026-09-09, mise en marché).
 */
describe('Payment providers — mode dégradé local', () => {
  const demoConfig = new ConfigService({ PAYMENTS_DEMO_MODE: 'true' });

  it('MVola génère une transaction de démonstration quand le mode démo est explicitement activé', async () => {
    const provider = new MvolaProvider(demoConfig);

    const result = await provider.initiate({
      orderId: 'order-123',
      orderNumber: 'JM-2026-000123',
      amount: '25000',
      phone: '+261341234567',
    });

    expect(result.txId).toMatch(/^demo-mvola-/);
    expect(result.ussdCode).toContain('999');
    expect(provider.isAvailable()).toBe(true);
  });

  it('Orange Money et Airtel Money restent utilisables en mode démo explicite', async () => {
    const orange = new OrangeMoneyProvider(demoConfig);
    const airtel = new AirtelMoneyProvider(demoConfig);

    expect((await orange.initiate({
      orderId: 'order-124',
      orderNumber: 'JM-2026-000124',
      amount: '12000',
      phone: '+261340000001',
    })).txId).toMatch(/^demo-orange-/);

    expect((await airtel.initiate({
      orderId: 'order-125',
      orderNumber: 'JM-2026-000125',
      amount: '18000',
      phone: '+261340000002',
    })).txId).toMatch(/^demo-airtel-/);
  });

  it('sans PAYMENTS_DEMO_MODE, aucun fournisseur ne simule un succès', async () => {
    const bareConfig = new ConfigService({});
    const provider = new MvolaProvider(bareConfig);

    expect(provider.isAvailable()).toBe(false);
    await expect(
      provider.initiate({ orderId: 'order-126', orderNumber: 'JM-2026-000126', amount: '5000', phone: '+261340000003' }),
    ).rejects.toThrow('n’est pas encore disponible');
  });

  it('en production, le mode démo reste bloqué même si PAYMENTS_DEMO_MODE=true traîne dans l’environnement', async () => {
    const prodConfig = new ConfigService({ env: 'production', PAYMENTS_DEMO_MODE: 'true' });
    const provider = new MvolaProvider(prodConfig);

    expect(provider.isAvailable()).toBe(false);
    await expect(
      provider.initiate({ orderId: 'order-127', orderNumber: 'JM-2026-000127', amount: '5000', phone: '+261340000004' }),
    ).rejects.toThrow('n’est pas encore disponible');
  });
});
