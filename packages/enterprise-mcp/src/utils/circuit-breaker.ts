/**
 * Circuit Breaker Pattern Implementation
 * Prevents cascade failures by failing fast when dependencies are unhealthy
 */

import { logger } from './logger.js';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Number of failures before opening circuit */
  failureThreshold: number;
  /** Time in ms before attempting to close circuit */
  resetTimeout: number;
  /** Number of successful calls to close circuit from half-open */
  successThreshold: number;
  /** Name for logging */
  name: string;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure?: Date;
  lastSuccess?: Date;
  totalCalls: number;
  totalFailures: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private successes = 0;
  private lastFailure?: Date;
  private lastSuccess?: Date;
  private nextAttempt?: Date;
  private totalCalls = 0;
  private totalFailures = 0;

  constructor(private options: CircuitBreakerOptions) {
    logger.debug('Circuit breaker initialized', { name: options.name });
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalCalls++;

    if (this.state === 'OPEN') {
      if (this.nextAttempt && new Date() >= this.nextAttempt) {
        this.state = 'HALF_OPEN';
        logger.info('Circuit breaker half-open', { name: this.options.name });
      } else {
        logger.debug('Circuit breaker open, rejecting call', { name: this.options.name });
        throw new CircuitOpenError(
          `Circuit breaker is open for ${this.options.name}`,
          this.nextAttempt
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Record a successful call
   */
  private onSuccess(): void {
    this.lastSuccess = new Date();
    this.failures = 0;

    if (this.state === 'HALF_OPEN') {
      this.successes++;
      if (this.successes >= this.options.successThreshold) {
        this.state = 'CLOSED';
        this.successes = 0;
        logger.info('Circuit breaker closed', { name: this.options.name });
      }
    }
  }

  /**
   * Record a failed call
   */
  private onFailure(): void {
    this.failures++;
    this.totalFailures++;
    this.lastFailure = new Date();
    this.successes = 0;

    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.nextAttempt = new Date(Date.now() + this.options.resetTimeout);
      logger.warn('Circuit breaker re-opened from half-open', {
        name: this.options.name,
        nextAttempt: this.nextAttempt
      });
    } else if (this.failures >= this.options.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttempt = new Date(Date.now() + this.options.resetTimeout);
      logger.warn('Circuit breaker opened', {
        name: this.options.name,
        failures: this.failures,
        nextAttempt: this.nextAttempt
      });
    }
  }

  /**
   * Get current circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailure: this.lastFailure,
      lastSuccess: this.lastSuccess,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.nextAttempt = undefined;
    logger.info('Circuit breaker manually reset', { name: this.options.name });
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }
}

/**
 * Error thrown when circuit is open
 */
export class CircuitOpenError extends Error {
  constructor(message: string, public retryAfter?: Date) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}

/**
 * Circuit breaker registry for managing multiple breakers
 */
class CircuitBreakerRegistry {
  private breakers = new Map<string, CircuitBreaker>();

  /**
   * Get or create a circuit breaker
   */
  getBreaker(name: string, options?: Partial<CircuitBreakerOptions>): CircuitBreaker {
    if (!this.breakers.has(name)) {
      const defaultOptions: CircuitBreakerOptions = {
        failureThreshold: 5,
        resetTimeout: 30000, // 30 seconds
        successThreshold: 2,
        name,
        ...options,
      };
      this.breakers.set(name, new CircuitBreaker(defaultOptions));
    }
    return this.breakers.get(name)!;
  }

  /**
   * Get all circuit breaker stats
   */
  getAllStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {};
    for (const [name, breaker] of this.breakers) {
      stats[name] = breaker.getStats();
    }
    return stats;
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }
}

// Singleton registry
export const circuitBreakerRegistry = new CircuitBreakerRegistry();

// Pre-configured breakers for common use cases
export const apiCircuitBreaker = circuitBreakerRegistry.getBreaker('api', {
  failureThreshold: 5,
  resetTimeout: 30000,
  successThreshold: 2,
});

export const edgeFunctionsCircuitBreaker = circuitBreakerRegistry.getBreaker('edgeFunctions', {
  failureThreshold: 3,
  resetTimeout: 60000, // Edge functions may take longer to recover
  successThreshold: 1,
});
