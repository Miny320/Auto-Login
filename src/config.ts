require("dotenv").config();

import path from "path";
import fs from "fs";
import { Browser } from "puppeteer";
import puppeteer, { VanillaPuppeteer } from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth"; // from local workspace package
import treeKill from "tree-kill";
import logger from "./logger";

// Import puppeteer-real-browser connect function
let connect: any = null;
try {
  const realBrowser = require("puppeteer-real-browser");
  connect = realBrowser.connect || realBrowser.default?.connect || realBrowser;
} catch (error) {
  // puppeteer-real-browser not available, will use standard puppeteer
}
import {
  closeProxyServer,
  createProxyServer,
  LOCAL_PROXY_SERVER_PORT,
  resolveTimezone,
  getProxyInformationHelper,
  ProxyInfo,
} from "./proxy";
import { NETWORK_TIMEOUT } from "./constants";

const BASE_WINDOW_WIDTH = 880;
const BASE_WINDOW_HEIGHT = 950;

puppeteer.use(
  require("puppeteer-extra-plugin-user-preferences")({
    userPrefs: {
      safebrowsing: {
        enabled: false,
        enhanced: false,
      },
    },
  })
);

const stealth = StealthPlugin();

// Note: navigator.languages was disabled for memory leak reasons, but it's important for detection
// Re-enabling it as it's critical for avoiding Upwork's detection
// If memory issues occur, we can optimize differently
// stealth.enabledEvasions.delete("navigator.languages");

puppeteer.use(stealth);

// Log that puppeteer-real-browser is active (if available)
logger.info(" Using puppeteer-real-browser for enhanced anti-detection");

let browser: Browser | null;

/** USER_ID will be available in the k8s cluster */
let userAuthId: string | null = process.env.USER_ID ?? null;

let environmentData: { userName: string; proxyUrl: string } | null = null;

let newProxyUrl = "";

const args_ = process.argv.slice(2);
const flags: { [key: string]: any } = {};

args_.forEach((arg) => {
  flags[arg] = true;
});

export const isRunningWithoutProxy = flags["--runWithoutProxy"];

type Options = {
  noUserData?: boolean;
  noProxy?: boolean;
  headless?: boolean;
  args?: string[];
};

export const getUserAuthId = () => {
  if (!userAuthId) {
    throw new Error("Bot running but userAuthId is not defined!");
  }

  return userAuthId;
};

export const getEnvironmentData = () => {
  return environmentData;
};

export const setUserAuthId = (userId: string) => {
  userAuthId = userId;
};

export const setEnvironmentData = ({
  userName,
  proxyUrl,
}: {
  userName: string;
  proxyUrl: string;
}) => {
  environmentData = { userName, proxyUrl };
};

export const hasBrowserLaunched = (): boolean => browser !== null && browser !== undefined;

