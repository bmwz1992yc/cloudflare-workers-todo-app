Cloudflare KV 待办清单应用 Worker
这是一个基于 Cloudflare Workers 和 Workers KV 存储的无服务器（Serverless）待办清单应用程序。它提供了三种不同的访问模式：用户私人清单、管理员控制台和可协作的共享视图。

该项目将后端逻辑、路由、KV 数据库操作以及完整的 HTML/CSS/JavaScript 前端渲染代码全部封装在一个 Cloudflare Worker 中。

核心技术栈
组件

描述

运行时环境

Cloudflare Workers

持久化存储

Cloudflare Workers KV 命名空间 (TODOS_KV)

编程语言

JavaScript (ES Module Worker)

前端

原生 HTML, CSS (Tailwind CSS CDN), JavaScript

架构与数据模型
1. 访问模式与路由
Worker 依靠 URL 路径 (pathname) 的第一个段来确定请求的访问模式。

模式

路径示例

描述

权限

USER

/alice

私人模式。 用户只能管理自己的待办事项。

读写自身数据

ADMIN

/

控制台模式。 查看所有用户数据，管理全局共享链接。

读所有数据, 读写共享链接

SHARE

/8a2c4e1f

共享协作模式。 通过 Token 访问，可查看并修改所有用户的清单。

读写所有数据

ADMIN API

/admin

用于处理共享链接的生成 (POST) 和删除 (DELETE) 请求。

需通过 Token 验证或依赖路径权限

2. KV 数据结构
项目使用了单个 KV 命名空间 (TODOS_KV)，但通过键名（Key）前缀区分用户数据和全局配置。

数据类型

KV Key 格式

Value (JSON Structure)

用户待办事项

todos:<userId>

Array<{id: string, text: string, completed: boolean}>

共享链接

admin:share_links

Object<string, {memo: string, created_at: string}> (Key 是 8 位 Token)

关键功能与端点
1. 待办事项 CRUD (用户/共享模式)
Worker 通过不同的 HTTP 方法处理对用户清单的修改。

HTTP 方法

URL 格式

Payload

操作描述

GET

/<userId>

N/A

渲染用户清单 HTML 并返回列表数据。

POST

/<userId>

FormData {text: string}

添加新待办事项（仅限 USER 模式）。

PUT

/<userId> 或 /<token>

JSON {id: string, completed: boolean, ownerId: string}

切换事项状态。在 SHARE 模式下必须提供 ownerId。

DELETE

/<userId> 或 /<token>

JSON {id: string, ownerId: string}

删除待办事项。在 SHARE 模式下必须提供 ownerId。

2. 共享链接管理 (管理员模式)
HTTP 方法

URL 格式

Payload

操作描述

POST

/admin

FormData {memo: string}

生成新的 8 位随机 Token，并将其保存到 admin:share_links。成功后重定向。

DELETE

/admin

JSON {token: string}

删除指定的共享 Token，使其链接失效。

部署要求
为了使此 Worker 正常运行，必须配置以下环境变量和绑定：

1. KV 绑定 (必需)
必须将一个 Workers KV 命名空间绑定到 Worker 上，并命名为：

TODOS_KV

2. 部署流程
创建 Cloudflare Worker。

创建 Workers KV 命名空间（例如 my_todo_kv）。

在 Worker 设置中，将该 KV 命名空间绑定为变量 TODOS_KV。

将 worker.js 代码部署到 Worker。

访问 Worker 的 URL 根路径 (/) 进入管理员模式。