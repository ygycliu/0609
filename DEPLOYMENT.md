# AI数字化咨询中心部署说明

发布包已包含前端和后端生产构建文件，服务器无需重新编译。

## 环境要求

- Linux 服务器
- Node.js 20 或更高版本
- npm 10 或更高版本
- 可选：PM2、Nginx

## 部署步骤

```bash
mkdir -p /opt/ai-consulting-center
unzip AI数字化咨询中心-MVP-V1.0-部署包.zip -d /opt/ai-consulting-center
cd /opt/ai-consulting-center
npm ci --omit=dev
cp .env.example .env
```

编辑 `.env`，至少确认以下配置：

```dotenv
PORT=3001
WEB_ORIGIN=https://your-domain.example
DEFAULT_MODEL=demo
```

直接启动：

```bash
npm start
```

访问 `http://服务器IP:3001`，健康检查地址为：

```bash
curl http://127.0.0.1:3001/health
```

## PM2 守护

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

## Nginx 反向代理

```nginx
server {
    listen 80;
    server_name your-domain.example;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 数据与更新

运行时数据保存在 `data/`：

```text
data/
  knowledge.json
  consultations.json
  uploads/
```

升级版本前应备份该目录。发布包不包含现有客户数据、咨询历史和上传文件。

公网部署前请注意：

- `.env` 中的模型密钥不得公开。
- 当前 MVP 没有用户登录和租户隔离，建议增加访问控制。
- 公网只开放 80/443，应用端口 3001 建议仅供本机或内网访问。
