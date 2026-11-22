# magpie-numes-auth

把 [Numes](https://numes.ai/) 的模型接进 Magpie，provider id 为 `numes`。

Numes 提供 OpenAI Chat Completions 兼容接口：

```
https://api.numes.ai/api/v1
```

插件使用 Numes 的 **inference key** 认证，自动读取该 key 可用的模型、价格、上下文和推理能力，并显示 key 的额度与用量。

## 安装

```sh
/Applications/magpie.app/Contents/MacOS/magpie plugin add /path/to/magpie-numes-auth
```

或者从 GitHub 克隆后安装：

```sh
git clone https://github.com/markmini1234/magpie-numesai.git
/Applications/magpie.app/Contents/MacOS/magpie plugin add ./magpie-numesai
```

然后在 Magpie 的 Providers 里打开 `Numes`，添加账号。

## 获取 API key

1. 登录 `https://numes.ai/`。
2. 打开 Dashboard → API keys。
3. 创建一个 **inference key**（不是 management key）。
4. 在 Magpie 登录框里粘贴这个 key。

插件会调用 `GET /key` 验证，并拒绝 management key。

## 模型

登录后插件调用 `GET /models`，只保留能输出文本的模型。模型名形如：

```
numes/openai/gpt-6-luna
numes/anthropic/claude-sonnet-5-5
```

请求会直接走 Numes 的 `/chat/completions`，流式输出、工具调用和推理参数按 Numes 的 OpenAI 兼容约定传递。

## 用量卡片

`GET /key` 返回的 key 名称、消费限额、剩余额度和日/周/月用量会显示在 Magpie 的账号卡片上。`/credits` 需要 management key，暂不使用。

## 说明

Numes 的 API 只接受服务端请求，浏览器跨域请求会被拒绝；Magpie 插件本身在本地后端运行，不受影响。请勿把 key 写进前端代码。
