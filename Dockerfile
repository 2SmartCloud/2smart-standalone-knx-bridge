FROM node:12.5-alpine

RUN apk update \
    && apk upgrade && apk add git

COPY etc etc
COPY lib lib
COPY package.json package.json
COPY app.js app.js

RUN npm i --production

CMD npm start