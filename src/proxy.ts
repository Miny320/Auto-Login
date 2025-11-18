import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import * as ProxyChain from "proxy-chain";
import { getEnvironmentData, isRunningWithoutProxy } from "./config";
import { ONE_SECOND } from "./constants";
import { retry } from "./helpers";
import logger from "./logger";

let proxyServer: ProxyChain.Server | undefined;

export type ProxyInfo = {
  isValid: boolean;
  isResidential?: boolean;
  proxyType?: "residential" | "datacenter" | "unknown";
  geo: {
    city: string;
    country: string;
    countryCode: string;
    regionName: string;
    timezone: string;
    isp?: string;
    org?: string;
    ip: string;
  };
};

export const LOCAL_PROXY_SERVER_PORT = 8001;

/**
 * Detects if a proxy is likely a datacenter proxy based on ISP/org information
 * Datacenter proxies are commonly flagged by Upwork and other platforms
 */
function detectProxyType(isp?: string, org?: string): "residential" | "datacenter" | "unknown" {
  if (!isp && !org) {
    return "unknown";
  }

  const ispLower = (isp || "").toLowerCase();
  const orgLower = (org || "").toLowerCase();

  // Common datacenter proxy indicators
  const datacenterIndicators = [
    "datacenter",
    "data center",
    "hosting",
    "server",
    "cloud",
    "vps",
    "colocation",
    "colo",
    "ip range",
    "proxy",
    "aws",
    "azure",
    "google cloud",
    "digitalocean",
    "linode",
    "vultr",
    "ovh",
    "hetzner",
    "buyvm",
    "contabo",
    "ramnode",
    "leaseweb",
    "psychz",
    "cogent",
    "nlayer",
    "telia",
    "level3",
    "zayo",
    "gtt",
    "cogent communications",
    "as number", // AS numbers often indicate datacenter
  ];

  // Check if ISP or org contains datacenter indicators
  const combinedText = `${ispLower} ${orgLower}`;
  const isDatacenter = datacenterIndicators.some((indicator) =>
    combinedText.includes(indicator)
  );

  // Common residential ISP indicators (not exhaustive)
  const residentialIndicators = [
    "telecom",
    "telecommunications",
    "communications",
    "broadband",
    "cable",
    "fiber",
    "dsl",
    "isp",
    "internet service",
    "mobile",
    "wireless",
    "cellular",
    "verizon",
    "att",
    "comcast",
    "xfinity",
    "spectrum",
    "cox",
    "centurylink",
    "frontier",
    "windstream",
  ];

  const isResidential = residentialIndicators.some((indicator) =>
    combinedText.includes(indicator)
  );

  if (isDatacenter) {
    return "datacenter";
  } else if (isResidential) {
    return "residential";
  }

  return "unknown";
}

export const createProxyServer = () => {
  if (proxyServer) {
    closeProxyServer();
  }

  logger.info("Connected via proxy ");

  proxyServer = new ProxyChain.Server({
    port: LOCAL_PROXY_SERVER_PORT,
    prepareRequestFunction: () => {
      let upstreamProxy = getEnvironmentData()?.proxyUrl;
      if (!upstreamProxy && !isRunningWithoutProxy) {
        throw Error("Proxy not detected!");
      }

      return {
        upstreamProxyUrl: upstreamProxy,
      };
    },
  });

  proxyServer.listen(() => {
    logger.info(`Proxy server is listening on port ${proxyServer?.port}`);
  });
};

export const closeProxyServer = () => {
  if (proxyServer) {
    proxyServer.close(true);
    proxyServer = undefined;
  }
};

/** Util function to retrieve the timezone from the proxy or current IP */
export async function resolveTimezone({
  noProxy,
  proxyUrl,
  noRetries,
}: { noProxy?: boolean; proxyUrl?: URL; noRetries?: boolean } = {}) {
  if (!proxyUrl && !noProxy) {
    throw new Error("Running with proxy but no proxy provided!");
  }

  const getIpInfo = async () => {
    if (proxyUrl && !noProxy) {
      const proxyInfo = await getProxyInformationHelper(proxyUrl.toString());

      if (!proxyInfo.isValid) {
        throw new Error("Invalid proxy");
      }

      // Warn if using non-residential proxy for Upwork
      if (proxyInfo.proxyType === "datacenter") {
        logger.warn(
          "  CRITICAL: You are using a datacenter proxy. Upwork requires secure residential proxies!"
        );
      }

      return proxyInfo;
    }

    const data = await axios.get(`http://ip-api.com/json/?fields=timezone`);

    return {
      isValid: true,
      geo: {
        timezone: data.data.timezone,
      },
    } as ProxyInfo;
  };

  const ipInfoResponse = noRetries
    ? await getIpInfo()
    : await retry(getIpInfo, {
      maxAttempts: 3,
      delayBetweenAttempts: ONE_SECOND * 2,
    });

  if (!ipInfoResponse?.geo?.timezone) {
    throw new Error("Timezone not returned for proxy!");
  }

  return ipInfoResponse.geo.timezone;
}

export async function getProxyInformationHelper(proxyUrl: string): Promise<ProxyInfo> {
  let isValid = false;
  let geo: any = {};

  try {
    // Parse full proxy URL
    const parsed = new URL(proxyUrl);
    const { hostname, port, username, password } = parsed;

    // Decide which service to call
    const ipLiteral = /^\d+\.\d+\.\d+\.\d+$/;
    const agent = new HttpsProxyAgent(proxyUrl);

    // request-promise will parse that proxy URL and tunnel for us
    const resp = ipLiteral.test(hostname)
      ? await axios.get(`http://ip-api.com/json/${hostname}`, {
          proxy: { host: hostname, port: parseInt(port, 10), auth: { username, password } },
          timeout: 10000,
        })
      : await axios.get("http://ip-api.com/json", {
          httpAgent: agent,
          httpsAgent: agent,
          timeout: 10000,
          responseType: "json",
        });

    isValid = true;

    const { city, country, countryCode, regionName, timezone, isp, org, query } = resp.data;
    geo = {
      city,
      country,
      countryCode,
      regionName,
      timezone,
      isp,
      org,
      ip: query,
    };

    // Detect proxy type (residential vs datacenter)
    const proxyType = detectProxyType(isp, org);
    const isResidential = proxyType === "residential";

    // Log proxy information with warnings
    logger.info(`Proxy IP: ${query}`);
    logger.info(`Location: ${city}, ${regionName}, ${country}`);
    logger.info(`ISP: ${isp || "Unknown"}`);
    logger.info(`Organization: ${org || "Unknown"}`);
    logger.info(`Proxy Type Detected: ${proxyType.toUpperCase()}`);

    if (proxyType === "datacenter") {
      logger.warn(
        "  WARNING: Datacenter proxy detected! Upwork may reject this proxy."
      );
      logger.warn(
        "  For Upwork login, you need a SECURE RESIDENTIAL PROXY."
      );
      logger.warn(
        "  Datacenter proxies are easily detected and often blocked."
      );
    } else if (proxyType === "unknown") {
      logger.warn(
        "  Could not determine proxy type. Ensure you're using a residential proxy for Upwork."
      );
    } else if (proxyType === "residential") {
      logger.info(" Residential proxy detected - this should work with Upwork.");
    }

    return {
      isValid,
      isResidential,
      proxyType,
      geo,
    };
  } catch (error: any) {
    logger.error("Proxy validation failed", error);
    isValid = false;
    geo = {};
  }

  return {
    isValid,
    geo,
  };
}
