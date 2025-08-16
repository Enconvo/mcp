import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { TokenResponse } from "./oauth-client.js";

export interface StoredToken {
  access_token: string;
  token_type: string;
  expires_at?: number; // Unix timestamp
  refresh_token?: string;
  scope?: string;
  resource: string;
  client_id: string;
  authorization_server: string;
}

export class TokenManager {
  private tokenCache = new Map<string, StoredToken>();
  private tokenStorePath: string;

  constructor() {
    this.tokenStorePath = path.join(os.homedir(), '.mcp', 'tokens.json');
  }

  async loadTokens(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.tokenStorePath), { recursive: true });
      const data = await fs.readFile(this.tokenStorePath, 'utf-8');
      const tokens = JSON.parse(data) as Record<string, StoredToken>;
      
      for (const [key, token] of Object.entries(tokens)) {
        this.tokenCache.set(key, token);
      }
      
      console.log(`Loaded ${this.tokenCache.size} tokens from storage`);
    } catch (error) {
      if ((error as any).code !== 'ENOENT') {
        console.warn('Failed to load tokens:', error);
      }
      // File doesn't exist or is corrupted, start with empty cache
    }
  }

  async saveTokens(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.tokenStorePath), { recursive: true });
      const tokens = Object.fromEntries(this.tokenCache.entries());
      await fs.writeFile(this.tokenStorePath, JSON.stringify(tokens, null, 2));
      console.log(`Saved ${this.tokenCache.size} tokens to storage`);
    } catch (error) {
      console.error('Failed to save tokens:', error);
    }
  }

  private generateTokenKey(resource: string, clientId: string, authServer: string): string {
    return `${resource}:${clientId}:${authServer}`;
  }

  async storeToken(
    tokenResponse: TokenResponse,
    resource: string,
    clientId: string,
    authorizationServer: string
  ): Promise<void> {
    const key = this.generateTokenKey(resource, clientId, authorizationServer);
    
    const storedToken: StoredToken = {
      access_token: tokenResponse.access_token,
      token_type: tokenResponse.token_type,
      refresh_token: tokenResponse.refresh_token,
      scope: tokenResponse.scope,
      resource,
      client_id: clientId,
      authorization_server: authorizationServer,
    };

    // Calculate expiration time if expires_in is provided
    if (tokenResponse.expires_in) {
      storedToken.expires_at = Date.now() + (tokenResponse.expires_in * 1000);
    }

    this.tokenCache.set(key, storedToken);
    await this.saveTokens();
  }

  async getValidToken(
    resource: string,
    clientId: string,
    authorizationServer: string
  ): Promise<StoredToken | null> {
    const key = this.generateTokenKey(resource, clientId, authorizationServer);
    const token = this.tokenCache.get(key);

    if (!token) {
      return null;
    }

    // Check if token is expired
    if (token.expires_at && Date.now() >= token.expires_at) {
      console.log(`Token for ${resource} has expired`);
      return null;
    }

    return token;
  }

  async removeToken(
    resource: string,
    clientId: string,
    authorizationServer: string
  ): Promise<void> {
    const key = this.generateTokenKey(resource, clientId, authorizationServer);
    this.tokenCache.delete(key);
    await this.saveTokens();
  }

  async updateToken(
    resource: string,
    clientId: string,
    authorizationServer: string,
    newTokenResponse: TokenResponse
  ): Promise<void> {
    const key = this.generateTokenKey(resource, clientId, authorizationServer);
    const existingToken = this.tokenCache.get(key);

    if (!existingToken) {
      throw new Error('Cannot update non-existent token');
    }

    // Update the token while preserving non-token fields
    const updatedToken: StoredToken = {
      ...existingToken,
      access_token: newTokenResponse.access_token,
      token_type: newTokenResponse.token_type,
      scope: newTokenResponse.scope,
    };

    // Update refresh token if provided
    if (newTokenResponse.refresh_token) {
      updatedToken.refresh_token = newTokenResponse.refresh_token;
    }

    // Update expiration time if provided
    if (newTokenResponse.expires_in) {
      updatedToken.expires_at = Date.now() + (newTokenResponse.expires_in * 1000);
    }

    this.tokenCache.set(key, updatedToken);
    await this.saveTokens();
  }

  async getAllTokens(): Promise<StoredToken[]> {
    return Array.from(this.tokenCache.values());
  }

  async clearExpiredTokens(): Promise<void> {
    const now = Date.now();
    let removedCount = 0;

    for (const [key, token] of Array.from(this.tokenCache.entries())) {
      if (token.expires_at && now >= token.expires_at) {
        this.tokenCache.delete(key);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      console.log(`Removed ${removedCount} expired tokens`);
      await this.saveTokens();
    }
  }

  async clearAllTokens(): Promise<void> {
    this.tokenCache.clear();
    try {
      await fs.unlink(this.tokenStorePath);
    } catch (error) {
      // File might not exist, which is fine
    }
  }

  getTokenCount(): number {
    return this.tokenCache.size;
  }

  hasValidToken(resource: string, clientId: string, authorizationServer: string): boolean {
    const key = this.generateTokenKey(resource, clientId, authorizationServer);
    const token = this.tokenCache.get(key);

    if (!token) {
      return false;
    }

    // Check if token is expired
    if (token.expires_at && Date.now() >= token.expires_at) {
      return false;
    }

    return true;
  }
}