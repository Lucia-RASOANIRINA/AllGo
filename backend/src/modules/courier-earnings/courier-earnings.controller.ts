import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { CourierEarningsService } from './courier-earnings.service';

@Controller('courier/earnings')
export class CourierEarningsController {
  constructor(private readonly earnings: CourierEarningsService) {}

  @Get()
  @RequirePermission(Permission.CourierEarningsRead)
  summary(@CurrentUser() user: AuthenticatedUser) { return this.earnings.summary(user.mysqlId); }

  @Get('history')
  @RequirePermission(Permission.CourierEarningsRead)
  history(@CurrentUser() user: AuthenticatedUser) { return this.earnings.history(user.mysqlId); }

  @Get('withdrawals')
  @RequirePermission(Permission.CourierEarningsRead)
  withdrawals(@CurrentUser() user: AuthenticatedUser) { return this.earnings.withdrawalsList(user.mysqlId); }

  @Post('withdrawals')
  @RequirePermission(Permission.CourierEarningsRead)
  request(@CurrentUser() user: AuthenticatedUser, @Body() body: { amount: number; method: string; account: string }) {
    return this.earnings.requestWithdrawal(user.mysqlId, body.amount, body.method, body.account);
  }
}
