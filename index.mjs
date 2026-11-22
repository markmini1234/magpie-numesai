// Numes (numes.ai) for Magpie.
//
// Numes speaks the OpenAI Chat Completions shape at
// https://api.numes.ai/api/v1, authenticated with an inference key. The key
// also lists the models it may use and carries its own spending limit and
// usage, so sign-in, model discovery and the usage card all come from the
// same API.
const ID = "numes";
const BASE = "https://api.numes.ai/api/v1";
const NPM = "@ai-sdk/openai-compatible";
const MODALITIES = ["text", "image", "audio", "video", "pdf"];
const RESET_SPAN = { daily: 86_400, weekly: 604_800, monthly: 2_592_000 };

async function readJSON(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Numes answered HTTP ${response.status} with a body that isn't JSON`);
  }
}

function errorText(response, body) {
  const message = body?.error?.message;
  return typeof message === "string" && message ? message : `Numes answered HTTP ${response.status}`;
}

async function numes(path, key, { method = "GET", signal } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      accept: "application/json",
      "HTTP-Referer": "https://usemagpie.ai",
      "X-Title": "Magpie",
    },
    signal,
  });
  const body = await readJSON(response);
  return { response, body };
}

function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

function perMillion(value) {
  return Number((money(value) * 1_000_000).toFixed(6));
}

function modalities(list) {
  const said = Array.isArray(list) ? list : [];
  return Object.fromEntries(MODALITIES.map((kind) => [kind, said.includes(kind)]));
}

function modelOf(model) {
  const pricing = model.pricing ?? {};
  const supported = new Set(Array.isArray(model.supported_parameters) ? model.supported_parameters : []);
  const inputModalities = Array.isArray(model.architecture?.input_modalities) ? model.architecture.input_modalities : ["text"];
  const outputModalities = Array.isArray(model.architecture?.output_modalities) ? model.architecture.output_modalities : ["text"];
  const efforts = Array.isArray(model.reasoning?.supported_efforts) ? model.reasoning.supported_efforts : [];
  const output = model.maximum_output_length ?? model.top_provider?.max_completion_tokens ?? 0;
  return {
    id: model.id,
    name: model.name ?? model.id,
    api: { id: model.id, url: BASE, npm: NPM },
    status: "active",
    limit: {
      context: Number(model.context_length) || 0,
      ...(Number(model.max_input_tokens) > 0 ? { input: Number(model.max_input_tokens) } : {}),
      output: Number(output) || 0,
    },
    capabilities: {
      temperature: supported.size ? supported.has("temperature") : true,
      reasoning: efforts.length > 0 || supported.has("reasoning") || model.reasoning?.default_enabled === true,
      attachment: inputModalities.some((kind) => kind !== "text"),
      toolcall: supported.has("tools"),
      input: modalities(inputModalities),
      output: modalities(outputModalities),
      interleaved: false,
    },
    cost: {
      input: perMillion(pricing.prompt),
      output: perMillion(pricing.completion),
      cache: {
        read: perMillion(pricing.input_cache_read),
        write: perMillion(pricing.input_cache_write),
      },
    },
    variants: Object.fromEntries(efforts.map((effort) => [effort, { reasoningEffort: effort }])),
    free: perMillion(pricing.prompt) === 0 && perMillion(pricing.completion) === 0 && money(pricing.request) === 0,
    release_date: Number(model.created) > 0 ? new Date(Number(model.created) * 1000).toISOString() : "",
  };
}

function usageOf(data) {
  const currency = typeof data.billing_currency === "string" ? data.billing_currency : "USD";
  const windows = [];
  if (Number(data.limit) > 0) {
    windows.push({
      name: `${data.limit_reset ?? "key"} limit`,
      used: (money(data.usage) / money(data.limit)) * 100,
      amount: money(data.usage),
      limit: money(data.limit),
      unit: currency,
      ...(RESET_SPAN[data.limit_reset] ? { span: RESET_SPAN[data.limit_reset] } : {}),
    });
  }
  for (const [name, field, span] of [
    ["Today", "usage_daily", 86_400],
    ["This week", "usage_weekly", 604_800],
    ["This month", "usage_monthly", 2_592_000],
  ]) {
    if (money(data[field]) > 0) windows.push({ name, amount: money(data[field]), unit: currency, span, aside: true });
  }
  return {
    plan: typeof data.name === "string" ? data.name : "",
    user: typeof data.label === "string" ? data.label : "",
    balance: Number.isFinite(Number(data.limit_remaining)) ? `${money(data.limit_remaining)} ${currency}` : "",
    error: data.disabled === true ? "This Numes key is disabled" : "",
    windows,
  };
}

export async function NumesPlugin(_input, _options = {}) {
  return {
    async config(cfg) {
      cfg.provider ??= {};
      cfg.provider[ID] ??= {
        name: "Numes",
        npm: NPM,
        api: BASE,
        models: {},
      };
    },

    provider: {
      id: ID,
      async models(_provider, { auth } = {}) {
        const key = auth?.key;
        if (typeof key !== "string" || !key) return {};
        const { response, body } = await numes("/models", key);
        if (!response.ok) throw new Error(errorText(response, body));
        if (!Array.isArray(body?.data)) throw new Error("Numes returned no model list");
        return Object.fromEntries(
          body.data
            .filter(
              (model) =>
                model &&
                typeof model.id === "string" &&
                (!Array.isArray(model.architecture?.output_modalities) || model.architecture.output_modalities.includes("text")),
            )
            .map((model) => [model.id, modelOf(model)]),
        );
      },
    },

    auth: {
      provider: ID,
      maxConcurrency: 6,
      methods: [
        {
          type: "api",
          label: "Numes API key",
          prompts: [
            {
              key: "key",
              message: "Numes inference key",
              placeholder: "sk-...",
              validate: (value) => (typeof value === "string" && value.trim() ? undefined : "Paste the key from numes.ai → API keys"),
            },
          ],
          async authorize(inputs) {
            const key = typeof inputs.key === "string" ? inputs.key.trim() : "";
            if (!key) return { type: "failed", error: "Paste a Numes inference key" };
            const { response, body } = await numes("/key", key);
            if (!response.ok) return { type: "failed", error: errorText(response, body) };
            const data = body?.data;
            if (!data || data.is_management_key === true) {
              return { type: "failed", error: "This is a management key; paste an inference key" };
            }
            return {
              type: "success",
              key,
              metadata: {
                name: typeof data.name === "string" ? data.name : "",
                label: typeof data.label === "string" ? data.label : "",
                currency: typeof data.billing_currency === "string" ? data.billing_currency : "",
              },
            };
          },
        },
      ],

      async loader(getAuth) {
        const auth = await getAuth();
        const key = auth?.key;
        if (typeof key !== "string" || !key) throw new Error("Numes sign-in has no inference key");
        return {
          baseURL: BASE,
          apiKey: key,
          headers: {
            "HTTP-Referer": "https://usemagpie.ai",
            "X-Title": "Magpie",
          },
        };
      },

      async usage(getAuth, _provider, options = {}) {
        const auth = await getAuth();
        const key = auth?.key;
        if (typeof key !== "string" || !key) return { error: "Numes sign-in has no inference key" };
        const { response, body } = await numes("/key", key, { signal: options.signal });
        if (!response.ok) return { error: errorText(response, body) };
        if (!body?.data) return { error: "Numes returned no key metadata" };
        return usageOf(body.data);
      },
    },
  };
}

export default NumesPlugin;
