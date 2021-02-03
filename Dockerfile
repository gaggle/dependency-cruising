FROM node:14-alpine AS base

FROM base AS build
WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY src ./src
COPY test ./test
COPY tsconfig.json .
RUN npm test
RUN npm run build
RUN npm prune --production

FROM base AS run
COPY --from=build /build/node_modules /_app/node_modules
COPY --from=build /build/dist /_app
RUN rm _app/tsconfig.tsbuildinfo
RUN chmod -R 777 /_app # all users should be able to execute the app
ENTRYPOINT ["/_app/cli.js"]
