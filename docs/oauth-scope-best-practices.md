# OAuth Scope Best Practices

## Overview

OAuth scopes define the specific permissions and access levels that a client application requests from an authorization server. In MCP implementations, scopes should be determined dynamically based on the server's supported capabilities rather than being hardcoded.

## Best Practices

### 1. Dynamic Scope Selection

Instead of hardcoding scope values, determine them based on the authorization server's metadata:

```typescript
// ❌ Bad: Hardcoded scope
const { url: authUrl, state } = oauthClient.buildAuthorizationUrl(
  authServerMetadata.authorization_endpoint,
  clientId,
  redirectUri,
  resourceUrl,
  codeChallenge,
  "read write"  // Hardcoded - may not be supported by server
);

// ✅ Good: Dynamic scope based on server capabilities
const supportedScopes = authServerMetadata.scopes_supported || ['openid'];
const requestedScope = supportedScopes.includes('mcp') ? 'mcp' : 
                      supportedScopes.includes('openid') ? 'openid' : 
                      supportedScopes[0] || undefined;

const { url: authUrl, state } = oauthClient.buildAuthorizationUrl(
  authServerMetadata.authorization_endpoint,
  clientId,
  redirectUri,
  resourceUrl,
  codeChallenge,
  requestedScope
);
```

### 2. Configuration-Driven Scopes

Make scopes configurable through user configuration:

```json
{
  "oauth_config": {
    "enabled": true,
    "scope": "${user_config.oauth_scope}"
  },
  "user_config": {
    "oauth_scope": {
      "type": "string",
      "title": "OAuth Scope",
      "description": "OAuth scopes to request (e.g., 'openid', 'mcp', 'read write')",
      "required": false,
      "default": "openid"
    }
  }
}
```

### 3. Scope Fallback Strategy

Implement a fallback strategy for scope selection:

```typescript
function selectOptimalScope(
  authServerMetadata: AuthorizationServerMetadata,
  userRequestedScope?: string
): string | undefined {
  const supportedScopes = authServerMetadata.scopes_supported || [];
  
  // 1. Use user-requested scope if supported
  if (userRequestedScope && supportedScopes.includes(userRequestedScope)) {
    return userRequestedScope;
  }
  
  // 2. Prefer MCP-specific scopes
  const mcpScopes = ['mcp', 'mcp:read', 'mcp:write'];
  for (const scope of mcpScopes) {
    if (supportedScopes.includes(scope)) {
      return scope;
    }
  }
  
  // 3. Fall back to standard OAuth scopes
  const standardScopes = ['openid', 'profile'];
  for (const scope of standardScopes) {
    if (supportedScopes.includes(scope)) {
      return scope;
    }
  }
  
  // 4. Use first supported scope
  return supportedScopes[0] || undefined;
}
```

## Common MCP Scopes

### Standard Scopes

| Scope | Description | Use Case |
|-------|-------------|----------|
| `openid` | Basic OpenID Connect authentication | Minimal authentication |
| `profile` | Access to user profile information | User identification |
| `email` | Access to user email address | User contact information |

### MCP-Specific Scopes

| Scope | Description | Use Case |
|-------|-------------|----------|
| `mcp` | Full MCP access | General MCP operations |
| `mcp:read` | Read-only MCP access | Data retrieval only |
| `mcp:write` | Write access to MCP resources | Data modification |
| `mcp:tools` | Access to MCP tools | Tool execution |
| `mcp:resources` | Access to MCP resources | Resource management |

### Service-Specific Scopes

Different MCP servers may define their own scopes:

```typescript
// GitHub Copilot example
const githubScopes = [
  'copilot',
  'copilot:read',
  'repo'
];

// Notion example
const notionScopes = [
  'notion:read',
  'notion:write',
  'notion:databases'
];
```

## Implementation Examples

### Manifest Configuration

```json
{
  "server": {
    "type": "http",
    "entry_point": "https://api.example.com/mcp",
    "oauth_config": {
      "enabled": true,
      "scope": "${user_config.oauth_scope}"
    }
  },
  "user_config": {
    "oauth_scope": {
      "type": "string",
      "title": "OAuth Scope",
      "description": "Scopes: 'openid' (basic), 'mcp' (full access), 'mcp:read' (read-only)",
      "required": false,
      "default": "openid",
      "enum": ["openid", "mcp", "mcp:read", "mcp:write"]
    }
  }
}
```

### Runtime Scope Selection

```typescript
async function buildAuthorizationUrl(
  authServerMetadata: AuthorizationServerMetadata,
  oauthConfig: OAuthConfig,
  resourceUrl: string,
  codeChallenge: string
): Promise<{ url: string; state: string }> {
  
  // Get user-requested scope from config
  const userScope = oauthConfig.scope;
  
  // Select optimal scope based on server capabilities
  const selectedScope = selectOptimalScope(authServerMetadata, userScope);
  
  console.log(`Selected OAuth scope: ${selectedScope || 'none'}`);
  
  return oauthClient.buildAuthorizationUrl(
    authServerMetadata.authorization_endpoint,
    clientId,
    redirectUri,
    resourceUrl,
    codeChallenge,
    selectedScope
  );
}
```

## Scope Validation

### Server-Side Validation

Authorization servers should validate requested scopes:

```typescript
// Server-side scope validation
function validateRequestedScopes(
  requestedScopes: string[],
  clientId: string,
  resourceUrl: string
): string[] {
  const clientPermissions = getClientPermissions(clientId);
  const resourceRequirements = getResourceRequirements(resourceUrl);
  
  return requestedScopes.filter(scope => 
    clientPermissions.includes(scope) &&
    resourceRequirements.supports(scope)
  );
}
```

### Client-Side Validation

Clients should handle scope-related errors:

```typescript
try {
  const tokenResponse = await exchangeCodeForToken(/* ... */);
  
  // Check if granted scopes match requested scopes
  const grantedScopes = tokenResponse.scope?.split(' ') || [];
  const requestedScopes = originalRequestedScope?.split(' ') || [];
  
  const missingScopes = requestedScopes.filter(scope => 
    !grantedScopes.includes(scope)
  );
  
  if (missingScopes.length > 0) {
    console.warn(`Some scopes were not granted: ${missingScopes.join(', ')}`);
  }
  
} catch (error) {
  if (error.message.includes('invalid_scope')) {
    console.error('Requested scope is not supported by the server');
    // Implement fallback or retry with different scope
  }
}
```

## Security Considerations

### Principle of Least Privilege

- Request only the minimum scopes necessary for functionality
- Avoid requesting broad scopes like "admin" or "full_access"
- Use specific scopes for specific operations

### Scope Escalation

- Never request additional scopes without user consent
- Implement proper scope checking for sensitive operations
- Log scope usage for security auditing

### Dynamic Scope Updates

```typescript
// Handle scope updates during token refresh
async function refreshTokenWithScopes(
  refreshToken: string,
  additionalScopes?: string[]
): Promise<TokenResponse> {
  
  const existingScopes = getCurrentTokenScopes();
  const requestedScopes = additionalScopes 
    ? [...existingScopes, ...additionalScopes]
    : existingScopes;
    
  // Only request additional scopes if user has consented
  if (additionalScopes?.length && !hasUserConsentedToScopes(additionalScopes)) {
    throw new Error('Additional scopes require user consent');
  }
  
  return await oauthClient.refreshToken(
    tokenEndpoint,
    refreshToken,
    clientId,
    resourceUrl,
    requestedScopes.join(' ')
  );
}
```

By following these best practices, MCP implementations can ensure proper scope management, better security, and improved compatibility with various OAuth servers.