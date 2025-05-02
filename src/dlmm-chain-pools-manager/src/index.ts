/**
 * DLMM串联池流动性管理脚本 - 主程序入口
 * 
 * 程序入口点，负责初始化各服务、实现主工作流程，以及处理错误和退出逻辑
 */

import { logger } from './logger';
import { display } from './display';
import { sleep } from './utils';
import {
  ConnectionService, 
  WalletService, 
  PoolDiscoveryService, 
  PriceMonitorService,
  LiquidityAdjustmentService
} from './services';
import { MONITOR_CONFIG, APPLICATION_CONFIG } from './config';

// 检查是否为调试模式
const isDebugMode = process.env.DEBUG === 'true';

/**
 * 应用主类
 */
export class DLMMChainPoolsManager {
  private connectionService: ConnectionService;
  private walletService: WalletService;
  private poolDiscoveryService: PoolDiscoveryService;
  private priceMonitorService: PriceMonitorService | null = null;
  private liquidityAdjustmentService: LiquidityAdjustmentService | null = null;
  private running: boolean = false;
  
  /**
   * 构造函数
   */
  constructor(
    connectionService: ConnectionService,
    walletService: WalletService,
    displayService: any // 使用any类型避免类型错误
  ) {
    // 初始化各服务
    this.connectionService = connectionService;
    this.walletService = walletService;
    this.poolDiscoveryService = new PoolDiscoveryService(this.connectionService, this.walletService);
  }
  
  /**
   * 初始化应用
   */
  public async initialize(): Promise<void> {
    try {
      logger.group('初始化应用');
      
      if (isDebugMode) {
        logger.debug('调试模式已启用');
        logger.debug('系统环境信息:');
        logger.debug(`Node.js版本: ${process.version}`);
        logger.debug(`平台: ${process.platform}`);
        logger.debug(`系统内存: ${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)} MB`);
      }
      
      // 连接区块链网络
      logger.info('正在连接到Solana网络...');
      await this.connectionService.initialize();
      
      // 显示钱包信息
      const walletAddress = this.walletService.getAddress();
      logger.info(`使用钱包: ${walletAddress}`);
      
      // 获取SOL余额
      const solBalance = await this.walletService.getSolBalance();
      logger.info(`钱包SOL余额: ${solBalance.toFixed(4)} SOL`);
      
      // 发现池子
      logger.info('开始发现用户创建的池子...');
      const poolChain = await this.poolDiscoveryService.discoverPools();
      
      if (isDebugMode) {
        logger.debug(`发现的池子数量: ${poolChain.getAllPools().length}`);
        for (const pool of poolChain.getAllPools()) {
          logger.debug(`池子地址: ${pool.address}, 价格范围: ${pool.priceRange.minPrice.toFixed(8)}-${pool.priceRange.maxPrice.toFixed(8)}`);
        }
      }
      
      // 初始化价格监控服务
      this.priceMonitorService = new PriceMonitorService(this.connectionService, poolChain);
      
      // 初始化流动性调整服务
      this.liquidityAdjustmentService = new LiquidityAdjustmentService(
        this.connectionService,
        this.walletService,
        poolChain,
        this.priceMonitorService,
        this.poolDiscoveryService
      );
      
      logger.info('应用初始化完成');
    } catch (error) {
      logger.error(`初始化应用时出错: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * 启动应用
   */
  public async start(): Promise<void> {
    if (this.running) {
      logger.warn('应用已经在运行中');
      return;
    }
    
    try {
      this.running = true;
      logger.group('启动应用');
      
      // 显示欢迎信息
      display.updateStatusMessage('正在启动...');
      display.render();
      
      // 检查并初始化（如果尚未初始化）
      if (!this.priceMonitorService || !this.liquidityAdjustmentService) {
        await this.initialize();
      }
      
      // 启动价格监控
      logger.info('启动价格监控...');
      await this.priceMonitorService!.startMonitoring();
      
      // 进行首次邻近池子检查
      logger.info('进行首次邻近池子检查...');
      await this.liquidityAdjustmentService!.checkAndAdjustNeighboringPools();
      
      // 启动定时检查循环
      this.startPeriodicChecks();
      
      logger.info('应用成功启动');
      display.updateStatusMessage(isDebugMode ? '调试模式运行中' : '运行中');
      display.render();
    } catch (error) {
      this.running = false;
      logger.error(`启动应用时出错: ${error instanceof Error ? error.message : String(error)}`);
      display.updateStatusMessage(`启动失败: ${error instanceof Error ? error.message : String(error)}`);
      display.render();
    }
  }
  
  /**
   * 启动定时检查循环
   */
  private async startPeriodicChecks(): Promise<void> {
    if (!this.running || !this.liquidityAdjustmentService) return;
    
    const liquidityService = this.liquidityAdjustmentService;
    
    // 启动一个异步循环，定时检查相邻池子
    (async () => {
      while (this.running) {
        try {
          await sleep(MONITOR_CONFIG.PRICE_CHECK_INTERVAL_MS);
          
          if (this.running) {
            logger.info('执行定时邻近池子检查...');
            await liquidityService.checkAndAdjustNeighboringPools();
          }
        } catch (error) {
          logger.error(`定时检查时出错: ${error instanceof Error ? error.message : String(error)}`);
          // 出错后继续运行，不中断循环
        }
      }
    })();
  }
  
  /**
   * 停止应用
   */
  public stop(): void {
    if (!this.running) {
      logger.warn('应用未在运行');
      return;
    }
    
    logger.group('停止应用');
    
    // 停止价格监控
    if (this.priceMonitorService) {
      this.priceMonitorService.stopMonitoring();
    }
    
    this.running = false;
    logger.info('应用已停止');
    display.updateStatusMessage('已停止');
    display.render();
  }
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  try {
    // 设置退出处理
    process.on('SIGINT', () => {
      logger.info('接收到终止信号，正在退出...');
      display.displayMessage('正在退出，请稍候...');
      process.exit(0);
    });

    // 显示欢迎信息
    display.displayMessage(`DLMM链上池子管理服务 v${APPLICATION_CONFIG.VERSION}`);
    logger.info(`启动 DLMM链上池子管理服务 v${APPLICATION_CONFIG.VERSION}`);

    // 初始化基础服务
    const connectionService = new ConnectionService();
    const walletService = new WalletService(connectionService);
    
    // 初始化钱包服务（加载私钥），这一步会提示用户输入密码
    logger.info('初始化钱包服务...');
    await walletService.init();
    logger.info('钱包初始化成功');
    
    // 创建主管理器实例
    const manager = new DLMMChainPoolsManager(
      connectionService,
      walletService,
      display
    );
    
    // 启动服务
    await manager.start();
  } catch (error) {
    logger.error(`运行时错误: ${error instanceof Error ? error.message : String(error)}`);
    display.displayMessage(`发生错误: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// 运行主函数
main().catch(error => {
  console.error('未捕获的错误:', error);
  process.exit(1);
}); 