import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsInt, IsNumberString, IsOptional, Max, Min } from 'class-validator';

import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { CartService } from './cart.service';

export class AddCartItemDto {
  @ApiProperty({ description: 'Identifiant numérique MySQL du produit.' })
  @IsNumberString()
  productId!: string;

  @ApiPropertyOptional({ description: 'Identifiant numérique MySQL de la variante.' })
  @IsOptional()
  @IsNumberString()
  variantId?: string;

  @ApiProperty({ minimum: 1, maximum: 999, default: 1 })
  @IsInt()
  @Min(1)
  @Max(999)
  quantity = 1;
}

export class UpdateCartItemDto {
  @ApiProperty({ minimum: 0, maximum: 999, description: '0 retire la ligne du panier.' })
  @IsInt()
  @Min(0)
  @Max(999)
  quantity!: number;
}

@ApiTags('Panier')
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @RequirePermission(Permission.CartManage)
  @ApiOperation({ summary: 'Consulter le panier.' })
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.cart.get(user.mysqlId);
  }

  @Post('items')
  @RequirePermission(Permission.CartManage)
  @ApiOperation({ summary: 'Ajouter un article au panier.' })
  add(@CurrentUser() user: AuthenticatedUser, @Body() dto: AddCartItemDto) {
    return this.cart.addItem(user.mysqlId, dto.productId, dto.quantity, dto.variantId);
  }

  @Patch('items/:id')
  @RequirePermission(Permission.CartManage)
  @ApiOperation({ summary: 'Modifier la quantité d’une ligne.' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cart.updateQuantity(user.mysqlId, id, dto.quantity);
  }

  @Delete('items/:id')
  @RequirePermission(Permission.CartManage)
  @ApiOperation({ summary: 'Retirer une ligne du panier.' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.cart.removeItem(user.mysqlId, id);
  }

  @Get('coupon')
  @RequirePermission(Permission.CartManage)
  @ApiOperation({ summary: 'Prévisualiser une réduction avant de commander, boutique par boutique.' })
  previewCoupon(@CurrentUser() user: AuthenticatedUser, @Query('code') code: string) {
    return this.cart.previewCoupon(user.mysqlId, code);
  }
}
