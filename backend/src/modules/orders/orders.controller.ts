import { Body, Controller, Get, Param, Patch, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators';
import { Permission } from '../../common/rbac/permissions';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { OrdersService } from './orders.service';
import { CreateOrderDto, UpdateOrderStatusDto } from './dto/create-order.dto';
import { ORDER_STATUSES, type OrderStatus } from './schemas/order.schema';

export class RaiseDisputeDto {
  @ApiProperty({ minLength: 10, maxLength: 2000 })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;
}

/**
 * `@Query() query: PaginationQueryDto` valide toute la requête brute contre
 * cette classe (`whitelist`/`forbidNonWhitelisted` globaux) : `status` et `q`
 * lus à côté via `@Query('x')` sans être déclarés ici seraient rejetés avec
 * `VALIDATION_FAILED` — voir `ShopQueryDto` pour le même constat sur `/shops`.
 */
export class ShopOrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ORDER_STATUSES })
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: OrderStatus;

  @ApiPropertyOptional({ description: 'Numéro de commande ou téléphone du client.' })
  @IsOptional()
  @IsString()
  q?: string;
}

@ApiTags('Commandes')
@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post('orders')
  @RequirePermission(Permission.OrderCreate)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Clé générée par le client. Garantit qu’une commande rejouée après une ' +
      'coupure réseau ne crée jamais de doublon (§9.3).',
  })
  @ApiOperation({
    summary: 'Passer commande.',
    description:
      'Transactionnel : une commande par boutique, décrément conditionnel du ' +
      'stock, écriture des mouvements, vidage du panier — tout ou rien.',
  })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateOrderDto) {
    return this.orders.create(user.id, dto, {
      name: user.phone,
      phone: user.phone,
    });
  }

  @Get('orders')
  @RequirePermission(Permission.OrderReadOwn)
  @ApiOperation({ summary: 'Lister mes commandes, de la plus récente à la plus ancienne.' })
  listMine(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) {
    return this.orders.listForUser(user.id, query.limit, query.cursor);
  }

  @Get('orders/:id')
  @RequirePermission(Permission.OrderReadOwn)
  @ApiOperation({ summary: 'Consulter une commande.' })
  async findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.orders.findForUser(user.id, id);
  }

  @Patch('orders/:id/cancel')
  @RequirePermission(Permission.OrderCancel)
  @ApiOperation({ summary: 'Annuler une commande non payée.' })
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.orders.cancelForUser(id, user.id);
  }

  @Post('orders/:id/dispute')
  @RequirePermission(Permission.OrderDispute)
  @ApiOperation({ summary: 'Ouvrir un litige sur une commande, traité par la modération.' })
  dispute(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: RaiseDisputeDto) {
    return this.orders.raiseDispute(id, user.id, dto.reason);
  }

  // --- Espace commerçant : la portée est nommée par `:shopId` (§3.2) ---

  @Get('shop/:shopId/orders')
  @RequirePermission(Permission.OrderReadShop, 'shopId')
  @ApiOperation({ summary: 'Commandes reçues par la boutique.' })
  listForShop(@Param('shopId') shopId: string, @Query() query: ShopOrdersQueryDto) {
    return this.orders.listForShop(shopId, query.limit, query.status, query.cursor, query.q);
  }

  @Patch('shop/:shopId/orders/:id/status')
  @RequirePermission(Permission.OrderUpdateStatus, 'shopId')
  @ApiOperation({
    summary: 'Faire avancer une commande.',
    description:
      'Les transitions sont contraintes : pending → confirmed → preparing → ' +
      'shipped → delivered. Toute autre transition est refusée.',
  })
  updateStatus(
    @Param('id') id: string,
    @Param('shopId') shopId: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.updateStatus(id, shopId, dto.status, user.id, dto.note);
  }

  @Patch('shop/:shopId/orders/:id/cancel')
  @RequirePermission(Permission.OrderCancel, 'shopId')
  cancelForShop(@Param('shopId') shopId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.orders.cancelForShop(id, shopId, user.id);
  }

  @Get('courier/missions')
  @RequirePermission(Permission.DeliveryReadOwn)
  missions(@CurrentUser() user: AuthenticatedUser) { return this.orders.courierMissions(user.id); }

  @Patch('courier/missions/:id/accept')
  @RequirePermission(Permission.DeliveryUpdate)
  acceptMission(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.orders.acceptMission(id, user.id); }

  @Patch('courier/missions/:id/refuse')
  @RequirePermission(Permission.DeliveryUpdate)
  refuseMission(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.orders.refuseMission(id, user.id); }

  @Patch('courier/missions/:id/workflow')
  @RequirePermission(Permission.DeliveryUpdate)
  workflow(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body('status') status: string) { return this.orders.updateCourierWorkflow(id, user.id, status); }

  @Post('courier/missions/:id/complete')
  @RequirePermission(Permission.DeliveryProof)
  complete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: { otp: string; photoUrl?: string }) { return this.orders.completeDelivery(id, user.id, body.otp, body.photoUrl); }
}
