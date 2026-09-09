import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

const ROLE_TYPES = ['client', 'merchant'] as const;
const DOCUMENT_TYPES = ['cin', 'passeport', 'permis_conduire', 'registre_commerce', 'autre'] as const;

/**
 * Le fichier a déjà été téléversé vers le stockage objet via
 * `POST /media/upload-url` (§ décision « aucun fichier ne transite par le
 * serveur applicatif »). Ce DTO ne porte que la référence au fichier, jamais
 * son contenu.
 */
export class SubmitKycDocumentDto {
  @ApiProperty({ enum: ROLE_TYPES })
  @IsIn(ROLE_TYPES)
  roleType!: (typeof ROLE_TYPES)[number];

  @ApiProperty({ enum: DOCUMENT_TYPES })
  @IsIn(DOCUMENT_TYPES)
  documentType!: (typeof DOCUMENT_TYPES)[number];

  @ApiProperty({ description: 'Clé retournée par `POST /media/upload-url`.' })
  @IsString()
  @MaxLength(255)
  filePath!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(255)
  originalName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  mimeType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  fileSize?: number;
}

const REVIEW_STATUSES = ['approved', 'rejected'] as const;

export class ReviewKycDocumentDto {
  @ApiProperty({ enum: REVIEW_STATUSES })
  @IsIn(REVIEW_STATUSES)
  status!: (typeof REVIEW_STATUSES)[number];

  @ApiPropertyOptional({ description: 'Obligatoire si `status` vaut `rejected`.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  rejectionReason?: string;
}
