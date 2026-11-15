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
# Under templates/ rather than conf.d/: the image's entrypoint runs envsubst over everything
# here at start-up, which is how the twin's token reaches nginx without being written into a
# file that git tracks. It substitutes only names that are in the environment, so nginx's own
# $host and $uri come through untouched.
COPY deploy/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
