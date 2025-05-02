/**
 * DLMM串联池流动性管理脚本 - 显示模块
 * 
 * 负责所有终端界面显示功能，提供实时状态更新和可视化
 */

import { DISPLAY_CONFIG } from './config';
import { truncateAddress } from './utils';

// 终端颜色代码
const COLORS: Record<string, string> = {
  RESET: '\x1b[0m',
  RED: '\x1b[31m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  MAGENTA: '\x1b[35m',
  CYAN: '\x1b[36m',
  WHITE: '\x1b[37m',
  BRIGHT: '\x1b[1m',
  DIM: '\x1b[2m',
  BG_RED: '\x1b[41m',
  BG_GREEN: '\x1b[42m',
  BG_YELLOW: '\x1b[43m',
  BG_BLUE: '\x1b[44m',
};

/**
 * 池状态枚举
 */
export enum PoolStatus {
  NORMAL = 'normal',     // 正常
  CURRENT = 'current',   // 当前价格所在池
  ADJUSTING = 'adjusting', // 调整中
  WARNING = 'warning',   // 警告状态
  ERROR = 'error',       // 错误状态
}

/**
 * 池子显示数据结构
 */
export interface PoolDisplayData {
  address: string;
  binRange: string;
  priceRange: string;
  tokenX: string;
  tokenY: string;
  status: PoolStatus;
  isBidAsk?: boolean;
  positionId?: string;
}

/**
 * 状态颜色映射
 */
const STATUS_COLORS: Record<PoolStatus, string> = {
  [PoolStatus.NORMAL]: COLORS.WHITE,
  [PoolStatus.CURRENT]: COLORS.BG_GREEN + COLORS.WHITE,
  [PoolStatus.ADJUSTING]: COLORS.BG_BLUE + COLORS.WHITE,
  [PoolStatus.WARNING]: COLORS.BG_YELLOW + COLORS.WHITE,
  [PoolStatus.ERROR]: COLORS.BG_RED + COLORS.WHITE,
};

/**
 * 状态文本映射
 */
const STATUS_TEXT: Record<PoolStatus, string> = {
  [PoolStatus.NORMAL]: '正常',
  [PoolStatus.CURRENT]: '当前',
  [PoolStatus.ADJUSTING]: '调整中',
  [PoolStatus.WARNING]: '警告',
  [PoolStatus.ERROR]: '错误',
};

/**
 * 显示管理器类
 */
export class Display {
  private isFirstRender: boolean = true;
  private poolsData: PoolDisplayData[] = [];
  private currentPrice: string = 'N/A';
  private lastUpdateTime: string = '';
  private statusMessage: string = '';
  private currentBinId: string = 'N/A';

  /**
   * 清除屏幕
   */
  private clearScreen(): void {
    if (this.isFirstRender) {
      console.clear();
      this.isFirstRender = false;
    } else {
      // 使用ANSI转义序列移动光标到顶部
      process.stdout.write('\x1B[1;1H\x1B[J');
    }
  }

  /**
   * 生成表格水平分隔符
   */
  private generateHorizontalLine(width: number): string {
    return '─'.repeat(width);
  }

  /**
   * 生成固定宽度的单元格内容（左对齐数据）
   */
  private formatCell(content: string, width: number): string {
    if (content.length > width) {
      return content.substring(0, width - 3) + '...';
    }
    // 左对齐数据，前后补充空格
    return ' ' + content.padEnd(width - 2, ' ') + ' ';
  }

  /**
   * 生成固定宽度的标题单元格内容（居中对齐）
   */
  private formatHeaderCell(content: string, width: number): string {
    if (content.length > width) {
      return content.substring(0, width - 3) + '...';
    }
    // 居中对齐标题
    const padding = width - content.length;
    const leftPad = Math.floor(padding / 2);
    const rightPad = padding - leftPad;
    return ' '.repeat(leftPad) + content + ' '.repeat(rightPad);
  }

  /**
   * 渲染表头
   */
  private renderTableHeader(): void {
    const { POOL_ADDRESS, BIN_RANGE, PRICE_RANGE, TOKEN_X, TOKEN_Y, STATUS, POSITION_ID } = DISPLAY_CONFIG.TABLE_COLUMN_WIDTHS;
    
    // 表头 - 使用居中对齐的标题
    const header = `│ ${this.formatHeaderCell('池地址', POOL_ADDRESS)} │ ${this.formatHeaderCell('Bin范围', BIN_RANGE)} │ ${this.formatHeaderCell('价格范围', PRICE_RANGE)} │ ${this.formatHeaderCell('X代币', TOKEN_X)} │ ${this.formatHeaderCell('Y代币', TOKEN_Y)} │ ${this.formatHeaderCell('状态', STATUS)} │ ${this.formatHeaderCell('头寸ID', POSITION_ID)} │`;
    
    // 分隔线
    const separator = `├─${this.generateHorizontalLine(POOL_ADDRESS)}─┼─${this.generateHorizontalLine(BIN_RANGE)}─┼─${this.generateHorizontalLine(PRICE_RANGE)}─┼─${this.generateHorizontalLine(TOKEN_X)}─┼─${this.generateHorizontalLine(TOKEN_Y)}─┼─${this.generateHorizontalLine(STATUS)}─┼─${this.generateHorizontalLine(POSITION_ID)}─┤`;
    
    const topLine = `┌─${this.generateHorizontalLine(POOL_ADDRESS)}─┬─${this.generateHorizontalLine(BIN_RANGE)}─┬─${this.generateHorizontalLine(PRICE_RANGE)}─┬─${this.generateHorizontalLine(TOKEN_X)}─┬─${this.generateHorizontalLine(TOKEN_Y)}─┬─${this.generateHorizontalLine(STATUS)}─┬─${this.generateHorizontalLine(POSITION_ID)}─┐`;
    
    console.log(topLine);
    console.log(header);
    console.log(separator);
  }

  /**
   * 渲染表格行
   */
  private renderTableRow(pool: PoolDisplayData): void {
    const { POOL_ADDRESS, BIN_RANGE, PRICE_RANGE, TOKEN_X, TOKEN_Y, STATUS, POSITION_ID } = DISPLAY_CONFIG.TABLE_COLUMN_WIDTHS;
    
    const statusColor = STATUS_COLORS[pool.status];
    const statusText = STATUS_TEXT[pool.status];
    
    // 处理地址显示
    const displayAddress = truncateAddress(pool.address, POOL_ADDRESS);
    
    // 格式化状态显示
    const formattedStatus = pool.isBidAsk === false 
      ? `${statusColor}${this.formatCell('非BidAsk', STATUS)}${COLORS.RESET}`
      : `${statusColor}${this.formatCell(statusText, STATUS)}${COLORS.RESET}`;
    
    // 处理头寸ID显示
    const displayPositionId = pool.positionId || '-';
    
    // 构建行
    const row = `│ ${this.formatCell(displayAddress, POOL_ADDRESS)} │ ${this.formatCell(pool.binRange, BIN_RANGE)} │ ${this.formatCell(pool.priceRange, PRICE_RANGE)} │ ${this.formatCell(pool.tokenX, TOKEN_X)} │ ${this.formatCell(pool.tokenY, TOKEN_Y)} │ ${formattedStatus} │ ${this.formatCell(displayPositionId, POSITION_ID)} │`;
    
    console.log(row);
  }

  /**
   * 更新池子数据
   */
  public updatePoolsData(poolsData: PoolDisplayData[]): void {
    this.poolsData = poolsData;
    this.lastUpdateTime = new Date().toLocaleTimeString();
  }

  /**
   * 更新当前价格
   */
  public updateCurrentPrice(price: string): void {
    this.currentPrice = price;
  }

  /**
   * 更新最后更新时间
   */
  public updateLastUpdated(time: string): void {
    this.lastUpdateTime = time;
  }

  /**
   * 更新状态消息
   */
  public updateStatusMessage(message: string): void {
    this.statusMessage = message;
  }

  /**
   * 显示消息（别名方法，与updateStatusMessage功能相同）
   */
  public displayMessage(message: string): void {
    this.updateStatusMessage(message);
    this.render();
  }

  /**
   * 更新当前bin ID
   */
  public updateCurrentBinId(binId: string): void {
    this.currentBinId = binId;
  }

  /**
   * 渲染概览信息
   */
  private renderSummary(): void {
    console.log(`\n当前X代币价格: ${COLORS.BRIGHT}${this.currentPrice}${COLORS.RESET}`);
    console.log(`当前活跃Bin ID: ${COLORS.CYAN}${this.currentBinId}${COLORS.RESET}`);
    console.log(`最后更新时间: ${this.lastUpdateTime}`);
    
    if (this.statusMessage) {
      console.log(`\n状态: ${this.statusMessage}`);
    }
  }

  /**
   * 渲染进度条
   */
  public renderProgressBar(current: number, total: number, width: number = 30): void {
    const percentage = Math.min(Math.max(current / total, 0), 1);
    const filledWidth = Math.round(width * percentage);
    const emptyWidth = width - filledWidth;
    
    const filledBar = '█'.repeat(filledWidth);
    const emptyBar = '░'.repeat(emptyWidth);
    
    process.stdout.write(`\r[${filledBar}${emptyBar}] ${(percentage * 100).toFixed(1)}% (${current}/${total})`);
    
    if (current === total) {
      process.stdout.write('\n');
    }
  }

  /**
   * 渲染完整界面
   */
  public render(): void {
    this.clearScreen();
    
    // 标题
    console.log(`${COLORS.BRIGHT}===== DLMM串联池流动性管理 =====${COLORS.RESET}`);
    
    // 表格
    if (this.poolsData.length > 0) {
      this.renderTableHeader();
      this.poolsData.forEach(pool => this.renderTableRow(pool));
      const { POOL_ADDRESS, BIN_RANGE, PRICE_RANGE, TOKEN_X, TOKEN_Y, STATUS, POSITION_ID } = DISPLAY_CONFIG.TABLE_COLUMN_WIDTHS;
      const bottomLine = `└─${this.generateHorizontalLine(POOL_ADDRESS)}─┴─${this.generateHorizontalLine(BIN_RANGE)}─┴─${this.generateHorizontalLine(PRICE_RANGE)}─┴─${this.generateHorizontalLine(TOKEN_X)}─┴─${this.generateHorizontalLine(TOKEN_Y)}─┴─${this.generateHorizontalLine(STATUS)}─┴─${this.generateHorizontalLine(POSITION_ID)}─┘`;
      console.log(bottomLine);
    } else {
      console.log("\n未发现池子数据");
    }
    
    // 概览
    this.renderSummary();
  }
}

// 导出单例实例
export const display = new Display(); 