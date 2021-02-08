# syntax = docker/dockerfile:1.0-experimental
FROM node:14-alpine AS base

# DEPENDENCIES
# Install system- and node-dependencies
FROM base AS deps
WORKDIR /root/build
RUN --mount=type=cache,target=/var/cache/apk ln -vs /var/cache/apk /etc/apk/cache && \
    apk add \
    bash\
    git
COPY package*.json ./

RUN --mount=type=cache,id=npm,target=/root/.npm \
    npm ci
COPY tsconfig.json .

# TEST THE SOURCE CODE
FROM deps AS test
COPY src ./src
COPY test ./test
COPY README.md ./
RUN npm test
RUN touch /.dockerkeep

# BUILD THE SOURCE CODE
# Convert build to be production-like by pruning dev dependencies and installing the package globally
FROM deps AS build
COPY src ./src
RUN npm run build

# PRUNE ENVIRONMENT
# Optimize the environment by pruning unused dependencies and installing the package globally
FROM deps AS pruned
RUN npm prune --production
COPY --from=build /root/build/dist /root/build/dist
RUN npm pack
RUN --mount=type=cache,id=npm,target=/root/.npm \
    npm install -g dependency-cruising*.tgz

# RUNTIME
# Pure, minimal production-only stage *only* containing the package
FROM base AS runtime
RUN --mount=type=cache,target=/var/cache/apk ln -vs /var/cache/apk /etc/apk/cache && \
    apk add \
    graphviz
RUN --mount=type=cache,id=npm,target=/root/.npm \
    npm install -g typescript
# ↑ need typescript to parse typescript
WORKDIR /root
COPY --from=test /.dockerkeep /root/
# ↑ use `test` stage with a noop copy to create a dependency, because unused stages get skipped
COPY --from=pruned /usr/local/bin/ /usr/local/bin/
COPY --from=pruned /usr/local/lib/node_modules/dependency-cruising/ /usr/local/lib/node_modules/dependency-cruising
# ↑ copy the globally-installed package only
RUN chmod -R 777 /usr/local/bin/depcruising /usr/local/lib/node_modules/dependency-cruising # all users should be able to execute the app
RUN depcruising --help
# ↑ just a final sanity check to be sure the binary is in place
ENTRYPOINT ["depcruising"]
