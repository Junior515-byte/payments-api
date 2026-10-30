import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IdempotencyInterceptor } from '../idempotency/idempotency.interceptor';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { PaymentsService } from './payments.service';

const IdempotencyHeader = ApiHeader({
  name: 'Idempotency-Key',
  required: true,
  description:
    'UUID generado por el cliente. Reintentar con la misma clave nunca duplica el efecto.',
});

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  @IdempotencyHeader
  @ApiOperation({ summary: 'Crear un pago y obtener la URL de checkout' })
  @ApiResponse({
    status: 201,
    description: 'Pago creado (o respuesta original si es un reintento)',
  })
  @ApiResponse({
    status: 409,
    description: 'Request en curso con la misma clave / orden con otro monto',
  })
  @ApiResponse({ status: 422, description: 'Idempotency-Key reutilizada con otro body' })
  @ApiResponse({ status: 502, description: 'Pasarela caída: reintentar con la misma clave' })
  create(@Body() dto: CreatePaymentDto) {
    return this.payments.create(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consultar un pago con su historial de estados' })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.payments.findById(id);
  }

  @Post(':id/refund')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(IdempotencyInterceptor)
  @IdempotencyHeader
  @ApiOperation({ summary: 'Solicitar reembolso total (se confirma vía webhook)' })
  @ApiResponse({ status: 202, description: 'Reembolso solicitado: estado REFUND_PENDING' })
  @ApiResponse({ status: 409, description: 'El pago no está en un estado reembolsable' })
  refund(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: RefundPaymentDto) {
    return this.payments.refund(id, dto);
  }
}
