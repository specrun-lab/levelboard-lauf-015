FROM node:26.13.0-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN printf '{"source":"api"}' > dist/config.json

FROM nginx:1.31.9-alpine

ARG SOURCE_URL=""
ARG REVISION=""

RUN mkdir -p /tmp/client /tmp/proxy /tmp/fastcgi /tmp/uwsgi /tmp/scgi

COPY nginx-container.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html

LABEL org.opencontainers.image.source="${SOURCE_URL}"
LABEL org.opencontainers.image.revision="${REVISION}"
LABEL org.opencontainers.image.title="levelboard-frontend"

EXPOSE 8080
