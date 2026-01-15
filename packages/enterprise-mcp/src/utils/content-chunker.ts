/**
 * Content Chunking Utility for Enterprise MCP
 * Splits large content into multiple memory entries while preserving context
 */

import { logger } from './logger.js';

export interface ChunkOptions {
  /** Maximum characters per chunk (default: 8000) */
  maxChunkSize: number;
  /** Overlap between chunks to preserve context (default: 200) */
  overlapSize: number;
  /** Minimum chunk size to create (default: 500) */
  minChunkSize: number;
  /** Split on these boundaries in order of preference */
  splitBoundaries: string[];
}

export interface ContentChunk {
  /** Chunk index (1-based) */
  index: number;
  /** Total number of chunks */
  total: number;
  /** The chunk content */
  content: string;
  /** Character offset in original content */
  startOffset: number;
  /** Character end offset in original content */
  endOffset: number;
  /** Suggested title suffix for this chunk */
  titleSuffix: string;
  /** Whether this is a continuation */
  isContinuation: boolean;
}

export interface ChunkResult {
  /** Original content length */
  originalLength: number;
  /** Array of chunks */
  chunks: ContentChunk[];
  /** Whether content was split */
  wasSplit: boolean;
  /** Chunking metadata */
  metadata: {
    chunkSize: number;
    overlapSize: number;
    splitMethod: string;
  };
}

const DEFAULT_OPTIONS: ChunkOptions = {
  maxChunkSize: 8000,    // ~2000 tokens for most models
  overlapSize: 200,      // Context preservation
  minChunkSize: 500,     // Don't create tiny chunks
  splitBoundaries: [
    '\n\n\n',            // Triple newline (section breaks)
    '\n\n',              // Double newline (paragraphs)
    '\n',                // Single newline
    '. ',                // Sentence end
    '? ',                // Question end
    '! ',                // Exclamation end
    '; ',                // Semicolon
    ', ',                // Comma
    ' ',                 // Word boundary (last resort)
  ],
};

/**
 * Find the best split point near the target position
 */
function findSplitPoint(
  content: string,
  targetPos: number,
  options: ChunkOptions
): number {
  const searchStart = Math.max(0, targetPos - options.overlapSize);
  const searchEnd = Math.min(content.length, targetPos + options.overlapSize);
  const searchRegion = content.slice(searchStart, searchEnd);

  // Try each boundary type in order of preference
  for (const boundary of options.splitBoundaries) {
    // Search backwards from target for the boundary
    const lastIndex = searchRegion.lastIndexOf(boundary, targetPos - searchStart);
    if (lastIndex !== -1) {
      const absolutePos = searchStart + lastIndex + boundary.length;
      // Make sure we're making progress
      if (absolutePos > options.minChunkSize) {
        return absolutePos;
      }
    }
  }

  // Fallback: split at exact position
  return targetPos;
}

/**
 * Split content into chunks with intelligent boundary detection
 */
