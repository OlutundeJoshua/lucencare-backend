import * as path from 'path';
import { DataSourceOptions } from 'typeorm';

export function buildDatabaseOptions(): DataSourceOptions {
  const src = path.resolve(__dirname, '..');

  return {
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'lucencare',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    synchronize:
      process.env.NODE_ENV !== 'production' && process.env.DB_SYNC !== 'false',
    logging: process.env.NODE_ENV === 'development',
    entities: [path.join(src, '**/*.entity{.ts,.js}')],
    migrations: [path.join(src, 'database/migrations/*{.ts,.js}')],
    subscribers: [path.join(src, 'common/subscribers/*{.ts,.js}')],
  };
}
