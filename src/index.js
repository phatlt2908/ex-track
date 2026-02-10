import './config/env.js';
import { startBot } from './bot/telegram.js';
import { logger } from './utils/logger.js';

logger.info('Starting ex-track bot...');
startBot();
