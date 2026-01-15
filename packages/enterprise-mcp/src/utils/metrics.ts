/**
 * Prometheus-Compatible Metrics for Enterprise MCP
 * Exports metrics in Prometheus text format
 */

import { circuitBreakerRegistry } from './circuit-breaker.js';
import { memoryListCache, statsCache } from './cache.js';
import { getServerMetrics } from './health.js';

/**
 * Track request counts and durations
 */
class RequestMetrics {
  private counts = new Map<string, number>();
  private durations: number[] = [];
  private errors = new Map<string, number>();

  recordRequest(tool: string, duration: number, success: boolean): void {
    // Increment count
    const key = `tool_${tool}`;
    this.counts.set(key, (this.counts.get(key) || 0) + 1);

    // Track duration
    this.durations.push(duration);
    if (this.durations.length > 1000) {
      this.durations.shift(); // Keep last 1000 samples
    }

    // Track errors
    if (!success) {
      this.errors.set(key, (this.errors.get(key) || 0) + 1);
    }
  }

  getMetrics(): {
    totalRequests: number;
    requestsByTool: Record<string, number>;
    errorsByTool: Record<string, number>;
    avgDuration: number;
    p50Duration: number;
    p95Duration: number;
    p99Duration: number;
  } {
    const sorted = [...this.durations].sort((a, b) => a - b);
    const len = sorted.length;

    return {
      totalRequests: Array.from(this.counts.values()).reduce((a, b) => a + b, 0),
      requestsByTool: Object.fromEntries(this.counts),
      errorsByTool: Object.fromEntries(this.errors),
      avgDuration: len > 0 ? sorted.reduce((a, b) => a + b, 0) / len : 0,
      p50Duration: len > 0 ? sorted[Math.floor(len * 0.5)] : 0,
      p95Duration: len > 0 ? sorted[Math.floor(len * 0.95)] : 0,
      p99Duration: len > 0 ? sorted[Math.floor(len * 0.99)] : 0,
    };
  }
}

// Singleton metrics instance
export const requestMetrics = new RequestMetrics();

/**
 * Generate Prometheus-format metrics
 */
