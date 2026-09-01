import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min } from 'class-validator';
import { REVIEW_TARGETS, type ReviewTarget } from '../schemas/review.schema';

export class CreateReviewDto {
  @ApiProperty() @IsString() orderId!: string;
  @ApiProperty({ enum: REVIEW_TARGETS }) @IsIn(REVIEW_TARGETS) targetType!: ReviewTarget;
  @ApiProperty() @IsString() targetId!: string;
  @ApiProperty({ minimum: 1, maximum: 5 }) @IsInt() @Min(1) @Max(5) rating!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) comment?: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @IsUrl({}, { each: true }) photos?: string[];
}

export class UpdateReviewDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional() @IsInt() @Min(1) @Max(5) rating?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) comment?: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @IsUrl({}, { each: true }) photos?: string[];
}

export class ReportReviewDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
