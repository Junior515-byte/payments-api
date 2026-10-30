import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { currency, type Currency } from '../../db/schema';

export const GATEWAY_EVENT_TYPES = [
  'payment.approved',
  'payment.rejected',
  'refund.succeeded',
  'refund.failed',
] as const;
export type GatewayEventType = (typeof GATEWAY_EVENT_TYPES)[number];

export class GatewayWebhookDataDto {
  @ApiProperty({ description: 'Nuestro id de pago, enviado a la pasarela al crear el checkout' })
  @IsUUID()
  shopProcessId: string;

  @ApiProperty() @IsInt() @Min(1) amount: number;
  @ApiProperty({ enum: currency.enumValues }) @IsIn(currency.enumValues) currency: Currency;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class GatewayWebhookDto {
  @ApiProperty({ example: 'evt_01J9...' }) @IsString() @MaxLength(100) id: string;
  @ApiProperty({ enum: GATEWAY_EVENT_TYPES }) @IsIn(GATEWAY_EVENT_TYPES) type: GatewayEventType;
  @ApiProperty() @IsISO8601() createdAt: string;

  @ApiProperty({ type: GatewayWebhookDataDto })
  @ValidateNested()
  @Type(() => GatewayWebhookDataDto)
  data: GatewayWebhookDataDto;
}
