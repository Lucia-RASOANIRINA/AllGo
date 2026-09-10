import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { GeoController } from './geo.controller';
import { GeoService } from './geo.service';

@Module({
  imports: [MediaModule],
  controllers: [GeoController],
  providers: [GeoService],
})
export class GeoModule {}
