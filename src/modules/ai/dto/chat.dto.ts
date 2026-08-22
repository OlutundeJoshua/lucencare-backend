import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum ChatRole {
  USER = 'user',
  ASSISTANT = 'assistant',
}

export class ChatMessageDto {
  // Only user and assistant. Accepting `system` here would let a caller replace
  // the clinical-safety instructions the service prepends server-side.
  @ApiProperty({ enum: ChatRole })
  @IsEnum(ChatRole)
  role: ChatRole;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content: string;
}

export class ChatDto {
  @ApiProperty({ type: [ChatMessageDto], description: 'Conversation so far, oldest first' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages: ChatMessageDto[];
}