export function chunkContent(
  content: string,
  options: Partial<ChunkOptions> = {}
): ChunkResult {
  const opts: ChunkOptions = { ...DEFAULT_OPTIONS, ...options };

  // If content fits in one chunk, return as-is
  if (content.length <= opts.maxChunkSize) {
    return {
      originalLength: content.length,
      chunks: [{
        index: 1,
        total: 1,
        content,
        startOffset: 0,
        endOffset: content.length,
        titleSuffix: '',
        isContinuation: false,
      }],
      wasSplit: false,
      metadata: {
        chunkSize: opts.maxChunkSize,
        overlapSize: opts.overlapSize,
        splitMethod: 'none',
      },
    };
  }

  const chunks: ContentChunk[] = [];
  let position = 0;
  let chunkIndex = 1;
  let splitMethod = 'boundary';

  while (position < content.length) {
    const remainingLength = content.length - position;

    // If remaining content fits, take it all
    if (remainingLength <= opts.maxChunkSize) {
      chunks.push({
        index: chunkIndex,
        total: 0, // Will be filled in later
        content: content.slice(position),
        startOffset: position,
        endOffset: content.length,
        titleSuffix: chunkIndex > 1 ? ` (Part ${chunkIndex})` : '',
        isContinuation: chunkIndex > 1,
      });
      break;
    }

    // Find the best split point
    const targetEnd = position + opts.maxChunkSize;
    const splitPoint = findSplitPoint(content, targetEnd, opts);

    // Extract chunk with overlap consideration
    const chunkEnd = splitPoint;
    const chunkContent = content.slice(position, chunkEnd);

    chunks.push({
      index: chunkIndex,
      total: 0, // Will be filled in later
      content: chunkContent,
      startOffset: position,
      endOffset: chunkEnd,
      titleSuffix: chunkIndex > 1 ? ` (Part ${chunkIndex})` : '',
      isContinuation: chunkIndex > 1,
    });

    // Move position, accounting for overlap
    position = Math.max(position + opts.minChunkSize, chunkEnd - opts.overlapSize);
    chunkIndex++;

    // Safety check to prevent infinite loops
    if (chunkIndex > 1000) {
      logger.error('Content chunking exceeded maximum iterations', {
        contentLength: content.length,
        position,
      });
      splitMethod = 'forced';
      break;
    }
  }

  // Fill in total count
  const total = chunks.length;
  chunks.forEach(chunk => {
    chunk.total = total;
    if (total > 1 && chunk.index === 1) {
      chunk.titleSuffix = ` (Part 1 of ${total})`;
    } else if (total > 1) {
      chunk.titleSuffix = ` (Part ${chunk.index} of ${total})`;
    }
  });

  logger.debug('Content chunked', {
    originalLength: content.length,
    chunks: total,
    avgChunkSize: Math.round(content.length / total),
  });

  return {
    originalLength: content.length,
    chunks,
    wasSplit: total > 1,
    metadata: {
      chunkSize: opts.maxChunkSize,
      overlapSize: opts.overlapSize,
      splitMethod,
    },
  };
}

/**
 * Create multiple memory entries from chunked content
 */
export function createChunkedMemories(
  baseTitle: string,
  content: string,
  type: string,
  tags: string[] = [],
  metadata: Record<string, unknown> = {},
  options: Partial<ChunkOptions> = {}
): Array<{
  title: string;
  content: string;
  type: string;
  tags: string[];
  metadata: Record<string, unknown>;
}> {
  const result = chunkContent(content, options);

  return result.chunks.map(chunk => ({
    title: `${baseTitle}${chunk.titleSuffix}`,
    content: chunk.content,
    type,
    tags: [
      ...tags,
      ...(result.wasSplit ? ['chunked', `chunk-${chunk.index}-of-${chunk.total}`] : []),
    ],
    metadata: {
      ...metadata,
      ...(result.wasSplit ? {
        chunking: {
          index: chunk.index,
          total: chunk.total,
          originalLength: result.originalLength,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          isContinuation: chunk.isContinuation,
        },
      } : {}),
    },
  }));
}

/**
 * Estimate if content needs chunking
 */
export function needsChunking(
  content: string,
  maxSize: number = DEFAULT_OPTIONS.maxChunkSize
): boolean {
  return content.length > maxSize;
}

/**
 * Get recommended chunk count for content
 */
export function estimateChunkCount(
  content: string,
  maxSize: number = DEFAULT_OPTIONS.maxChunkSize
): number {
  if (content.length <= maxSize) return 1;
  return Math.ceil(content.length / (maxSize * 0.9)); // Account for overlap
}

/**
 * Reassemble chunks back into original content (for reading)
 */
export function reassembleChunks(
  chunks: Array<{ content: string; metadata?: { chunking?: { index: number } } }>
): string {
  // Sort by chunk index if available
  const sorted = [...chunks].sort((a, b) => {
    const indexA = a.metadata?.chunking?.index || 0;
    const indexB = b.metadata?.chunking?.index || 0;
    return indexA - indexB;
  });

  // Simple concatenation (overlap handling would need more sophisticated logic)
  return sorted.map(c => c.content).join('\n\n---\n\n');
}
