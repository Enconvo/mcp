import * as crypto from "crypto";

export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  code_challenge_methods_supported?: string[];
  response_types_supported: string[];
  grant_types_supported?: string[];
}

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

export interface ClientCredentials {
  client_id: string;
  client_secret?: string;
}

export interface AuthorizationRequest {
  client_id: string;
  response_type: string;
  redirect_uri: string;
  scope?: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  resource: string;
}

export interface TokenRequest {
  grant_type: string;
  code: string;
  redirect_uri: string;
  client_id: string;
  code_verifier: string;
  resource: string;
}

export class OAuthClient {
  private authServerMetadata: AuthorizationServerMetadata | null = null;
  private clientCredentials: ClientCredentials | null = null;

  async discoverAuthorizationServer(issuer: string): Promise<AuthorizationServerMetadata> {
    const issuerUrl = new URL(issuer);
    const endpoints = this.buildDiscoveryEndpoints(issuerUrl);

    for (const endpoint of endpoints) {
      try {
        console.log(`Trying discovery endpoint: ${endpoint}`);
        const response = await fetch(endpoint);
        if (response.ok) {
          const metadata = await response.json() as AuthorizationServerMetadata;
          this.validateAuthServerMetadata(metadata);
          this.authServerMetadata = metadata;
          return metadata;
        }
      } catch (error) {
        console.warn(`Discovery failed for ${endpoint}:`, error);
        continue;
      }
    }

    throw new Error(`Failed to discover authorization server metadata for issuer: ${issuer}`);
  }

  private buildDiscoveryEndpoints(issuerUrl: URL): string[] {
    const endpoints: string[] = [];
    const pathSegments = issuerUrl.pathname.split('/').filter(segment => segment.length > 0);

    if (pathSegments.length > 0) {
      // For issuer URLs with path components
      const pathComponent = pathSegments.join('/');
      endpoints.push(`${issuerUrl.origin}/.well-known/oauth-authorization-server/${pathComponent}`);
      endpoints.push(`${issuerUrl.origin}/.well-known/openid-configuration/${pathComponent}`);
      endpoints.push(`${issuerUrl.origin}/${pathComponent}/.well-known/openid-configuration`);
    } else {
      // For issuer URLs without path components
      endpoints.push(`${issuerUrl.origin}/.well-known/oauth-authorization-server`);
      endpoints.push(`${issuerUrl.origin}/.well-known/openid-configuration`);
    }

    return endpoints;
  }

  private validateAuthServerMetadata(metadata: AuthorizationServerMetadata): void {
    if (!metadata.authorization_endpoint) {
      throw new Error('Authorization server metadata missing authorization_endpoint');
    }
    if (!metadata.token_endpoint) {
      throw new Error('Authorization server metadata missing token_endpoint');
    }
    
    // Validate PKCE support as required by MCP spec
    if (!metadata.code_challenge_methods_supported || 
        !metadata.code_challenge_methods_supported.includes('S256')) {
      throw new Error('Authorization server must support PKCE with S256 method');
    }
  }

  async discoverProtectedResourceMetadata(serverUrl: string): Promise<ProtectedResourceMetadata> {
    const metadataUrl = new URL('/.well-known/oauth-protected-resource', serverUrl);
    
    try {
      const response = await fetch(metadataUrl.toString());
      if (!response.ok) {
        throw new Error(`Failed to fetch protected resource metadata: ${response.status}`);
      }
      
      const metadata = await response.json() as ProtectedResourceMetadata;
      if (!metadata.authorization_servers || metadata.authorization_servers.length === 0) {
        throw new Error('Protected resource metadata missing authorization_servers');
      }
      
      return metadata;
    } catch (error) {
      throw new Error(`Failed to discover protected resource metadata: ${error}`);
    }
  }

  async registerDynamicClient(registrationEndpoint: string, clientMetadata: any): Promise<ClientCredentials> {
    if (!registrationEndpoint) {
      throw new Error('Dynamic client registration not supported by authorization server');
    }

    const response = await fetch(registrationEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_name: 'MCP Client',
        redirect_uris: ['http://localhost:8080/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none', // Public client
        ...clientMetadata,
      }),
    });

    if (!response.ok) {
      throw new Error(`Dynamic client registration failed: ${response.status}`);
    }

    const credentials = await response.json() as ClientCredentials;
    this.clientCredentials = credentials;
    return credentials;
  }

  generatePKCE(): { codeVerifier: string; codeChallenge: string } {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    
    return { codeVerifier, codeChallenge };
  }

  buildAuthorizationUrl(
    authorizationEndpoint: string,
    clientId: string,
    redirectUri: string,
    resourceUrl: string,
    codeChallenge: string,
    scope?: string
  ): { url: string; state: string } {
    const state = crypto.randomBytes(16).toString('hex');
    
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      resource: resourceUrl,
    });

    if (scope) {
      params.set('scope', scope);
    }

    return {
      url: `${authorizationEndpoint}?${params.toString()}`,
      state,
    };
  }

  async exchangeCodeForToken(
    tokenEndpoint: string,
    code: string,
    codeVerifier: string,
    clientId: string,
    redirectUri: string,
    resourceUrl: string
  ): Promise<TokenResponse> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
      resource: resourceUrl,
    });

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
    }

    return await response.json() as TokenResponse;
  }

  async refreshToken(
    tokenEndpoint: string,
    refreshToken: string,
    clientId: string,
    resourceUrl: string
  ): Promise<TokenResponse> {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      resource: resourceUrl,
    });

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
    }

    return await response.json() as TokenResponse;
  }

  getAuthServerMetadata(): AuthorizationServerMetadata | null {
    return this.authServerMetadata;
  }

  getClientCredentials(): ClientCredentials | null {
    return this.clientCredentials;
  }

  setClientCredentials(credentials: ClientCredentials): void {
    this.clientCredentials = credentials;
  }
}