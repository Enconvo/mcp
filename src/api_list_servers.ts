import { RequestOptions, EnconvoResponse, MCP } from "@enconvo/api";
export default async function main(req: Request): Promise<EnconvoResponse> {
  let options: RequestOptions = await req.json();
  const servers = await MCP.listServers();

  return JSON.stringify(servers, null, 2);
}
