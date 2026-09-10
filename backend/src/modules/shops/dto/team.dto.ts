import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

export const SHOP_TEAM_ROLES = [
  'shop_manager',
  'shop_sales',
  'shop_cashier',
  'shop_stock',
  'shop_courier',
  'shop_marketing',
] as const;

export class AddTeamMemberDto {
  @ApiProperty({ description: 'Numéro de téléphone du compte à ajouter.' })
  @IsString()
  phone!: string;

  @ApiProperty({ enum: SHOP_TEAM_ROLES })
  @IsIn(SHOP_TEAM_ROLES)
  role!: (typeof SHOP_TEAM_ROLES)[number];
}

export class UpdateTeamMemberDto {
  @ApiProperty({ enum: SHOP_TEAM_ROLES })
  @IsIn(SHOP_TEAM_ROLES)
  role!: (typeof SHOP_TEAM_ROLES)[number];
}
