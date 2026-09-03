import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { CreateRefundDto, RequestWithdrawalDto, ResolveWithdrawalDto } from './dto/finance.dto';
import { FinanceService } from './finance.service';
import type { TransactionStatus, TransactionType } from './schemas/transaction.schema';

@ApiTags('Finance')
@Controller('finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  // --- Commerçant : solde et retraits ---------------------------------------

  @Get('merchant/balance')
  @RequirePermission(Permission.ShopDashboard, 'shopId')
  merchantBalance(@Query('shopId') shopId: string) {
    return this.finance.merchantBalance(shopId);
  }

  @Post('merchant/withdrawals')
  @RequirePermission(Permission.WithdrawalRequest, 'shopId')
  requestMerchantWithdrawal(@CurrentUser() user: AuthenticatedUser, @Body() dto: RequestWithdrawalDto) {
    return this.finance.requestMerchantWithdrawal(dto.shopId, user.id, dto.amount, dto.method, dto.account);
  }

  @Get('merchant/withdrawals')
  @RequirePermission(Permission.ShopDashboard, 'shopId')
  merchantWithdrawals(@Query('shopId') shopId: string) {
    return this.finance.listMerchantWithdrawals(shopId);
  }

  // --- Administration : vue d'ensemble ---------------------------------------

  @Get('transactions')
  @RequirePermission(Permission.PlatformModerate)
  transactions(@Query('type') type?: TransactionType, @Query('status') status?: TransactionStatus) {
    return this.finance.listTransactions(type, status);
  }

  @Get('payments')
  @RequirePermission(Permission.PlatformModerate)
  payments(@Query('status') status?: string, @Query('method') method?: string) {
    return this.finance.listPayments(status, method);
  }

  @Get('commissions')
  @RequirePermission(Permission.PlatformModerate)
  commissions(@Query('days') days?: string) {
    return this.finance.commissionsSummary(days ? Number(days) : undefined);
  }

  @Get('revenue')
  @RequirePermission(Permission.PlatformModerate)
  revenue(@Query('days') days?: string) {
    return this.finance.revenueSummary(days ? Number(days) : undefined);
  }

  @Get('delivery-fees')
  @RequirePermission(Permission.PlatformModerate)
  deliveryFees(@Query('days') days?: string) {
    return this.finance.deliveryFeesSummary(days ? Number(days) : undefined);
  }

  @Get('refunds')
  @RequirePermission(Permission.PlatformModerate)
  refunds(@Query('status') status?: string) {
    return this.finance.refundsList(status);
  }

  @Post('refunds')
  @RequirePermission(Permission.PlatformModerate)
  createRefund(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateRefundDto) {
    return this.finance.createRefund(dto.orderId, dto.amount, dto.reason, user.id);
  }

  @Get('invoices')
  @RequirePermission(Permission.PlatformModerate)
  invoices(@Query('shopId') shopId?: string) {
    return this.finance.invoicesList(shopId);
  }

  @Post('invoices/:orderId')
  @RequirePermission(Permission.PlatformModerate)
  generateInvoice(@CurrentUser() user: AuthenticatedUser, @Param('orderId') orderId: string) {
    return this.finance.generateInvoice(orderId, user.id);
  }

  @Get('withdrawals/merchants')
  @RequirePermission(Permission.PlatformModerate)
  allMerchantWithdrawals(@Query('status') status?: string) {
    return this.finance.listMerchantWithdrawals(undefined, status);
  }

  @Patch('withdrawals/merchants/:id')
  @RequirePermission(Permission.PlatformModerate)
  resolveMerchantWithdrawal(@Param('id') id: string, @Body() dto: ResolveWithdrawalDto) {
    return this.finance.resolveMerchantWithdrawal(id, dto.status);
  }

  @Get('withdrawals/couriers')
  @RequirePermission(Permission.PlatformModerate)
  courierWithdrawals(@Query('status') status?: string) {
    return this.finance.listCourierWithdrawals(status);
  }

  @Patch('withdrawals/couriers/:id')
  @RequirePermission(Permission.PlatformModerate)
  resolveCourierWithdrawal(@Param('id') id: string, @Body() dto: ResolveWithdrawalDto) {
    return this.finance.resolveCourierWithdrawal(id, dto.status);
  }

  @Get('reports')
  @RequirePermission(Permission.PlatformModerate)
  report(@Query('from') from?: string, @Query('to') to?: string) {
    return this.finance.financialReport(from, to);
  }
}
