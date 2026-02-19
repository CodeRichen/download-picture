# 使用輕量的 Node.js 22 (符合你引擎要求的 >=12.0.0)
FROM node:22-alpine

# 設定容器內的下載路徑（假設你程式會下載到 ./downloads）
WORKDIR /app

# 1. 安裝 pnpm
RUN npm install -g pnpm

# 2. 設定鏡像站（解決你之前的連線失敗問題）
RUN pnpm config set registry https://registry.npmmirror.com

# 3. 先複製依賴清單 (利用 Docker 快取層)
COPY package.json ./
# 如果你有 pnpm-lock.yaml 也請解除註解下面這行
# COPY pnpm-lock.yaml ./

# 4. 安裝套件
RUN pnpm install

# 5. 複製所有原始碼 (index.js 等)
COPY . .

# 6. 建立下載資料夾，確保程式有地方存圖
RUN mkdir -p picture

# 7. 設定環境變數，指定下載路徑（Docker 統一使用 /app/picture）
ENV DOWNLOAD_DIR=/app/picture

# 啟動指令
CMD ["pnpm", "start"]