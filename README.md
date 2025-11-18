# Kaio Minimal - Puppeteer Automation

A Puppeteer-based automation project with Docker support, featuring proxy management, stealth plugins, and VNC access for debugging.

## Prerequisites

- **Node.js**: 21.2.0 (managed via Volta)
- **npm**: Comes with Node.js
- **Docker & Docker Compose**: Required for containerized deployment
- **Environment Files**: `.env.dev`, `.env.local`, or `.env.prod` (depending on your environment)

## Installation

```bash
npm install
```

This will install all dependencies including the local workspace packages (`puppeteer-extra-plugin-stealth` and `proxy-chain`).

---

## Running Locally (Without Docker)

### Option 1: Run with Proxy

To run the development executable with proxy support:

```bash
npm run dev_exec:dev
```

**Note**: This currently runs with `--runWithoutProxy` flag. To run with proxy enabled, you need to:

1. Set up your proxy configuration in environment variables (proxy URL, etc.)
2. Remove the `--runWithoutProxy` flag from the script in `package.json`:
   ```json
   "dev_exec:dev": "ts-node src/dev_executable.ts"
   ```

### Option 2: Run in Production Mode

```bash
npm run build:prod
npm run dev_exec:prod
```

### Available Scripts

| Script                  | Description                                |
| ----------------------- | ------------------------------------------ |
|  |
| `npm run dev_exec:dev`  | Run the dev executable script              |
| `npm run dev_exec:prod` | Run the production build of dev executable |
| `npm run docker-test`   | Run Docker test script locally             |
| `npm test`              | Run Jest tests                             |

---

## Running with Docker

### Build and Run (Recommended)

To build the Docker image and run the container while viewing logs in real-time:

```bash
docker-compose -f docker-compose-dev.yml up --build
```

This will:

- Build the image targeting the `dev` stage in the Dockerfile
- Start the container with VNC server on port 5901
- Start the application on port 8000
- Display logs in your terminal

### Run in Background (Detached Mode)

If you prefer to run the container in the background:

```bash
docker-compose -f docker-compose-dev.yml up -d --build
```

Then view the logs with:

```bash
docker-compose -f docker-compose-dev.yml logs -f
```

### Stop the Container

```bash
docker-compose -f docker-compose-dev.yml down
```

### Rebuild from Scratch (No Cache)

If you need to rebuild the image without using cached layers:

```bash
docker-compose -f docker-compose-dev.yml build --no-cache
docker-compose -f docker-compose-dev.yml up
```

### Accessing the VNC Server

When running in Docker, you can connect to the VNC server to view the browser in action:

1. **VNC Server**: Connect to `localhost:5901`
2. **Password**: `yourpassword` (configured in `start-vnc.sh`)
3. **Recommended VNC Clients**:
   - macOS: Screen Sharing, RealVNC Viewer
   - Windows: TightVNC, RealVNC Viewer
   - Linux: Remmina, TigerVNC

### Docker Architecture

- **Base Image**: Ubuntu 22.04
- **Browser**: Google Chrome (stable)
- **Desktop Environment**: XFCE4
- **VNC Server**: TigerVNC
- **Node.js**: 21.2.0
- **Resolution**: 1920x1080
- **User**: Non-root user `puppeteer` for security

---

## Environment Variables

Create the appropriate `.env` file based on your environment:

| Variable   | Description                              | Required      |
| ---------- | ---------------------------------------- | ------------- |
| `NODE_ENV` | Environment mode (`dev`, `test`, `prod`) | Yes           |
| `USER_ID`  | User authentication ID                   | In production |
| `DISPLAY`  | X11 display (auto-set in Docker)         | No            |
| `TZ`       | Timezone (e.g., `America/Los_Angeles`)   | No            |

**Example `.env.dev`:**

```env
NODE_ENV=dev
USER_ID=your_user_id_here
```

---

## Project Structure

```
kaio-minimal/
├── src/
│   ├── classes/           # Class-based components
│   ├── userSetup/         # Authentication and setup
│   ├── config.ts          # Browser configuration
│   ├── proxy.ts           # Proxy server management
│   ├── helpers.ts         # Utility functions
│   └── dev_executable.ts  # Development executable
├── packages/              # Local workspace packages
│   ├── proxy-chain/
│   └── puppeteer-extra-plugin-stealth/
├── Dockerfile             # Multi-stage Docker build
├── docker-compose-dev.yml # Development Docker Compose
├── start-vnc.sh           # VNC server startup script
└── package.json           # Dependencies and scripts
```

---

## Troubleshooting

### Container Name Already in Use

If you see an error like `The container name "/kaio_dev" is already in use`:

```bash
# Stop and remove existing containers
docker-compose -f docker-compose-dev.yml down

# Then run again
docker-compose -f docker-compose-dev.yml up --build
```

Alternatively, you can remove the specific container:

```bash
docker rm -f kaio_dev
```

### Chrome Sandbox Issues (Linux)

If you encounter sandbox errors, the container is configured with `SYS_ADMIN` capability. If issues persist, you can add `--no-sandbox` to the Chrome args in `config.ts`.

### VNC Connection Refused

Ensure the container is fully started:

```bash
docker-compose -f docker-compose-dev.yml logs -f
```

Look for the message: "X server is ready"

### Proxy Issues

If authentication fails with proxy errors:

1. Verify your proxy URL is correctly set in environment variables
2. Check proxy credentials are valid
3. Review logs for specific error codes (`AUTH_NETWORK_RESTRICTED`, `AUTH_TECH_DIFFICULTIES`)

### Font Issues

The project includes custom fonts in the `fonts/` directory. If you see font rendering issues:

```bash
# Inside container
fc-cache -f -v
```

---

## Development Tips

### Debugging with VNC

1. Start the container: `docker-compose -f docker-compose-dev.yml up`
2. Connect via VNC to `localhost:5901`
3. You'll see the Chrome browser running in the XFCE desktop
4. Interact with the browser in real-time while viewing logs

### Running Tests

```bash
npm test
```

### Linting & Formatting

The project uses TypeScript with strict type checking. Run the build to check for type errors:

```bash
npx tsc --noEmit
```
