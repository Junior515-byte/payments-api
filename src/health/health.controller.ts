import { Controller, Get, HttpStatus, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { ApiError } from '../common/errors';
import { DATABASE, Database } from '../db/database';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  async check() {
    try {
      await this.db.execute(sql`select 1`);
      return { status: 'ok', database: 'up' };
    } catch {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'UNHEALTHY',
        'Base de datos no disponible',
      );
    }
  }
}
