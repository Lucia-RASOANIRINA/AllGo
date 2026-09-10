import { Module } from '@nestjs/common';

import { MediaModule } from '../media/media.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [MediaModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
