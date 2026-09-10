import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { CreateReviewDto, ReportReviewDto, UpdateReviewDto } from './dto/review.dto';
import { ReviewsService } from './reviews.service';

@ApiTags('Avis')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}
  @Get() @RequirePermission(Permission.ReviewRead)
  list(@Query('targetType') targetType: 'product' | 'shop' | 'courier', @Query('targetId') targetId: string, @Query('limit') limit?: number) {
    return this.reviews.list(targetType, targetId, limit);
  }
  @Post() @RequirePermission(Permission.ReviewCreate)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReviewDto & { orderId: string }) {
    return this.reviews.create(user, dto);
  }
  @Patch(':id') @RequirePermission(Permission.ReviewUpdate)
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateReviewDto) {
    return this.reviews.update(user.id, id, dto);
  }
  @Delete(':id') @RequirePermission(Permission.ReviewDelete)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.reviews.remove(user.id, id);
  }
  @Post(':id/report') @RequirePermission(Permission.ReviewReport)
  report(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ReportReviewDto) {
    return this.reviews.report(user.id, id, dto.reason);
  }
}
