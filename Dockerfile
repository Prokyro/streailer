FROM node:22-alpine

# The package is available on Alpine ARM64 and only inspects formats at runtime.
RUN apk add --no-cache yt-dlp

WORKDIR /app

# Use the audited dependency versions from package-lock.json.
COPY package*.json ./
RUN npm ci --omit=dev

# .dockerignore excludes local secrets, history, fixtures and backups.
COPY . .

EXPOSE 7020
CMD ["node", "index.js"]
