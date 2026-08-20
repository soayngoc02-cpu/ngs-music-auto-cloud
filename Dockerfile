FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY app.tgz.b64 /tmp/app.tgz.b64
RUN base64 -d /tmp/app.tgz.b64 | tar -xz -C /app && rm /tmp/app.tgz.b64 && npm install --omit=dev
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm","start"]
