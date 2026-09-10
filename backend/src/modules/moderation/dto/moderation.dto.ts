import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsNumberString, IsOptional, IsString, Min, MaxLength } from 'class-validator';

import { REPORT_ACTIONS, REPORT_REASON_CODES, type ReportAction, type ReportReasonCode } from '../schemas/report.schema';
import { SANCTION_TYPES, type SanctionType } from '../schemas/sanction.schema';

/** Corps partagé par toutes les routes `.../:id/report` — même motif que `ReportPostDto`/`ReportConversationDto`. */
export class ReportDto {
  @ApiProperty({ required: false, maxLength: 500 })
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;

  @ApiProperty({ enum: REPORT_REASON_CODES, required: false })
  @IsOptional() @IsIn(REPORT_REASON_CODES)
  reasonCode?: ReportReasonCode;
}

export class ResolveReportDto {
  @ApiProperty({ enum: ['dismissed', 'actioned'] })
  @IsIn(['dismissed', 'actioned'])
  status!: 'dismissed' | 'actioned';

  @ApiProperty({ enum: REPORT_ACTIONS, required: false })
  @IsOptional() @IsIn(REPORT_ACTIONS)
  action?: ReportAction;

  @ApiProperty({ required: false, maxLength: 2000 })
  @IsOptional() @IsString() @MaxLength(2000)
  resolution?: string;

  /** Requis quand `action` vaut `warning`, `suspension` ou `ban` — le signalement porte sur un contenu, pas forcément sur un compte. */
  @ApiProperty({ required: false, description: 'Identifiant numérique MySQL.' })
  @IsOptional() @IsNumberString()
  sanctionUserId?: string;

  /** Uniquement pour `action: 'suspension'` — absent, la sanction est définitive. */
  @ApiProperty({ required: false })
  @IsOptional() @IsInt() @Min(1)
  suspensionDays?: number;
}

export class IssueSanctionDto {
  @ApiProperty({ description: 'Identifiant numérique MySQL.' }) @IsNumberString() userId!: string;
  @ApiProperty({ enum: SANCTION_TYPES }) @IsIn(SANCTION_TYPES) type!: SanctionType;
  @ApiProperty({ maxLength: 500 }) @IsString() @MaxLength(500) reason!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() expiresAt?: string;
}

export class CreateBannedWordDto {
  @ApiProperty({ maxLength: 100 }) @IsString() @MaxLength(100) word!: string;
}
