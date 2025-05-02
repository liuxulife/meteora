/**
 * DLMM串联池流动性管理脚本 - 数据模型
 * 
 * 定义系统中的核心数据结构，包括Pool、PoolChain和Position类
 */

import { PublicKey } from '@solana/web3.js';
import * as DLMMSdk from '@meteora-ag/dlmm';
import { formatAmount, formatPrice, validateBidAskModel, calculateRealPrice } from './utils';
import { ADJUSTMENT_CONFIG, DLMM_CONFIG } from './config';
import { logger } from './logger';
import { withRetry } from './utils';

/**
 * BIN数据接口
 */
export interface BinData {
  binId: number;
  x: bigint;
  y: bigint;
  price?: string | number;
}

/**
 * 价格区间接口
 */
export interface PriceRange {
  minPrice: number;
  maxPrice: number;
}

/**
 * 池子类
 * 表示单个DLMM流动性池
 */
export class Pool {
  public address: PublicKey;
  public dlmmPool: any; // DLMM SDK池对象
  public priceRange: PriceRange;
  public positions: Position[] = [];
  public tokenXDecimals: number = 0;
  public tokenYDecimals: number = 0;
  public tokenXSymbol: string = 'UnknownX';
  public tokenYSymbol: string = 'UnknownY';
  
  /**
   * 构造函数
   */
  constructor(address: PublicKey, dlmmPool: any) {
    this.address = address;
    this.dlmmPool = dlmmPool;
    
    // 提取代币精度和符号
    this.tokenXDecimals = dlmmPool.tokenX.decimals || 9;
    this.tokenYDecimals = dlmmPool.tokenY.decimals || 6;
    
    // 使用代币地址的前6位作为符号标识
    if (dlmmPool.tokenX?.publicKey) {
      this.tokenXSymbol = dlmmPool.tokenX.publicKey.toString().slice(0, 6) + '...';
    }
    if (dlmmPool.tokenY?.publicKey) {
      this.tokenYSymbol = dlmmPool.tokenY.publicKey.toString().slice(0, 6) + '...';
    }
    
    // 初始化价格区间
    this.priceRange = { minPrice: 0, maxPrice: 0 };
  }

  /**
   * 获取所有bin的ID
   */
  public getAllBinIds(): number[] {
    let binIds: number[] = [];
    for (const position of this.positions) {
      binIds = [...binIds, ...position.binData.map(bin => bin.binId)];
    }
    return binIds;
  }

  /**
   * 获取所有bin数据
   */
  private getAllBins(): BinData[] {
    let bins: BinData[] = [];
    for (const position of this.positions) {
      bins = [...bins, ...position.binData];
    }
    return bins;
  }

  /**
   * 获取格式化的bin范围字符串
   */
  public getBinRangeString(): string {
    const binIds = this.getAllBinIds();
    if (binIds.length === 0) return '无数据';
    
    const minBinId = Math.min(...binIds);
    const maxBinId = Math.max(...binIds);
    
    return `${minBinId}-${maxBinId}`;
  }
  
  /**
   * 获取格式化的价格区间字符串
   * 直接从bin数据中获取价格
   */
  public getPriceRangeString(): string {
    try {
      const allBins = this.getAllBins();
      if (allBins.length === 0) return '无数据';
      
      // 计算bin范围
      const binIds = allBins.map(bin => bin.binId);
      const minBinId = Math.min(...binIds);
      const maxBinId = Math.max(...binIds);
      
      // 从bin数据中找出最低和最高价格
      let minPriceRaw = '';
      let maxPriceRaw = '';
      
      // 从price字段获取价格
      for (const bin of allBins) {
        if (bin.price && (typeof bin.price === 'string' || typeof bin.price === 'number')) {
          if (bin.binId === minBinId) {
            minPriceRaw = bin.price.toString();
          }
          if (bin.binId === maxBinId) {
            maxPriceRaw = bin.price.toString();
          }
        }
      }
      
      // 如果无法从bin直接获取价格，返回未知
      if (!minPriceRaw || !maxPriceRaw) {
        return '价格数据获取中';
      }
      
      // 转换为真实价格
      const minPrice = formatPrice(minPriceRaw, this.tokenXDecimals, this.tokenYDecimals);
      const maxPrice = formatPrice(maxPriceRaw, this.tokenXDecimals, this.tokenYDecimals);
      
      return `${minPrice}-${maxPrice}`;
    } catch (error) {
      logger.error('格式化价格失败:', error);
      return '价格计算中';
    }
  }

