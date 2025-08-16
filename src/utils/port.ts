import * as net from "net";

/**
 * 更高效的端口检查方法 - 使用 net.connect 而不是创建服务器
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(true); // 连接超时，认为端口可用
    }, 100);
    
    socket.on('connect', () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve(false); // 能连接，说明端口被占用
    });
    
    socket.on('error', () => {
      clearTimeout(timeout);
      resolve(true); // 连接失败，端口可用
    });
    
    socket.connect(port, 'localhost');
  });
}


/**
 * 查找可用端口，从指定端口开始递增查找（仅检查，不创建服务器）
 */
export async function findAvailablePort(startPort: number, maxAttempts: number = 100): Promise<number> {
  for (let port = startPort; port < startPort + maxAttempts; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`无法找到可用端口，已尝试从 ${startPort} 到 ${startPort + maxAttempts - 1}`);
}