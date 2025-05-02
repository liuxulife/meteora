/**
 * DLMM串联池流动性管理脚本 - 服务功能
 * 
 * 整合所有核心业务逻辑，包括连接管理、钱包服务、池子发现、价格监控和流动性调整
 */

import { 
  Connection, 
  Keypair, 
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  Commitment,
  ComputeBudgetProgram,
  SystemProgram
} from '@solana/web3.js';
import * as DLMMSdk from '@meteora-ag/dlmm'; // 导入DLMM SDK
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';
import BN from 'bn.js'; // 导入BN库

import { 
  CONNECTION_CONFIG, 
  WALLET_CONFIG, 
  MONITOR_CONFIG,
  ADJUSTMENT_CONFIG,
  DLMM_CONFIG,
  TRANSACTION_CONFIG
} from './config';
import { logger } from './logger';
import { sleep, withRetry, formatAmount, calculateRealPrice } from './utils';
import { Pool, PoolChain, Position } from './models';
import { display, PoolDisplayData, PoolStatus } from './display';

/**
 * 连接服务
 * 管理与Solana区块链的连接
 */
export class ConnectionService {
  private connection: Connection;
  private isConnected: boolean = false;
  
  /**
   * 构造函数
   */
  constructor() {
    this.connection = new Connection(
      CONNECTION_CONFIG.RPC_ENDPOINT,
      {
        commitment: CONNECTION_CONFIG.CONNECTION_OPTIONS.commitment as Commitment,
        disableRetryOnRateLimit: CONNECTION_CONFIG.CONNECTION_OPTIONS.disableRetryOnRateLimit,
        confirmTransactionInitialTimeout: CONNECTION_CONFIG.CONNECTION_OPTIONS.confirmTransactionInitialTimeout
      }
    );
  }