  /**
   * 获取完整的价格范围信息（包含bin和价格）
   */
  public getFullPriceRangeString(): string {
    return `Bin:${this.getBinRangeString()} 价格:${this.getPriceRangeString()}`;
  }

  /**
   * 判断当前价格是否在此池范围内
   */
  public isPriceInRange(price: number): boolean {
    return price >= this.priceRange.minPrice && price <= this.priceRange.maxPrice;
  }

  /**
   * 判断bin是否在此池范围内
   */
  public isBinInRange(binId: number): boolean {
    const binIds = this.getAllBinIds();
    if (binIds.length === 0) return false;
    
    const minBinId = Math.min(...binIds);
    const maxBinId = Math.max(...binIds);
    return binId >= minBinId && binId <= maxBinId;
  }

  /**
   * 判断该池是否只包含X代币
   */
  public hasOnlyTokenX(): boolean {
    if (this.positions.length === 0) return false;
    
    // 检查是否所有bin中只有X代币
    for (const position of this.positions) {
      for (const bin of position.binData) {
        if (bin.y > BigInt(0)) return false;
      }
    }
    
    return true;
  }

  /**
   * 判断该池是否只包含Y代币
   */
  public hasOnlyTokenY(): boolean {
    if (this.positions.length === 0) return false;
    
    // 检查是否所有bin中只有Y代币
    for (const position of this.positions) {
      for (const bin of position.binData) {
        if (bin.x > BigInt(0)) return false;
      }
    }
    
    return true;
  }

  /**
   * 判断池是否符合BidAsk模型
   * 修改判断逻辑：
   * - 删除"只含单种代币"的严格条件
   * - 低于当前价格/bin的池子只检查Y代币分布
   * - 高于当前价格/bin的池子只检查X代币分布
   */
  public isBidAskCompliant(isHigherThanCurrentPrice: boolean): boolean {
    logger.debug(`[池${this.address.toString().slice(0, 8)}] 开始BidAsk合规性检查，期望分布: ${isHigherThanCurrentPrice ? '升序' : '降序'}`);
    
    if (this.positions.length === 0) {
      logger.debug(`[池${this.address.toString().slice(0, 8)}] 无头寸，自动判定为符合`);
      return true;
    }
    
    // 按binId排序的代币数量数组
    let sortedBins: { binId: number; value: number }[] = [];
    
    // 根据池子位置选择要检查的代币类型
    if (isHigherThanCurrentPrice) {
      // 高于当前bin的池子应检查X代币分布
      logger.debug(`[池${this.address.toString().slice(0, 8)}] 检查X代币分布`);
      
      for (const position of this.positions) {
        for (const bin of position.binData) {
          // 跳过X代币数量为0的bin（可能是空的或未初始化的bin）
          if (bin.x === BigInt(0)) continue;
          
          const xAmount = parseFloat(formatAmount(bin.x.toString(), this.tokenXDecimals));
          sortedBins.push({ binId: bin.binId, value: xAmount });
        }
      }
    } else {
      // 低于当前bin的池子应检查Y代币分布
      logger.debug(`[池${this.address.toString().slice(0, 8)}] 检查Y代币分布`);
      
      for (const position of this.positions) {
        for (const bin of position.binData) {
          // 跳过Y代币数量为0的bin（可能是空的或未初始化的bin）
          if (bin.y === BigInt(0)) continue;
          
          const yAmount = parseFloat(formatAmount(bin.y.toString(), this.tokenYDecimals));
          sortedBins.push({ binId: bin.binId, value: yAmount });
        }
      }
    }
    
    // 如果没有有效的流动性数据，无法判断
    if (sortedBins.length === 0) {
      logger.debug(`[池${this.address.toString().slice(0, 8)}] 无有效流动性数据，自动判定为符合`);
      return true;
    }
    
    logger.debug(`[池${this.address.toString().slice(0, 8)}] 收集到${sortedBins.length}个有效流动性数据点`);
    
    // 聚合相同binId的流动性
    const aggregatedBins = new Map<number, number>();
    for (const bin of sortedBins) {
      const existingValue = aggregatedBins.get(bin.binId) || 0;
      aggregatedBins.set(bin.binId, existingValue + bin.value);
    }
    
    // 转换为数组并按binId排序（基于数学大小，而非绝对值）
    const sortedAggregatedBins = Array.from(aggregatedBins.entries())
      .sort((a, b) => a[0] - b[0]); // 按binId从小到大排序
    
    logger.debug(`[池${this.address.toString().slice(0, 8)}] 聚合后有${sortedAggregatedBins.length}个不同的bin`);
    
    // 输出详细的bin分布情况
    const binDistribution = sortedAggregatedBins
      .map(([binId, value]) => `Bin${binId}:${value.toFixed(4)}`)
      .join(', ');
    logger.debug(`[池${this.address.toString().slice(0, 8)}] Bin分布: ${binDistribution}`);
    
    // 提取排序后的流动性值数组
    const values = sortedAggregatedBins.map(([_, value]) => value);
    
    // 判断分布是否符合预期（升序或降序）
    const result = validateBidAskModel(values, isHigherThanCurrentPrice);
    logger.debug(`[池${this.address.toString().slice(0, 8)}] BidAsk检查结果: ${result ? '符合' : '不符合'}`);
    
    return result;
  }

