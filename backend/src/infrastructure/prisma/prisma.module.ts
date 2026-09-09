import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Global : chaque module qui touche une table MySQL réelle importe celui-ci une fois. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
