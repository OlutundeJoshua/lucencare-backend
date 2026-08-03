import { Logger as NestLogger } from '@nestjs/common';
import { Logger as TypeOrmLogger, QueryRunner } from 'typeorm';

const SLOW_QUERY_THRESHOLD_MS = 200;

// Never logs query parameters — TypeORM binds raw user/PII values there
// (passwordHash, phone, sharedDataSnapshot) and CLAUDE.md forbids logging those.
export class TypeOrmQueryLogger implements TypeOrmLogger {
  private readonly logger = new NestLogger('TypeORM');

  // TypeORM calls logQuery for every query unconditionally, regardless of the
  // `logging` DataSourceOptions value, once a custom logger instance is set —
  // so the off-by-default behavior has to be enforced here instead.
  logQuery(query: string, _parameters?: unknown[], _queryRunner?: QueryRunner): void {
    if (process.env.DB_LOG_QUERIES !== 'true') return;
    this.logger.debug(query);
  }

  logQueryError(
    error: string | Error,
    query: string,
    _parameters?: unknown[],
    _queryRunner?: QueryRunner,
  ): void {
    this.logger.error(`${query} — ${error instanceof Error ? error.message : error}`);
  }

  logQuerySlow(time: number, query: string, _parameters?: unknown[], _queryRunner?: QueryRunner): void {
    this.logger.warn(`Slow query (${time}ms, threshold ${SLOW_QUERY_THRESHOLD_MS}ms): ${query}`);
  }

  logSchemaBuild(message: string, _queryRunner?: QueryRunner): void {
    this.logger.log(message);
  }

  logMigration(message: string, _queryRunner?: QueryRunner): void {
    this.logger.log(message);
  }

  log(level: 'log' | 'info' | 'warn', message: unknown, _queryRunner?: QueryRunner): void {
    if (level === 'warn') {
      this.logger.warn(message);
    } else {
      this.logger.log(message);
    }
  }
}
