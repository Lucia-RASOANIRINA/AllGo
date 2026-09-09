import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class UpdateSettingDto {
  @ApiProperty()
  @IsString()
  @MaxLength(65_000)
  value!: string;
}
