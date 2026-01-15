/**
 * Lanonasis REST API Client
 * Enhanced wrapper with axios, retry logic, timeouts, and structured logging
 *
 * Based on original fetch-based client, enhanced with reliability features
 */

import axios, { AxiosInstance, AxiosError, AxiosRequestConfig } from 'axios';
import axiosRetry, { exponentialDelay } from 'axios-retry';
import { config as appConfig } from '../config/environment.js';
import { logger, logApiCall, logRetry } from './logger.js';
import { normalizeError, TimeoutError, RateLimitError, ServiceUnavailableError } from '../middleware/errorHandler.js';

export interface ApiClientConfig {
  baseUrl: string;              // e.g., https://api.lanonasis.com/api/v1
  supabaseFunctionsUrl: string; // e.g., https://lanonasis.supabase.co/functions/v1
  apiKey?: string;
  bearerToken?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Array<{ field: string; message: string }>;
    requestId?: string;
    retryable?: boolean;
  };
}

/**
 * Create an axios instance with retry, timeout, and logging configured
 */
function createAxiosInstance(baseURL: string, headers: Record<string, string>): AxiosInstance {
  const instance = axios.create({
    baseURL,
    timeout: appConfig.REQUEST_TIMEOUT_MS,
    headers,
  });

  // Configure automatic retry with exponential backoff
  axiosRetry(instance, {
    retries: appConfig.MAX_RETRIES,
    retryDelay: (retryCount, error) => {
      const delay = exponentialDelay(retryCount);
      const endpoint = error.config?.url || 'unknown';
      const reason = error.message || 'Unknown error';

      logRetry(retryCount, appConfig.MAX_RETRIES, endpoint, reason);

      return delay;
    },
    retryCondition: (error: AxiosError) => {
      // Retry on network errors, timeouts, and 5xx responses
      if (axiosRetry.isNetworkOrIdempotentRequestError(error)) {
        return true;
      }

      const status = error.response?.status;
      if (status) {
        // Retry on 429 (rate limited), 502, 503, 504
        return [429, 502, 503, 504].includes(status);
      }

      return false;
    },
    onRetry: (retryCount, error, requestConfig) => {
      logger.debug('Retrying request', {
        attempt: retryCount,
        url: requestConfig.url,
        method: requestConfig.method,
        error: error.message
      });
    }
  });

  // Request interceptor for logging
  instance.interceptors.request.use(
    (config) => {
      // Add request start time for duration tracking
      (config as any).metadata = { startTime: Date.now() };

      logger.debug('API Request', {
        method: config.method?.toUpperCase(),
        url: config.url,
        baseURL: config.baseURL
      });

      return config;
    },
    (error) => {
      logger.error('Request setup error', { error: error.message });
      return Promise.reject(error);
    }
  );

  // Response interceptor for logging and error transformation
  instance.interceptors.response.use(
    (response) => {
      const duration = Date.now() - ((response.config as any).metadata?.startTime || Date.now());

      logApiCall(
        response.config.method?.toUpperCase() || 'UNKNOWN',
        response.config.url || '',
        duration,
        true,
        { status: response.status }
      );

      return response;
    },
    (error: AxiosError) => {
      const duration = Date.now() - ((error.config as any)?.metadata?.startTime || Date.now());
      const url = error.config?.url || 'unknown';

      logApiCall(
        error.config?.method?.toUpperCase() || 'UNKNOWN',
        url,
        duration,
        false,
        {
          status: error.response?.status,
          code: error.code,
          message: error.message
        }
      );

      // Transform to appropriate error type
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        throw new TimeoutError(`Request to ${url} timed out after ${appConfig.REQUEST_TIMEOUT_MS}ms`);
      }

      if (error.response?.status === 429) {
        const retryAfter = parseInt(error.response.headers['retry-after'] || '60', 10);
        throw new RateLimitError('Rate limit exceeded', retryAfter);
      }

      if (error.response?.status === 503 || error.response?.status === 502) {
        throw new ServiceUnavailableError(`Service unavailable: ${url}`);
      }

      return Promise.reject(error);
    }
  );

  return instance;
}

export class LanonasisApiClient {
  private baseClient: AxiosInstance;
  private functionsClient: AxiosInstance;
  private baseUrl: string;
  private functionsUrl: string;
  private apiKey?: string;
  private bearerToken?: string;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.functionsUrl = config.supabaseFunctionsUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.bearerToken = config.bearerToken;

    const headers = this.getHeaders();
    this.baseClient = createAxiosInstance(this.baseUrl, headers);
    this.functionsClient = createAxiosInstance(this.functionsUrl, headers);

