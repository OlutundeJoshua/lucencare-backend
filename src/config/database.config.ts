import { registerAs } from '@nestjs/config';
import { buildDatabaseOptions } from './database-options';

export default registerAs('database', () => buildDatabaseOptions());
