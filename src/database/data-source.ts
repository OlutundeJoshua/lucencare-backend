// Used by TypeORM CLI for migrations only — not loaded by the NestJS app

import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { buildDatabaseOptions } from '../config/database-options';

dotenv.config();

export const AppDataSource = new DataSource(buildDatabaseOptions());

export default AppDataSource;
