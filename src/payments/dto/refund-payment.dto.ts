import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RefundPaymentDto {
  @ApiPropertyOptional({ example: 'Cliente desistió de la compra' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
