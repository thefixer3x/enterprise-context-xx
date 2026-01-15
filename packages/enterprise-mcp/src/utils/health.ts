/**
 * Health Check Utilities for Enterprise MCP
 * Comprehensive dependency health monitoring
 */

import { logger } from './logger.js';
import { config } from '../config/environment.js';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency?: number;
  error?: string;
  lastCheck?: string;
}

export interface DependencyHealth {
  api: HealthStatus;
  edgeFunctions: HealthStatus;
  overall: 'healthy' | 'degraded' | 'unhealthy';
}

/**
 * Check health of main API endpoint
 */
async function checkApiHealth(): Promise<HealthStatus> {
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${config.LANONASIS_API_URL}/health`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'X-API-Key': config.LANONASIS_API_KEY || '',
      }
    });

    clearTimeout(timeout);
    const latency = Date.now() - start;

    if (response.ok) {
      return { status: 'healthy', latency, lastCheck: new Date().toISOString() };
    }

    return {
      status: 'degraded',
      latency,
      error: `HTTP ${response.status}`,
      lastCheck: new Date().toISOString()
    };
  } catch (error) {
    const latency = Date.now() - start;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.warn('API health check failed', { error: errorMessage, latency });

    return {
      status: 'unhealthy',
      latency,
      error: errorMessage,
      lastCheck: new Date().toISOString()
    };
  }
}

/**
 * Check health of Edge Functions
 */
async function checkEdgeFunctionsHealth(): Promise<HealthStatus> {
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10 seconds for Edge Functions (cold start can be slow)

    // Edge Functions accept both X-API-Key and Authorization Bearer
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (config.LANONASIS_API_KEY) {
      headers['X-API-Key'] = config.LANONASIS_API_KEY;
    }
    if (config.LANONASIS_BEARER_TOKEN) {
      headers['Authorization'] = `Bearer ${config.LANONASIS_BEARER_TOKEN}`;
    }

    const response = await fetch(`${config.SUPABASE_FUNCTIONS_URL}/intelligence-health-check`, {
      method: 'GET',
      signal: controller.signal,
      headers,
    });

    clearTimeout(timeout);
    const latency = Date.now() - start;

    if (response.ok) {
      return { status: 'healthy', latency, lastCheck: new Date().toISOString() };
    }

    return {
      status: 'degraded',
      latency,
      error: `HTTP ${response.status}`,
      lastCheck: new Date().toISOString()
    };
  } catch (error) {
    const latency = Date.now() - start;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.warn('Edge Functions health check failed', { error: errorMessage, latency });

    return {
      status: 'unhealthy',
      latency,
      error: errorMessage,
      lastCheck: new Date().toISOString()
    };
  }
}

/**
 * Perform comprehensive health check of all dependencies
 */
export async function checkDependencyHealth(): Promise<DependencyHealth> {
  const [api, edgeFunctions] = await Promise.all([
    checkApiHealth(),
    checkEdgeFunctionsHealth(),
  ]);

  // Determine overall health
  const statuses = [api.status, edgeFunctions.status];
  let overall: 'healthy' | 'degraded' | 'unhealthy';

  if (statuses.every(s => s === 'healthy')) {
    overall = 'healthy';
  } else if (statuses.some(s => s === 'unhealthy')) {
    overall = 'unhealthy';
  } else {
    overall = 'degraded';
  }

  logger.debug('Health check completed', { overall, api: api.status, edgeFunctions: edgeFunctions.status });

  return { api, edgeFunctions, overall };
}

/**
 * Get server runtime metrics
 */
export function getServerMetrics() {
  const memUsage = process.memoryUsage();
  const uptime = process.uptime();

  return {
    uptime: Math.floor(uptime),
    uptimeFormatted: formatUptime(uptime),
    memory: {
      rss: formatBytes(memUsage.rss),
      heapTotal: formatBytes(memUsage.heapTotal),
      heapUsed: formatBytes(memUsage.heapUsed),
      external: formatBytes(memUsage.external),
    },
    pid: process.pid,
    nodeVersion: process.version,
  };
}

function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(2)}MB`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);

  return parts.join(' ');
}
