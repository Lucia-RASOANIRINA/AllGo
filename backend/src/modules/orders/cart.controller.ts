import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsInt, IsMongoId, IsOptional, Max, Min } from 'class-validator';

import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { CartService } from './cart.service';

export class AddCartItemDto {
  @ApiProperty()
  @IsMongoId()
  productId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
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
    return this.cart.get(user.id);
  }

  @Post('items')
  @RequirePermission(Permission.CartManage)
  @ApiOperation({ summary: 'Ajouter un article au panier.' })
  add(@CurrentUser() user: AuthenticatedUser, @Body() dto: AddCartItemDto) {
    return this.cart.addItem(user.id, dto.productId, dto.quantity, dto.variantId);
  }

  @Patch('items/:id')
  @RequirePermission(Permission.CartManage)
  @ApiOperation({ summary: 'Modifier la quantité d’une ligne.' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cart.updateQuantity(user.id, id, dto.quantity);
  }

  @Delete('items/:id')
  @RequirePermission(Permission.CartManage)
  @ApiOperation({ summary: 'Retirer une ligne du panier.' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.cart.removeItem(user.id, id);
  }
}
