/**
 * DLMM串联池流动性管理脚本 - 配置文件
 * 
 * 本文件集中管理所有配置参数，方便统一调整和维护
 */

// 应用程序配置
export const APPLICATION_CONFIG = {
  // 应用版本
  VERSION: '1.0.0',
  // 应用名称
  NAME: 'DLMM链上池子管理服务',
};

// RPC连接设置
export const CONNECTION_CONFIG = {
  // Solana RPC端点
  RPC_ENDPOINT: 'https://solana.publicnode.com',
  
  // 备用RPC节点列表 - 尝试更多可能支持DLMM查询的节点
  BACKUP_RPC_ENDPOINTS: [
    'https://rpc.ankr.com/solana',
    'https://api.mainnet-beta.solana.com', 
    'https://solana-mainnet.rpc.staratlas.cloud',
  ],
  
  // 连接选项
  CONNECTION_OPTIONS: {
    commitment: 'confirmed',
    disableRetryOnRateLimit: false,
    confirmTransactionInitialTimeout: 60000
  },
  // 重连最大尝试次数
  MAX_CONNECTION_RETRIES: 10,
  // 重连间隔基础时间(毫秒)
  RECONNECT_BASE_DELAY_MS: 2000,
  // SOL余额检查区间(秒)
  BALANCE_CHECK_INTERVAL_SEC: 300, // 5分钟
  // 最小SOL余额警告阈值
  MIN_SOL_BALANCE: 0.01,
};

// DLMM相关配置
export const DLMM_CONFIG = {
  // 默认池地址列表（如果已知）
  POOL_ADDRESSES: [
    '3msVd34R5KxonDzyNSV5nT19UtUeJ2RF1NaQhvVPNLxL' // 从read-position-simplified.ts中获取的示例池地址
  ],
  // 获取池子的最大重试次数
  MAX_POOL_FETCH_RETRIES: 3,
  // 获取头寸的最大重试次数
  MAX_POSITION_FETCH_RETRIES: 3,
  // 检查的最大池子数量（当自动发现池子时）
  MAX_POOLS_TO_CHECK: 50,
};

// 钱包配置
export const WALLET_CONFIG = {
  // 私钥，已移至加密文件存储，此处保留空字符串以保持接口兼容
  PRIVATE_KEY: ""
};

// 监控参数
export const MONITOR_CONFIG = {
  // 同一池子内价格监控间隔(毫秒)
  PRICE_CHECK_INTERVAL_MS: 3000, // 3秒
};

// 调整策略参数
export const ADJUSTMENT_CONFIG = {
  // 调整时的最大重试次数
  MAX_ADJUSTMENT_RETRIES: 1,
  // BidAsk模型最小流动性比例差异(倍数)
  MIN_LIQUIDITY_RATIO: 3.0, // 至少1倍差异
};

// 错误处理配置
export const ERROR_CONFIG = {
  // 临时错误的重试策略
  RETRY_CONFIG: {
    // 最大重试次数
    MAX_RETRIES: 3,
    // 初始重试延迟(毫秒)
    INITIAL_RETRY_DELAY_MS: 1000,
    // 重试延迟增长系数
    BACKOFF_FACTOR: 2,
  },
};

// 交易费用配置
export const TRANSACTION_CONFIG = {
  // 是否启用优先级费用
  ENABLE_PRIORITY_FEE: true,
  // 优先级费用(microLamports)
  // 200,000 microLamports ≈ 0.000001 SOL
  PRIORITY_FEE_MICROLAMPORTS: 200000,
  // 计算单元限制(如果需要设置)
  COMPUTE_UNIT_LIMIT: 1000000,
  // 是否自动设置计算单元限制
  AUTO_COMPUTE_UNIT_LIMIT: false,
  // 交易重试策略
  TRANSACTION_RETRY: {
    // 最大重试次数
    MAX_RETRIES: 5,
    // 重试间隔(毫秒)
    RETRY_INTERVAL_MS: 3000,
    // 交易超时时间(毫秒)
    TRANSACTION_TIMEOUT_MS: 90000,
  },
};

// 日志配置
export const LOGGER_CONFIG = {
  // 日志级别: 'debug' | 'info' | 'warn' | 'error'
  // 优先使用环境变量中的DEBUG设置
  LOG_LEVEL: process.env.DEBUG === 'true' ? 'debug' : 'info',
  // 是否输出时间戳
  TIMESTAMP: true,
  // 是否输出到文件
  LOG_TO_FILE: true,
  // 日志文件路径
  LOG_FILE_PATH: './logs/dlmm-manager.log',
};

// 显示配置
export const DISPLAY_CONFIG = {
  // 表格列宽
  TABLE_COLUMN_WIDTHS: {
    POOL_ADDRESS: 14,  // 截断的池地址
    BIN_RANGE: 13,     // bin范围
    PRICE_RANGE: 16,   // 价格范围
    TOKEN_X: 15,       // X代币数量
    TOKEN_Y: 15,       // Y代币数量
    STATUS: 10,        // 状态信息
    POSITION_ID: 12,   // 头寸ID
  },
  // 是否使用颜色
  USE_COLORS: true,
  // 刷新频率(毫秒)
  REFRESH_RATE_MS: 5000,
}; 