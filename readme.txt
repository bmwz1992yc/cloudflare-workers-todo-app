# Cloudflare Workers 待办清单应用

这是一个基于 Cloudflare Workers 和 R2 存储的无服务器（Serverless）待办清单应用程序。它提供了三种不同的访问模式：用户私人清单、管理员控制台和可协作的共享视图。

该项目将后端逻辑、路由、R2 数据库操作以及完整的 HTML/CSS/JavaScript 前端渲染代码全部封装在一个 Cloudflare Worker 中。

## 核心技术栈

| 组件 | 描述 |
|------|------|
| 运行时环境 | Cloudflare Workers |
| 持久化存储 | Cloudflare R2 存储桶 |
| 编程语言 | JavaScript (ES Module Worker) |
| 前端框架 | 原生 HTML, CSS (Tailwind CSS CDN), JavaScript |

## 项目结构

```
├── index.js          # 主要的 Worker 脚本
├── index.html        # 管理员控制台页面
├── styles.css        # 样式文件
├── script.js         # 前端交互脚本
├── wrangler.jsonc    # Wrangler 配置文件
└── .gitignore        # Git 忽略文件
```

## 架构与数据模型

### 1. 访问模式与路由

Worker 依靠 URL 路径 (pathname) 的第一个段来确定请求的访问模式。

| 模式 | 路径示例 | 描述 | 权限 |
|------|----------|------|------|
| USER | /8a2c4e1f | 私人模式。通过 Token 访问，可管理自己的待办事项。 | 读写自身数据 |
| ADMIN | / | 控制台模式。查看所有用户数据，管理全局共享链接。 | 读所有数据, 读写共享链接 |

### 2. R2 数据结构

项目使用了单个 R2 存储桶，但通过键名（Key）前缀区分用户数据和全局配置。

| 数据类型 | R2 Key 格式 | Value (JSON Structure) |
|----------|-------------|------------------------|
| 用户待办事项 | todos:<userId> | Array<{id: string, text: string, completed: boolean, createdAt: string, creatorId: string}> |
| 共享链接 | admin:share_links | Object<string, {username: string, created_at: string}> (Key 是 8 位 Token) |
| 已删除事项 | system:deleted_todos | Array<{...todo, ownerId: string, deletedAt: string, deletedBy: string}> |

## 关键功能与端点

### 1. 待办事项 CRUD

Worker 通过不同的 HTTP 方法处理对用户清单的修改。

| HTTP 方法 | URL 格式 | Payload | 操作描述 |
|-----------|----------|---------|----------|
| GET | /<token> | N/A | 渲染用户清单 HTML 并返回列表数据。 |
| POST | /add_todo | FormData {text: string, userIds: string[]} | 添加新待办事项，可指派给多个用户。 |
| PUT | /update_todo | JSON {id: string, completed: boolean, ownerId: string} | 切换事项状态。 |
| DELETE | /delete_todo | JSON {id: string, ownerId: string} | 删除待办事项。 |

### 2. 用户管理

| HTTP 方法 | URL 格式 | Payload | 操作描述 |
|-----------|----------|---------|----------|
| POST | /add_user | FormData {username: string} | 创建新用户并生成访问 Token。 |
| DELETE | /delete_user | JSON {token: string} | 删除指定用户及其 Token。 |

### 3. 共享链接管理 (管理员模式)

| HTTP 方法 | URL 格式 | Payload | 操作描述 |
|-----------|----------|---------|----------|
| GET | / | N/A | 渲染管理员控制台页面。 |

## 部署要求

为了使此 Worker 正常运行，必须配置以下环境变量和绑定：

### 1. R2 绑定 (必需)

必须将一个 R2 存储桶绑定到 Worker 上，并命名为：

```
R2_BUCKET
```

### 2. 部署流程

1. 创建 Cloudflare Worker。
2. 创建 R2 存储桶（例如 my_todo_r2）。
3. 在 Worker 设置中，将该 R2 存储桶绑定为变量 R2_BUCKET。
4. 将 index.js 代码部署到 Worker。
5. 访问 Worker 的 URL 根路径 (/) 进入管理员模式。

## 本地开发

1. 安装 Wrangler CLI：
   ```bash
   npm install -g wrangler
   ```

2. 登录到 Cloudflare：
   ```bash
   wrangler login
   ```

3. 运行开发服务器：
   ```bash
   wrangler dev
   ```

## 功能特性

- [x] 多用户支持
- [x] 共享待办事项列表
- [x] 管理员控制台
- [x] 用户管理（创建/删除）
- [x] 待办事项 CRUD 操作
- [x] 事项完成状态切换
- [x] 事项删除与恢复
- [x] 响应式设计（支持移动端）
- [x] 最近删除事项查看（5天内）

## 使用说明

1. 访问根路径 (/) 进入管理员控制台
2. 在"用户管理"部分创建新用户
3. 点击生成的用户链接访问其个人待办清单
4. 在管理员控制台或个人页面添加、完成、删除待办事项

## 注意事项

- 本应用需要 Cloudflare Workers 和 R2 存储服务
- 确保正确配置了 R2 存储桶绑定
- 删除的事项会在 5 天后自动清理
