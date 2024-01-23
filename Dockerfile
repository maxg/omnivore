FROM node:20-alpine

RUN apk add --no-cache tzdata postgresql16-client
RUN ln -s /usr/share/zoneinfo/America/New_York /etc/localtime

WORKDIR /app

ENV NODE_ENV production

COPY --link package.json package-lock.json ./
RUN npm ci

COPY --link --chown=node backup ./backup
COPY --link bin ./bin
COPY --link config ./config
COPY --link src ./src
COPY --link views ./views
COPY --link web ./web

USER node

CMD [ "bin/serve" ]