    logger.info('API client initialized', {
      baseUrl: this.baseUrl,
      functionsUrl: this.functionsUrl,
      authMethod: this.apiKey ? 'api_key' : this.bearerToken ? 'bearer_token' : 'none',
      timeout: appConfig.REQUEST_TIMEOUT_MS,
      maxRetries: appConfig.MAX_RETRIES
    });
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    } else if (this.bearerToken) {
      headers['Authorization'] = `Bearer ${this.bearerToken}`;
    }

    return headers;
  }

  /**
   * Add request ID header if provided
   */
  private withRequestId(config: AxiosRequestConfig, requestId?: string): AxiosRequestConfig {
    if (requestId) {
      return {
        ...config,
        headers: {
          ...config.headers,
          'X-Request-Id': requestId
        }
      };
    }
    return config;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean>, requestId?: string): Promise<ApiResponse<T>> {
    try {
      const config = this.withRequestId({ params }, requestId);
      const response = await this.baseClient.get<ApiResponse<T>>(path, config);
      return response.data;
    } catch (error) {
      return normalizeError(error, requestId) as ApiResponse<T>;
    }
  }

  async post<T>(path: string, body?: unknown, requestId?: string): Promise<ApiResponse<T>> {
    try {
      const config = this.withRequestId({}, requestId);
      const response = await this.baseClient.post<ApiResponse<T>>(path, body, config);
      return response.data;
    } catch (error) {
      return normalizeError(error, requestId) as ApiResponse<T>;
    }
  }

  async put<T>(path: string, body?: unknown, requestId?: string): Promise<ApiResponse<T>> {
    try {
      const config = this.withRequestId({}, requestId);
      const response = await this.baseClient.put<ApiResponse<T>>(path, body, config);
      return response.data;
    } catch (error) {
      return normalizeError(error, requestId) as ApiResponse<T>;
    }
  }

  async delete<T>(path: string, requestId?: string): Promise<ApiResponse<T>> {
    try {
      const config = this.withRequestId({}, requestId);
      const response = await this.baseClient.delete<ApiResponse<T>>(path, config);
      return response.data;
    } catch (error) {
      return normalizeError(error, requestId) as ApiResponse<T>;
    }
  }

  // Memory endpoints
  memories = {
    list: (params?: { limit?: number; offset?: number; type?: string; tags?: string; sortBy?: string; sortOrder?: string }) =>
      this.get('/memories', params as Record<string, string | number>),

    create: (data: { title: string; content: string; type: string; tags?: string[]; metadata?: Record<string, unknown> }) =>
      this.post('/memories', data),

    get: (id: string) =>
      this.get(`/memories/${id}`),

    update: (id: string, data: { title?: string; content?: string; type?: string; tags?: string[]; metadata?: Record<string, unknown> }) =>
      this.put(`/memories/${id}`, data),

    delete: (id: string) =>
      this.delete(`/memories/${id}`),

    search: (data: { query: string; type?: string; threshold?: number; limit?: number }) =>
      this.post('/memories/search', data),
  };

  // Documentation search
  docs = {
    search: (data: { query: string; section?: string; limit?: number }) =>
      this.post('/docs/search', data),
  };

  // API Key endpoints
  apiKeys = {
    list: (params?: { active_only?: boolean; project_id?: string }) =>
      this.get('/auth/api-keys', params as Record<string, string | boolean>),

    create: (data: { name: string; description?: string; access_level?: string; expires_in_days?: number; project_id?: string }) =>
      this.post('/auth/api-keys', data),

    delete: (keyId: string) =>
      this.delete(`/auth/api-keys/${keyId}`),

    rotate: (keyId: string) =>
      this.post(`/auth/api-keys/${keyId}/rotate`),

    revoke: (keyId: string) =>
      this.post(`/auth/api-keys/${keyId}/revoke`),
  };

  // Project endpoints
  projects = {
    list: (params?: { organization_id?: string }) =>
      this.get('/projects', params as Record<string, string>),

    create: (data: { name: string; description?: string; organization_id?: string }) =>
      this.post('/projects', data),
  };

  // Organization endpoints
  organizations = {
    get: (orgId: string) =>
      this.get(`/organizations/${orgId}`),
  };

  // System endpoints
  system = {
    health: () =>
      this.get('/health'),

    authStatus: () =>
      this.get('/auth/status'),

    getConfig: (key: string) =>
      this.get('/config', { key }),

    setConfig: (key: string, value: string) =>
      this.put('/config', { key, value }),
  };

  // ==========================================================================
  // Supabase Edge Functions (Direct)
  // ==========================================================================

  private async callFunction<T>(functionName: string, method: 'GET' | 'POST', data?: unknown, params?: Record<string, string>, requestId?: string): Promise<ApiResponse<T>> {
    try {
      const config = this.withRequestId({ params }, requestId);

      let response;
      if (method === 'GET') {
        response = await this.functionsClient.get<ApiResponse<T>>(`/${functionName}`, config);
      } else {
        response = await this.functionsClient.post<ApiResponse<T>>(`/${functionName}`, data, config);
      }

      return response.data;
    } catch (error) {
      return normalizeError(error, requestId) as ApiResponse<T>;
    }
  }

  // Memory Edge Functions (additional tools)
  memoryFunctions = {
    stats: () =>
      this.callFunction('memory-stats', 'GET'),

    bulkDelete: (ids: string[]) =>
      this.callFunction('memory-bulk-delete', 'POST', { ids }),
  };

  // Intelligence Edge Functions (6 tools)
  intelligence = {
    healthCheck: () =>
      this.callFunction('intelligence-health-check', 'GET'),

    suggestTags: (data: { memory_id: string; user_id: string; max_suggestions?: number; include_existing_tags?: boolean }) =>
      this.callFunction('intelligence-suggest-tags', 'POST', data),

    findRelated: (data: { memory_id: string; user_id: string; limit?: number; similarity_threshold?: number }) =>
      this.callFunction('intelligence-find-related', 'POST', data),

    detectDuplicates: (data: { user_id: string; similarity_threshold?: number; max_pairs?: number }) =>
      this.callFunction('intelligence-detect-duplicates', 'POST', data),

    extractInsights: (data: { user_id: string; topic?: string; memory_type?: string; max_memories?: number }) =>
      this.callFunction('intelligence-extract-insights', 'POST', data),

    analyzePatterns: (data: { user_id: string; time_range_days?: number }) =>
      this.callFunction('intelligence-analyze-patterns', 'POST', data),
  };
}

// Singleton instance
let apiClient: LanonasisApiClient | null = null;

export function initializeApiClient(config: ApiClientConfig): LanonasisApiClient {
  apiClient = new LanonasisApiClient(config);
  return apiClient;
}

export function getApiClient(): LanonasisApiClient {
  if (!apiClient) {
    throw new Error('API client not initialized. Call initializeApiClient() first.');
  }
  return apiClient;
}
