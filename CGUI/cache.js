import crypto from 'crypto';

const HASH_ALG = 'sha1';

/**
 * 模拟 computeIfAbsent 行为的缓存类
 */
export class BufferCache {
  constructor() {
    // 使用 Map 存储哈希值到结果的映射
    this.cache = new Map();
  }

  /**
   * 对 Buffer 生成 SHA256 并检查缓存
   * @param {Buffer} buffer - 输入的数据
   * @param {Function} callback - 如果缓存不存在，则调用此函数生成值
   * @returns {any} 返回缓存中已存在的值或新生成的值
   */
  computeIfAbsent(buffer, callback) {
    if (!Buffer.isBuffer(buffer)) {
      throw new Error('Input must be a Buffer');
    }

    // 1. 生成 SHA256 哈希作为 key
    // 使用 'hex' 编码以便在 Map 中作为唯一键
    const hash = crypto.createHash(HASH_ALG).update(buffer).digest('hex');

    // 2. 检查缓存中是否已存在
    if (this.cache.has(hash)) {
      return this.cache.get(hash);
    }

    // 3. 如果不存在，执行回调并存入缓存
    const result = callback(buffer, hash);
    this.cache.set(hash, result);

    return result;
  }

  async computeIfAbsentAsync(buffer, callback) {
    if (!Buffer.isBuffer(buffer)) {
      throw new Error('Input must be a Buffer');
    }

    // 1. 生成 SHA256 哈希作为 key
    // 使用 'hex' 编码以便在 Map 中作为唯一键
    const hash = crypto.createHash(HASH_ALG).update(buffer).digest('hex');

    // 2. 检查缓存中是否已存在
    if (this.cache.has(hash)) {
      return this.cache.get(hash);
    }

    // 3. 如果不存在，执行回调并存入缓存
    const result = await callback(buffer, hash);
    this.cache.set(hash, result);

    return result;
  }
  /**
   * 清除缓存
   */
  clear() {
    this.cache.clear();
  }
}
