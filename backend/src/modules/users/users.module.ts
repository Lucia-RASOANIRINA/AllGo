import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/** 100 % MySQL depuis la Phase 6 — plus de miroir Mongo `User`. */
@Module({
  imports: [MediaModule, AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
