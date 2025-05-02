/**
 * 私钥加密脚本
 * 
 * 用途：加密私钥并存储到文件中，提高安全性
 * 使用方法：
 *   1. 运行 `npm run encrypt-key`
 *   2. 按提示输入私钥和加密密码
 */

import { 
  encryptPrivateKey, 
  saveEncryptedKey, 
  getPasswordFromUser,
  getEncryptedKeyPath,
  ENCRYPTED_KEY_FILENAME
} from '../utils/crypto';
import { WALLET_CONFIG } from '../dlmm-chain-pools-manager/src/config';
import path from 'path';

/**
 * 主函数
 */
async function main() {
  try {
    console.log('========================================');
    console.log('私钥加密工具');
    console.log('========================================');
    console.log('此工具将加密您的私钥并保存到安全文件中');
    console.log('只有使用正确的密码才能访问加密的私钥');
    console.log('请确保记住您的密码，否则将无法恢复私钥');
    console.log('========================================\n');
    
    // 显示当前工作目录
    console.log(`当前工作目录: ${process.cwd()}`);
    
    // 获取要加密的私钥
    let privateKey: string;
    
    if (WALLET_CONFIG.PRIVATE_KEY) {
      console.log('检测到配置文件中存在私钥');
      const useConfigKey = await getYesNoInput('是否使用配置文件中的私钥? (y/n): ');
      
      if (useConfigKey) {
        privateKey = WALLET_CONFIG.PRIVATE_KEY;
        console.log('将使用配置文件中的私钥进行加密');
      } else {
        privateKey = await getPasswordFromUser('请输入要加密的私钥: ');
      }
    } else {
      privateKey = await getPasswordFromUser('请输入要加密的私钥: ');
    }
    
    // 获取加密密码
    const password = await getPasswordFromUser('请设置加密密码: ');
    const confirmPassword = await getPasswordFromUser('请再次输入密码确认: ');
    
    if (password !== confirmPassword) {
      console.error('两次输入的密码不一致，加密已取消');
      process.exit(1);
    }
    
    // 加密私钥
    console.log('正在加密私钥...');
    const encryptedData = encryptPrivateKey(privateKey, password);
    
    // 保存加密的私钥到文件
    const filePath = getEncryptedKeyPath();
    saveEncryptedKey(encryptedData, filePath);
    
    console.log('\n加密完成!');
    console.log(`私钥已安全加密并保存到文件: ${filePath}`);
    console.log('现在您可以从配置文件中删除明文私钥，使用加密的私钥文件代替');
    console.log('程序将在启动时提示您输入密码来解密私钥');
    
    // 创建一个备份文件到用户主目录
    const os = await import('os');
    const homeDir = os.homedir();
    const backupPath = path.join(homeDir, ENCRYPTED_KEY_FILENAME);
    saveEncryptedKey(encryptedData, backupPath);
    console.log(`\n已在您的主目录中创建备份文件: ${backupPath}`);
  } catch (error) {
    console.error('加密过程中出错:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * 获取用户的是/否输入
 */
async function getYesNoInput(prompt: string): Promise<boolean> {
  while (true) {
    const input = await getPasswordFromUser(prompt);
    const lowerInput = input.toLowerCase();
    
    if (lowerInput === 'y' || lowerInput === 'yes') {
      return true;
    } else if (lowerInput === 'n' || lowerInput === 'no') {
      return false;
    }
    
    console.log('请输入 y (yes) 或 n (no)');
  }
}

// 执行主函数
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('发生错误:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
} 