/**
 * 私钥加密解密工具
 * 使用AES-256-GCM算法加密私钥
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

// 加密密钥文件名
export const ENCRYPTED_KEY_FILENAME = '.encrypted_wallet.dat';
// 默认加密密钥存储路径
export const DEFAULT_ENCRYPTION_PATH = path.join(process.cwd());

/**
 * 从用户终端获取密码
 */
export async function getPasswordFromUser(prompt: string = '请输入解密密码: '): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    // 提示用户输入密码
    rl.question(prompt, (password) => {
      rl.close();
      resolve(password);
    });
  });
}

/**
 * 加密私钥
 * @param privateKey 要加密的私钥
 * @param password 加密密码
 * @returns 加密数据对象
 */
export function encryptPrivateKey(privateKey: string, password: string): { 
  encryptedData: string;
  iv: string;
  salt: string;
} {
  // 生成随机盐值
  const salt = crypto.randomBytes(16).toString('hex');
  
  // 从密码和盐值生成密钥
  const key = crypto.scryptSync(password, salt, 32);
  
  // 生成随机初始化向量
  const iv = crypto.randomBytes(16);
  
  // 创建加密器
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  // 加密私钥
  let encrypted = cipher.update(privateKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  // 获取认证标签
  const authTag = cipher.getAuthTag().toString('hex');
  
  // 组合加密数据、认证标签、初始化向量和盐值
  const encryptedData = encrypted + ':' + authTag;
  
  return {
    encryptedData,
    iv: iv.toString('hex'),
    salt
  };
}

/**
 * 解密私钥
 * @param encryptedData 加密数据
 * @param iv 初始化向量
 * @param salt 盐值
 * @param password 解密密码
 * @returns 解密后的私钥
 */
export function decryptPrivateKey(encryptedData: string, iv: string, salt: string, password: string): string {
  try {
    // 分离加密数据和认证标签
    const [encrypted, authTag] = encryptedData.split(':');
    
    // 从密码和盐值生成密钥
    const key = crypto.scryptSync(password, salt, 32);
    
    // 创建解密器
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm', 
      key, 
      Buffer.from(iv, 'hex')
    );
    
    // 设置认证标签
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    
    // 解密私钥
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    throw new Error('解密失败，密码可能不正确');
  }
}

/**
 * 保存加密的私钥到文件
 * @param encryptedData 加密数据对象
 * @param filePath 文件路径
 */
export function saveEncryptedKey(
  encryptedData: { encryptedData: string; iv: string; salt: string },
  filePath: string = path.join(DEFAULT_ENCRYPTION_PATH, ENCRYPTED_KEY_FILENAME)
): void {
  // 确保目录存在
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // 将加密数据保存为JSON格式
  fs.writeFileSync(
    filePath, 
    JSON.stringify(encryptedData, null, 2), 
    { encoding: 'utf8', mode: 0o600 } // 仅所有者可读写
  );
  
  console.log(`加密的私钥已保存到 ${filePath}`);
}

/**
 * 从文件加载加密的私钥
 * @param filePath 文件路径
 * @returns 加密数据对象
 */
export function loadEncryptedKey(
  filePath: string = path.join(DEFAULT_ENCRYPTION_PATH, ENCRYPTED_KEY_FILENAME)
): { encryptedData: string; iv: string; salt: string } {
  if (!fs.existsSync(filePath)) {
    throw new Error(`加密私钥文件不存在: ${filePath}`);
  }
  
  try {
    // 从文件读取加密数据
    const fileContent = fs.readFileSync(filePath, { encoding: 'utf8' });
    return JSON.parse(fileContent);
  } catch (error) {
    throw new Error(`读取加密私钥文件失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 加载并解密私钥
 * @param password 解密密码
 * @param filePath 加密私钥文件路径
 * @returns 解密后的私钥
 */
export async function loadAndDecryptPrivateKey(
  password?: string,
  filePath: string = path.join(DEFAULT_ENCRYPTION_PATH, ENCRYPTED_KEY_FILENAME)
): Promise<string> {
  // 加载加密的私钥
  const encryptedKeyData = loadEncryptedKey(filePath);
  
  // 如果没有提供密码，从用户终端获取
  if (!password) {
    password = await getPasswordFromUser();
  }
  
  // 解密私钥
  return decryptPrivateKey(
    encryptedKeyData.encryptedData,
    encryptedKeyData.iv,
    encryptedKeyData.salt,
    password
  );
}

/**
 * 获取加密密钥文件的完整路径
 * @param customPath 自定义路径
 * @returns 完整文件路径
 */
export function getEncryptedKeyPath(customPath?: string): string {
  // 默认路径使用绝对路径，而不是相对路径
  const defaultPath = customPath || DEFAULT_ENCRYPTION_PATH;
  const fullPath = path.resolve(defaultPath, ENCRYPTED_KEY_FILENAME);
  console.log(`加密文件查找路径: ${fullPath}`);
  console.log(`当前工作目录: ${process.cwd()}`);
  
  // 检查文件是否存在并输出日志
  try {
    if (fs.existsSync(fullPath)) {
      console.log(`找到加密文件: ${fullPath}`);
    } else {
      console.log(`未找到加密文件: ${fullPath}`);
      // 尝试查找用户主目录中的加密文件
      const homeDir = require('os').homedir();
      const homeFilePath = path.join(homeDir, ENCRYPTED_KEY_FILENAME);
      if (fs.existsSync(homeFilePath)) {
        console.log(`在用户主目录中找到加密文件: ${homeFilePath}`);
        return homeFilePath;
      }
      
      // 尝试查找上级目录中的加密文件
      const parentDir = path.resolve(process.cwd(), '..');
      const parentFilePath = path.join(parentDir, ENCRYPTED_KEY_FILENAME);
      if (fs.existsSync(parentFilePath)) {
        console.log(`在上级目录中找到加密文件: ${parentFilePath}`);
        return parentFilePath;
      }
    }
  } catch (error) {
    console.error(`检查加密文件时出错: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  return fullPath;
} 