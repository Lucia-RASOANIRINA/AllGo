import { ConfigService } from '@nestjs/config';

import { AirtelMoneyProvider } from './airtel-money.provider';
import { MvolaProvider } from './mvola.provider';
import { OrangeMoneyProvider } from './orange-money.provider';

describe('Payment providers — mode dégradé local', () => {
  const config = new ConfigService();

  it('MVola génère une transaction de démonstration sans clé fournisseur', async () => {
    const provider = new MvolaProvider(config);

    const result = await provider.initiate({
      orderId: 'order-123',
      orderNumber: 'JM-2026-000123',
      amount: '25000',
      phone: '+261341234567',
    });

    expect(result.txId).toMatch(/^demo-mvola-/);
    expect(result.ussdCode).toContain('999');
  });

  it('Orange Money et Airtel Money restent utilisables sans configuration externe', async () => {
    const orange = new OrangeMoneyProvider(config);
    const airtel = new AirtelMoneyProvider(config);

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
});
