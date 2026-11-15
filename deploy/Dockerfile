# The page, built and served from the same host as the twin.
#
# Built inside the image rather than on the server: the server needs nothing but Docker, and
# what ships is the same build whoever runs it. package.json asks for node >= 24.
FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# `npm run build` is `tsc --noEmit && vite build`, so a type error stops the image here
# instead of shipping a page that fails in a browser.
RUN npm run build

FROM nginx:alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
