/**
 * DLMM串联池流动性管理脚本 - 工具函数
 * 
 * 提供通用辅助功能，包括重试机制、数据处理和BidAsk模型验证
 */

import { ERROR_CONFIG } from './config';
import { logger } from './logger';

/**
 * 带重试的异步函数执行
 * @param fn 要执行的异步函数
 * @param context 上下文描述(用于日志)
 * @param maxRetries 最大重试次数
 * @param initialDelay 初始延迟(毫秒)
 * @param backoffFactor 退避因子
 * @returns 异步函数结果
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  context: string,
  maxRetries: number = ERROR_CONFIG.RETRY_CONFIG.MAX_RETRIES,
  initialDelay: number = ERROR_CONFIG.RETRY_CONFIG.INITIAL_RETRY_DELAY_MS,
  backoffFactor: number = ERROR_CONFIG.RETRY_CONFIG.BACKOFF_FACTOR
): Promise<T> {
  let lastError: Error | null = null;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        logger.debug(`[${context}] 第${attempt}次重试...`);
      }
      return await fn();
    } catch (error) {
      lastError = error as Error;
      logger.warn(`[${context}] 失败(尝试 ${attempt + 1}/${maxRetries + 1}): ${lastError.message}`);
      
      if (attempt < maxRetries) {
        logger.debug(`[${context}] 等待${delay}ms后重试...`);
        await sleep(delay);
        delay *= backoffFactor; // 指数退避
      }
    }
  }

  throw lastError || new Error(`执行${context}失败，已重试${maxRetries}次`);
}

/**
 * 延迟指定时间
 * @param ms 延迟毫秒数
 * @returns Promise
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 格式化代币数量为可读字符串
 * @param amount 代币数量(bigint或string)
 * @param decimals 小数位数
 * @returns 格式化后的数量字符串
 */
export function formatAmount(amount: bigint | string | number, decimals: number): string {
  const amountStr = typeof amount === 'bigint' ? amount.toString() : amount.toString();
  return (Number(amountStr) / Math.pow(10, decimals)).toFixed(decimals);
}

/**
 * 将格式化的数量转换回原始值
 * @param formattedAmount 格式化的数量
 * @param decimals 小数位数
 * @returns 原始值
 */
export function parseAmount(formattedAmount: string, decimals: number): bigint {
  const value = parseFloat(formattedAmount);
  return BigInt(Math.floor(value * Math.pow(10, decimals)));
}

/**
 * 计算真实价格
 * 由于不同代币精度不同，需要调整价格
 * @param price 原始价格
 * @param tokenXDecimals X代币精度(如SOL的9)
 * @param tokenYDecimals Y代币精度(如USDC的6)
 * @returns 调整后的真实价格
 */
export function calculateRealPrice(price: number | string, tokenXDecimals: number, tokenYDecimals: number): number {
  const priceFactor = Math.pow(10, tokenXDecimals - tokenYDecimals);
  return Number(price) * priceFactor;
}

/**
 * 格式化价格显示
 * @param price 原始价格
 * @param tokenXDecimals X代币精度
 * @param tokenYDecimals Y代币精度
 * @returns 格式化后的价格字符串
 */
export function formatPrice(price: number | string, tokenXDecimals: number, tokenYDecimals: number): string {
  if (!price || price === '-') return '-';
  
  const realPrice = calculateRealPrice(price, tokenXDecimals, tokenYDecimals);
  
  // 根据价格大小选择合适的小数位数
  let decimals = 2;
  if (realPrice < 0.1) decimals = 6;
  else if (realPrice < 10) decimals = 4;
  
  return realPrice.toFixed(decimals);
}

/**
 * 截断地址字符串以便显示
 * @param address 完整地址
 * @param length 截断后的长度
 * @returns 截断后的地址
 */
export function truncateAddress(address: string, length: number = 8): string {
  if (address.length <= length) return address;
  const prefixLength = Math.ceil(length / 2);
  const suffixLength = length - prefixLength;
  return `${address.substring(0, prefixLength)}...${address.substring(address.length - suffixLength)}`;
}

/**
 * 验证BidAsk模型
 * 检查一系列资金分配是否符合线性增长的BidAsk模型
 * 
 * @param values 资金数量数组
 * @param isAscending 资金应该是升序还是降序
 * @returns 是否符合BidAsk模型
 */
export function validateBidAskModel(
  values: number[], 
  isAscending: boolean
): boolean {
  if (values.length <= 1) {
    logger.debug(`BidAsk检查: 只有${values.length}个值，自动判定为符合`);
    return true;
  }
  
  // 检查是否为零
  const nonZeroValues = values.filter(v => v > 0);
  if (nonZeroValues.length === 0) {
    logger.debug(`BidAsk检查: 所有值都为0，自动判定为符合`);
    return true; // 全零数组视为有效
  }
  
  // 记录调试信息
  logger.debug(`BidAsk检查: 期望分布=${isAscending ? '升序' : '降序'}, 值=${nonZeroValues.join(', ')}`);
  
  // 线性增长检查
  for (let i = 1; i < nonZeroValues.length; i++) {
    const prev = nonZeroValues[i - 1];
    const current = nonZeroValues[i];
    
    if (isAscending) {
      // 升序: 当前值应大于前一个值
      if (current <= prev) {
        logger.debug(`BidAsk检查: 升序验证失败，位置${i}的值${current}不大于前一个值${prev}`);
        return false;
      }
    } else {
      // 降序: 当前值应小于前一个值
      if (current >= prev) {
        logger.debug(`BidAsk检查: 降序验证失败，位置${i}的值${current}不小于前一个值${prev}`);
        return false;
      }
    }
  }
  
  logger.debug(`BidAsk检查: 验证通过，符合${isAscending ? '升序' : '降序'}分布`);
  return true;
}

/**
 * 计算BidAsk模型的理想分布
 * 
 * @param total 总资金量
 * @param binCount bin数量
 * @param isAscending 是否为升序分布
 * @returns 每个bin的资金分配数组
 */
export function calculateBidAskDistribution(
  total: number,
  binCount: number,
  isAscending: boolean
): number[] {
  if (binCount <= 0) return [];
  if (binCount === 1) return [total];
  
  // 计算线性增长系数
  // 对于n个点的线性增长，和为total，可以用数学公式推导
  const sum = (binCount * (binCount + 1)) / 2;
  const unitValue = total / sum;
  
  // 创建线性增长的数组
  let distribution = Array.from({ length: binCount }, (_, i) => unitValue * (i + 1));
  
  // 如果需要降序，反转数组
  if (!isAscending) {
    distribution.reverse();
  }
  
  return distribution;
} 