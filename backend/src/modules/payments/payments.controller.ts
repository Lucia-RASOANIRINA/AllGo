import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsMongoId, IsString } from 'class-validator';
import type { Request } from 'express';

import { Public, RequirePermission } from '../../common/decorators/auth.decorators';
import { Permission } from '../../common/rbac/permissions';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { PaymentsService } from './payments.service';

export class InitiatePaymentDto {
  @ApiProperty() @IsMongoId() orderId!: string;

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

  @Post('initiate')
  @RequirePermission(Permission.PaymentInitiate)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Déclencher un paiement mobile money.' })
  initiate(@Body() dto: InitiatePaymentDto) {
    return this.payments.initiate(dto.orderId, dto.provider, dto.phone);
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
