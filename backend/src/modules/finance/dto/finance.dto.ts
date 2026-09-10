import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsNumber, IsNumberString, IsOptional, IsPositive, IsString, MaxLength, Min } from 'class-validator';

export class RequestWithdrawalDto {
  @ApiProperty({ description: 'Identifiant numérique MySQL de la boutique.' }) @IsNumberString() shopId!: string;
  @ApiProperty() @IsNumber() @IsPositive() amount!: number;
  @ApiProperty() @IsString() method!: string;
  @ApiProperty() @IsString() account!: string;
}

export class ResolveWithdrawalDto {
  @ApiProperty({ enum: ['paid', 'rejected'] })
  @IsIn(['paid', 'rejected'])
  status!: 'paid' | 'rejected';
}

export class CreateRefundDto {
  @ApiProperty({ description: 'Identifiant numérique MySQL de la commande.' }) @IsNumberString() orderId!: string;
  @ApiProperty({ required: false, description: 'Montant partiel — le total de la commande par défaut.' })
  @IsOptional() @IsNumber() @IsPositive()
  amount?: number;
  @ApiProperty({ maxLength: 500 }) @IsString() @MaxLength(500) reason!: string;
}

export class ReportRangeDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() from?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() to?: string;
}

export class DashboardQueryDto {
  @ApiProperty({ required: false, minimum: 1, maximum: 90, default: 30 })
  @IsOptional() @IsInt() @Min(1)
  days?: number;
}
