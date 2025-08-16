import { DxtManifest } from "@enconvo/api";

declare module "@enconvo/api" {
  interface DxtManifest {
    server?: {
      type?: "http" | "sse" | "stdio";
      entry_point?: string;
      mcp_config?: {
        command?: string;
        args?: string[];
        env?: Record<string, string>;
      };
      oauth_config?: {
        enabled?: boolean;
        client_id?: string;
        client_secret?: string;
        redirect_uri?: string;
        scope?: string;
        auto_register?: boolean;
      };
    };
  }
}