import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/auth.decorators';
import { Permission } from '../../common/rbac/permissions';
import { CreatePromotionDto, UpdatePromotionDto } from './dto/promotion.dto';
import { CampaignsService } from './campaigns.service';

@Controller()
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}
  @Get('shop/:shopId/promotions') @RequirePermission(Permission.CampaignRead, 'shopId') list(@Param('shopId') id: string) { return this.campaigns.list(id); }
  @Post('shop/:shopId/promotions') @RequirePermission(Permission.CampaignCreate, 'shopId') create(@Param('shopId') id: string, @Body() dto: CreatePromotionDto) { return this.campaigns.create(id, dto); }
  @Patch('shop/:shopId/promotions/:promotionId') @RequirePermission(Permission.CampaignUpdate, 'shopId') update(@Param('shopId') shopId: string, @Param('promotionId') id: string, @Body() dto: UpdatePromotionDto) { return this.campaigns.update(shopId, id, dto); }
  @Delete('shop/:shopId/promotions/:promotionId') @RequirePermission(Permission.CampaignDelete, 'shopId') remove(@Param('shopId') shopId: string, @Param('promotionId') id: string) { return this.campaigns.remove(shopId, id); }
}
