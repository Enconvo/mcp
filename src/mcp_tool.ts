import { RequestOptions, EnconvoResponse, MCP, BaseChatMessage } from '@enconvo/api'
export default async function main(req: Request): Promise<EnconvoResponse> {

    let options: RequestOptions = await req.json()

    const required: string[] = options.parameters.required

    let required_params: { type: string, name: string }[] = []
    for (const key of required) {
        if (!options[key]) {
            required_params.push({
                type: options.parameters.properties[key].type,
                name: key
            })
        }
    }

    let parameters: any = options
    if (required_params.length > 0) {
        for (const param of required_params) {
            if (param.type === "string") {
                parameters[param.name] = options.input_text
            } else if (param.type === "number") {
                parameters[param.name] = Number(options.input_text)
            } else if (param.type === "boolean") {
                parameters[param.name] = options.input_text === "true"
            } else if (param.type === "array") {
                parameters[param.name] = options.input_text?.split("\n")
            } else if (param.type === "object") {
                parameters[param.name] = JSON.parse(options.input_text || "{}")
            }

            console.log("param", param,  options.input_text,parameters[param.name])
        }
    }


    const result = await MCP.callTool({
        clientName: options.extensionName,
        toolName: options.commandName || "",
        parameters: parameters
    })

    return {
        type: "messages",
        messages: [
            BaseChatMessage.assistant(result.content)
        ]
    }
}




