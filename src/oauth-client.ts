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
    console.log(`🔍 Starting protected resource discovery for: ${serverUrl}`);
    
    // Step 1: Try direct metadata discovery first
    // According to RFC9728, servers SHOULD serve metadata at /.well-known/oauth-protected-resource
    try {
      console.log('📡 Attempting direct metadata discovery...');
      const metadataUrl = new URL('/.well-known/oauth-protected-resource', serverUrl);
      console.log("Metadata URL:", metadataUrl.toString());
      const response = await fetch(metadataUrl.toString());
      
      if (response.ok) {
        const metadata = await response.json() as ProtectedResourceMetadata;
        if (metadata.authorization_servers && metadata.authorization_servers.length > 0) {
          console.log('✅ Direct metadata discovery successful');
          return metadata;
        } else {
          throw new Error('Protected resource metadata missing authorization_servers');
        }
      } else {
        throw new Error(`Direct discovery failed with status: ${response.status}`);
      }
    } catch (directError) {
      console.log(`ℹ️  Direct discovery failed: ${(directError as Error).message}`);
    }

    // Step 2: Attempt 401 challenge discovery
    // According to RFC9728 Section 5.1, servers MUST use WWW-Authenticate header on 401
    try {
      console.log('📡 Attempting 401 challenge discovery...');
      const response = await fetch(serverUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });

      console.log(`📋 Response status: ${response.status}`);
      
      if (response.status === 401) {
        const wwwAuth = response.headers.get('www-authenticate');
        console.log(`🔍 WWW-Authenticate header: ${wwwAuth}`);
        
        if (wwwAuth) {
          const metadataUrl = this.extractMetadataUrlFromWwwAuth(wwwAuth);
          if (metadataUrl) {
            console.log("Metadata URL 2:", metadataUrl);
            console.log(`📡 Found metadata URL in WWW-Authenticate: ${metadataUrl}`);
            
            try {
              const metadataResponse = await fetch(metadataUrl);
              if (metadataResponse.ok) {
                const metadata = await metadataResponse.json() as ProtectedResourceMetadata;
                if (metadata.authorization_servers && metadata.authorization_servers.length > 0) {
                  console.log('✅ Metadata retrieved from WWW-Authenticate URL');
                  return metadata;
                } else {
                  throw new Error('Metadata missing authorization_servers');
                }
              } else {
                console.warn(`❌ Failed to fetch metadata from ${metadataUrl}: ${metadataResponse.status}`);
              }
            } catch (metadataFetchError) {
              console.warn(`❌ Error fetching metadata from ${metadataUrl}:`, metadataFetchError);
            }
          } else {
            console.log('ℹ️  No resource_metadata found in WWW-Authenticate header');
            
            // Parse other parameters for debugging
            const authParams = this.parseWwwAuthParams(wwwAuth);
            console.log('🔍 Parsed WWW-Authenticate parameters:', Object.fromEntries(authParams));
          }
        } else {
          console.log('ℹ️  No WWW-Authenticate header in 401 response');
        }
      } else {
        console.log(`ℹ️  Server responded with ${response.status}, not 401. May not require authentication.`);
      }
    } catch (fetchError) {
      console.warn('❌ Failed to perform 401 challenge discovery:', fetchError);
    }

    // Step 3: Try common metadata paths as fallback
    const baseUrl = new URL(serverUrl);
    const pathSegments = baseUrl.pathname.split('/').filter(segment => segment.length > 0);
    
    const metadataPaths = [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/',
    ];
    
    // Add path-specific metadata URLs (like GitHub Copilot example)
    if (pathSegments.length > 0) {
      const resourcePath = pathSegments.join('/');
      metadataPaths.push(`/.well-known/oauth-protected-resource/${resourcePath}`);
      metadataPaths.push(`/.well-known/oauth-protected-resource/${resourcePath}/`);
    }

    for (const path of metadataPaths) {
      try {
        const metadataUrl = `${baseUrl.origin}${path}`;
        console.log(`📡 Trying fallback metadata URL: ${metadataUrl}`);
        
        const response = await fetch(metadataUrl);
        if (response.ok) {
          const metadata = await response.json() as ProtectedResourceMetadata;
          if (metadata.authorization_servers && metadata.authorization_servers.length > 0) {
            console.log('✅ Fallback metadata discovery successful');
            return metadata;
          }
        }
      } catch (error) {
        // Continue to next path
      }
    }
    
    throw new Error(`Failed to discover protected resource metadata for ${serverUrl}. Server may not support OAuth authentication.`);
  }

  private extractMetadataUrlFromWwwAuth(wwwAuthHeader: string): string | null {
    // Parse WWW-Authenticate header according to RFC9728
    // Format: Bearer realm="...", resource_metadata="...", error="...", error_description="..."
    
    console.log(`🔍 Parsing WWW-Authenticate header: ${wwwAuthHeader}`);
    
    // Handle multiple authentication schemes by splitting on comma outside quotes
    const authChallenges = this.parseAuthChallenges(wwwAuthHeader);
    
    for (const challenge of authChallenges) {
      if (challenge.scheme.toLowerCase() === 'bearer') {
        const resourceMetadata = challenge.params.get('resource_metadata');
        if (resourceMetadata) {
          console.log(`✅ Found resource_metadata: ${resourceMetadata}`);
          return resourceMetadata;
        }
      }
    }
    
    console.log('❌ No resource_metadata found in WWW-Authenticate header');
    return null;
  }

  private parseAuthChallenges(wwwAuthHeader: string): Array<{scheme: string, params: Map<string, string>}> {
    const challenges: Array<{scheme: string, params: Map<string, string>}> = [];
    
    // Split by scheme keywords (Bearer, Basic, etc.) while preserving the structure
    const schemeRegex = /(?:^|,\s*)([a-zA-Z][a-zA-Z0-9_+-]*)\s+(.+?)(?=(?:,\s*[a-zA-Z][a-zA-Z0-9_+-]*\s)|$)/g;
    let match;
    
    while ((match = schemeRegex.exec(wwwAuthHeader)) !== null) {
      const scheme = match[1];
      const paramString = match[2];
      
      const params = this.parseWwwAuthParams(paramString);
      challenges.push({ scheme, params });
    }
    
    // Fallback: if regex parsing fails, try simple Bearer parsing
    if (challenges.length === 0 && wwwAuthHeader.toLowerCase().startsWith('bearer')) {
      const paramString = wwwAuthHeader.substring(6).trim(); // Remove "Bearer"
      const params = this.parseWwwAuthParams(paramString);
      challenges.push({ scheme: 'Bearer', params });
    }
    
    return challenges;
  }

  private parseWwwAuthParams(paramString: string): Map<string, string> {
    const params = new Map<string, string>();
    
    // Parse key="value" pairs, handling quoted values properly
    const paramRegex = /([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*(?:"([^"]*)"|([^,\s]+))/g;
    let match;
    
    while ((match = paramRegex.exec(paramString)) !== null) {
      const key = match[1];
      const quotedValue = match[2];
      const unquotedValue = match[3];
      const value = quotedValue !== undefined ? quotedValue : unquotedValue;
      
      if (value !== undefined) {
        params.set(key, value);
      }
    }
    
    return params;
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