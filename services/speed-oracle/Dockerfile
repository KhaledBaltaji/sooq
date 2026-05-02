FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV NODE_NO_WARNINGS=1
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=builder /app/dist ./dist

# Run as root so /app file permissions don't bite. The container itself is
# isolated by Railway; downgrading user is defense-in-depth, not required.
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/index.js"]
