/**
 * DLMM串联池流动性管理脚本 - 日志模块
 * 
 * 负责系统日志管理，支持多级别日志和格式化输出
 */

import * as fs from 'fs';
import * as path from 'path';
import { LOGGER_CONFIG } from './config';

// 日志级别枚举
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

// 日志级别映射
const LOG_LEVEL_MAP: Record<string, LogLevel> = {
  'debug': LogLevel.DEBUG,
  'info': LogLevel.INFO,
  'warn': LogLevel.WARN,
  'error': LogLevel.ERROR
};

// 终端颜色代码
const COLORS: Record<string, string> = {
  RESET: '\x1b[0m',
  DEBUG: '\x1b[36m', // 青色
  INFO: '\x1b[32m',  // 绿色
  WARN: '\x1b[33m',  // 黄色
  ERROR: '\x1b[31m', // 红色
  TIME: '\x1b[90m',  // 灰色
  BG_DEBUG: '\x1b[46m\x1b[30m', // 青色背景，黑色文字
};

/**
 * 日志管理器类
 */
class Logger {
  private level: LogLevel;
  private useTimestamp: boolean;
  private logToFile: boolean;
  private logFilePath: string;
  private isDebugMode: boolean;

  constructor() {
    this.isDebugMode = process.env.DEBUG === 'true';
    this.level = this.isDebugMode ? LogLevel.DEBUG : (LOG_LEVEL_MAP[LOGGER_CONFIG.LOG_LEVEL] || LogLevel.INFO);
    this.useTimestamp = LOGGER_CONFIG.TIMESTAMP;
    this.logToFile = LOGGER_CONFIG.LOG_TO_FILE;
    this.logFilePath = LOGGER_CONFIG.LOG_FILE_PATH;

    // 如果需要记录到文件，确保日志目录存在
    if (this.logToFile) {
      const logDir = path.dirname(this.logFilePath);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
    }
    
    // 调试模式下，打印初始化消息
    if (this.isDebugMode) {
      console.log(`${COLORS.BG_DEBUG}[DLMM调试模式]${COLORS.RESET} 日志级别: DEBUG`);
    }
  }

  /**
   * 获取当前时间戳字符串
   */
  private getTimestamp(): string {
    const now = new Date();
    return now.toISOString();
  }

  /**
   * 格式化日志消息
   */
  private formatMessage(level: string, message: string): string {
    let formattedMessage = '';
    
    // 添加时间戳
    if (this.useTimestamp) {
      formattedMessage += `${COLORS.TIME}[${this.getTimestamp()}]${COLORS.RESET} `;
    }
    
    // 添加日志级别
    const levelColor = COLORS[level] || COLORS.RESET;
    
    // 调试模式下的DEBUG消息使用特殊格式
    if (level === 'DEBUG' && this.isDebugMode) {
      formattedMessage += `${COLORS.BG_DEBUG}[${level}]${COLORS.RESET} ${message}`;
    } else {
      formattedMessage += `${levelColor}[${level}]${COLORS.RESET} ${message}`;
    }
    
    return formattedMessage;
  }

  /**
   * 写入日志到文件
   */
  private writeToFile(message: string): void {
    if (!this.logToFile) return;
    
    // 移除颜色代码的纯文本消息
    const plainMessage = message.replace(/\x1b\[\d+m/g, '');
    
    try {
      fs.appendFileSync(this.logFilePath, plainMessage + '\n');
    } catch (error) {
      // 如果写入文件失败，输出到控制台
      console.error(`无法写入日志文件: ${error}`);
    }
  }

  /**
   * DEBUG级别日志
   */
  debug(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.DEBUG) {
      const formattedMessage = this.formatMessage('DEBUG', message);
      console.log(formattedMessage, ...args);
      this.writeToFile(`${formattedMessage} ${args.join(' ')}`);
    }
  }

  /**
   * INFO级别日志
   */
  info(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      const formattedMessage = this.formatMessage('INFO', message);
      console.log(formattedMessage, ...args);
      this.writeToFile(`${formattedMessage} ${args.join(' ')}`);
    }
  }

  /**
   * WARN级别日志
   */
  warn(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.WARN) {
      const formattedMessage = this.formatMessage('WARN', message);
      console.warn(formattedMessage, ...args);
      this.writeToFile(`${formattedMessage} ${args.join(' ')}`);
    }
  }

  /**
   * ERROR级别日志
   */
  error(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.ERROR) {
      const formattedMessage = this.formatMessage('ERROR', message);
      console.error(formattedMessage, ...args);
      this.writeToFile(`${formattedMessage} ${args.join(' ')}`);
    }
  }

  /**
   * 记录错误对象
   */
  logError(error: Error, context?: string): void {
    const contextMsg = context ? `[${context}] ` : '';
    this.error(`${contextMsg}错误: ${error.message}`);
    if (error.stack) {
      this.debug(`堆栈追踪: ${error.stack}`);
    }
  }

  /**
   * 分组标记，用于视觉上分隔日志消息
   */
  group(title: string): void {
    const separator = '-'.repeat(50);
    this.info(`\n${separator}`);
    this.info(`--- ${title} ---`);
    this.info(`${separator}`);
  }
}

// 导出单例实例
export const logger = new Logger(); 