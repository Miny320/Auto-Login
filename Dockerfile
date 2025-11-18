# Base image
FROM ubuntu:22.04 AS base

# Set environment to prevent prompts
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Etc/UTC
ENV DISPLAY=:1
ENV RESOLUTION=1920x1080

# Prevent Puppeteer from downloading Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Install necessary packages
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    wget curl gnupg2 ca-certificates sudo \
    dbus-x11 xfonts-base x11-apps x11-utils x11-xserver-utils x11-xkb-utils xauth \
    libnss3 libasound2 libgbm-dev libgtk-3-0 libnotify-dev \
    libgconf-2-4 libxss1 libatk-bridge2.0-0 libx11-xcb1 libxcomposite1 libxdamage1 \
    libxrandr2 libatk1.0-0 libcairo2 libpango-1.0-0 libcups2 \
    xfce4 xfce4-goodies xfce4-terminal \
    tigervnc-standalone-server tigervnc-common tigervnc-tools \
    tzdata \
    ttf-mscorefonts-installer && \
    echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | debconf-set-selections && \
    rm -rf /var/lib/apt/lists/*

# Copy your local .ttf fonts into the container
RUN mkdir -p /usr/share/fonts/truetype/microsoft
COPY fonts/ /usr/share/fonts/truetype/microsoft/

# Rebuild the font cache
RUN fc-cache -f -v


# Install Google Chrome with a pinned version that we update every 6-8 weeks
RUN wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | \
    gpg --dearmor | \
    tee /usr/share/keyrings/google-chrome.gpg > /dev/null && \
    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] \
    http://dl.google.com/linux/chrome/deb/ stable main" | \
    tee /etc/apt/sources.list.d/google-chrome.list && \
    apt-get update && \
    apt-get install -y google-chrome-stable && \
    rm -rf /var/lib/apt/lists/*

# Set proper permissions for chrome-sandbox
RUN chown root:root /opt/google/chrome/chrome-sandbox && \
    chmod 4755 /opt/google/chrome/chrome-sandbox

# Install Node.js 21.2.0
RUN curl -fsSL https://deb.nodesource.com/setup_21.x | bash - && \
    apt-get install -y nodejs=21.2.0-1nodesource1

# Create a non-root user and group with home directory
RUN groupadd -r puppeteer && \
    useradd -rm -g puppeteer -G audio,video -s /bin/bash -d /home/puppeteer puppeteer && \
    mkdir -p /home/puppeteer && \
    chown -R puppeteer:puppeteer /home/puppeteer

# Set working directory and change ownership to the non-root user
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages/
RUN chown -R puppeteer:puppeteer /app

# Switch to the non-root user
USER puppeteer

# ##############
# Development stage
FROM base AS dev

# Install Node.js dependencies
# We already copied package.json, package-lock.json, and packages into /app
# So now we can install dependencies (including the local workspace).
RUN npm config set fetch-timeout 600000 && \
    npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm install

# Copy the rest of the application code
COPY --chown=puppeteer:puppeteer . .

# Copy the appropriate .env file based on the build argument
ARG ENV_FILE=.env.dev
COPY --chown=puppeteer:puppeteer ${ENV_FILE} .env

# Set the correct target env to be used in start-vnc.sh
ARG BUILD_TARGET=dev
ENV BUILD_TARGET=${BUILD_TARGET}

# Expose the necessary ports
EXPOSE 5901 8000

# Switch back to root to copy the start script and set permissions
USER root
COPY start-vnc.sh /start-vnc.sh
RUN chmod +x /start-vnc.sh

# Set ENTRYPOINT
ENTRYPOINT ["/start-vnc.sh"]


#######################
# Building production
# Stage 1: Build stage
FROM base AS build

# Install Node.js dependencies
RUN npm install

# Copy the rest of the application code
COPY --chown=puppeteer:puppeteer . .

RUN npx tsc

# Optional: Verify the dist directory
RUN ls -l /app/dist


# Stage 2: Building production
# Production stage
FROM base AS prod

# Copy compiled JavaScript files and necessary files
COPY --from=build /app/dist /app/dist
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/packages /app/packages


# Copy the appropriate .env file based on the build argument
ARG ENV_FILE=.env.prod
COPY --chown=puppeteer:puppeteer ${ENV_FILE} .env

# Install only production dependencies
RUN npm install --omit=dev

# Set the correct target env to be used in start-vnc.sh
ARG BUILD_TARGET=prod
ENV BUILD_TARGET=${BUILD_TARGET}

# Expose the necessary ports
EXPOSE 5901 8000

# Switch back to root to copy the start script and set permissions
USER root
COPY start-vnc.sh /start-vnc.sh
RUN chmod +x /start-vnc.sh

# Set ENTRYPOINT
ENTRYPOINT ["/start-vnc.sh"]