import "dotenv/config";
import PageWrapper from "./classes/PageWrapper";
import { getBrowser, setEnvironmentData, isRunningWithoutProxy } from "./config";
import authenticate from "./userSetup/authenticate";
import { NETWORK_TIMEOUT } from "./constants";

// Check if running without proxy (via --runWithoutProxy flag)
const runWithoutProxy = isRunningWithoutProxy || process.argv.includes("--no-proxy");

if (!runWithoutProxy) {
  setEnvironmentData({
    userName: "",
    // proxyUrl: "http://q82qg:wr6ffw0i@43.239.161.5:5432",
    // proxyUrl: "http://sffb9:s0q7lgzl@37.19.66.202:5432",
    proxyUrl: "http://brd-customer-hl_42803ce4-zone-fingerprint_test-country-us:31hx1buwp6ke@brd.superproxy.io:33335",
  });
}

(async () => {
  // Use persistent user data for more realistic browser fingerprint
  // This makes the browser look like a real user's session
  const browser = await getBrowser({ 
    headless: false, 
    noUserData: false,
    noProxy: runWithoutProxy // Run without proxy if flag is set
  });
  
  if (!browser) {
    throw new Error("Browser failed to launch");
  }
  
  const page = await new PageWrapper(await browser.newPage());

  // Cookie warming - navigate to sites before login to improve reCAPTCHA v3 score
  // This improves score from 0.1 to 0.7+ as found by the team
  const { warmUpCookies } = await import("./helpers/cookieWarming");
  await warmUpCookies(page);

  await page.goto("https://www.upwork.com/ab/account-security/login");

  const { status } = await authenticate({
    username: "saeleanore.87@outlook.com",
    password: "eXtE31rioR",
    page,
  });

  if (status !== 200) {
    throw new Error(`Login not successful.`);
  }

  await page.goto("https://www.upwork.com/nx/find-work/", { timeout: NETWORK_TIMEOUT });

  console.log(`Login successful.`);
})();
