FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --omit=dev --ignore-scripts
COPY packages/mock-api packages/mock-api
COPY packages/lab-controller packages/lab-controller
USER node
ENTRYPOINT ["node", "packages/lab-controller/node-runner.mjs"]