  /**
   * 获取池子总流动性
   */
  public getTotalLiquidity(): { totalX: bigint; totalY: bigint } {
    let totalX = BigInt(0);
    let totalY = BigInt(0);
    
    for (const position of this.positions) {
      const { totalX: posX, totalY: posY } = position.getTotalLiquidity();
      totalX += posX;
      totalY += posY;
    }
    
    return { totalX, totalY };
  }

  /**
   * 获取格式化的代币数量字符串
   */
  public getFormattedLiquidity(): { formattedX: string; formattedY: string } {
    const { totalX, totalY } = this.getTotalLiquidity();
    
    const formattedX = formatAmount(totalX.toString(), this.tokenXDecimals);
    const formattedY = formatAmount(totalY.toString(), this.tokenYDecimals);
    
    return { formattedX, formattedY };
  }

  /**
   * 获取池子和头寸的汇总信息
   */
  public getSummaryInfo(): any {
    // 获取所有bin的ID
    const binIds = this.getAllBinIds();
    if (binIds.length === 0) {
      return { address: this.address.toString(), positionCount: 0 };
    }
    
    // 获取总流动性
    const { totalX, totalY } = this.getTotalLiquidity();
    
    // bin范围
    const minBinId = Math.min(...binIds);
    const maxBinId = Math.max(...binIds);
    
    // 价格范围 - 直接使用getPriceRangeString获取格式化价格
    const priceRangeStr = this.getPriceRangeString();
    
    return {
      address: this.address.toString(),
      positionCount: this.positions.length,
      binRange: {
        min: minBinId,
        max: maxBinId,
        count: binIds.length
      },
      priceRange: {
        formatted: priceRangeStr
      },
      liquidity: {
        x: {
          amount: totalX.toString(),
          formatted: formatAmount(totalX.toString(), this.tokenXDecimals),
          symbol: this.tokenXSymbol,
          decimals: this.tokenXDecimals
        },
        y: {
          amount: totalY.toString(),
          formatted: formatAmount(totalY.toString(), this.tokenYDecimals),
          symbol: this.tokenYSymbol,
          decimals: this.tokenYDecimals
        }
      },
      tokens: {
        x: {
          symbol: this.tokenXSymbol,
          decimals: this.tokenXDecimals,
          address: this.dlmmPool.tokenX?.publicKey?.toString() || 'unknown'
        },
        y: {
          symbol: this.tokenYSymbol,
          decimals: this.tokenYDecimals,
          address: this.dlmmPool.tokenY?.publicKey?.toString() || 'unknown'
        }
      }
    };
  }

