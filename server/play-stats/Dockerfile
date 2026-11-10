FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node server.cjs backup.cjs catalog.json package.json ./
RUN mkdir -p /data && chown node:node /data
USER node
ENV HOST=0.0.0.0 PORT=8080 DATA_PATH=/data/plays.sqlite
EXPOSE 8080
CMD ["node", "server.cjs"]
