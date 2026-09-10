import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [MediaModule],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
