import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { CartService } from './cart.service';
import { GeoPointDto } from './dto/create-order.dto';

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

class PreviewDeliveryDto {
  @ApiProperty({ enum: ['delivery', 'pickup'] })
  @IsIn(['delivery', 'pickup'])
  method!: 'delivery' | 'pickup';

  @ApiPropertyOptional({ type: GeoPointDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => GeoPointDto)
  location?: GeoPointDto;
}

export class PreviewCartDto {
  @ApiProperty({ type: PreviewDeliveryDto })
  @ValidateNested()
  @Type(() => PreviewDeliveryDto)
  delivery!: PreviewDeliveryDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  couponCode?: string;
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

  @Delete()
  @RequirePermission(Permission.CartManage)
  @ApiOperation({ summary: 'Vider le panier.' })
  clear(@CurrentUser() user: AuthenticatedUser) {
    return this.cart.clear(user.id);
  }

  @Post('preview')
  @RequirePermission(Permission.CartManage)
  @ApiOperation({
    summary: 'Prévisualiser la commande : produits, frais de livraison, coupon, total.',
    description:
      'Lecture seule — ne crée aucune commande, ne touche aucun stock. Relit ' +
      'prix et disponibilité actuels de chaque produit, jamais l’instantané du ' +
      'panier. `POST /orders` reste la seule source de vérité transactionnelle.',
  })
  preview(@CurrentUser() user: AuthenticatedUser, @Body() dto: PreviewCartDto) {
    return this.cart.preview(user.id, dto.delivery, dto.couponCode);
  }
}
