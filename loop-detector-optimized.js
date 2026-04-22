'use strict';

/**
 * Highly optimized loop detector that tracks tool calls per chat ID to prevent infinite loops.
 * Maintains exact behavioral compatibility with original while improving performance.
 * Key optimizations:
 * 1. Circular buffer for O(1) window operations (eliminates O(n) shift)
 * 2. Optimized stableStringify with fast paths for common types
 * 3. Same MD5 hashing for behavioral compatibility
 * 4. Reduced object allocations where possible
 */

const crypto = require('crypto');

const LOOP_WARN_THRESHOLD = 3;
const LOOP_BREAK_THRESHOLD = 5;
const WINDOW_SIZE = 10;

// Per-chatId state to prevent cross-chat interference
const _chatState = new Map();

function _getState(chatId) {
  if (!_chatState.has(chatId)) {
    // Initialize with circular buffer and count map
    _chatState.set(chatId, {
      hashWindow: new Array(WINDOW_SIZE).fill(null), // Pre-allocated circular buffer
      windowStart: 0,           // Index of oldest element
      windowSize: 0,            // Current number of elements in window
      hashCounts: new Map()     // Count of each hash in window
    });
  }
  return _chatState.get(chatId);
}

/**
 * Reset state for a specific chat ID
 * @param {string|number} chatId - The chat identifier
 */
function reset(chatId) {
  _chatState.delete(chatId);
}

/**
 * Highly optimized stable stringifier
 * Fast paths for common types while maintaining exact behavioral compatibility
 * @param {*} obj - Object to stringify
 * @returns {string} - Deterministic string representation
 */
function stableStringify(obj) {
  // Fast path for primitives
  if (obj === null || typeof obj !== 'object') {
    return String(obj);
  }

  // Fast path for arrays
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    if (obj.length === 1) return '[' + stableStringify(obj[0]) + ']';
    
    // Pre-allocate exact size
    const result = new Array(obj.length);
    for (let i = 0; i < obj.length; i++) {
      result[i] = stableStringify(obj[i]);
    }
    return '[' + result.join(',') + ']';
  }

  // For objects
  const keys = Object.keys(obj);
  if (keys.length === 0) return '{}';
  if (keys.length === 1) {
    const key = keys[0];
    return '{' + JSON.stringify(key) + ':' + stableStringify(obj[key]) + '}';
  }
  
  // Multiple keys - need sorting
  keys.sort(); // Built-in sort is typically very fast
  
  // Pre-allocate exact size
  const result = new Array(keys.length);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    result[i] = JSON.stringify(key) + ':' + stableStringify(obj[key]);
  }
  return '{' + result.join(',') + '}';
}

/**
 * Hash function - IDENTICAL to original for behavioral compatibility
 * Uses MD5 of tool name + stableStringified args
 * @param {string} name - Tool name
 * @param {*} args - Tool arguments
 * @returns {string} - Hexadecimal MD5 hash
 */
function hashToolCall(name, args) {
  // Must be identical to original: MD5(name + stableStringify(args))
  return crypto.createHash('md5')
    .update(name + stableStringify(args || {}))
    .digest('hex');
}

/**
 * Record a tool call and check for loops
 * FULLY OPTIMIZED: 
 * - Circular buffer for O(1) window operations
 * - Minimal object creation
 * - Fast path for common cases
 * @param {string|number} chatId - The chat identifier
 * @param {string} name - Tool name
 * @param {*} args - Tool arguments
 * @returns {{status: string, hash: string, count: number}} - Result object
 */
function recordToolCall(chatId, name, args) {
  const state = _getState(chatId);
  const hash = hashToolCall(name, args);

  // OPTIMIZED: Circular buffer operations
  if (state.windowSize < WINDOW_SIZE) {
    // Buffer not full yet - add at end position
    state.hashWindow[state.windowSize] = hash;
    state.windowSize++;
  } else {
    // Buffer full - overwrite oldest (circular buffer)
    const oldHash = state.hashWindow[state.windowStart];
    
    // Update count for outgoing hash
    const oldCount = state.hashCounts.get(oldHash);
    if (oldCount === 1) {
      state.hashCounts.delete(oldHash);
    } else {
      state.hashCounts.set(oldHash, oldCount - 1);
    }
    
    // Store new hash
    state.hashWindow[state.windowStart] = hash;
    
    // Advance window start (circular)
    state.windowStart = (state.windowStart + 1) % WINDOW_SIZE;
  }

  // Update count for incoming hash
  const count = (state.hashCounts.get(hash) || 0) + 1;
  state.hashCounts.set(hash, count);

  // Check thresholds - IDENTICAL to original
  if (count >= LOOP_BREAK_THRESHOLD) {
    return { status: 'break', hash, count };
  }
  if (count >= LOOP_WARN_THRESHOLD) {
    return { status: 'warn', hash, count };
  }
  return { status: 'ok', hash, count };
}

module.exports = { reset, recordToolCall, LOOP_WARN_THRESHOLD, LOOP_BREAK_THRESHOLD };