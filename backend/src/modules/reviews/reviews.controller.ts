import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNumberString } from 'class-validator';
import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { CreateReviewDto, ReportReviewDto, UpdateReviewDto } from './dto/review.dto';
import { ReviewsService } from './reviews.service';
import { REVIEW_TARGETS, type ReviewTarget } from './schemas/review.schema';

/**
 * `@Query() query: PaginationQueryDto` valide toute la requête brute contre
 * cette classe (`whitelist`/`forbidNonWhitelisted` globaux) : un `targetType`/
 * `targetId` lu à côté via `@Query('...')` séparé, sans être déclaré ici,
 * n'était jamais rejeté par la validation (aucun DTO ne les couvrait), mais
 * `limit` restait alors une chaîne brute jamais convertie ni bornée — Mongoose
 * tolérait un `.limit(NaN)` silencieusement, Prisma refuse un `take` invalide
 * (§ constaté en exécution, même motif que `ShopQueryDto`).
 */
export class ReviewsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: REVIEW_TARGETS }) @IsIn(REVIEW_TARGETS) targetType!: ReviewTarget;
  @ApiPropertyOptional({ description: 'Identifiant numérique MySQL de la cible.' }) @IsNumberString() targetId!: string;
}

@ApiTags('Avis')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}
  @Get() @RequirePermission(Permission.ReviewRead)
  list(@Query() query: ReviewsQueryDto) {
    return this.reviews.list(query.targetType, query.targetId, query.limit);
  }
  @Post() @RequirePermission(Permission.ReviewCreate)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReviewDto & { orderId: string }) {
    return this.reviews.create(user, dto);
  }
  @Patch(':id') @RequirePermission(Permission.ReviewUpdate)
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateReviewDto) {
    return this.reviews.update(user.mysqlId, id, dto);
  }
  @Delete(':id') @RequirePermission(Permission.ReviewDelete)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.reviews.remove(user.mysqlId, id);
  }
  @Post(':id/report') @RequirePermission(Permission.ReviewReport)
  report(@Param('id') id: string, @Body() dto: ReportReviewDto) {
    return this.reviews.report(id, dto.reason);
  }
}
