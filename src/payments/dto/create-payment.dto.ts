import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { currency, type Currency } from '../../db/schema';

export class CreatePaymentDto {
  @ApiProperty({
    example: 'ORD-2026-000123',
    description: 'ID de la orden en el sistema del comercio (único)',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  merchantOrderId: string;

  @ApiProperty({
    example: 150000,
    description: 'Monto en unidades mínimas (PYG sin decimales, USD en centavos)',
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amount: number;

  @ApiProperty({ enum: currency.enumValues, example: 'PYG' })
  @IsIn(currency.enumValues)
  currency: Currency;

  @ApiPropertyOptional({ example: 'Suscripción mensual Plan Pro' })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  description?: string;
}