  /**
   * 初始化连接
   */
  public async initialize(): Promise<void> {
    try {
      logger.info(`连接到Solana网络: ${CONNECTION_CONFIG.RPC_ENDPOINT}`);
      
      // 检查连接是否正常工作
      await this.checkConnection();
      this.isConnected = true;
      logger.info('成功连接到Solana网络');
    } catch (error) {
      this.isConnected = false;
      logger.error(`连接到Solana网络失败: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * 检查连接是否正常
   */
  private async checkConnection(): Promise<void> {
    try {
      // 获取最新区块高度验证连接
      const slot = await this.connection.getSlot();
      if (!slot || slot <= 0) {
        throw new Error('获取的区块高度无效');
      }
      
      logger.debug(`连接正常，当前区块高度: ${slot}`);
    } catch (error) {
      logger.error(`连接检查失败: ${error instanceof Error ? error.message : String(error)}`);
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * 确保连接可用
   */
  public async ensureConnected(): Promise<void> {
    if (!this.isConnected) {
      await this.initialize();
      return;
    }
    
    try {
      // 检查连接是否仍然可用
      await this.checkConnection();
    } catch (error) {
      logger.warn(`连接已断开，尝试重新连接: ${error instanceof Error ? error.message : String(error)}`);
      this.isConnected = false;
      await this.initialize();
    }
  }

  /**
   * 获取连接实例
   */
  public getConnection(): Connection {
    if (!this.isConnected) {
      logger.warn('尝试获取未初始化的连接，将自动重新连接');
      this.initialize().catch(error => {
        logger.error(`重新连接失败: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    return this.connection;
  }
}

/**
 * 钱包服务
 * 管理用户钱包和交易签名
 */
export class WalletService {
  private wallet: Keypair;
  private connectionService: ConnectionService;
  
  /**
   * 构造函数
   */
  constructor(connectionService: ConnectionService) {
    this.connectionService = connectionService;
    
    // 初始化钱包（实际的初始化将在init方法中完成）
    this.wallet = null as unknown as Keypair;
  }
  
  /**
   * 初始化钱包
   * 如果存在加密的私钥文件，则从加密文件加载私钥
   * 否则从配置文件加载私钥
   */
  public async init(): Promise<void> {
    try {
      logger.info('开始初始化钱包...');
      
      // 尝试从加密文件加载私钥
      try {
        logger.debug('尝试加载加密模块...');
        
        // 导入crypto模块 - 使用绝对路径
        const path = await import('path');
        const projectRoot = path.resolve(process.cwd());
        logger.debug(`项目根目录: ${projectRoot}`);
        
        // 使用绝对路径导入加密模块
        const cryptoPath = path.join(projectRoot, 'dist', 'utils', 'crypto.js');
        logger.debug(`加密模块路径: ${cryptoPath}`);
        
        // 检查文件是否存在
        const fs = await import('fs');
        if (!fs.existsSync(cryptoPath)) {
          throw new Error(`找不到加密模块文件: ${cryptoPath}`);
        }
        
        // 导入加密模块
        const cryptoUtils = await import(cryptoPath);
        
        // 获取加密文件路径（这将在多个位置查找）
        const encryptedKeyPath = cryptoUtils.getEncryptedKeyPath();
        logger.debug(`加密私钥路径: ${encryptedKeyPath}`);
        
        // 检查加密私钥文件是否存在
        if (fs.existsSync(encryptedKeyPath)) {
          logger.info(`找到加密的私钥文件: ${encryptedKeyPath}`);
          // 从用户获取密码并解密私钥
          try {
            logger.debug('提示用户输入密码...');
            const privateKeyBase58 = await cryptoUtils.loadAndDecryptPrivateKey(undefined, encryptedKeyPath);
            logger.debug('私钥解密成功，创建钱包...');
            this.wallet = Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
            logger.info('成功从加密文件加载私钥');
            
            // 成功加载私钥后，直接返回
            logger.info(`钱包地址: ${this.getAddress()}`);
            return;
          } catch (error) {
            logger.error(`解密私钥失败: ${error instanceof Error ? error.message : String(error)}`);
            // 如果解密失败，提示用户确认是否使用配置文件中的私钥
            const readline = await import('readline');
            const rl = readline.createInterface({
              input: process.stdin,
              output: process.stdout
            });
            const answer = await new Promise<string>((resolve) => {
              rl.question('解密私钥失败，是否使用配置文件中的私钥？(y/n): ', resolve);
            });
            rl.close();
            
            if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
              // 从配置文件加载私钥
              this.loadPrivateKeyFromConfig();
              logger.info(`钱包地址: ${this.getAddress()}`);
              return;
            } else {
              // 用户不想使用配置文件中的私钥，抛出错误
              throw new Error('无法加载私钥，程序无法继续');
            }
          }
        } else {
          // 如果加密文件不存在，从配置文件加载私钥
          logger.info(`未检测到加密的私钥文件: ${encryptedKeyPath}`);
          this.loadPrivateKeyFromConfig();
          logger.info(`钱包地址: ${this.getAddress()}`);
          return;
        }
      } catch (error) {
        // 如果尝试使用加密文件加载失败，回退到使用配置文件
        logger.warn(`尝试使用加密文件加载私钥失败: ${error instanceof Error ? error.message : String(error)}`);
        logger.info('回退到使用配置文件加载私钥');
        this.loadPrivateKeyFromConfig();
        logger.info(`钱包地址: ${this.getAddress()}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`钱包初始化失败: ${message}`);
      throw new Error(`钱包初始化失败: ${message}`);
    }
  }
  
  /**
   * 从配置文件加载私钥
   */
  private loadPrivateKeyFromConfig(): void {
    const privateKeyBase58 = WALLET_CONFIG.PRIVATE_KEY;
    // 检查私钥是否存在且非空
    if (!privateKeyBase58 || privateKeyBase58.trim() === '') {
      throw new Error('配置文件中未设置私钥，且未找到加密的私钥文件。请使用encrypt-key工具生成加密私钥文件，或在配置中设置PRIVATE_KEY');
    }
    
    try {
      this.wallet = Keypair.fromSecretKey(bs58.decode(privateKeyBase58));
      logger.info('从配置文件加载私钥成功');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`解析配置文件中的私钥失败: ${message}`);
    }
  }

  /**
   * 获取钱包公钥
   */
  public getPublicKey(): PublicKey {
    return this.wallet.publicKey;
  }

  /**
   * 获取钱包密钥对
   */
  public getKeypair(): Keypair {
    return this.wallet;
  }

  /**
   * 获取钱包地址字符串
   */
  public getAddress(): string {
    return this.wallet.publicKey.toString();
  }

  /**
   * 获取SOL余额
   */
  public async getSolBalance(): Promise<number> {
    const connection = this.connectionService.getConnection();
    const balance = await connection.getBalance(this.wallet.publicKey);
    return balance / 1e9; // 转换为SOL
  }

  /**
   * 添加优先级费用到交易
   */
  public addPriorityFee(transaction: Transaction): Transaction {
    if (!TRANSACTION_CONFIG.ENABLE_PRIORITY_FEE) {
      return transaction;
    }

    // 添加优先级费用
    const priorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: TRANSACTION_CONFIG.PRIORITY_FEE_MICROLAMPORTS
    });
    transaction.add(priorityFee);

    // 如果配置了计算单元限制，也添加
    if (TRANSACTION_CONFIG.AUTO_COMPUTE_UNIT_LIMIT) {
      const computeUnitLimit = ComputeBudgetProgram.setComputeUnitLimit({
        units: TRANSACTION_CONFIG.COMPUTE_UNIT_LIMIT
      });
      transaction.add(computeUnitLimit);
    }

    return transaction;
  }

  /**
   * 签名并发送交易
   */
  public async signAndSendTransaction(transaction: Transaction): Promise<string> {
    const connection = this.connectionService.getConnection();
    try {
      // 添加优先级费用
      transaction = this.addPriorityFee(transaction);
      
      // 获取最新的blockhash
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = this.wallet.publicKey;

      // 签名并发送交易
      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [this.wallet],
        {
          commitment: 'confirmed',
          maxRetries: TRANSACTION_CONFIG.TRANSACTION_RETRY.MAX_RETRIES,
          skipPreflight: false
        }
      );
      
      logger.info(`交易发送成功，签名: ${signature}`);
      return signature;
    } catch (error) {
      logger.error(`交易失败: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
}

/**
 * 池子发现服务
 * 发现用户创建的所有池子
 */
export class PoolDiscoveryService {
  private connectionService: ConnectionService;
  private walletService: WalletService;
  private poolChain: PoolChain;
  
  /**
   * 构造函数
   */
  constructor(
    connectionService: ConnectionService,
    walletService: WalletService
  ) {
    this.connectionService = connectionService;
    this.walletService = walletService;
    this.poolChain = new PoolChain();
  }

  /**
   * 发现并加载所有池子
   */
  public async discoverPools(): Promise<PoolChain> {
    try {
      await this.connectionService.ensureConnected();
      const connection = this.connectionService.getConnection();
      const userPublicKey = this.walletService.getPublicKey();
      
      logger.info(`开始搜索用户池子和头寸: ${userPublicKey.toString()}`);
      
      // 使用指定池地址
      if (DLMM_CONFIG && DLMM_CONFIG.POOL_ADDRESSES && DLMM_CONFIG.POOL_ADDRESSES.length > 0) {
        logger.info(`使用预设池地址搜索用户头寸，共${DLMM_CONFIG.POOL_ADDRESSES.length}个地址`);
        
        for (const poolAddressStr of DLMM_CONFIG.POOL_ADDRESSES) {
          try {
            const poolAddress = new PublicKey(poolAddressStr);
            logger.debug(`连接到DLMM池: ${poolAddress.toString()}`);
            
            // 创建DLMM实例
            const dlmmPool = await withRetry(
              async () => await (DLMMSdk as any).default.create(connection, poolAddress),
              `创建DLMM实例(${poolAddress.toString()})`,
              DLMM_CONFIG.MAX_POOL_FETCH_RETRIES || 3
            );
            
            // 获取用户在该池子中的头寸
            const { userPositions } = await withRetry(
              async () => await dlmmPool.getPositionsByUserAndLbPair(userPublicKey),
              `获取用户头寸(${poolAddress.toString()})`,
              DLMM_CONFIG.MAX_POSITION_FETCH_RETRIES || 3
            );
            
            if (userPositions.length === 0) {
              logger.info(`池子 ${poolAddress.toString()} 没有用户头寸，跳过`);
              continue;
            }
            
            logger.info(`在池子 ${poolAddress.toString()} 中找到 ${userPositions.length} 个用户头寸`);
            
            // 创建Pool对象并加载头寸
            const pool = new Pool(poolAddress, dlmmPool);
            await pool.fetchPositions(userPublicKey);
            
            if (pool.positions.length === 0) {
              logger.warn(`加载池子 ${poolAddress.toString()} 的头寸失败，无法获取头寸详情`);
              continue;
            }
            
            // 添加到池子链中
            this.poolChain.addPool(pool);
            
            // 打印池子和头寸汇总信息
            this.logPoolSummary(pool);
          } catch (error) {
            logger.error(`加载池子 ${poolAddressStr} 失败: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      
      // 检查是否找到任何池子
      if (this.poolChain.getAllPools().length === 0) {
        logger.warn('未找到任何包含用户头寸的池子');
        display.updateStatusMessage('未找到用户池子');
      } else {
        logger.info(`发现用户池子总数: ${this.poolChain.getAllPools().length}`);
        display.updateStatusMessage(`找到 ${this.poolChain.getAllPools().length} 个用户池子`);
        
        // 更新显示
        this.updatePoolsDisplay();
      }
      
      return this.poolChain;
    } catch (error) {
      logger.error(`发现池子时出错: ${error instanceof Error ? error.message : String(error)}`);
      display.updateStatusMessage(`发现池子失败: ${error instanceof Error ? error.message : String(error)}`);
      return this.poolChain;
    }
  }

  /**
   * 记录池子摘要信息
   */
  private logPoolSummary(pool: Pool): void {
    const summary = pool.getSummaryInfo();
    logger.info(`========== 池子和头寸汇总信息 ==========`);
    logger.info(`池子地址: ${summary.address}`);
    logger.info(`代币: ${summary.tokens.x.symbol}/${summary.tokens.y.symbol}`);
    logger.info(`头寸数量: ${summary.positionCount}`);
    logger.info(`Bin范围: ${summary.binRange.min} 至 ${summary.binRange.max} (共${summary.binRange.count}个bin)`);
    logger.info(`价格范围: ${summary.priceRange.formatted}`);
    logger.info(`总流动性: ${summary.liquidity.x.formatted} ${summary.tokens.x.symbol}, ${summary.liquidity.y.formatted} ${summary.tokens.y.symbol}`);
    logger.info(`=========================================`);
  }

  /**
   * 更新池子显示
   */
  public updatePoolsDisplay(): void {
    const pools = this.poolChain.getAllPools();
    
    const poolsData: PoolDisplayData[] = [];
    
    // 遍历每个池子
    for (const pool of pools) {
      if (pool.positions.length === 0) {
        // 如果没有头寸，仍显示池子
        const { formattedX, formattedY } = pool.getFormattedLiquidity();
        
        poolsData.push({
          address: pool.address.toString(),
          binRange: pool.getBinRangeString(),
          priceRange: pool.getPriceRangeString(),
          tokenX: formattedX + ' ' + pool.tokenXSymbol,
          tokenY: formattedY + ' ' + pool.tokenYSymbol,
          status: PoolStatus.NORMAL
        });
      } else {
        // 如果有头寸，为每个头寸创建一行
        // 获取每个头寸的bin范围，并计算最大bin值用于排序
        const positionsWithBin = pool.positions.map(position => {
          const binIds = position.binData.map(bin => bin.binId);
          const minBinId = Math.min(...binIds);
          const maxBinId = Math.max(...binIds);
          return {
            position,
            minBinId,
            maxBinId
          };
        });
        
        // 按bin的最大值从大到小排序
        positionsWithBin.sort((a, b) => b.maxBinId - a.maxBinId);
        
        // 为每个排序后的头寸创建一行
        for (const { position, minBinId, maxBinId } of positionsWithBin) {
          const binRangeStr = `${minBinId}-${maxBinId}`;
          
          // 使用头寸的价格范围
          const priceRangeStr = position.getPriceRangeString();
          
          // 获取该头寸的流动性
          const { formattedX, formattedY } = position.getFormattedLiquidity();
          
          poolsData.push({
            address: pool.address.toString(),
            binRange: binRangeStr,
            priceRange: priceRangeStr,
            tokenX: formattedX + ' ' + pool.tokenXSymbol,
            tokenY: formattedY + ' ' + pool.tokenYSymbol,
            status: PoolStatus.NORMAL,
            positionId: position.publicKey.toString().slice(0, 8) + '...'
          });
        }
      }
    }
    
    display.updatePoolsData(poolsData);
    display.render();
  }

  /**
   * 获取池子链
   */
  public getPoolChain(): PoolChain {
    return this.poolChain;
  }
}

/**
 * 价格监控服务
 * 监控价格变化并触发相应事件
 */
export class PriceMonitorService {
  private connectionService: ConnectionService;
  private poolChain: PoolChain;
  private currentPrice: number = 0;
  private currentBinId: number = 0;
  private previousBinId: number = 0;
  private monitoring: boolean = false;
  private onPriceChangeCallbacks: ((price: number, previousPrice: number) => void)[] = [];
  private onPoolCrossingCallbacks: ((
    previousPool: Pool | undefined,
    currentPool: Pool | undefined
  ) => void)[] = [];
  
  /**
   * 构造函数
   */
  constructor(
    connectionService: ConnectionService,
    poolChain: PoolChain
  ) {
    this.connectionService = connectionService;
    this.poolChain = poolChain;
  }
  
  /**
   * 获取当前价格
   */
  public async getCurrentPrice(): Promise<number> {
    if (this.currentPrice === 0) {
      await this.updatePrice();
    }
    return this.currentPrice;
  }
  
  /**
   * 获取当前活跃bin ID
   */
  public getCurrentBinId(): number {
    return this.currentBinId;
  }
  
  /**
   * 更新价格和活跃bin
   */
  private async updatePrice(): Promise<void> {
    try {
      // 确保连接可用
      await this.connectionService.ensureConnected();
      
      // 获取所有池子
      const pools = this.poolChain.getAllPools();
      if (pools.length === 0) {
        logger.warn('没有可用池子，无法获取价格');
        return;
      }
      
      try {
        // 选择一个池子获取活跃bin数据
        // 这里默认使用第一个池子，因为活跃bin在所有池子中应该是一致的
        const pool = pools[0];
        
        // 获取活跃bin
        const activeBin = await pool.dlmmPool.getActiveBin();
        if (!activeBin) {
          logger.warn('获取活跃Bin失败，无法更新价格');
          return;
        }
        
        // 获取活跃bin的ID
        const activeBinId = activeBin.binId || activeBin.index;
        if (activeBinId === undefined) {
          logger.warn('无法获取活跃Bin ID');
          return;
        }
        
        // 保存之前的bin ID
        this.previousBinId = this.currentBinId;
        
        // 更新当前bin ID
        this.currentBinId = activeBinId;
        
        // 更新池链中的当前bin ID
        this.poolChain.updateCurrentBinId(this.currentBinId);
        
        // 获取bin对应的价格
        let price = 0;
        if (typeof pool.dlmmPool.getPriceFromBinId === 'function') {
          price = pool.dlmmPool.getPriceFromBinId(activeBinId);
          price = calculateRealPrice(price, pool.tokenXDecimals, pool.tokenYDecimals);
        } else {
          // 如果无法直接获取价格，可以使用其他方法
          // 例如从bin数据中获取价格信息
          const binIds = pool.getAllBinIds();
          // 查找匹配的bin
          for (const position of pool.positions) {
            const matchingBin = position.binData.find(bin => bin.binId === activeBinId);
            if (matchingBin && matchingBin.price) {
              price = parseFloat(matchingBin.price.toString());
              break;
            }
          }
          
          // 如果还是无法获取价格，使用bin ID作为近似值
          if (price === 0) {
            price = activeBinId;
          }
        }
        
        // 保存上一次价格用于对比
        const previousPrice = this.currentPrice;
        
        // 更新当前价格
        this.currentPrice = price;
        
        // 更新池链中的当前价格 (仍然需要更新价格以供其他功能使用)
        this.poolChain.updateCurrentPrice(this.currentPrice);
        
        // 处理bin ID变化
        this.processBinChange(this.currentBinId, this.previousBinId, this.currentPrice, previousPrice);
      } catch (error) {
        logger.error(`获取价格出错: ${error instanceof Error ? error.message : String(error)}`);
      }
    } catch (error) {
      logger.error(`更新价格出错: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 处理bin变化并显示
   */
  private processBinChange(currentBinId: number, previousBinId: number, currentPrice: number, previousPrice: number): void {
    // 如果是首次更新，没有之前的bin记录
    if (previousBinId === 0) {
      logger.info(`首次获取活跃Bin: ${currentBinId}, 价格: ${currentPrice}`);
      
      // 更新显示
      display.updateCurrentPrice(String(currentPrice));
      display.updateCurrentBinId(String(currentBinId));
      display.updateLastUpdated(new Date().toLocaleTimeString());
      return;
    }
    
    // 检查bin是否发生变化
    if (currentBinId !== previousBinId) {
      logger.info(`活跃Bin变化: ${previousBinId} -> ${currentBinId}, 价格: ${previousPrice.toFixed(8)} -> ${currentPrice.toFixed(8)}`);
      
      // 检查是否跨越池子边界
      const previousPool = this.findPoolByBin(previousBinId);
      const currentPool = this.findPoolByBin(currentBinId);
      
      if (previousPool !== currentPool) {
        logger.info(`跨越池子边界: ${previousPool?.address.toString().slice(0, 8)}... -> ${currentPool?.address.toString().slice(0, 8)}...`);
        
        // 触发池子跨越回调
        this.triggerPoolCrossingCallbacks(previousPool, currentPool);
      }
      
      // 触发价格变化回调
      this.triggerPriceChangeCallbacks(currentPrice, previousPrice);
    } else {
      // bin没有变化，但可能价格有微小变动
      if (previousPrice > 0 && currentPrice !== previousPrice) {
        const changePercent = Math.abs((currentPrice - previousPrice) / previousPrice) * 100;
        logger.debug(`价格变动${changePercent.toFixed(4)}%: ${previousPrice.toFixed(8)} -> ${currentPrice.toFixed(8)}, Bin保持在: ${currentBinId}`);
      }
    }
    
    // 更新显示
    display.updateCurrentPrice(String(currentPrice));
    display.updateCurrentBinId(String(currentBinId));
    display.updateLastUpdated(new Date().toLocaleTimeString());
  }

  /**
   * 根据bin ID查找所在的池子
   */
  private findPoolByBin(binId: number): Pool | undefined {
    return this.poolChain.getAllPools().find(pool => pool.isBinInRange(binId));
  }

  /**
   * 触发价格变化回调
   */
  private triggerPriceChangeCallbacks(price: number, previousPrice: number): void {
    for (const callback of this.onPriceChangeCallbacks) {
      try {
        callback(price, previousPrice);
      } catch (error) {
        logger.error(`执行价格变化回调时出错: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * 触发池子跨越回调
   */
  private triggerPoolCrossingCallbacks(previousPool: Pool | undefined, currentPool: Pool | undefined): void {
    for (const callback of this.onPoolCrossingCallbacks) {
      try {
        callback(previousPool, currentPool);
      } catch (error) {
        logger.error(`执行池子跨越回调时出错: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * 注册价格变化回调
   */
  public onPriceChange(callback: (price: number, previousPrice: number) => void): void {
    this.onPriceChangeCallbacks.push(callback);
  }

  /**
   * 注册池子跨越回调
   */
  public onPoolCrossing(callback: (previousPool: Pool | undefined, currentPool: Pool | undefined) => void): void {
    this.onPoolCrossingCallbacks.push(callback);
  }

  /**
   * 开始监控
   */
  public async startMonitoring(): Promise<void> {
    if (this.monitoring) return;
    
    this.monitoring = true;
    logger.info('开始价格监控');
    
    // 首次更新价格
    await this.updatePrice();
    
    // 定期更新价格
    this.monitoringLoop();
  }

  /**
   * 监控循环
   */
  private async monitoringLoop(): Promise<void> {
    while (this.monitoring) {
      try {
        await this.updatePrice();
      } catch (error) {
        logger.error(`价格监控出错: ${error instanceof Error ? error.message : String(error)}`);
      }
      
      // 等待指定时间
      await sleep(MONITOR_CONFIG.PRICE_CHECK_INTERVAL_MS);
    }
  }

  /**
   * 停止监控
   */
  public stopMonitoring(): void {
    this.monitoring = false;
    logger.info('停止价格监控');
  }
}

/**
 * 流动性调整服务
 * 执行流动性移除和添加操作
 */
export class LiquidityAdjustmentService {
  private connectionService: ConnectionService;
  private walletService: WalletService;
  private poolChain: PoolChain;
  private priceMonitorService: PriceMonitorService;
  private adjusting: boolean = false;
  private poolDiscoveryService: PoolDiscoveryService;
  
  /**
   * 构造函数
   */
  constructor(
    connectionService: ConnectionService,
    walletService: WalletService,
    poolChain: PoolChain,
    priceMonitorService: PriceMonitorService,
    poolDiscoveryService: PoolDiscoveryService
  ) {
    this.connectionService = connectionService;
    this.walletService = walletService;
    this.poolChain = poolChain;
    this.priceMonitorService = priceMonitorService;
    this.poolDiscoveryService = poolDiscoveryService;
    
    // 注册池子跨越回调
    this.priceMonitorService.onPoolCrossing((previousPool, currentPool) => {
      this.handlePoolCrossing(previousPool, currentPool);
    });
  }

  /**
   * 处理池子跨越事件
   */
  private async handlePoolCrossing(previousPool: Pool | undefined, currentPool: Pool | undefined): Promise<void> {
    // 如果正在调整，则跳过
    if (this.adjusting) {
      logger.warn('正在进行流动性调整，跳过池子跨越处理');
      return;
    }
    
    // 只有当跨越到有效池子时才进行检查
    if (currentPool) {
      await this.checkAndAdjustNeighboringPools();
    } else {
      logger.warn('价格超出所有已知池子范围，进入监控模式');
      display.updateStatusMessage('价格超出范围，仅监控');
    }
  }

  /**
   * 检查并调整相邻池子
   */
  public async checkAndAdjustNeighboringPools(): Promise<void> {
    // 如果正在调整，则跳过
    if (this.adjusting) {
      logger.warn('正在进行流动性调整，跳过检查');
      return;
    }
    
    try {
      this.adjusting = true;
      logger.info('开始检查相邻池子是否需要调整...');
      display.updateStatusMessage('检查相邻池子中...');
      
      // 获取当前价格
      const currentPrice = await this.priceMonitorService.getCurrentPrice();
      // 获取当前活跃bin
      const currentBinId = this.priceMonitorService.getCurrentBinId();
      logger.info(`当前价格: ${currentPrice.toFixed(8)}, 当前活跃Bin: ${currentBinId}`);
      
      // 检查相邻池子是否符合BidAsk模型
      logger.info('检查相邻头寸是否符合BidAsk模型...');
      const complianceCheck = this.poolChain.checkNeighboringPoolsCompliance();
      
      // 输出检查结果汇总
      logger.info('相邻头寸合规性检查结果:');
      if (complianceCheck.lowerPosition) {
        logger.info(`- 低头寸(${complianceCheck.lowerPosition.position.publicKey.toString().slice(0, 8)}...): ${complianceCheck.lowerPosition.isCompliant ? '符合' : '不符合'}`);
      } else {
        logger.info('- 无低头寸');
      }
      
      if (complianceCheck.currentPosition) {
        logger.info(`- 当前头寸(${complianceCheck.currentPosition.position.publicKey.toString().slice(0, 8)}...): ${complianceCheck.currentPosition.isCompliant ? '符合' : '不符合'}`);
      } else {
        logger.info('- 无当前头寸');
      }
      
      if (complianceCheck.higherPosition) {
        logger.info(`- 高头寸(${complianceCheck.higherPosition.position.publicKey.toString().slice(0, 8)}...): ${complianceCheck.higherPosition.isCompliant ? '符合' : '不符合'}`);
      } else {
        logger.info('- 无高头寸');
      }
      
      // 处理需要调整的头寸
      const positionsToAdjust: { position: Position; pool: Pool; isHigherThanCurrentPrice: boolean }[] = [];
      
      // 获取当前池
      const currentPool = this.poolChain.getCurrentPool();
      if (!currentPool) {
        logger.info('未找到当前活跃bin所在的池子，无法进行调整');
        return;
      }
      
      if (complianceCheck.lowerPosition && !complianceCheck.lowerPosition.isCompliant) {
        logger.info(`添加低头寸(${complianceCheck.lowerPosition.position.publicKey.toString().slice(0, 8)}...)到待调整列表`);
        positionsToAdjust.push({ 
          position: complianceCheck.lowerPosition.position, 
          pool: currentPool, 
          isHigherThanCurrentPrice: false 
        });
      }
      
      if (complianceCheck.higherPosition && !complianceCheck.higherPosition.isCompliant) {
        logger.info(`添加高头寸(${complianceCheck.higherPosition.position.publicKey.toString().slice(0, 8)}...)到待调整列表`);
        positionsToAdjust.push({ 
          position: complianceCheck.higherPosition.position, 
          pool: currentPool, 
          isHigherThanCurrentPrice: true 
        });
      }
      
      // 如果有需要调整的头寸，进行调整
      if (positionsToAdjust.length > 0) {
        logger.info(`发现${positionsToAdjust.length}个头寸需要调整`);
        display.updateStatusMessage(`准备调整${positionsToAdjust.length}个头寸`);
        
        for (const { position, pool, isHigherThanCurrentPrice } of positionsToAdjust) {
          logger.info(`开始调整头寸${position.publicKey.toString().slice(0, 8)}..., 期望分布: ${isHigherThanCurrentPrice ? '升序' : '降序'}`);
          // 调整单个头寸，而不是整个池子
          await this.adjustPosition(position, pool, isHigherThanCurrentPrice);
        }
        
        logger.info('完成所有头寸调整');
        display.updateStatusMessage('所有头寸调整完成');
      } else {
        logger.info('所有相邻头寸均符合BidAsk模型，无需调整');
        display.updateStatusMessage('所有头寸正常');
      }
    } catch (error) {
      logger.error(`检查和调整池子时出错: ${error instanceof Error ? error.message : String(error)}`);
      display.updateStatusMessage(`调整出错: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.adjusting = false;
      // 更新显示
      this.poolDiscoveryService.updatePoolsDisplay();
    }
  }

  /**
   * 调整单个头寸
   */
  private async adjustPosition(position: Position, pool: Pool, isHigherThanCurrentPrice: boolean): Promise<void> {
    const positionAddress = position.publicKey.toString();
    logger.info(`开始调整头寸: ${positionAddress}`);
    display.updateStatusMessage(`调整头寸: ${positionAddress}`);
    
    try {
      // 步骤1: 移除头寸的流动性
      const removeResult = await this.removePositionLiquidity(position, pool);
      if (!removeResult.success) {
        logger.error(`移除头寸流动性失败: ${removeResult.error || '未知错误'}`);
        display.updateStatusMessage(`调整失败: 移除流动性出错`);
        return;
      }
      
      if (!removeResult.liquidity) {
        logger.error('移除流动性成功但未返回流动性数据');
        display.updateStatusMessage(`调整失败: 无流动性数据`);
        return;
      }
      
      // 步骤2: 根据BidAsk模型重新添加流动性
      await this.addLiquidityForPosition(pool, position, isHigherThanCurrentPrice, removeResult.liquidity);
      
      // 再次刷新池数据，确保后续检查使用最新数据
      await pool.fetchPositions(this.walletService.getPublicKey());
      
      logger.info(`完成头寸调整: ${positionAddress}`);
    } catch (error) {
      logger.error(`调整头寸时出错: ${error instanceof Error ? error.message : String(error)}`);
      display.updateStatusMessage(`调整出错: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 移除单个头寸的流动性
   */
  private async removePositionLiquidity(position: Position, pool: Pool): Promise<{ 
    success: boolean; 
    error?: string;
    liquidity?: { totalX: bigint; totalY: bigint } 
  }> {
    const positionAddress = position.publicKey.toString();
    logger.info(`移除头寸${positionAddress}的流动性`);
    
    try {
      // 获取头寸的流动性
      const liquidity = position.getTotalLiquidity();
      
      // 获取头寸的bin ID范围
      const binIds = position.binData.map(bin => bin.binId);
      
      // 创建移除流动性交易
      const tx = await pool.dlmmPool.removeLiquidity({
        position: position.publicKey,
        user: this.walletService.getPublicKey(),
        fromBinId: Math.min(...binIds),
        toBinId: Math.max(...binIds),
        bps: new BN(10000), // 移除100%的流动性
        shouldClaimAndClose: false, // 不关闭头寸，仅移除流动性
      });
      
      // 签名并发送交易
      await this.walletService.signAndSendTransaction(tx);
      
      // 等待交易确认
      await sleep(2000);
      
      // 刷新头寸数据
      await pool.fetchPositions(this.walletService.getPublicKey());
      
      logger.info(`成功移除头寸${positionAddress}的流动性`);
      return { success: true, liquidity };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`移除头寸流动性失败: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 为单个头寸按策略添加流动性
   */
  private async addLiquidityForPosition(
    pool: Pool,
    position: Position,
    isHigherThanCurrentPrice: boolean,
    previousLiquidity: { totalX: bigint; totalY: bigint }
  ): Promise<void> {
    const positionAddress = position.publicKey.toString();
    logger.info(`按BidAsk模型为头寸${positionAddress}添加流动性`);
    
    try {
      // 获取头寸的bin范围
      const range = position.getBinRange();
      logger.info(`头寸bin范围: ${range.minBinId} - ${range.maxBinId}`);
      
      // 将bigint类型转换为BN类型
      const totalXAmount = new BN(previousLiquidity.totalX.toString());
      const totalYAmount = new BN(previousLiquidity.totalY.toString());
      
      // 创建添加流动性的交易
      const tx = await pool.dlmmPool.addLiquidityByStrategy({
        positionPubKey: position.publicKey, // 使用头寸的公钥
        user: this.walletService.getPublicKey(),
        totalXAmount: totalXAmount, // 使用BN类型
        totalYAmount: totalYAmount, // 使用BN类型
        strategy: {
          maxBinId: range.maxBinId,
          minBinId: range.minBinId,
          strategyType: DLMMSdk.StrategyType.BidAsk, // 使用BidAsk策略
          // 根据是否高于当前价格，控制策略参数
          singleSidedX: isHigherThanCurrentPrice, // 高于当前价格时使用X代币(升序分布)，否则使用Y代币(降序分布)
        },
      });
      
      // 签名并发送交易
      await this.walletService.signAndSendTransaction(tx);
      
      // 添加流动性成功后，刷新头寸数据
      await pool.fetchPositions(this.walletService.getPublicKey());
      
      logger.info(`成功按BidAsk模型为头寸${positionAddress}添加流动性`);
    } catch (error) {
      logger.error(`添加流动性时出错: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
} 