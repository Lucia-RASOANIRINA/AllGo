import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNumberString, IsString } from 'class-validator';
import type { Request } from 'express';

import {
  CurrentUser,
  Public,
  RequirePermission,
} from '../../common/decorators/auth.decorators';
import { Permission } from '../../common/rbac/permissions';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PaymentsService } from './payments.service';

export class InitiatePaymentDto {
  @ApiProperty() @IsNumberString() orderId!: string;

  @ApiProperty({ enum: ['mvola', 'orange_money', 'airtel_money'] })
  @IsIn(['mvola', 'orange_money', 'airtel_money'])
  provider!: string;

  @ApiProperty({ example: '+261341234567', description: 'Numéro du compte mobile money payeur.' })
  @IsString()
  phone!: string;
}

@ApiTags('Paiements')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('methods')
  @RequirePermission(Permission.PaymentInitiate)
  @ApiOperation({ summary: 'Lister les moyens de paiement disponibles.' })
  methods() {
    const mobileMoney: Array<{ key: string; label: string }> = [
      { key: 'mvola', label: 'MVola' },
      { key: 'orange_money', label: 'Orange Money' },
      { key: 'airtel_money', label: 'Airtel Money' },
    ];
    return {
      data: [
        { key: 'cod', label: 'Paiement à la livraison', available: true },
        ...mobileMoney.map(({ key, label }) => {
          const available = this.payments.provider(key)?.isAvailable() ?? false;
          return { key, label, available, message: available ? undefined : 'Ce moyen de paiement sera bientôt disponible.' };
        }),
      ],
    };
  }

  @Post('initiate')
  @RequirePermission(Permission.PaymentInitiate)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Déclencher un paiement mobile money.' })
  initiate(@CurrentUser() user: AuthenticatedUser, @Body() dto: InitiatePaymentDto) {
    return this.payments.initiate(dto.orderId, user.mysqlId, dto.provider, dto.phone);
  }

  /**
   * Point d'entrée des rappels fournisseurs.
   *
   * `@Public()` car appelé par un serveur tiers, sans jeton : l'authentification
   * repose entièrement sur la signature HMAC du corps, vérifiée dans le service.
   */
  @Public()
  @Post('webhook/:provider')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rappel de confirmation de paiement (appelé par le fournisseur).' })
  webhook(
    @Param('provider') provider: string,
    @Req() req: Request & { rawBody?: Buffer },
    @Headers() headers: Record<string, string>,
  ) {
    return this.payments.handleWebhook(provider, req.rawBody ?? Buffer.alloc(0), headers);
  }
}
