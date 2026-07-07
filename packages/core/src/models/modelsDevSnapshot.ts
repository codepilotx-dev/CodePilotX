// Built-in snapshot of models.dev/catalog.json (provider configs only).
// Generated on 2026-07-07.
// Update by re-running: node scripts/refresh-models-dev-catalog.ts

export const MODELS_DEV_PROVIDERS: Record<string, {
  name?: string
  npm?: string
  api?: string
  env?: string[]
  doc?: string
}> = {
  "requesty": {
    "name": "Requesty",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://router.requesty.ai/v1",
    "env": [
      "REQUESTY_API_KEY"
    ],
    "doc": "https://requesty.ai/solution/llm-routing/models"
  },
  "qiniu-ai": {
    "name": "Qiniu",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.qnaigc.com/v1",
    "env": [
      "QINIU_API_KEY"
    ],
    "doc": "https://developer.qiniu.com/aitokenapi"
  },
  "alibaba-cn": {
    "name": "Alibaba (China)",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "env": [
      "DASHSCOPE_API_KEY"
    ],
    "doc": "https://www.alibabacloud.com/help/en/model-studio/models"
  },
  "regolo-ai": {
    "name": "Regolo AI",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.regolo.ai/v1",
    "env": [
      "REGOLO_API_KEY"
    ],
    "doc": "https://docs.regolo.ai/"
  },
  "stackit": {
    "name": "STACKIT",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.openai-compat.model-serving.eu01.onstackit.cloud/v1",
    "env": [
      "STACKIT_API_KEY"
    ],
    "doc": "https://docs.stackit.cloud/products/data-and-ai/ai-model-serving/basics/available-shared-models"
  },
  "vercel": {
    "name": "Vercel AI Gateway",
    "npm": "@ai-sdk/gateway",
    "env": [
      "AI_GATEWAY_API_KEY"
    ],
    "doc": "https://github.com/vercel/ai/tree/5eb85cc45a259553501f535b8ac79a77d0e79223/packages/gateway"
  },
  "submodel": {
    "name": "submodel",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://llm.submodel.ai/v1",
    "env": [
      "SUBMODEL_INSTAGEN_ACCESS_KEY"
    ],
    "doc": "https://submodel.gitbook.io"
  },
  "huggingface": {
    "name": "Hugging Face",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://router.huggingface.co/v1",
    "env": [
      "HF_TOKEN"
    ],
    "doc": "https://huggingface.co/docs/inference-providers"
  },
  "minimax-coding-plan": {
    "name": "MiniMax Token Plan (minimax.io)",
    "npm": "@ai-sdk/anthropic",
    "api": "https://api.minimax.io/anthropic/v1",
    "env": [
      "MINIMAX_API_KEY"
    ],
    "doc": "https://platform.minimax.io/docs/token-plan/intro"
  },
  "novita-ai": {
    "name": "NovitaAI",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.novita.ai/openai",
    "env": [
      "NOVITA_API_KEY"
    ],
    "doc": "https://novita.ai/docs/guides/introduction"
  },
  "xai": {
    "name": "xAI",
    "npm": "@ai-sdk/xai",
    "env": [
      "XAI_API_KEY"
    ],
    "doc": "https://docs.x.ai/docs/models"
  },
  "privatemode-ai": {
    "name": "Privatemode AI",
    "npm": "@ai-sdk/openai-compatible",
    "api": "http://localhost:8080/v1",
    "env": [
      "PRIVATEMODE_API_KEY",
      "PRIVATEMODE_ENDPOINT"
    ],
    "doc": "https://docs.privatemode.ai/api/overview"
  },
  "drun": {
    "name": "D.Run (China)",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://chat.d.run/v1",
    "env": [
      "DRUN_API_KEY"
    ],
    "doc": "https://www.d.run"
  },
  "alibaba-token-plan-cn": {
    "name": "Alibaba Token Plan (China)",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    "env": [
      "ALIBABA_TOKEN_PLAN_API_KEY"
    ],
    "doc": "https://www.alibabacloud.com/help/zh/model-studio/token-plan-overview"
  },
  "moonshotai": {
    "name": "Moonshot AI",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.moonshot.ai/v1",
    "env": [
      "MOONSHOT_API_KEY"
    ],
    "doc": "https://platform.moonshot.ai/docs/api/chat"
  },
  "fireworks-ai": {
    "name": "Fireworks AI",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.fireworks.ai/inference/v1/",
    "env": [
      "FIREWORKS_API_KEY"
    ],
    "doc": "https://fireworks.ai/docs/"
  },
  "vultr": {
    "name": "Vultr",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.vultrinference.com/v1",
    "env": [
      "VULTR_API_KEY"
    ],
    "doc": "https://api.vultrinference.com/"
  },
  "302ai": {
    "name": "302.AI",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.302.ai/v1",
    "env": [
      "302AI_API_KEY"
    ],
    "doc": "https://doc.302.ai"
  },
  "trustedrouter": {
    "name": "TrustedRouter",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.trustedrouter.com/v1",
    "env": [
      "TRUSTEDROUTER_API_KEY"
    ],
    "doc": "https://trustedrouter.com/docs"
  },
  "zhipuai": {
    "name": "Zhipu AI",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://open.bigmodel.cn/api/paas/v4",
    "env": [
      "ZHIPU_API_KEY"
    ],
    "doc": "https://docs.z.ai/guides/overview/pricing"
  },
  "cortecs": {
    "name": "Cortecs",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.cortecs.ai/v1",
    "env": [
      "CORTECS_API_KEY"
    ],
    "doc": "https://api.cortecs.ai/v1/models"
  },
  "nebius": {
    "name": "Nebius Token Factory",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.tokenfactory.nebius.com/v1",
    "env": [
      "NEBIUS_API_KEY"
    ],
    "doc": "https://docs.tokenfactory.nebius.com/"
  },
  "auriko": {
    "name": "Auriko",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.auriko.ai/v1",
    "env": [
      "AURIKO_API_KEY"
    ],
    "doc": "https://docs.auriko.ai"
  },
  "stepfun-ai": {
    "name": "StepFun AI",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.stepfun.ai/step_plan/v1",
    "env": [
      "STEPFUN_API_KEY"
    ],
    "doc": "https://platform.stepfun.ai/docs/en/step-plan/integrations/open-code"
  },
  "vivgrid": {
    "name": "Vivgrid",
    "npm": "@ai-sdk/openai",
    "api": "https://api.vivgrid.com/v1",
    "env": [
      "VIVGRID_API_KEY"
    ],
    "doc": "https://docs.vivgrid.com/models"
  },
  "tinfoil": {
    "name": "Tinfoil",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://inference.tinfoil.sh/v1",
    "env": [
      "TINFOIL_API_KEY"
    ],
    "doc": "https://docs.tinfoil.sh"
  },
  "mistral": {
    "name": "Mistral",
    "npm": "@ai-sdk/mistral",
    "env": [
      "MISTRAL_API_KEY"
    ],
    "doc": "https://docs.mistral.ai/getting-started/models/"
  },
  "cloudflare-workers-ai": {
    "name": "Cloudflare Workers AI",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1",
    "env": [
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_API_KEY"
    ],
    "doc": "https://developers.cloudflare.com/workers-ai/models/"
  },
  "bailing": {
    "name": "Bailing",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.tbox.cn/api/llm/v1/chat/completions",
    "env": [
      "BAILING_API_TOKEN"
    ],
    "doc": "https://alipaytbox.yuque.com/sxs0ba/ling/intro"
  },
  "anyapi": {
    "name": "AnyAPI",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.anyapi.ai/v1",
    "env": [
      "ANYAPI_API_KEY"
    ],
    "doc": "https://docs.anyapi.ai"
  },
  "google": {
    "name": "Google",
    "npm": "@ai-sdk/google",
    "env": [
      "GOOGLE_API_KEY",
      "GOOGLE_GENERATIVE_AI_API_KEY",
      "GEMINI_API_KEY"
    ],
    "doc": "https://ai.google.dev/gemini-api/docs/models"
  },
  "opencode-go": {
    "name": "OpenCode Go",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://opencode.ai/zen/go/v1",
    "env": [
      "OPENCODE_API_KEY"
    ],
    "doc": "https://opencode.ai/docs/zen"
  },
  "digitalocean": {
    "name": "DigitalOcean",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://inference.do-ai.run/v1",
    "env": [
      "DIGITALOCEAN_ACCESS_TOKEN"
    ],
    "doc": "https://docs.digitalocean.com/products/gradient-ai-platform/details/models/"
  },
  "subconscious": {
    "name": "Subconscious",
    "npm": "@ai-sdk/anthropic",
    "api": "https://api.subconscious.dev/v1",
    "env": [
      "SUBCONSCIOUS_API_KEY"
    ],
    "doc": "https://docs.subconscious.dev"
  },
  "venice": {
    "name": "Venice AI",
    "npm": "venice-ai-sdk-provider",
    "env": [
      "VENICE_API_KEY"
    ],
    "doc": "https://docs.venice.ai"
  },
  "lmstudio": {
    "name": "LMStudio",
    "npm": "@ai-sdk/openai-compatible",
    "api": "http://127.0.0.1:1234/v1",
    "env": [
      "LMSTUDIO_API_KEY"
    ],
    "doc": "https://lmstudio.ai/models"
  },
  "poolside": {
    "name": "Poolside",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://inference.poolside.ai/v1",
    "env": [
      "POOLSIDE_API_KEY"
    ],
    "doc": "https://platform.poolside.ai"
  },
  "zenmux": {
    "name": "ZenMux",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://zenmux.ai/api/v1",
    "env": [
      "ZENMUX_API_KEY"
    ],
    "doc": "https://docs.zenmux.ai"
  },
  "kenari": {
    "name": "Kenari",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://kenari.id/v1",
    "env": [
      "KENARI_API_KEY"
    ],
    "doc": "https://kenari.id/docs"
  },
  "openai": {
    "name": "OpenAI",
    "npm": "@ai-sdk/openai",
    "env": [
      "OPENAI_API_KEY"
    ],
    "doc": "https://platform.openai.com/docs/models"
  },
  "berget": {
    "name": "Berget.AI",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.berget.ai/v1",
    "env": [
      "BERGET_API_KEY"
    ],
    "doc": "https://api.berget.ai"
  },
  "snowflake-cortex": {
    "name": "Snowflake Cortex",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://${SNOWFLAKE_ACCOUNT}.snowflakecomputing.com/api/v2/cortex/v1",
    "env": [
      "SNOWFLAKE_ACCOUNT",
      "SNOWFLAKE_CORTEX_PAT"
    ],
    "doc": "https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-rest-api"
  },
  "tencent-token-plan": {
    "name": "Tencent Token Plan",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.lkeap.cloud.tencent.com/plan/v3",
    "env": [
      "TENCENT_TOKEN_PLAN_API_KEY"
    ],
    "doc": "https://cloud.tencent.com/document/product/1823/130060"
  },
  "github-models": {
    "name": "GitHub Models",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://models.github.ai/inference",
    "env": [
      "GITHUB_TOKEN"
    ],
    "doc": "https://docs.github.com/en/github-models"
  },
  "neuralwatt": {
    "name": "Neuralwatt",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.neuralwatt.com/v1",
    "env": [
      "NEURALWATT_API_KEY"
    ],
    "doc": "https://portal.neuralwatt.com/docs"
  },
  "siliconflow-cn": {
    "name": "SiliconFlow (China)",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.siliconflow.cn/v1",
    "env": [
      "SILICONFLOW_CN_API_KEY"
    ],
    "doc": "https://cloud.siliconflow.com/models"
  },
  "merge-gateway": {
    "name": "Merge Gateway",
    "npm": "merge-gateway-ai-sdk-provider",
    "env": [
      "MERGE_GATEWAY_API_KEY"
    ],
    "doc": "https://docs.merge.dev/merge-gateway"
  },
  "qihang-ai": {
    "name": "QiHang",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.qhaigc.net/v1",
    "env": [
      "QIHANG_API_KEY"
    ],
    "doc": "https://www.qhaigc.net/docs"
  },
  "xiaomi-token-plan-ams": {
    "name": "Xiaomi Token Plan (Europe)",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://token-plan-ams.xiaomimimo.com/v1",
    "env": [
      "XIAOMI_API_KEY"
    ],
    "doc": "https://platform.xiaomimimo.com/#/docs"
  },
  "modelscope": {
    "name": "ModelScope",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api-inference.modelscope.cn/v1",
    "env": [
      "MODELSCOPE_API_KEY"
    ],
    "doc": "https://modelscope.cn/docs/model-service/API-Inference/intro"
  },
  "groq": {
    "name": "Groq",
    "npm": "@ai-sdk/groq",
    "env": [
      "GROQ_API_KEY"
    ],
    "doc": "https://console.groq.com/docs/models"
  },
  "mixlayer": {
    "name": "Mixlayer",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://models.mixlayer.ai/v1",
    "env": [
      "MIXLAYER_API_KEY"
    ],
    "doc": "https://docs.mixlayer.com"
  },
  "orcarouter": {
    "name": "OrcaRouter",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.orcarouter.ai/v1",
    "env": [
      "ORCAROUTER_API_KEY"
    ],
    "doc": "https://docs.orcarouter.ai"
  },
  "helicone": {
    "name": "Helicone",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://ai-gateway.helicone.ai/v1",
    "env": [
      "HELICONE_API_KEY"
    ],
    "doc": "https://helicone.ai/models"
  },
  "zai": {
    "name": "Z.AI",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.z.ai/api/paas/v4",
    "env": [
      "ZHIPU_API_KEY"
    ],
    "doc": "https://docs.z.ai/guides/overview/pricing"
  },
  "nearai": {
    "name": "NEAR AI Cloud",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://cloud-api.near.ai/v1",
    "env": [
      "NEARAI_API_KEY"
    ],
    "doc": "https://docs.near.ai/"
  },
  "llmgateway": {
    "name": "LLM Gateway",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.llmgateway.io/v1",
    "env": [
      "LLMGATEWAY_API_KEY"
    ],
    "doc": "https://llmgateway.io/docs"
  },
  "alibaba-coding-plan-cn": {
    "name": "Alibaba Coding Plan (China)",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://coding.dashscope.aliyuncs.com/v1",
    "env": [
      "ALIBABA_CODING_PLAN_API_KEY"
    ],
    "doc": "https://help.aliyun.com/zh/model-studio/coding-plan"
  },
  "abacus": {
    "name": "Abacus",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://routellm.abacus.ai/v1",
    "env": [
      "ABACUS_API_KEY"
    ],
    "doc": "https://abacus.ai/help/api"
  },
  "cloudferro-sherlock": {
    "name": "CloudFerro Sherlock",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api-sherlock.cloudferro.com/openai/v1/",
    "env": [
      "CLOUDFERRO_SHERLOCK_API_KEY"
    ],
    "doc": "https://docs.sherlock.cloudferro.com/"
  },
  "ollama-cloud": {
    "name": "Ollama Cloud",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://ollama.com/v1",
    "env": [
      "OLLAMA_API_KEY"
    ],
    "doc": "https://docs.ollama.com/cloud"
  },
  "cloudflare-ai-gateway": {
    "name": "Cloudflare AI Gateway",
    "npm": "ai-gateway-provider",
    "env": [
      "CLOUDFLARE_API_TOKEN",
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_GATEWAY_ID"
    ],
    "doc": "https://developers.cloudflare.com/ai-gateway/"
  },
  "moonshotai-cn": {
    "name": "Moonshot AI (China)",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.moonshot.cn/v1",
    "env": [
      "MOONSHOT_API_KEY"
    ],
    "doc": "https://platform.moonshot.cn/docs/api/chat"
  },
  "morph": {
    "name": "Morph",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.morphllm.com/v1",
    "env": [
      "MORPH_API_KEY"
    ],
    "doc": "https://docs.morphllm.com/api-reference/introduction"
  },
  "sakana": {
    "name": "Sakana AI",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.sakana.ai/v1",
    "env": [
      "SAKANA_API_KEY"
    ],
    "doc": "https://console.sakana.ai/models"
  },
  "deepinfra": {
    "name": "Deep Infra",
    "npm": "@ai-sdk/deepinfra",
    "env": [
      "DEEPINFRA_API_KEY"
    ],
    "doc": "https://deepinfra.com/models"
  },
  "google-vertex-anthropic": {
    "name": "Vertex (Anthropic)",
    "npm": "@ai-sdk/google-vertex/anthropic",
    "env": [
      "GOOGLE_VERTEX_PROJECT",
      "GOOGLE_VERTEX_LOCATION",
      "GOOGLE_APPLICATION_CREDENTIALS"
    ],
    "doc": "https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/claude"
  },
  "v0": {
    "name": "v0",
    "npm": "@ai-sdk/vercel",
    "env": [
      "V0_API_KEY"
    ],
    "doc": "https://sdk.vercel.ai/providers/ai-sdk-providers/vercel"
  },
  "azure": {
    "name": "Azure",
    "npm": "@ai-sdk/azure",
    "env": [
      "AZURE_RESOURCE_NAME",
      "AZURE_API_KEY"
    ],
    "doc": "https://learn.microsoft.com/en-us/azure/ai-services/openai/concepts/models"
  },
  "cerebras": {
    "name": "Cerebras",
    "npm": "@ai-sdk/cerebras",
    "env": [
      "CEREBRAS_API_KEY"
    ],
    "doc": "https://inference-docs.cerebras.ai/models/overview"
  },
  "zai-coding-plan": {
    "name": "Z.AI Coding Plan",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.z.ai/api/coding/paas/v4",
    "env": [
      "ZHIPU_API_KEY"
    ],
    "doc": "https://docs.z.ai/devpack/overview"
  },
  "nvidia": {
    "name": "Nvidia",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://integrate.api.nvidia.com/v1",
    "env": [
      "NVIDIA_API_KEY"
    ],
    "doc": "https://docs.api.nvidia.com/nim/"
  },
  "evroc": {
    "name": "evroc",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://models.think.evroc.com/v1",
    "env": [
      "EVROC_API_KEY"
    ],
    "doc": "https://docs.evroc.com/products/think/overview.html"
  },
  "xiaomi": {
    "name": "Xiaomi",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.xiaomimimo.com/v1",
    "env": [
      "XIAOMI_API_KEY"
    ],
    "doc": "https://platform.xiaomimimo.com/#/docs"
  },
  "inception": {
    "name": "Inception",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.inceptionlabs.ai/v1/",
    "env": [
      "INCEPTION_API_KEY"
    ],
    "doc": "https://platform.inceptionlabs.ai/docs"
  },
  "tencent-coding-plan": {
    "name": "Tencent Coding Plan (China)",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.lkeap.cloud.tencent.com/coding/v3",
    "env": [
      "TENCENT_CODING_PLAN_API_KEY"
    ],
    "doc": "https://cloud.tencent.com/document/product/1772/128947"
  },
  "freemodel": {
    "name": "FreeModel",
    "npm": "@ai-sdk/anthropic",
    "api": "https://cc.freemodel.dev/v1",
    "env": [
      "FREEMODEL_API_KEY"
    ],
    "doc": "https://freemodel.dev"
  },
  "sap-ai-core": {
    "name": "SAP AI Core",
    "npm": "@jerome-benoit/sap-ai-provider-v2",
    "env": [
      "AICORE_SERVICE_KEY"
    ],
    "doc": "https://help.sap.com/docs/sap-ai-core"
  },
  "opencode": {
    "name": "OpenCode Zen",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://opencode.ai/zen/v1",
    "env": [
      "OPENCODE_API_KEY"
    ],
    "doc": "https://opencode.ai/docs/zen"
  },
  "inference": {
    "name": "Inference",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://inference.net/v1",
    "env": [
      "INFERENCE_API_KEY"
    ],
    "doc": "https://inference.net/models"
  },
  "inceptron": {
    "name": "Inceptron",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.inceptron.io/v1",
    "env": [
      "INCEPTRON_API_KEY"
    ],
    "doc": "https://docs.inceptron.io"
  },
  "llama": {
    "name": "Llama",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.llama.com/compat/v1/",
    "env": [
      "LLAMA_API_KEY"
    ],
    "doc": "https://llama.developer.meta.com/docs/models"
  },
  "llmtr": {
    "name": "LLMTR",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://llmtr.com/v1",
    "env": [
      "LLMTR_API_KEY"
    ],
    "doc": "https://llmtr.com/docs"
  },
  "cohere": {
    "name": "Cohere",
    "npm": "@ai-sdk/cohere",
    "env": [
      "COHERE_API_KEY"
    ],
    "doc": "https://docs.cohere.com/docs/models"
  },
  "sarvam": {
    "name": "Sarvam AI",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.sarvam.ai/v1",
    "env": [
      "SARVAM_API_KEY"
    ],
    "doc": "https://docs.sarvam.ai/api-reference-docs/getting-started/models"
  },
  "stepfun": {
    "name": "StepFun",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.stepfun.com/v1",
    "env": [
      "STEPFUN_API_KEY"
    ],
    "doc": "https://platform.stepfun.com/docs/zh/overview/concept"
  },
  "hpc-ai": {
    "name": "HPC-AI",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.hpc-ai.com/inference/v1",
    "env": [
      "HPC_AI_API_KEY"
    ],
    "doc": "https://www.hpc-ai.com/doc/docs/quickstart/"
  },
  "minimax-cn": {
    "name": "MiniMax (minimaxi.com)",
    "npm": "@ai-sdk/anthropic",
    "api": "https://api.minimaxi.com/anthropic/v1",
    "env": [
      "MINIMAX_API_KEY"
    ],
    "doc": "https://platform.minimaxi.com/docs/guides/quickstart"
  },
  "alibaba-coding-plan": {
    "name": "Alibaba Coding Plan",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://coding-intl.dashscope.aliyuncs.com/v1",
    "env": [
      "ALIBABA_CODING_PLAN_API_KEY"
    ],
    "doc": "https://www.alibabacloud.com/help/en/model-studio/coding-plan"
  },
  "longcat": {
    "name": "LongCat",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.longcat.chat/openai",
    "env": [
      "LONGCAT_API_KEY"
    ],
    "doc": "https://longcat.chat/platform/docs/"
  },
  "poe": {
    "name": "Poe",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.poe.com/v1",
    "env": [
      "POE_API_KEY"
    ],
    "doc": "https://creator.poe.com/docs/external-applications/openai-compatible-api"
  },
  "kimi-for-coding": {
    "name": "Kimi For Coding",
    "npm": "@ai-sdk/anthropic",
    "api": "https://api.kimi.com/coding/v1",
    "env": [
      "KIMI_API_KEY"
    ],
    "doc": "https://www.kimi.com/code/docs/en/third-party-tools/other-coding-agents.html"
  },
  "dinference": {
    "name": "DInference",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.dinference.com/v1",
    "env": [
      "DINFERENCE_API_KEY"
    ],
    "doc": "https://dinference.com"
  },
  "perplexity-agent": {
    "name": "Perplexity Agent",
    "npm": "@ai-sdk/openai",
    "api": "https://api.perplexity.ai/v1",
    "env": [
      "PERPLEXITY_API_KEY"
    ],
    "doc": "https://docs.perplexity.ai/docs/agent-api/models"
  },
  "siliconflow": {
    "name": "SiliconFlow",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.siliconflow.com/v1",
    "env": [
      "SILICONFLOW_API_KEY"
    ],
    "doc": "https://cloud.siliconflow.com/models"
  },
  "umans-ai-coding-plan": {
    "name": "Umans AI Coding Plan",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.code.umans.ai/v1",
    "env": [
      "UMANS_AI_CODING_PLAN_API_KEY"
    ],
    "doc": "https://app.umans.ai/offers/code/docs"
  },
  "io-net": {
    "name": "IO.NET",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.intelligence.io.solutions/api/v1",
    "env": [
      "IOINTELLIGENCE_API_KEY"
    ],
    "doc": "https://io.net/docs/guides/intelligence/io-intelligence"
  },
  "gmicloud": {
    "name": "GMI Cloud",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.gmi-serving.com/v1",
    "env": [
      "GMICLOUD_API_KEY"
    ],
    "doc": "https://docs.gmicloud.ai/inference-engine/api-reference/llm-api-reference"
  },
  "xiaomi-token-plan-cn": {
    "name": "Xiaomi Token Plan (China)",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://token-plan-cn.xiaomimimo.com/v1",
    "env": [
      "XIAOMI_API_KEY"
    ],
    "doc": "https://platform.xiaomimimo.com/#/docs"
  },
  "zeldoc": {
    "name": "Zeldoc",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.zeldoc.ai/v1",
    "env": [
      "ZELDOC_API_KEY"
    ],
    "doc": "https://docs.zeldoc.ai"
  },
  "scaleway": {
    "name": "Scaleway",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.scaleway.ai/v1",
    "env": [
      "SCALEWAY_API_KEY"
    ],
    "doc": "https://www.scaleway.com/en/docs/generative-apis/"
  },
  "ovhcloud": {
    "name": "OVHcloud AI Endpoints",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1",
    "env": [
      "OVHCLOUD_API_KEY"
    ],
    "doc": "https://www.ovhcloud.com/en/public-cloud/ai-endpoints/catalog//"
  },
  "friendli": {
    "name": "Friendli",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.friendli.ai/serverless/v1",
    "env": [
      "FRIENDLI_TOKEN"
    ],
    "doc": "https://friendli.ai/docs/guides/serverless_endpoints/introduction"
  },
  "tencent-tokenhub": {
    "name": "Tencent TokenHub",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://tokenhub.tencentmaas.com/v1",
    "env": [
      "TENCENT_TOKENHUB_API_KEY"
    ],
    "doc": "https://cloud.tencent.com/document/product/1823/130050"
  },
  "wandb": {
    "name": "Weights & Biases",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.inference.wandb.ai/v1",
    "env": [
      "WANDB_API_KEY"
    ],
    "doc": "https://docs.wandb.ai/guides/integrations/inference/"
  },
  "kuae-cloud-coding-plan": {
    "name": "KUAE Cloud Coding Plan",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://coding-plan-endpoint.kuaecloud.net/v1",
    "env": [
      "KUAE_API_KEY"
    ],
    "doc": "https://docs.mthreads.com/kuaecloud/kuaecloud-doc-online/coding_plan/"
  },
  "gitlab": {
    "name": "GitLab Duo",
    "npm": "gitlab-ai-provider",
    "env": [
      "GITLAB_TOKEN"
    ],
    "doc": "https://docs.gitlab.com/user/duo_agent_platform/"
  },
  "kilo": {
    "name": "Kilo Gateway",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.kilo.ai/api/gateway",
    "env": [
      "KILO_API_KEY"
    ],
    "doc": "https://kilo.ai"
  },
  "lucidquery": {
    "name": "LucidQuery",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.lucidquery.com/v1",
    "env": [
      "LUCIDQUERY_API_KEY"
    ],
    "doc": "https://lucidquery.com/docs"
  },
  "meganova": {
    "name": "Meganova",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.meganova.ai/v1",
    "env": [
      "MEGANOVA_API_KEY"
    ],
    "doc": "https://docs.meganova.ai"
  },
  "perplexity": {
    "name": "Perplexity",
    "npm": "@ai-sdk/perplexity",
    "env": [
      "PERPLEXITY_API_KEY"
    ],
    "doc": "https://docs.perplexity.ai"
  },
  "amazon-bedrock": {
    "name": "Amazon Bedrock",
    "npm": "@ai-sdk/amazon-bedrock",
    "env": [
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_REGION",
      "AWS_BEARER_TOKEN_BEDROCK"
    ],
    "doc": "https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html"
  },
  "umans-ai": {
    "name": "Umans AI",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.code.umans.ai/v1",
    "env": [
      "UMANS_AI_API_KEY"
    ],
    "doc": "https://app.umans.ai/offers/code/docs/orgs"
  },
  "togetherai": {
    "name": "Together AI",
    "npm": "@ai-sdk/togetherai",
    "env": [
      "TOGETHER_API_KEY"
    ],
    "doc": "https://docs.together.ai/docs/serverless-models"
  },
  "frogbot": {
    "name": "FrogBot",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://app.frogbot.ai/api/v1",
    "env": [
      "FROGBOT_API_KEY"
    ],
    "doc": "https://docs.frogbot.ai"
  },
  "openrouter": {
    "name": "OpenRouter",
    "npm": "@openrouter/ai-sdk-provider",
    "api": "https://openrouter.ai/api/v1",
    "env": [
      "OPENROUTER_API_KEY"
    ],
    "doc": "https://openrouter.ai/models"
  },
  "jiekou": {
    "name": "Jiekou.AI",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.jiekou.ai/openai",
    "env": [
      "JIEKOU_API_KEY"
    ],
    "doc": "https://docs.jiekou.ai/docs/support/quickstart?utm_source=github_models.dev"
  },
  "nova": {
    "name": "Nova",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.nova.amazon.com/v1",
    "env": [
      "NOVA_API_KEY"
    ],
    "doc": "https://nova.amazon.com/dev/documentation"
  },
  "alibaba-token-plan": {
    "name": "Alibaba Token Plan",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    "env": [
      "ALIBABA_TOKEN_PLAN_API_KEY"
    ],
    "doc": "https://www.alibabacloud.com/help/en/model-studio/token-plan-overview"
  },
  "alibaba": {
    "name": "Alibaba",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    "env": [
      "DASHSCOPE_API_KEY"
    ],
    "doc": "https://www.alibabacloud.com/help/en/model-studio/models"
  },
  "databricks": {
    "name": "Databricks",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://${DATABRICKS_HOST}/ai-gateway/mlflow/v1",
    "env": [
      "DATABRICKS_HOST",
      "DATABRICKS_TOKEN"
    ],
    "doc": "https://docs.databricks.com/aws/en/machine-learning/foundation-models/"
  },
  "crof": {
    "name": "CrofAI",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://crof.ai/v1",
    "env": [
      "CROF_API_KEY"
    ],
    "doc": "https://crof.ai/docs"
  },
  "fastrouter": {
    "name": "FastRouter",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://go.fastrouter.ai/api/v1",
    "env": [
      "FASTROUTER_API_KEY"
    ],
    "doc": "https://fastrouter.ai/models"
  },
  "abliteration-ai": {
    "name": "abliteration.ai",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.abliteration.ai/v1",
    "env": [
      "ABLIT_KEY"
    ],
    "doc": "https://docs.abliteration.ai/models"
  },
  "xpersona": {
    "name": "Xpersona",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://www.xpersona.co/v1",
    "env": [
      "XPERSONA_API_KEY"
    ],
    "doc": "https://www.xpersona.co/docs"
  },
  "azure-cognitive-services": {
    "name": "Azure Cognitive Services",
    "npm": "@ai-sdk/azure",
    "env": [
      "AZURE_COGNITIVE_SERVICES_RESOURCE_NAME",
      "AZURE_COGNITIVE_SERVICES_API_KEY"
    ],
    "doc": "https://learn.microsoft.com/en-us/azure/ai-services/openai/concepts/models"
  },
  "baseten": {
    "name": "Baseten",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://inference.baseten.co/v1",
    "env": [
      "BASETEN_API_KEY"
    ],
    "doc": "https://docs.baseten.co/inference/model-apis/overview"
  },
  "atomic-chat": {
    "name": "Atomic Chat",
    "npm": "@ai-sdk/openai-compatible",
    "api": "http://127.0.0.1:1337/v1",
    "env": [
      "ATOMIC_CHAT_API_KEY"
    ],
    "doc": "https://atomic.chat"
  },
  "routing-run": {
    "name": "routing.run",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://ai.routing.sh/v1",
    "env": [
      "ROUTING_RUN_API_KEY"
    ],
    "doc": "https://docs.routing.run/api-reference/models"
  },
  "aihubmix": {
    "name": "AIHubMix",
    "npm": "@aihubmix/ai-sdk-provider",
    "env": [
      "AIHUBMIX_API_KEY"
    ],
    "doc": "https://docs.aihubmix.com"
  },
  "google-vertex": {
    "name": "Vertex",
    "npm": "@ai-sdk/google-vertex",
    "env": [
      "GOOGLE_VERTEX_PROJECT",
      "GOOGLE_VERTEX_LOCATION",
      "GOOGLE_APPLICATION_CREDENTIALS"
    ],
    "doc": "https://cloud.google.com/vertex-ai/generative-ai/docs/models"
  },
  "nano-gpt": {
    "name": "NanoGPT",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://nano-gpt.com/api/v1",
    "env": [
      "NANO_GPT_API_KEY"
    ],
    "doc": "https://docs.nano-gpt.com"
  },
  "moark": {
    "name": "Moark",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://moark.com/v1",
    "env": [
      "MOARK_API_KEY"
    ],
    "doc": "https://moark.com/docs/openapi/v1#tag/%E6%96%87%E6%9C%AC%E7%94%9F%E6%88%90"
  },
  "lilac": {
    "name": "Lilac",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.getlilac.com/v1",
    "env": [
      "LILAC_API_KEY"
    ],
    "doc": "https://docs.getlilac.com/inference/models"
  },
  "ambient": {
    "name": "Ambient",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.ambient.xyz/v1",
    "env": [
      "AMBIENT_API_KEY"
    ],
    "doc": "https://ambient.xyz"
  },
  "neon": {
    "name": "Neon",
    "npm": "@ai-sdk/openai-compatible",
    "api": "${NEON_AI_GATEWAY_BASE_URL}/ai-gateway/mlflow/v1",
    "env": [
      "NEON_AI_GATEWAY_BASE_URL",
      "NEON_AI_GATEWAY_TOKEN"
    ],
    "doc": "https://neon.com/docs"
  },
  "upstage": {
    "name": "Upstage",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.upstage.ai/v1/solar",
    "env": [
      "UPSTAGE_API_KEY"
    ],
    "doc": "https://developers.upstage.ai/docs/apis/chat"
  },
  "zhipuai-coding-plan": {
    "name": "Zhipu AI Coding Plan",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://open.bigmodel.cn/api/coding/paas/v4",
    "env": [
      "ZHIPU_API_KEY"
    ],
    "doc": "https://docs.bigmodel.cn/cn/coding-plan/overview"
  },
  "chutes": {
    "name": "Chutes",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://llm.chutes.ai/v1",
    "env": [
      "CHUTES_API_KEY"
    ],
    "doc": "https://llm.chutes.ai/v1/models"
  },
  "minimax-cn-coding-plan": {
    "name": "MiniMax Token Plan (minimaxi.com)",
    "npm": "@ai-sdk/anthropic",
    "api": "https://api.minimaxi.com/anthropic/v1",
    "env": [
      "MINIMAX_API_KEY"
    ],
    "doc": "https://platform.minimaxi.com/docs/token-plan/intro"
  },
  "deepseek": {
    "name": "DeepSeek",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.deepseek.com",
    "env": [
      "DEEPSEEK_API_KEY"
    ],
    "doc": "https://api-docs.deepseek.com/quick_start/pricing"
  },
  "wafer.ai": {
    "name": "Wafer",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://pass.wafer.ai/v1",
    "env": [
      "WAFER_API_KEY"
    ],
    "doc": "https://docs.wafer.ai/wafer-pass"
  },
  "minimax": {
    "name": "MiniMax (minimax.io)",
    "npm": "@ai-sdk/anthropic",
    "api": "https://api.minimax.io/anthropic/v1",
    "env": [
      "MINIMAX_API_KEY"
    ],
    "doc": "https://platform.minimax.io/docs/guides/quickstart"
  },
  "github-copilot": {
    "name": "GitHub Copilot",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.githubcopilot.com",
    "env": [
      "GITHUB_TOKEN"
    ],
    "doc": "https://docs.github.com/en/copilot"
  },
  "clarifai": {
    "name": "Clarifai",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.clarifai.com/v2/ext/openai/v1",
    "env": [
      "CLARIFAI_PAT"
    ],
    "doc": "https://docs.clarifai.com/compute/inference/"
  },
  "the-grid-ai": {
    "name": "The Grid AI",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.thegrid.ai/v1",
    "env": [
      "THEGRIDAI_API_KEY"
    ],
    "doc": "https://thegrid.ai/docs"
  },
  "synthetic": {
    "name": "Synthetic",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.synthetic.new/openai/v1",
    "env": [
      "SYNTHETIC_API_KEY"
    ],
    "doc": "https://synthetic.new/pricing"
  },
  "iflowcn": {
    "name": "iFlow",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://apis.iflow.cn/v1",
    "env": [
      "IFLOW_API_KEY"
    ],
    "doc": "https://platform.iflow.cn/en/docs"
  },
  "xiaomi-token-plan-sgp": {
    "name": "Xiaomi Token Plan (Singapore)",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://token-plan-sgp.xiaomimimo.com/v1",
    "env": [
      "XIAOMI_API_KEY"
    ],
    "doc": "https://platform.xiaomimimo.com/#/docs"
  },
  "claudinio": {
    "name": "Claudinio",
    "npm": "@ai-sdk/openai-compatible",
    "api": "https://api.claudin.io/v1",
    "env": [
      "CLAUDINIO_API_KEY"
    ],
    "doc": "https://claudin.io"
  }
};
