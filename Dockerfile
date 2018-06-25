FROM node:10-alpine

RUN apk update && apk upgrade && \
    echo @edge http://nl.alpinelinux.org/alpine/edge/community >> /etc/apk/repositories && \
    echo @edge http://nl.alpinelinux.org/alpine/edge/main >> /etc/apk/repositories && \
    apk add --no-cache \
      chromium@edge \
      nss@edge \
      ttf-freefont \
      fontconfig && \
    wget https://oscdl.ipa.go.jp/IPAfont/ipag00303.zip && \
    unzip ipag00303.zip && \
    mkdir -p /usr/share/fonts/ipa && \
    mv ipag00303/ipag.ttf /usr/share/fonts/ipa && \
    fc-cache -fv && \
    rm -rf ipag00303*

# Tell Puppeteer to skip installing Chrome. We'll be using the installed package.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD true

RUN mkdir /opt/redashbot
WORKDIR /opt/redashbot

ADD package.json /opt/redashbot
ADD yarn.lock /opt/redashbot
RUN yarn install
ADD index.js /opt/redashbot

ENV CHROMIUM_BROWSER_PATH /usr/bin/chromium-browser

ENTRYPOINT [ "node" ]
CMD [ "index.js" ]
