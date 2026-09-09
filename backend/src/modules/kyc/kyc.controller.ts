import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ReviewKycDocumentDto, SubmitKycDocumentDto } from './dto/kyc.dto';
import { KycService } from './kyc.service';

@ApiTags('Vérification d’identité')
@Controller('kyc-documents')
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @Post()
  @RequirePermission(Permission.KycSubmit)
  @ApiOperation({ summary: 'Soumettre un document d’identité pour vérification.' })
  submit(@CurrentUser() user: AuthenticatedUser, @Body() dto: SubmitKycDocumentDto) {
    return this.kyc.submit(user, dto);
  }

  @Get('mine')
  @RequirePermission(Permission.KycSubmit)
  @ApiOperation({ summary: 'Mes documents soumis et leur statut.' })
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.kyc.listOwn(user);
  }

  @Get('pending')
  @RequirePermission(Permission.KycReview)
  @ApiOperation({ summary: 'Documents en attente de vérification — modération plateforme.' })
  pending() {
    return this.kyc.listPending();
  }

  @Patch(':id')
  @RequirePermission(Permission.KycReview)
  @ApiOperation({ summary: 'Approuver ou rejeter un document — modération plateforme.' })
  review(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewKycDocumentDto,
  ) {
    return this.kyc.review(user, id, dto);
  }
}
