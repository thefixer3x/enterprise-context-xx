/**
 * Environment Configuration
 * Simplified config validation for enterprise-mcp
 */

import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

export interface AppConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  LOG_LEVEL: 'error' | 'warn' | 'info' | 'debug';
  LOG_FORMAT: 'json' | 'simple';

  // API Configuration
  LANONASIS_API_URL: string;
  SUPABASE_FUNCTIONS_URL: string;
  LANONASIS_API_KEY?: string;
  LANONASIS_BEARER_TOKEN?: string;

  // Reliability Configuration
  REQUEST_TIMEOUT_MS: number;
  MAX_RETRIES: number;
  RETRY_BASE_DELAY_MS: number;

  // Warmup
  WARMUP_INTERVAL_MS: number;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) return defaultValue;
  return parsed;
}

export const config: AppConfig = {
  NODE_ENV: (process.env.NODE_ENV as AppConfig['NODE_ENV']) || 'development',
  PORT: getEnvNumber('PORT', 3010),
  LOG_LEVEL: (process.env.LOG_LEVEL as AppConfig['LOG_LEVEL']) || 'info',
  LOG_FORMAT: (process.env.LOG_FORMAT as AppConfig['LOG_FORMAT']) || 'json',

  // API Configuration
  LANONASIS_API_URL: process.env.LANONASIS_API_URL || 'https://api.lanonasis.com/api/v1',
  SUPABASE_FUNCTIONS_URL: process.env.SUPABASE_FUNCTIONS_URL || 'https://lanonasis.supabase.co/functions/v1',
  LANONASIS_API_KEY: process.env.LANONASIS_API_KEY,
  LANONASIS_BEARER_TOKEN: process.env.LANONASIS_BEARER_TOKEN,

  // Reliability Configuration
  REQUEST_TIMEOUT_MS: getEnvNumber('REQUEST_TIMEOUT_MS', 30000),
  MAX_RETRIES: getEnvNumber('MAX_RETRIES', 3),
  RETRY_BASE_DELAY_MS: getEnvNumber('RETRY_BASE_DELAY_MS', 1000),

  // Warmup
  WARMUP_INTERVAL_MS: getEnvNumber('WARMUP_INTERVAL_MS', 300000),
};

export const isDevelopment = config.NODE_ENV === 'development';
export const isProduction = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';

/**
 * Validate required environment variables at startup
 */
export function validateEnvironment(): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  if (!config.LANONASIS_API_KEY && !config.LANONASIS_BEARER_TOKEN) {
    warnings.push('No authentication configured (LANONASIS_API_KEY or LANONASIS_BEARER_TOKEN)');
  }

  return { valid: true, warnings };
}