export function generatePrometheusMetrics(): string {
  const lines: string[] = [];
  const serverMetrics = getServerMetrics();
  const reqMetrics = requestMetrics.getMetrics();
  const circuitStats = circuitBreakerRegistry.getAllStats();

  // Server info
  lines.push('# HELP enterprise_mcp_info Server information');
  lines.push('# TYPE enterprise_mcp_info gauge');
  lines.push(`enterprise_mcp_info{version="1.0.0",node_version="${serverMetrics.nodeVersion}"} 1`);

  // Uptime
  lines.push('# HELP enterprise_mcp_uptime_seconds Server uptime in seconds');
  lines.push('# TYPE enterprise_mcp_uptime_seconds counter');
  lines.push(`enterprise_mcp_uptime_seconds ${serverMetrics.uptime}`);

  // Memory usage
  lines.push('# HELP enterprise_mcp_memory_bytes Memory usage in bytes');
  lines.push('# TYPE enterprise_mcp_memory_bytes gauge');
  const memUsage = process.memoryUsage();
  lines.push(`enterprise_mcp_memory_bytes{type="rss"} ${memUsage.rss}`);
  lines.push(`enterprise_mcp_memory_bytes{type="heap_total"} ${memUsage.heapTotal}`);
  lines.push(`enterprise_mcp_memory_bytes{type="heap_used"} ${memUsage.heapUsed}`);
  lines.push(`enterprise_mcp_memory_bytes{type="external"} ${memUsage.external}`);

  // Request metrics
  lines.push('# HELP enterprise_mcp_requests_total Total number of requests');
  lines.push('# TYPE enterprise_mcp_requests_total counter');
  lines.push(`enterprise_mcp_requests_total ${reqMetrics.totalRequests}`);

  // Request by tool
  lines.push('# HELP enterprise_mcp_tool_requests_total Requests by tool');
  lines.push('# TYPE enterprise_mcp_tool_requests_total counter');
  for (const [tool, count] of Object.entries(reqMetrics.requestsByTool)) {
    lines.push(`enterprise_mcp_tool_requests_total{tool="${tool.replace('tool_', '')}"} ${count}`);
  }

  // Errors by tool
  lines.push('# HELP enterprise_mcp_tool_errors_total Errors by tool');
  lines.push('# TYPE enterprise_mcp_tool_errors_total counter');
  for (const [tool, count] of Object.entries(reqMetrics.errorsByTool)) {
    lines.push(`enterprise_mcp_tool_errors_total{tool="${tool.replace('tool_', '')}"} ${count}`);
  }

  // Request duration
  lines.push('# HELP enterprise_mcp_request_duration_ms Request duration in milliseconds');
  lines.push('# TYPE enterprise_mcp_request_duration_ms summary');
  lines.push(`enterprise_mcp_request_duration_ms{quantile="0.5"} ${reqMetrics.p50Duration.toFixed(2)}`);
  lines.push(`enterprise_mcp_request_duration_ms{quantile="0.95"} ${reqMetrics.p95Duration.toFixed(2)}`);
  lines.push(`enterprise_mcp_request_duration_ms{quantile="0.99"} ${reqMetrics.p99Duration.toFixed(2)}`);
  lines.push(`enterprise_mcp_request_duration_ms_avg ${reqMetrics.avgDuration.toFixed(2)}`);

  // Circuit breaker states
  lines.push('# HELP enterprise_mcp_circuit_breaker_state Circuit breaker state (0=closed, 1=half-open, 2=open)');
  lines.push('# TYPE enterprise_mcp_circuit_breaker_state gauge');
  for (const [name, stats] of Object.entries(circuitStats)) {
    const stateValue = stats.state === 'CLOSED' ? 0 : stats.state === 'HALF_OPEN' ? 1 : 2;
    lines.push(`enterprise_mcp_circuit_breaker_state{name="${name}"} ${stateValue}`);
  }

  lines.push('# HELP enterprise_mcp_circuit_breaker_failures Circuit breaker failure count');
  lines.push('# TYPE enterprise_mcp_circuit_breaker_failures counter');
  for (const [name, stats] of Object.entries(circuitStats)) {
    lines.push(`enterprise_mcp_circuit_breaker_failures{name="${name}"} ${stats.totalFailures}`);
  }

  // Cache stats
  lines.push('# HELP enterprise_mcp_cache_size Cache size');
  lines.push('# TYPE enterprise_mcp_cache_size gauge');
  const caches = [
    { name: 'memoryList', stats: memoryListCache.getStats() },
    { name: 'stats', stats: statsCache.getStats() },
  ];
  for (const { name, stats } of caches) {
    lines.push(`enterprise_mcp_cache_size{cache="${name}"} ${stats.size}`);
  }

  lines.push('# HELP enterprise_mcp_cache_hits_total Cache hits');
  lines.push('# TYPE enterprise_mcp_cache_hits_total counter');
  for (const { name, stats } of caches) {
    lines.push(`enterprise_mcp_cache_hits_total{cache="${name}"} ${stats.hits}`);
  }

  lines.push('# HELP enterprise_mcp_cache_misses_total Cache misses');
  lines.push('# TYPE enterprise_mcp_cache_misses_total counter');
  for (const { name, stats } of caches) {
    lines.push(`enterprise_mcp_cache_misses_total{cache="${name}"} ${stats.misses}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Get metrics as JSON for /health/metrics endpoint
 */
export function getMetricsJson() {
  const serverMetrics = getServerMetrics();
  const reqMetrics = requestMetrics.getMetrics();
  const circuitStats = circuitBreakerRegistry.getAllStats();

  return {
    server: serverMetrics,
    requests: reqMetrics,
    circuitBreakers: circuitStats,
    caches: {
      memoryList: memoryListCache.getStats(),
      stats: statsCache.getStats(),
    },
    timestamp: new Date().toISOString(),
  };
}
