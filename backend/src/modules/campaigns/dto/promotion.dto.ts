import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsMongoId, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreatePromotionDto {
  @ApiProperty() @IsString() name!: string;
  @ApiProperty({ enum: ['percent', 'fixed', 'price'] }) @IsIn(['percent', 'fixed', 'price']) type!: string;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) value!: number;
  @ApiProperty() @IsDateString() startsAt!: string;
  @ApiProperty() @IsDateString() endsAt!: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(1) quantityLimit?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() couponCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() flash?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() specialOffer?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() productId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}
export class UpdatePromotionDto extends PartialType(CreatePromotionDto) {}