  /**
   * 查找池子的所有头寸
   */
  public async fetchPositions(owner: PublicKey): Promise<void> {
    try {
      logger.debug(`获取池子${this.address.toString()}的头寸`);
      
      // 获取用户头寸列表
      const { userPositions } = await this.dlmmPool.getPositionsByUserAndLbPair(owner);
      logger.debug(`发现${userPositions.length}个头寸记录`);
      
      // 清空原有头寸
      this.positions = [];
      
      // 处理每个头寸
      for (const positionData of userPositions) {
        try {
          // 获取完整头寸信息
          const fullPosition = await withRetry(
            async () => await this.dlmmPool.getPosition(positionData.publicKey),
            `获取头寸详情(${positionData.publicKey.toString()})`,
            DLMM_CONFIG.MAX_POSITION_FETCH_RETRIES || 3
          );
          
          if (fullPosition) {
            // 创建新的Position对象
            const position = new Position(
              positionData.publicKey, 
              fullPosition,
              this.tokenXDecimals,
              this.tokenYDecimals
            );
            
            // 只有当position成功解析出bin数据时才添加
            if (position.binData.length > 0) {
              this.positions.push(position);
              
              // 日志输出头寸信息
              const { formattedX, formattedY } = position.getFormattedLiquidity();
              logger.info(`加载头寸 ${position.publicKey.toString().slice(0, 8)}...: ${position.binData.length}个bin, ${formattedX} ${this.tokenXSymbol}, ${formattedY} ${this.tokenYSymbol}`);
              
              // 更新价格范围
              this.updatePriceRangeFromPositions();
            } else {
              logger.warn(`头寸${positionData.publicKey.toString()}没有可用的bin数据，跳过`);
            }
          }
        } catch (error) {
          logger.error(`获取头寸详情时出错: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      // 成功加载后打印汇总信息
      if (this.positions.length > 0) {
        const { totalX, totalY } = this.getTotalLiquidity();
        logger.info(
          `成功加载${this.positions.length}个头寸，总流动性: ` +
          `${formatAmount(totalX.toString(), this.tokenXDecimals)} ${this.tokenXSymbol}, ` +
          `${formatAmount(totalY.toString(), this.tokenYDecimals)} ${this.tokenYSymbol}`
        );
      }
    } catch (error) {
      logger.error(`获取池子头寸时出错: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * 根据头寸更新价格范围
   * 简化版本，只使用最简单的方法
   */
  private updatePriceRangeFromPositions(): void {
    const binIds = this.getAllBinIds();
    if (binIds.length === 0) return;
    
    // 找出最小和最大bin ID
    const minBinId = Math.min(...binIds);
    const maxBinId = Math.max(...binIds);
    
    // 尝试从DLMM SDK获取价格信息
    let minPrice = 0;
    let maxPrice = 0;
    
    try {
      // 如果SDK支持通过binId获取价格
      if (typeof this.dlmmPool.getPriceFromBinId === 'function') {
        minPrice = this.dlmmPool.getPriceFromBinId(minBinId);
        maxPrice = this.dlmmPool.getPriceFromBinId(maxBinId);
        
        // 应用代币精度调整
        minPrice = calculateRealPrice(minPrice, this.tokenXDecimals, this.tokenYDecimals);
        maxPrice = calculateRealPrice(maxPrice, this.tokenXDecimals, this.tokenYDecimals);
      } 
      // 如果不支持，直接使用bin ID代替 
      else {
        minPrice = minBinId;
        maxPrice = maxBinId;
      }
    } catch (error) {
      // 发生错误时使用bin ID
      logger.warn(`计算价格范围出错: ${error}, 使用bin ID代替`);
      minPrice = minBinId;
      maxPrice = maxBinId;
    }
    
    this.priceRange.minPrice = minPrice;
    this.priceRange.maxPrice = maxPrice;
  }

  /**
   * 获取低于当前bin的相邻头寸
   * @param currentBinId 当前活跃bin ID
   */
  public getLowerPosition(currentBinId: number): Position | undefined {
    if (this.positions.length === 0) return undefined;
    
    // 找到所有头寸的最低bin值
    const positionsWithRange = this.positions.map(position => {
      const range = position.getBinRange();
      return { position, ...range };
    });
    
    // 过滤出包含的bin全部小于当前bin的头寸，并按最大binId降序排序
    const lowerPositions = positionsWithRange
      .filter(p => p.maxBinId < currentBinId)
      .sort((a, b) => b.maxBinId - a.maxBinId);
    
    // 返回最接近当前bin的头寸（即最大bin值最大的头寸）
    return lowerPositions.length > 0 ? lowerPositions[0].position : undefined;
  }
  
  /**
   * 获取高于当前bin的相邻头寸
   * @param currentBinId 当前活跃bin ID
   */
  public getHigherPosition(currentBinId: number): Position | undefined {
    if (this.positions.length === 0) return undefined;
    
    // 找到所有头寸的最高bin值
    const positionsWithRange = this.positions.map(position => {
      const range = position.getBinRange();
      return { position, ...range };
    });
    
    // 过滤出包含的bin全部大于当前bin的头寸，并按最小binId升序排序
    const higherPositions = positionsWithRange
      .filter(p => p.minBinId > currentBinId)
      .sort((a, b) => a.minBinId - b.minBinId);
    
    // 返回最接近当前bin的头寸（即最小bin值最小的头寸）
    return higherPositions.length > 0 ? higherPositions[0].position : undefined;
  }
  
  /**
   * 获取包含当前bin的头寸
   * @param currentBinId 当前活跃bin ID
   */
  public getCurrentPosition(currentBinId: number): Position | undefined {
    return this.positions.find(position => position.isBinInRange(currentBinId));
  }
}

/**
 * 头寸类
 * 表示单个流动性头寸
 */
export class Position {
  public publicKey: PublicKey;
  public data: any; // 原始头寸数据
  public binData: BinData[] = [];
  private tokenXDecimals: number;
  private tokenYDecimals: number;
  
  /**
   * 构造函数
   */
  constructor(
    publicKey: PublicKey,
    data: any,
    tokenXDecimals: number,
    tokenYDecimals: number
  ) {
    this.publicKey = publicKey;
    this.data = data;
    this.tokenXDecimals = tokenXDecimals;
    this.tokenYDecimals = tokenYDecimals;
    
    // 初始化bin数据
    this.binData = this.extractBinData(data);
  }
  
  /**
   * 从头寸数据中提取bin数据
   * 简化版本，优先检查最常见的几种数据结构
   */
  private extractBinData(data: any): BinData[] {
    // 首先检查标准的positionBinData
    if (data.positionBinData?.length > 0) {
      return this.mapBinData(data.positionBinData);
    }
    
    // 尝试其他常见属性名
    if (data.bins?.length > 0) return this.mapBinData(data.bins);
    if (data.binPositions?.length > 0) return this.mapBinData(data.binPositions);
    if (data.positionData?.binPositions?.length > 0) return this.mapBinData(data.positionData.binPositions);
    
    // 深度搜索 - 只在其他方法都失败时使用
    const foundBinData = this.findBinArrayInObject(data);
    if (foundBinData) {
      return this.mapBinData(foundBinData);
    }
    
    logger.warn(`无法找到任何有效的bin数据，头寸${this.publicKey.toString()}可能无效`);
    return [];
  }
  
  /**
   * 递归查找对象中符合bin数据结构的数组
   * 简化版本，只检查关键字段
   */
  private findBinArrayInObject(obj: any): any[] | null {
    if (!obj || typeof obj !== 'object') return null;
    
    // 检查当前对象是否是bin数组
    if (Array.isArray(obj) && obj.length > 0) {
      const firstItem = obj[0];
      // 只检查关键字段，减少条件复杂度
      if (firstItem && 
          (firstItem.binId !== undefined || 
           firstItem.index !== undefined) &&
          ((firstItem.x !== undefined && firstItem.y !== undefined) ||
           (firstItem.positionXAmount !== undefined && firstItem.positionYAmount !== undefined))) {
        return obj;
      }
    }
    
    // 递归检查所有子对象和数组
    for (const key in obj) {
      const result = this.findBinArrayInObject(obj[key]);
      if (result) return result;
    }
    
    return null;
  }
  
  /**
   * 映射bin数据到标准格式
   */
  private mapBinData(binArray: any[]): BinData[] {
    if (!binArray || binArray.length === 0) return [];
    
    // 检查第一个元素以确定字段映射
    const sampleBin = binArray[0];
    
    // 确定字段名
    const binIdField = sampleBin.binId !== undefined ? 'binId' : 
                      sampleBin.index !== undefined ? 'index' : null;
    
    // 如果无法确定binId字段，则返回空数组
    if (binIdField === null) {
      logger.warn('无法识别bin数据的binId字段');
      return [];
    }
    
    const xField = sampleBin.positionXAmount !== undefined ? 'positionXAmount' : 
                  sampleBin.xAmount !== undefined ? 'xAmount' :
                  sampleBin.binXAmount !== undefined ? 'binXAmount' : 
                  sampleBin.x !== undefined ? 'x' : null;
    
    const yField = sampleBin.positionYAmount !== undefined ? 'positionYAmount' : 
                  sampleBin.yAmount !== undefined ? 'yAmount' :
                  sampleBin.binYAmount !== undefined ? 'binYAmount' : 
                  sampleBin.y !== undefined ? 'y' : null;
    
    // 如果无法确定x或y字段，则返回空数组
    if (xField === null || yField === null) {
      logger.warn('无法识别bin数据的x或y字段');
      return [];
    }
    
    const priceField = sampleBin.price !== undefined ? 'price' : 
                      sampleBin.rawPrice !== undefined ? 'rawPrice' :
                      sampleBin.binPrice !== undefined ? 'binPrice' : null;
    
    // 映射数组
    return binArray.map(bin => {
      try {
        const binId = typeof bin[binIdField] === 'number' ? bin[binIdField] : 0;
        const x = bin[xField] ? BigInt(bin[xField].toString()) : BigInt(0);
        const y = bin[yField] ? BigInt(bin[yField].toString()) : BigInt(0);
        const price = priceField && bin[priceField] !== undefined ? bin[priceField] : null;
        
        return { binId, x, y, price };
      } catch (error) {
        logger.warn(`映射bin数据时出错: ${error}`);
        return { binId: 0, x: BigInt(0), y: BigInt(0) };
      }
    });
  }

  /**
   * 获取头寸总流动性
   */
  public getTotalLiquidity(): { totalX: bigint; totalY: bigint } {
    let totalX = BigInt(0);
    let totalY = BigInt(0);
    
    for (const bin of this.binData) {
      totalX += bin.x;
      totalY += bin.y;
    }
    
    return { totalX, totalY };
  }

  /**
   * 获取格式化的代币数量字符串
   */
  public getFormattedLiquidity(): { formattedX: string; formattedY: string } {
    const { totalX, totalY } = this.getTotalLiquidity();
    
    const formattedX = formatAmount(totalX.toString(), this.tokenXDecimals);
    const formattedY = formatAmount(totalY.toString(), this.tokenYDecimals);
    
    return { formattedX, formattedY };
  }

  /**
   * 获取头寸的价格范围字符串
   */
  public getPriceRangeString(): string {
    try {
      if (this.binData.length === 0) return '无数据';
      
      // 计算bin范围
      const binIds = this.binData.map(bin => bin.binId);
      const minBinId = Math.min(...binIds);
      const maxBinId = Math.max(...binIds);
      
      // 从bin数据中找出最低和最高价格
      let minPriceRaw = '';
      let maxPriceRaw = '';
      
      // 从price字段获取价格
      for (const bin of this.binData) {
        if (bin.price && (typeof bin.price === 'string' || typeof bin.price === 'number')) {
          if (bin.binId === minBinId) {
            minPriceRaw = bin.price.toString();
          }
          if (bin.binId === maxBinId) {
            maxPriceRaw = bin.price.toString();
          }
        }
      }
      
      // 如果无法从bin直接获取价格，返回未知
      if (!minPriceRaw || !maxPriceRaw) {
        return '价格数据获取中';
      }
      
      // 转换为真实价格
      const minPrice = formatPrice(minPriceRaw, this.tokenXDecimals, this.tokenYDecimals);
      const maxPrice = formatPrice(maxPriceRaw, this.tokenXDecimals, this.tokenYDecimals);
      
      return `${minPrice}-${maxPrice}`;
    } catch (error) {
      logger.error('头寸格式化价格失败:', error);
      return '价格计算中';
    }
  }

  /**
   * 获取头寸的bin范围
   */
  public getBinRange(): { minBinId: number, maxBinId: number } {
    if (this.binData.length === 0) {
      return { minBinId: 0, maxBinId: 0 };
    }
    
    const binIds = this.binData.map(bin => bin.binId);
    return {
      minBinId: Math.min(...binIds),
      maxBinId: Math.max(...binIds)
    };
  }

  /**
   * 判断bin是否在该头寸范围内
   */
  public isBinInRange(binId: number): boolean {
    if (this.binData.length === 0) return false;
    
    const { minBinId, maxBinId } = this.getBinRange();
    return binId >= minBinId && binId <= maxBinId;
  }

  /**
   * 判断头寸是否符合BidAsk模型
   * @param isHigherThanCurrentBin 头寸是否高于当前bin
   */
  public isBidAskCompliant(isHigherThanCurrentBin: boolean): boolean {
    if (this.binData.length === 0) return true;
    
    // 按binId排序的代币数量数组
    let sortedBins: { binId: number; value: number }[] = [];
    
    // 根据头寸位置选择要检查的代币类型
    if (isHigherThanCurrentBin) {
      // 高于当前bin的头寸应检查X代币分布
      for (const bin of this.binData) {
        // 跳过X代币数量为0的bin
        if (bin.x === BigInt(0)) continue;
        
        const xAmount = parseFloat(formatAmount(bin.x.toString(), this.tokenXDecimals));
        sortedBins.push({ binId: bin.binId, value: xAmount });
      }
    } else {
      // 低于当前bin的头寸应检查Y代币分布
      for (const bin of this.binData) {
        // 跳过Y代币数量为0的bin
        if (bin.y === BigInt(0)) continue;
        
        const yAmount = parseFloat(formatAmount(bin.y.toString(), this.tokenYDecimals));
        sortedBins.push({ binId: bin.binId, value: yAmount });
      }
    }
    
    // 如果没有有效的流动性数据，无法判断
    if (sortedBins.length === 0) return true;
    
    // 按binId排序
    sortedBins.sort((a, b) => a.binId - b.binId); // 按binId从小到大排序
    
    // 提取排序后的流动性值数组
    const values = sortedBins.map(bin => bin.value);
    
    // 判断分布是否符合预期（升序或降序）
    return validateBidAskModel(values, isHigherThanCurrentBin);
  }
}

/**
 * 串联池链类
 * 管理串联的池子集合
 */
export class PoolChain {
  private pools: Pool[] = [];
  private currentPrice: number = 0;
  private currentBinId: number = 0;
  
  /**
   * 添加池子
   */
  public addPool(pool: Pool): void {
    this.pools.push(pool);
    this.sortPools();
  }

  /**
   * 按价格范围排序池子
   */
  private sortPools(): void {
    // 获取每个池子的最小bin ID用于排序
    this.pools.sort((a, b) => {
      const aBinIds = a.getAllBinIds();
      const bBinIds = b.getAllBinIds();
      
      if (aBinIds.length === 0 || bBinIds.length === 0) return 0;
      
      const aMinBin = Math.min(...aBinIds);
      const bMinBin = Math.min(...bBinIds);
      
      return aMinBin - bMinBin;
    });
  }

  /**
   * 获取所有池子
   */
  public getAllPools(): Pool[] {
    return this.pools;
  }

  /**
   * 根据地址获取池子
   */
  public getPoolByAddress(address: string): Pool | undefined {
    return this.pools.find(pool => pool.address.toString() === address);
  }

  /**
   * 更新当前价格
   */
  public updateCurrentPrice(price: number): void {
    this.currentPrice = price;
  }
  
  /**
   * 更新当前活跃bin ID
   */
  public updateCurrentBinId(binId: number): void {
    this.currentBinId = binId;
  }

  /**
   * 获取当前活跃bin所在的池子
   */
  public getCurrentPool(): Pool | undefined {
    return this.pools.find(pool => pool.isBinInRange(this.currentBinId));
  }

  /**
   * 获取低于当前活跃bin的相邻池子
   */
  public getLowerPool(): Pool | undefined {
    const currentPool = this.getCurrentPool();
    if (!currentPool) return undefined;
    
    const currentIndex = this.pools.indexOf(currentPool);
    if (currentIndex <= 0) return undefined;
    
    return this.pools[currentIndex - 1];
  }

  /**
   * 获取高于当前活跃bin的相邻池子
   */
  public getHigherPool(): Pool | undefined {
    const currentPool = this.getCurrentPool();
    if (!currentPool) return undefined;
    
    const currentIndex = this.pools.indexOf(currentPool);
    if (currentIndex >= this.pools.length - 1) return undefined;
    
    return this.pools[currentIndex + 1];
  }

  /**
   * 检查相邻头寸是否符合BidAsk模型
   */
  public checkNeighboringPoolsCompliance(): { 
    lowerPosition?: { position: Position; isCompliant: boolean };
    currentPosition?: { position: Position; isCompliant: boolean };
    higherPosition?: { position: Position; isCompliant: boolean };
  } {
    const result: any = {};
    
    logger.debug(`===== 开始检查相邻头寸BidAsk合规性 =====`);
    logger.debug(`当前活跃Bin: ${this.currentBinId}`);
    
    const currentPool = this.getCurrentPool();
    if (!currentPool) {
      logger.debug(`未找到包含当前bin的池子`);
      return result;
    }
    
    // 获取当前池子内的相邻头寸
    const lowerPosition = currentPool.getLowerPosition(this.currentBinId);
    const currentPosition = currentPool.getCurrentPosition(this.currentBinId);
    const higherPosition = currentPool.getHigherPosition(this.currentBinId);
    
    logger.debug(`找到的头寸: 当前池=${currentPool.address.toString().slice(0, 8)}, ` +
      `当前头寸=${currentPosition ? currentPosition.publicKey.toString().slice(0, 8) : '无'}, ` +
      `低头寸=${lowerPosition ? lowerPosition.publicKey.toString().slice(0, 8) : '无'}, ` +
      `高头寸=${higherPosition ? higherPosition.publicKey.toString().slice(0, 8) : '无'}`);
    
    if (lowerPosition) {
      // 获取bin范围
      const range = lowerPosition.getBinRange();
      
      logger.debug(`低头寸Bin范围: ${range.minBinId} - ${range.maxBinId}`);
      
      // 低于当前bin的头寸应该是降序分布
      const isCompliant = lowerPosition.isBidAskCompliant(false);
      logger.debug(`低头寸合规性检查: 分布应为降序, 结果=${isCompliant ? '符合' : '不符合'}`);
      
      result.lowerPosition = { position: lowerPosition, isCompliant };
    } else {
      logger.debug(`未找到低于当前bin的相邻头寸`);
    }
    
    if (currentPosition) {
      // 获取bin范围
      const range = currentPosition.getBinRange();
      const midBinId = Math.floor((range.minBinId + range.maxBinId) / 2);
      
      logger.debug(`当前头寸Bin范围: ${range.minBinId} - ${range.maxBinId}, 中间Bin: ${midBinId}`);
      
      // 当前头寸的合规性取决于bin在头寸中的位置
      const isHigherHalf = this.currentBinId >= midBinId;
      
      logger.debug(`当前bin ${this.currentBinId} ${isHigherHalf ? '>=' : '<'} 中间bin ${midBinId}, ` +
        `应为${isHigherHalf ? '升序' : '降序'}分布`);
      
      const isCompliant = currentPosition.isBidAskCompliant(isHigherHalf);
      logger.debug(`当前头寸合规性检查: 分布应为${isHigherHalf ? '升序' : '降序'}, 结果=${isCompliant ? '符合' : '不符合'}`);
      
      result.currentPosition = { position: currentPosition, isCompliant };
    } else {
      logger.debug(`未找到包含当前bin的头寸`);
    }
    
    if (higherPosition) {
      // 获取bin范围
      const range = higherPosition.getBinRange();
      
      logger.debug(`高头寸Bin范围: ${range.minBinId} - ${range.maxBinId}`);
      
      // 高于当前bin的头寸应该是升序分布
      const isCompliant = higherPosition.isBidAskCompliant(true);
      logger.debug(`高头寸合规性检查: 分布应为升序, 结果=${isCompliant ? '符合' : '不符合'}`);
      
      result.higherPosition = { position: higherPosition, isCompliant };
    } else {
      logger.debug(`未找到高于当前bin的相邻头寸`);
    }
    
    logger.debug(`===== 相邻头寸检查完成 =====`);
    
    return result;
  }
} 