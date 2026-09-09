import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AdministrationService } from './administration.service';

@Controller('admin')
export class AdministrationController {
  constructor(private readonly administration: AdministrationService) {}

  @Get('users') @RequirePermission(Permission.PlatformModerate) users(@Query('status') status?: string) { return this.administration.usersList(status); }
  @Patch('users/:id') @RequirePermission(Permission.PlatformModerate) user(@CurrentUser() admin: AuthenticatedUser, @Param('id') id: string, @Body() body: { status?: 'active' | 'suspended' | 'pending'; roles?: unknown[] }) { return this.administration.updateUser(id, body, admin); }
  @Patch('users/:id/delete') @RequirePermission(Permission.PlatformModerate) deleteUser(@CurrentUser() admin: AuthenticatedUser, @Param('id') id: string) { return this.administration.removeUser(id, admin); }
  @Get('shops') @RequirePermission(Permission.PlatformModerate) shops(@Query('status') status?: string) { return this.administration.shopsList(status); }
  @Patch('shops/:id/status') @RequirePermission(Permission.PlatformModerate) shop(@CurrentUser() admin: AuthenticatedUser, @Param('id') id: string, @Body('status') status: 'pending' | 'approved' | 'rejected' | 'suspended') { return this.administration.updateShop(id, status, admin); }
  @Get('products') @RequirePermission(Permission.PlatformModerate) products(@Query('status') status?: string) { return this.administration.productsList(status); }
  @Patch('products/:id/moderation') @RequirePermission(Permission.PlatformModerate) product(@CurrentUser() admin: AuthenticatedUser, @Param('id') id: string, @Body() body: { status: 'draft' | 'published' | 'archived'; isHidden?: boolean }) { return this.administration.moderateProduct(id, body.status, body.isHidden, admin); }
  @Patch('products/:id/delete') @RequirePermission(Permission.PlatformModerate) deleteProduct(@CurrentUser() admin: AuthenticatedUser, @Param('id') id: string) { return this.administration.removeProduct(id, admin); }
  @Get('reported-products') @RequirePermission(Permission.PlatformModerate) reportedProducts() { return this.administration.reportedProducts(); }
  @Get('orders') @RequirePermission(Permission.PlatformModerate) orders(@Query('status') status?: string) { return this.administration.ordersList(status); }
  @Patch('orders/:id/refund') @RequirePermission(Permission.PlatformModerate) refund(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.administration.refundOrder(id, user); }

  @Get('dashboard') @RequirePermission(Permission.PlatformModerate) dashboard(@Query('days') days?: string) { return this.administration.dashboard(days ? Number(days) : undefined); }

  @Get('disputes') @RequirePermission(Permission.PlatformModerate) disputes(@Query('status') status?: string) { return this.administration.disputesList(status); }
  @Patch('disputes/:id')
  @RequirePermission(Permission.PlatformModerate)
  resolveDispute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { status: 'resolved' | 'rejected'; resolution?: string },
  ) {
    return this.administration.resolveDispute(id, body.status, body.resolution, user);
  }

  @Post('couriers/:courierId/bonuses')
  @RequirePermission(Permission.PlatformModerate)
  grantBonus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('courierId') courierId: string,
    @Body() body: { amount: number; reason: string },
  ) {
    return this.administration.grantCourierBonus(courierId, body.amount, body.reason, user);
  }
}
