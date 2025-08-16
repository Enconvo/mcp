# OAuth Discovery Improvements

This document describes the enhanced OAuth discovery capabilities implemented to support various MCP server OAuth configurations, including GitHub Copilot's authentication pattern.

## Enhanced Discovery Features

### 1. Multi-Step Resource Metadata Discovery

The improved `discoverResourceMetadata` method now implements a comprehensive three-step discovery process:

#### Step 1: Direct Metadata Discovery
- Attempts to fetch metadata from standard `/.well-known/oauth-protected-resource` endpoint
- Follows RFC9728 Protected Resource Metadata specification
- Most efficient when servers properly implement the standard

#### Step 2: 401 Challenge Discovery
- Makes a request to the MCP server to trigger a 401 Unauthorized response
- Parses the `WWW-Authenticate` header for `resource_metadata` parameter
- Supports complex header formats with multiple parameters

#### Step 3: Fallback Path Discovery
- Tries multiple common metadata path variations
- Includes path-specific metadata URLs (e.g., for `/mcp` endpoints)
- Ensures compatibility with various server implementations

### 2. Advanced WWW-Authenticate Header Parsing

The enhanced parser supports complex authentication challenge formats:

```typescript
// Example headers that are now properly parsed:

// GitHub Copilot style
'Bearer error="invalid_request", error_description="No access token was provided in this request", resource_metadata="https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp/"'

// Standard OAuth 2.0
'Bearer realm="https://example.com", resource_metadata="https://example.com/.well-known/oauth-protected-resource"'

// Multiple parameters
'Bearer realm="mcp-server", error="insufficient_scope", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"'
```

#### Key Parsing Features:

1. **Scheme Detection**: Properly identifies Bearer authentication challenges
2. **Parameter Extraction**: Handles quoted and unquoted parameter values
3. **Multi-Parameter Support**: Parses complex headers with multiple key-value pairs
4. **Error Handling**: Graceful fallback for malformed headers

### 3. Path-Aware Metadata Discovery

The system now handles path-specific metadata URLs, such as:

- `https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp/`
- `https://example.com/.well-known/oauth-protected-resource/api/v1/`

This supports servers that host multiple MCP endpoints with different OAuth configurations.

## Implementation Details

### Enhanced discoverResourceMetadata Method

```typescript
private async discoverResourceMetadata(resourceUrl: string): Promise<ProtectedResourceMetadata> {
  console.log(`🔍 Starting protected resource discovery for: ${resourceUrl}`);
  
  // Step 1: Direct discovery
  try {
    const metadata = await this.oauthClient.discoverProtectedResourceMetadata(resourceUrl);
    return metadata;
  } catch (directError) {
    // Continue to step 2
  }

  // Step 2: 401 challenge discovery
  try {
    const response = await fetch(resourceUrl);
    if (response.status === 401) {
      const wwwAuth = response.headers.get('www-authenticate');
      if (wwwAuth) {
        const metadataUrl = this.extractMetadataUrlFromWwwAuth(wwwAuth);
        if (metadataUrl) {
          const metadataResponse = await fetch(metadataUrl);
          if (metadataResponse.ok) {
            return await metadataResponse.json();
          }
        }
      }
    }
  } catch (fetchError) {
    // Continue to step 3
  }

  // Step 3: Fallback path discovery
  const commonPaths = [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/',
    // Add path-specific variants
  ];
  
  // Try each path...
}
```

### WWW-Authenticate Parser

```typescript
private parseAuthChallenges(wwwAuthHeader: string): Array<{scheme: string, params: Map<string, string>}> {
  // Regex to handle multiple authentication schemes
  const schemeRegex = /(?:^|,\s*)([a-zA-Z][a-zA-Z0-9_+-]*)\s+(.+?)(?=(?:,\s*[a-zA-Z][a-zA-Z0-9_+-]*\s)|$)/g;
  
  // Parse parameters with proper quote handling
  const paramRegex = /([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*(?:"([^"]*)"|([^,\s]+))/g;
  
  // Implementation handles complex parsing scenarios...
}
```

## Real-World Examples

### GitHub Copilot Integration

The enhanced discovery successfully handles GitHub Copilot's OAuth flow:

1. **Resource URL**: `https://api.githubcopilot.com/mcp/`
2. **401 Response**: Contains detailed WWW-Authenticate header
3. **Metadata URL**: Extracted as `https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp/`
4. **Discovery**: Fetches authorization server information

### Standard MCP Servers

For servers following RFC9728 closely:

1. **Resource URL**: `https://mcp.example.com/api`
2. **Direct Discovery**: `https://mcp.example.com/.well-known/oauth-protected-resource`
3. **Immediate Success**: No additional requests needed

## Testing

The implementation includes comprehensive tests:

```typescript
// Test GitHub Copilot style header
const githubCopilotHeader = 'Bearer error="invalid_request", error_description="No access token was provided in this request", resource_metadata="https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp/"';

const extractedUrl = factory.extractMetadataUrlFromWwwAuth(githubCopilotHeader);
// Result: "https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp/"
```

## Benefits

1. **Broader Compatibility**: Supports various OAuth server implementations
2. **Robust Discovery**: Multiple fallback mechanisms ensure discovery success
3. **Detailed Logging**: Comprehensive logging for debugging OAuth issues
4. **Standards Compliance**: Follows RFC9728 and OAuth 2.1 specifications
5. **Real-World Testing**: Verified with actual services like GitHub Copilot

## Error Handling

The enhanced discovery provides clear error messages and diagnostic information:

- Logs each discovery attempt step
- Shows parsed WWW-Authenticate parameters
- Indicates which discovery method succeeded
- Provides fallback options when primary methods fail

This makes it easier to diagnose OAuth configuration issues and ensures reliable authentication across different MCP server implementations.