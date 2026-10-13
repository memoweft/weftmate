// Generated from src/ui-core/onboarding-copy.js by sync_phone_presets.mjs.
import Foundation
struct PhoneProviderPreset: Identifiable {
    let id, name, baseURL, model, help, url: String
    static let values: [Self] = [
        .init(id:"mimo",name:"MiMo",baseURL:"https://api.xiaomimimo.com/v1",model:"mimo-v2.6-flash",help:"登录小米 MiMo 开放平台，在控制台创建密钥。",url:"https://platform.xiaomimimo.com/"),
        .init(id:"deepseek",name:"DeepSeek",baseURL:"https://api.deepseek.com/v1",model:"deepseek-chat",help:"登录 DeepSeek 开放平台，在 API keys 页面创建密钥。",url:"https://platform.deepseek.com/api_keys"),
        .init(id:"kimi",name:"Kimi",baseURL:"https://api.moonshot.cn/v1",model:"kimi-k2.5",help:"登录 Moonshot 开放平台，进入控制台的密钥管理。",url:"https://platform.moonshot.cn/console/api-keys"),
        .init(id:"qwen",name:"通义千问",baseURL:"https://dashscope.aliyuncs.com/compatible-mode/v1",model:"qwen-plus",help:"在阿里云百炼创建密钥；请核对密钥所属地域与服务地址。",url:"https://help.aliyun.com/zh/model-studio/get-api-key/"),
        .init(id:"doubao",name:"豆包",baseURL:"https://ark.cn-beijing.volces.com/api/v3",model:"",help:"在火山方舟创建密钥并开通模型，填写模型名称或推理接入点。",url:"https://www.volcengine.com/docs/82379/1399008"),
        .init(id:"openai",name:"OpenAI 兼容",baseURL:"https://api.openai.com/v1",model:"",help:"在所选服务的官方控制台创建密钥，并填写兼容服务地址与模型名称。",url:"https://platform.openai.com/api-keys"),
        .init(id:"anthropic",name:"Anthropic 兼容",baseURL:"https://api.anthropic.com/v1",model:"",help:"在 Claude 控制台创建密钥，填写已开通的模型名称。使用官方 OpenAI 兼容接口，部分功能与原生接口不同。",url:"https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk")
    ]
}
