import { Body, Controller, Get, Param, Patch, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators';
import { Permission } from '../../common/rbac/permissions';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AppError } from '../../common/http/app-error';
import { OrdersService } from './orders.service';
import { CreateOrderDto, UpdateOrderStatusDto } from './dto/create-order.dto';
import type { OrderStatus } from './schemas/order.schema';

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
    const page = await this.orders.listForUser(user.id, 1);
    const order = page.items.find((o) => String((o as { _id: unknown })._id) === id);
    if (!order) throw AppError.notFound('Commande');
    return order;
  }

  // --- Espace commerçant : la portée est nommée par `:shopId` (§3.2) ---

  @Get('shop/:shopId/orders')
  @RequirePermission(Permission.OrderReadShop, 'shopId')
  @ApiOperation({ summary: 'Commandes reçues par la boutique.' })
  listForShop(
    @Param('shopId') shopId: string,
    @Query() query: PaginationQueryDto,
    @Query('status') status?: OrderStatus,
  ) {
    return this.orders.listForShop(shopId, query.limit, status, query.cursor);
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
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.updateStatus(id, dto.status, user.id, dto.note);
  }
}
