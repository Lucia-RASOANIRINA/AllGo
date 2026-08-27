import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsMongoId, IsOptional, IsString, MaxLength, Min } from 'class-validator';

import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { StockService } from './stock.service';

export class MoveStockDto {
  @ApiProperty() @IsMongoId() productId!: string;

  @ApiProperty({
    enum: ['in', 'out', 'correction'],
    description: 'Pour `correction`, `quantity` est le stock réel constaté, non un écart.',
  })
  @IsIn(['in', 'out', 'correction'])
  type!: 'in' | 'out' | 'correction';

  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) quantity!: number;

  @ApiProperty({ example: 'réception fournisseur' })
  @IsString()
  @MaxLength(80)
  reason!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}

@ApiTags('Stock')
@Controller('shop/:shopId/stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Post('movements')
  @RequirePermission(Permission.StockMove, 'shopId')
  @ApiOperation({
    summary: 'Enregistrer un mouvement de stock.',
    description:
      'Action refusée hors ligne : le stock est partagé entre plusieurs employés (§9.3).',
  })
  move(
    @Param('shopId') shopId: string,
    @Body() dto: MoveStockDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.stock.move({ ...dto, shopId, userId: user.id });
  }

  @Get('alerts')
  @RequirePermission(Permission.StockAlertRead, 'shopId')
  @ApiOperation({ summary: 'Produits sous le seuil d’alerte.' })
  alerts(@Param('shopId') shopId: string) {
    return this.stock.alerts(shopId);
  }
}