export const getBrowser = async ({
  noUserData = false,
  noProxy = false,
  headless = false,
  args = [] as string[],
}: Options = {}) => {
  if (browser) {
    return browser;
  }

  // Option to connect to existing Chrome instance (most realistic)
  // Set USE_REAL_BROWSER=true to connect to manually launched Chrome
  const useRealBrowser = process.env.USE_REAL_BROWSER === "true";
  const debugPort = process.env.CHROME_DEBUG_PORT || "9222";

  if (useRealBrowser) {
    logger.info(" Connecting to existing Chrome instance via remote debugging...");
    logger.info(` Make sure Chrome is running with: --remote-debugging-port=${debugPort}`);

    try {
      browser = await puppeteer.connect({
        browserURL: `http://localhost:${debugPort}`,
        defaultViewport: null,
      });
      logger.info(" Connected to real Chrome browser!");
      return browser;
    } catch (error) {
      logger.error(" Failed to connect to Chrome. Make sure Chrome is running with remote debugging enabled.");
      logger.error(` Launch Chrome manually with: chrome.exe --remote-debugging-port=${debugPort} --user-data-dir="C:\\temp\\chrome-debug" --proxy-server=http://localhost:8001`);
      throw error;
    }
  }

  // Use different dimensions to slightly alter fingerprint
  const randomizedWidth = BASE_WINDOW_WIDTH + Math.floor(Math.random() * 101) - 50;
  const randomizedHeight = BASE_WINDOW_HEIGHT + Math.floor(Math.random() * 101) - 50;

  const isTestEnvironment = process.env.NODE_ENV === "test";
  const isDevEnvironment = process.env.NODE_ENV === "dev";

  const launchParams: Parameters<VanillaPuppeteer["launch"]>[0] = {
    headless,
    ...(!!!noUserData &&
      !isTestEnvironment && {
      userDataDir: `${path.join(__dirname, "./sessions/userData")}`,
    }),
    protocolTimeout: NETWORK_TIMEOUT,
    args: [
      `--no-first-run`,
      `--ash-no-nudges`,
      `--no-default-browser-check`,
      `--window-size=${randomizedWidth},${randomizedHeight}`,
      "--webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--force-webrtc-ip-handling-policy",
      "--disable-blink-features=AutomationControlled",
      "--start-maximized",
      "--disable-infobars",
      // Additional flags to avoid detection (keep minimal to avoid suspicion)
      "--disable-dev-shm-usage",
      "--disable-features=VizDisplayCompositor",
      // Enable remote debugging for potential real browser connection
      `--remote-debugging-port=${debugPort}`,
      ...args,
    ],
    browser: "chrome",
    ignoreDefaultArgs: ["--enable-automation", "--enable-features=PdfOopif"],
    env: {
      DISPLAY: process.env.DISPLAY,
      XAUTHORITY: process.env.XAUTHORITY,
      FONTCONFIG_PATH: process.env.FONTCONFIG_PATH,
      FONTCONFIG_CACHE: process.env.FONTCONFIG_CACHE,
      ...process.env,
    },
  };

  // Set Chrome executable path based on platform
  // Only use Linux path if we're actually on Linux AND DISPLAY is set (Docker)
  const platform = process.platform;
  if (process.env.DISPLAY && platform === "linux") {
    // Docker/Linux environment - use Linux Chrome path
    launchParams.executablePath = "/usr/bin/google-chrome";
  } else {
    // Detect platform and set Chrome path accordingly
    if (platform === "win32") {
      // Windows Chrome paths (common locations)
      const chromePaths = [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
      ];
      // Try to find Chrome, or let Puppeteer find it automatically
      const foundPath = chromePaths.find((p) => fs.existsSync(p));
      if (foundPath) {
        launchParams.executablePath = foundPath;
      }
      // If not found, Puppeteer will try to download/use bundled Chrome
    } else if (platform === "darwin") {
      launchParams.executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    }
    // For Linux, let Puppeteer handle it or use default
  }

  // Use this to set the puppeteer timezone
  let timezone = "";
  let proxyInfo: ProxyInfo | null = null;

  if ((isDevEnvironment && isRunningWithoutProxy) || (noProxy && isDevEnvironment) || noProxy) {
    logger.info("Running without proxy");

    timezone = await resolveTimezone({ noProxy: true });
  }
  // Prod and proxy dev run
  else {
    if (!environmentData?.proxyUrl) {
      throw new Error("NO PROXY FOUND!");
    }

    await createProxyServer();

    /** We create a local proxy and attach it to puppeteer. This will make
     *  it so that we can dynamically change the browser's ip without having
     *  to close and reopen the browser.
     */
    newProxyUrl = `http://localhost:${LOCAL_PROXY_SERVER_PORT}`;

    launchParams.args!.push(`--proxy-server=${newProxyUrl}`);

    const proxyUrl = new URL(environmentData.proxyUrl);

    /** Get full proxy information including geo location */
    proxyInfo = await getProxyInformationHelper(environmentData.proxyUrl);

    /** Get the timezone of this proxy */
    timezone = await resolveTimezone({ proxyUrl });
  }

  // Map country code to language/locale for browser fingerprinting
  const getLanguageFromCountry = (countryCode?: string): { languages: string[]; locale: string } => {
    if (!countryCode) {
      return { languages: ["en-US", "en"], locale: "en-US" };
    }

    const countryToLang: { [key: string]: { languages: string[]; locale: string } } = {
      US: { languages: ["en-US", "en"], locale: "en-US" },
      CA: { languages: ["en-CA", "en-US", "fr-CA", "en", "fr"], locale: "en-CA" },
      GB: { languages: ["en-GB", "en"], locale: "en-GB" },
      AU: { languages: ["en-AU", "en"], locale: "en-AU" },
      NZ: { languages: ["en-NZ", "en"], locale: "en-NZ" },
      IE: { languages: ["en-IE", "en"], locale: "en-IE" },
      DE: { languages: ["de-DE", "de", "en"], locale: "de-DE" },
      FR: { languages: ["fr-FR", "fr", "en"], locale: "fr-FR" },
      ES: { languages: ["es-ES", "es", "en"], locale: "es-ES" },
      IT: { languages: ["it-IT", "it", "en"], locale: "it-IT" },
      NL: { languages: ["nl-NL", "nl", "en"], locale: "nl-NL" },
      BE: { languages: ["nl-BE", "fr-BE", "nl", "fr", "en"], locale: "nl-BE" },
      PL: { languages: ["pl-PL", "pl", "en"], locale: "pl-PL" },
      PT: { languages: ["pt-PT", "pt", "en"], locale: "pt-PT" },
      BR: { languages: ["pt-BR", "pt", "en"], locale: "pt-BR" },
      MX: { languages: ["es-MX", "es", "en"], locale: "es-MX" },
      AR: { languages: ["es-AR", "es", "en"], locale: "es-AR" },
      IN: { languages: ["en-IN", "hi-IN", "en", "hi"], locale: "en-IN" },
      CN: { languages: ["zh-CN", "zh", "en"], locale: "zh-CN" },
      JP: { languages: ["ja-JP", "ja", "en"], locale: "ja-JP" },
      KR: { languages: ["ko-KR", "ko", "en"], locale: "ko-KR" },
      RU: { languages: ["ru-RU", "ru", "en"], locale: "ru-RU" },
      TR: { languages: ["tr-TR", "tr", "en"], locale: "tr-TR" },
      SA: { languages: ["ar-SA", "ar", "en"], locale: "ar-SA" },
      AE: { languages: ["ar-AE", "en-AE", "ar", "en"], locale: "ar-AE" },
    };

    return countryToLang[countryCode.toUpperCase()] || { languages: ["en-US", "en"], locale: "en-US" };
  };

  // Get language settings based on proxy location
  const langSettings = proxyInfo?.geo?.countryCode
    ? getLanguageFromCountry(proxyInfo.geo.countryCode)
    : { languages: ["en-US", "en"], locale: "en-US" };

  if (proxyInfo?.geo?.countryCode) {
    logger.info(` Setting browser language to match proxy location: ${langSettings.locale} (${proxyInfo.geo.country})`);
  }

  /** Set the correct timezone in the environment */
  launchParams.env!.TZ = timezone;

  logger.info(`Timezone set to ${timezone}.`);

  // Use puppeteer-real-browser connect if available, otherwise use standard launch
  if (connect) {
    try {
      logger.info(" Using puppeteer-real-browser connect for enhanced anti-detection...");

      // Parse proxy URL for puppeteer-real-browser format (only if not running without proxy)
      let proxyConfig: any = undefined;
      if (!noProxy && newProxyUrl) {
        try {
          const proxyUrl = new URL(newProxyUrl);
          proxyConfig = {
            host: proxyUrl.hostname,
            port: parseInt(proxyUrl.port || "80", 10),
          };
        } catch (e) {
          logger.warn("Could not parse proxy URL for puppeteer-real-browser");
        }
      }

      // Get Chrome executable path if available
      let chromePath: string | undefined = undefined;
      if (launchParams.executablePath) {
        chromePath = launchParams.executablePath;
      } else {
        // Try to find Chrome based on platform
        const platform = process.platform;
        if (platform === "win32") {
          const chromePaths = [
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
            (process.env.LOCALAPPDATA || "") + "\\Google\\Chrome\\Application\\chrome.exe",
          ];
          chromePath = chromePaths.find((p) => fs.existsSync(p));
          if (chromePath) {
            logger.info(` Found Chrome at: ${chromePath}`);
          } else {
            logger.warn("  Could not find Chrome executable in standard Windows locations.");
            logger.warn("   Searched:");
            chromePaths.forEach((p) => logger.warn(`     - ${p}`));
            logger.warn("   chrome-launcher will attempt auto-detection, but may fail on Windows.");
          }
        } else if (platform === "linux") {
          // Linux paths
          const linuxPaths = [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
          ];
          chromePath = linuxPaths.find((p) => fs.existsSync(p));
          if (chromePath) {
            logger.info(` Found Chrome at: ${chromePath}`);
          }
        } else if (platform === "darwin") {
          // macOS paths
          const macPaths = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
          ];
          chromePath = macPaths.find((p) => fs.existsSync(p));
          if (chromePath) {
            logger.info(` Found Chrome at: ${chromePath}`);
          }
        }
      }

      // On Windows, if Chrome is not found, warn that puppeteer-real-browser may fail
      if (process.platform === "win32" && !chromePath) {
        logger.warn("  Chrome not found on Windows. puppeteer-real-browser may fail.");
        logger.warn("   Consider installing Google Chrome or the bot will fall back to standard puppeteer.");
      }

      // Detect if running in Docker (DISPLAY is already set by container)
      // In Docker, we should disable xvfb since the container already has a display server (TigerVNC)
      const isDocker = !!process.env.DISPLAY && process.platform === "linux";
      const disableXvfb = isDocker; // Disable xvfb in Docker to use existing display

      const connectOptions: any = {
        headless: false, // Set to false for visible browser
        fingerprint: true, // Enable fingerprinting evasion - CRITICAL for anti-detection
        turnstile: true, // Enable Turnstile/CAPTCHA handling
        proxy: proxyConfig, // puppeteer-real-browser expects {host, port} format
        disableXvfb: disableXvfb, // CRITICAL: Disable xvfb in Docker to use existing display server
        // Filter out args that might conflict with chrome-launcher
        args: (launchParams.args || []).filter(
          (arg) => !arg.includes("--remote-debugging-port") && !arg.includes("--user-data-dir")
        ),
        // Custom config for chrome-launcher
        // chrome-launcher expects chromePath (not executablePath)
        customConfig: {
          ...(chromePath && {
            chromePath: chromePath,
          }),
          ...(!!!noUserData && !isTestEnvironment && launchParams.userDataDir && {
            userDataDir: launchParams.userDataDir,
          }),
        },
        // Environment variables
        connectOption: {
          defaultViewport: null,
        },
      };

      if (isDocker) {
        logger.info(" Docker detected - disabling xvfb to use existing display server (TigerVNC)");
      }

      // Log the configuration being passed to puppeteer-real-browser
      if (chromePath) {
        logger.info(` Using Chrome path: ${chromePath}`);
        // Verify the path exists
        if (!fs.existsSync(chromePath)) {
          logger.error(` Chrome path does not exist: ${chromePath}`);
          throw new Error(`Chrome executable not found at: ${chromePath}`);
        }
      } else {
        logger.warn("  No Chrome path specified - chrome-launcher will attempt auto-detection");
      }

      let result;
      try {
        result = await connect(connectOptions);
      } catch (error: any) {
        // If puppeteer-real-browser fails (e.g., Chrome path issues), log and re-throw
        logger.error(` puppeteer-real-browser connect failed: ${error.message || error}`);
        if (error.code === 'ENOENT' && error.path) {
          logger.error(`   Chrome not found at: ${error.path}`);
          logger.error(`   Expected Chrome path: ${chromePath || 'auto-detect'}`);
        }
        throw error; // Re-throw to trigger fallback in outer catch block
      }
      // Type assertion needed because puppeteer-real-browser returns compatible but different type
      browser = result.browser as any as Browser;

      // Set default timeouts on the page
      if (result.page) {
        result.page.setDefaultNavigationTimeout(NETWORK_TIMEOUT);
        result.page.setDefaultTimeout(30000);

        // Apply location-specific language settings to puppeteer-real-browser's initial page
        try {
          const client = await result.page.target().createCDPSession();
          await client.send('Emulation.setLocaleOverride', {
            locale: langSettings.locale,
          });
          await client.send('Network.setExtraHTTPHeaders', {
            headers: {
              'Accept-Language': langSettings.languages.join(',') + ';q=0.9',
            },
          });
          await result.page.evaluateOnNewDocument((langs: string[], locale: string) => {
            Object.defineProperty(navigator, 'languages', {
              get: () => Object.freeze([...langs]),
            });
            Object.defineProperty(navigator, 'language', {
              get: () => langs[0] || 'en-US',
            });
          }, langSettings.languages, langSettings.locale);
        } catch (error) {
          // May fail with puppeteer-real-browser, but try anyway
        }
      }

      // Also set up language for all new pages created by puppeteer-real-browser
      browser.on('targetcreated', async (target) => {
        const page = await target.page();
        if (page) {
          try {
            const client = await page.target().createCDPSession();
            await client.send('Emulation.setLocaleOverride', {
              locale: langSettings.locale,
            });
            await client.send('Network.setExtraHTTPHeaders', {
              headers: {
                'Accept-Language': langSettings.languages.join(',') + ';q=0.9',
              },
            });
            await page.evaluateOnNewDocument((langs: string[]) => {
              Object.defineProperty(navigator, 'languages', {
                get: () => Object.freeze([...langs]),
              });
              Object.defineProperty(navigator, 'language', {
                get: () => langs[0] || 'en-US',
              });
            }, langSettings.languages);
          } catch (error) {
            // May fail, continue
          }
        }
      });

      logger.info(" Connected via puppeteer-real-browser!");

      // Skip additional evasions as puppeteer-real-browser handles this
      return browser;
    } catch (error: any) {
      logger.warn("  puppeteer-real-browser connect failed, falling back to standard puppeteer");
      logger.warn(`Error details: ${error.message || error}`);
      if (error.stack) {
        logger.warn(`Stack: ${error.stack.substring(0, 200)}`);
      }
      // Fallback to standard puppeteer launch
      browser = await puppeteer.launch(launchParams);
    }
  } else {
    // puppeteer-real-browser not available, use standard launch
    logger.info(" Using standard puppeteer launch...");
    browser = await puppeteer.launch(launchParams);
  }

  // Add additional page-level evasions after browser launch (only for standard puppeteer)
  // These will be applied to all pages created from this browser
  if (browser) {
    browser.on('targetcreated', async (target) => {
      const page = await target.page();
      if (page) {
        // Set locale via CDP (Chrome DevTools Protocol) - this is the most reliable way
        try {
          const client = await page.target().createCDPSession();
          await client.send('Emulation.setLocaleOverride', {
            locale: langSettings.locale,
          });
          // Set Accept-Language header
          await client.send('Network.setExtraHTTPHeaders', {
            headers: {
              'Accept-Language': langSettings.languages.join(',') + ';q=0.9',
            },
          });
        } catch (error) {
          // CDP might fail if puppeteer-real-browser is used, that's okay
          logger.warn("Could not set locale via CDP (this is normal with puppeteer-real-browser)");
        }

        // Inject additional evasions to avoid detection
        await page.evaluateOnNewDocument((langs: string[], locale: string) => {
          // Override navigator.webdriver more thoroughly
          Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
          });

          // Override chrome runtime to make it look like a real browser
          const win = window as any;
          if (!win.chrome) {
            win.chrome = {};
          }
          if (!win.chrome.runtime) {
            win.chrome.runtime = {
              onConnect: undefined,
              onMessage: undefined,
            };
          }

          // Spoof permissions API
          const originalQuery = window.navigator.permissions.query;
          window.navigator.permissions.query = (parameters: any) =>
            parameters.name === 'notifications'
              ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
              : originalQuery(parameters);

          // Spoof languages - match proxy location
          Object.defineProperty(navigator, 'languages', {
            get: () => Object.freeze([...langs]),
          });

          Object.defineProperty(navigator, 'language', {
            get: () => langs[0] || 'en-US',
          });
        }, langSettings.languages, langSettings.locale);
      }
    });
  }

  return browser;
};

export const killBrowser = async () => {
  try {
    if (!browser) return;

    if (newProxyUrl) {
      await closeProxyServer();
    }

    treeKill(browser.process()?.pid!, "SIGKILL");
    logger.info("Browser successfully killed ");
    browser = null;
  } catch (error) {
    logger.error("Error while killing browser", error);
    browser = null;
  }
};
