import { Injectable } from '@nestjs/common';

import { AppError } from '../../common/http/app-error';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { ReviewKycDocumentDto, SubmitKycDocumentDto } from './dto/kyc.dto';

@Injectable()
export class KycService {
  constructor(private readonly prisma: PrismaService) {}

  async submit(user: AuthenticatedUser, dto: SubmitKycDocumentDto): Promise<unknown> {
    const userId = await this.prisma.resolveUserId(user.phone);
    return this.prisma.kyc_documents.create({
      data: {
        user_id: userId,
        role_type: dto.roleType,
        document_type: dto.documentType,
        file_path: dto.filePath,
        original_name: dto.originalName,
        mime_type: dto.mimeType,
        file_size: dto.fileSize,
        status: 'pending',
      },
    });
  }

  async listOwn(user: AuthenticatedUser): Promise<unknown[]> {
    const userId = await this.prisma.resolveUserId(user.phone);
    return this.prisma.kyc_documents.findMany({
      where: { user_id: userId },
      orderBy: { uploaded_at: 'desc' },
    });
  }

  /** Réservé à la modération plateforme (`Permission.KycReview`). */
  async listPending(): Promise<unknown[]> {
    return this.prisma.kyc_documents.findMany({
      where: { status: 'pending' },
      orderBy: { uploaded_at: 'asc' },
      include: { users: { select: { id: true, firstname: true, lastname: true, phone: true } } },
    });
  }

  async review(reviewer: AuthenticatedUser, documentId: number, dto: ReviewKycDocumentDto): Promise<unknown> {
    if (dto.status === 'rejected' && !dto.rejectionReason) {
      throw new AppError(
        'REJECTION_REASON_REQUIRED',
        'Un motif est obligatoire pour rejeter un document.',
        400,
      );
    }
    const document = await this.prisma.kyc_documents.findUnique({ where: { id: documentId } });
    if (!document) throw AppError.notFound('Document KYC');

    const reviewerId = await this.prisma.resolveUserId(reviewer.phone);
    return this.prisma.kyc_documents.update({
      where: { id: documentId },
      data: {
        status: dto.status,
        rejection_reason: dto.status === 'rejected' ? dto.rejectionReason : null,
        reviewed_at: new Date(),
        reviewed_by: reviewerId,
      },
    });
  }
}
