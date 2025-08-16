import * as net from "net";

/**
 * More efficient port checking method - uses net.connect instead of creating servers
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(true); // Connection timeout, consider port available
    }, 100);
    
    socket.on('connect', () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve(false); // Can connect, port is in use
    });
    
    socket.on('error', () => {
      clearTimeout(timeout);
      resolve(true); // Connection failed, port available
    });
    
    socket.connect(port, 'localhost');
  });
}


/**
 * Find available port, incrementally searching from specified port (check only, no server creation)
 */
export async function findAvailablePort(startPort: number, maxAttempts: number = 100): Promise<number> {
  for (let port = startPort; port < startPort + maxAttempts; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`Unable to find available port, tried from ${startPort} to ${startPort + maxAttempts - 1}`);
}