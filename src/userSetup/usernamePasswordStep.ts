require("dotenv").config();
import { StatusCodes } from "http-status-codes";
import { UpworkLoginPage } from "../classes/UpworkPage/UpworkLoginPage/UpworkLoginPage";
import { AUTH_ERROR_CODES, NETWORK_TIMEOUT, ONE_SECOND, UpworkUrlPaths } from "../constants";
import {
  delay,
  getRandomNumberBetweenRange,
  retry,
  simulateHumanClick,
  simulateHumanType,
} from "../helpers";
import PageWrapper from "../classes/PageWrapper";
import logger from "../logger";

export async function handleUsernameAndPassword({
  page,
  username,
  password,
}: {
  page: PageWrapper;
  username: string;
  password: string;
}): Promise<{
  statusCode: number;
  errCode: AUTH_ERROR_CODES | undefined;
  UWLoginPage: UpworkLoginPage;
}> {
  let UWLoginPage!: UpworkLoginPage;

  const { statusCode, errCode } = await retry(
    async (attempt) => {
      await page.goto(UpworkUrlPaths.LOGIN_PAGE, {
        waitUntil: "load",
        timeout: NETWORK_TIMEOUT,
      });

      // Wait for page to fully render and settle - simulate human behavior
      await delay(getRandomNumberBetweenRange(ONE_SECOND * 2, ONE_SECOND * 4));

      // Simulate human-like mouse movements on the page
      const puppeteerPage = page.getPage();
      const pageHeight = await puppeteerPage.evaluate(() => window.innerHeight);
      const pageWidth = await puppeteerPage.evaluate(() => window.innerWidth);
      
      // Random mouse movements (simulating reading/looking around)
      for (let i = 0; i < getRandomNumberBetweenRange(2, 4); i++) {
        const randomX = getRandomNumberBetweenRange(pageWidth * 0.2, pageWidth * 0.8);
        const randomY = getRandomNumberBetweenRange(pageHeight * 0.2, pageHeight * 0.6);
        await puppeteerPage.mouse.move(randomX, randomY, { 
          steps: getRandomNumberBetweenRange(10, 20) 
        });
        await delay(getRandomNumberBetweenRange(300, 600));
      }

      // Small random scroll to simulate reading
      await puppeteerPage.mouse.wheel({ deltaY: getRandomNumberBetweenRange(-50, 50) });
      await delay(getRandomNumberBetweenRange(500, 1000));

      UWLoginPage = new UpworkLoginPage(page);

      /** Username and password step */
      const { statusCode, errCode } = await usernamePasswordStep({
        UWLoginPage,
        username,
        password,
      });

      // We need to reset the page. Change proxy and restart w/ a different one
      if (
        errCode === AUTH_ERROR_CODES.AUTH_NETWORK_RESTRICTED ||
        errCode === AUTH_ERROR_CODES.AUTH_TECH_DIFFICULTIES
      ) {
        logger.error(`Error code: ${errCode}. Change proxy and try again.`);

        //[... Code omitted here]

        throw new Error(`Authentication failed.`);
      }

      if (statusCode === StatusCodes.UNAUTHORIZED) {
        return { statusCode, errCode };
      }

      // We logged in w/o a 2fa
      if (!page.url().includes(UpworkUrlPaths.LOGIN_PAGE)) {
        return { statusCode, errCode };
      }

      // Wait for either login input or 2fa input or freelancer page to
      // be visible and interactable
      await UWLoginPage.waitForLoginSecondScreen();

      return { statusCode, errCode };
    },
    { maxAttempts: 5, delayBetweenAttempts: ONE_SECOND * 3 }
  );

  return { statusCode, errCode, UWLoginPage };
}

export async function usernamePasswordStep({
  UWLoginPage,
  username,
  password,
}: {
  UWLoginPage: UpworkLoginPage;
  username: string;
  password: string;
}) {
  // Wait for page to fully load and settle - simulate human reading the page
  // Longer initial delay to make it look like human is reading the page
  await delay(getRandomNumberBetweenRange(ONE_SECOND * 3, ONE_SECOND * 6));
  
  const puppeteerPage = UWLoginPage.page.getPage();

  const loginRequestListener = (request: any) => {
    try {
      if (typeof request.method === "function" && request.method() === "POST" && request.url().includes("/account-security/")) {
        const body = request.postData?.();
        if (body) {
          logger.info(` Login request payload: ${body}`);
        }
      }
    } catch (error: any) {
      logger.warn(`  Unable to log login request payload: ${error.message}`);
    }
  };

  puppeteerPage.on("request", loginRequestListener);

  const loginInput = await UWLoginPage.getLoginInput();

  // Additional delay before starting to type - human behavior
  // Longer delay to simulate thinking/reading
  await delay(getRandomNumberBetweenRange(ONE_SECOND * 2, ONE_SECOND * 4));

  await simulateHumanType({ element: loginInput, inputString: username });

  // Longer delay after typing username - simulate reading what was typed
  // Make it look like human is checking their input
  await delay(getRandomNumberBetweenRange(ONE_SECOND * 2, ONE_SECOND * 3));

  // Continue shows next
  let continueButton = await UWLoginPage.getFirstContinueLoginButton();
  await simulateHumanClick(continueButton, UWLoginPage.page.getPage());

  // Then password shows - wait for it to appear
  await delay(getRandomNumberBetweenRange(ONE_SECOND, ONE_SECOND * 2));
  const loginPassword = await UWLoginPage.getLoginPasswordInput();
  
  // Wait before typing password - human behavior
  // Longer delay to simulate thinking/remembering password
  await delay(getRandomNumberBetweenRange(ONE_SECOND * 1, ONE_SECOND * 3));
  await simulateHumanType({ element: loginPassword, inputString: password });

  // Longer delay after typing password - double checking
  await delay(getRandomNumberBetweenRange(ONE_SECOND * 2, ONE_SECOND * 3));

  // Click on remember me. waitForSelector won't find it for some reason
  await UWLoginPage.clickRememberMe();

  // Delay before clicking continue - human reading/checking
  // Longer delay to make it look like human is double-checking everything
  await delay(getRandomNumberBetweenRange(ONE_SECOND * 2, ONE_SECOND * 4));

  // Wait for security scripts (forter/iovation) to initialize and send initial requests
  logger.info(" Waiting for security scripts (forter/iovation) to initialize...");
  
  // Track network requests from security services (both requests and responses)
  const securityRequests = new Set<string>();
  const securityResponses = new Set<string>();
  
  const securityRequestListener = (request: any) => {
    try {
      const url = request.url();
      if (url.includes('forter') || url.includes('iovation') || url.includes('blackbox') || 
          url.includes('transmit') || url.includes('risk')) {
        securityRequests.add(url);
        logger.info(` Security script request detected: ${url.substring(0, 100)}...`);
      }
    } catch (e) {
      // Ignore errors
    }
  };

  const securityResponseListener = (response: any) => {
    try {
      const url = response.url();
      if (url.includes('forter') || url.includes('iovation') || url.includes('blackbox') || 
          url.includes('transmit') || url.includes('risk')) {
        securityResponses.add(url);
        logger.info(` Security script response received: ${url.substring(0, 100)}...`);
      }
    } catch (e) {
      // Ignore errors
    }
  };
  
  puppeteerPage.on("request", securityRequestListener);
  puppeteerPage.on("response", securityResponseListener);

  // Wait for security scripts to load and initialize
  // Give them more time to collect behavioral data
  logger.info(" Waiting for Forter/iovation scripts to collect behavioral data...");
  
  try {
    await puppeteerPage.waitForFunction(() => {
      // Check multiple indicators that scripts are loaded
      const hasForterScript = Array.from(document.querySelectorAll('script')).some(
        (script) => script.src.includes('forter') || script.textContent?.includes('forter')
      );
      const hasForterWindow = !!(window as any).forter || !!(window as any).Forter;
      const hasForterToken = localStorage.getItem('forterToken') !== null;
      
      const hasIovationScript = Array.from(document.querySelectorAll('script')).some(
        (script) => script.src.includes('iovation') || script.textContent?.includes('iovation')
      );
      const hasIovationWindow = !!(window as any).io || !!(window as any).iovation;
      const hasIovationData = Array.from({ length: localStorage.length }, (_, i) => {
        const key = localStorage.key(i);
        return key && /iovation|io_|blackbox/i.test(key || '');
      }).some(Boolean);

      return (hasForterScript || hasForterWindow || hasForterToken) && 
             (hasIovationScript || hasIovationWindow || hasIovationData);
    }, { timeout: 15000, polling: 500 }).catch(() => {
      logger.warn("  Security scripts check timed out, proceeding anyway...");
    });
  } catch (e) {
    logger.warn("  Error checking security scripts, proceeding...");
  }

  // Wait longer for security scripts to collect behavioral data and make network requests
  // Forter needs time to calculate fraud scores based on behavior
  logger.info(" Waiting for security scripts to complete data collection (this may take 10-15 seconds)...");
  await delay(getRandomNumberBetweenRange(ONE_SECOND * 10, ONE_SECOND * 15));

  if (securityRequests.size > 0) {
    logger.info(` Detected ${securityRequests.size} security script network requests`);
  }
  if (securityResponses.size > 0) {
    logger.info(` Detected ${securityResponses.size} security script network responses`);
  }
  if (securityRequests.size === 0 && securityResponses.size === 0) {
    logger.warn("  No security script network activity detected - scripts may be blocked or not loading");
  }

  puppeteerPage.off("request", securityRequestListener);
  puppeteerPage.off("response", securityResponseListener);

  // More human-like interactions: scroll, move mouse, pause
  // This helps Forter collect more behavioral data for a better score
  logger.info("  Performing human-like interactions before submission...");
  for (let i = 0; i < getRandomNumberBetweenRange(3, 5); i++) {
    await puppeteerPage.mouse.move(
      getRandomNumberBetweenRange(100, 700),
      getRandomNumberBetweenRange(100, 500),
      { steps: getRandomNumberBetweenRange(15, 25) }
    );
    await delay(getRandomNumberBetweenRange(800, 1500));
    await puppeteerPage.mouse.wheel({ deltaY: getRandomNumberBetweenRange(-150, 150) });
    await delay(getRandomNumberBetweenRange(800, 1500));
  }

  // Check forterToken score before submission
  // Note: The token in localStorage might be different from the one sent in the request
  try {
    const forterTokenInfo = await puppeteerPage.evaluate(() => {
      // Check localStorage
      const localStorageToken = localStorage.getItem('forterToken');
      
      // Check window objects (Forter might store it here)
      const windowForter = (window as any).forter || (window as any).Forter;
      const windowToken = windowForter?.getToken?.() || (window as any).__forterToken;
      
      // Check all possible token locations
      const tokens: string[] = [];
      if (localStorageToken) tokens.push(localStorageToken);
      if (windowToken) tokens.push(windowToken);
      
      // Try to extract score from any token (format: ...=-274-v2_tt or ...=123-v2_tt)
      let score: number | null = null;
      let foundToken: string | null = null;
      
      for (const token of tokens) {
        const scoreMatch = token.match(/=(-?\d+)-v2_tt/);
        if (scoreMatch) {
          score = parseInt(scoreMatch[1], 10);
          foundToken = token;
          break;
        }
      }
      
      return {
        hasToken: tokens.length > 0,
        tokenPreview: foundToken ? foundToken.substring(0, 80) + '...' : (tokens[0]?.substring(0, 50) || 'N/A'),
        score: score,
        hasNegativeScore: score !== null && score < 0,
      };
    });

    if (forterTokenInfo.hasToken) {
      if (forterTokenInfo.hasNegativeScore) {
        logger.warn(`  Forter token has NEGATIVE score: ${forterTokenInfo.score} - This indicates high fraud risk!`);
        logger.warn(`  The proxy IP or browser fingerprint may be flagged by Forter.`);
        logger.warn(`  Consider using a different residential proxy or improving browser fingerprint.`);
      } else if (forterTokenInfo.score !== null) {
        logger.info(` Forter token score: ${forterTokenInfo.score}`);
      } else {
        logger.info(`  Forter token present but score could not be extracted from format`);
        logger.info(`  Token preview: ${forterTokenInfo.tokenPreview}`);
      }
    } else {
      logger.warn("  Forter token not found - Forter scripts may not be running properly");
    }
  } catch (e: any) {
    logger.warn(`  Could not check forterToken score: ${e.message}`);
  }

  // Final delay before submitting - let Forter finalize its analysis
  await delay(getRandomNumberBetweenRange(ONE_SECOND * 2, ONE_SECOND * 4));

  // Solve reCAPTCHA v3 Enterprise before submitting form
  let recaptchaToken: string | null = null;
  try {
    const { default: CaptchaSolver } = await import("../services/captchaSolver");
    const solver = new CaptchaSolver({
      preferredService: (process.env.CAPTCHA_SERVICE as "capmonster" | "nextcaptcha") || "nextcaptcha",
    });

    logger.info(" Extracting reCAPTCHA site key from Upwork login page...");
    const siteKey = await solver.extractRecaptchaSiteKey(UWLoginPage.page.getPage());

    if (siteKey) {
      logger.info(` Found reCAPTCHA site key: ${siteKey.substring(0, 20)}...`);
      logger.info(" Solving reCAPTCHA v3 Enterprise...");
      
      recaptchaToken = await solver.solveRecaptchaV3Enterprise(
        "https://www.upwork.com/ab/account-security/login",
        siteKey,
        0.3, // min score
        "login" // page action
      );

      if (recaptchaToken) {
        logger.info(" reCAPTCHA solved successfully, injecting token...");
        
        // Inject the token into the page
        await puppeteerPage.evaluate((token: string) => {
          // Method 1: Try to set it in grecaptcha response
          if ((window as any).grecaptcha) {
            // Override grecaptcha.execute to return our token
            const originalExecute = (window as any).grecaptcha.execute;
            (window as any).grecaptcha.execute = function(siteKey: string, action: string) {
              return Promise.resolve(token);
            };
          }

          // Method 2: Set it as a hidden input field
          let tokenInput = document.querySelector('input[name="g-recaptcha-response"]') as HTMLInputElement;
          if (!tokenInput) {
            tokenInput = document.createElement('input');
            tokenInput.type = 'hidden';
            tokenInput.name = 'g-recaptcha-response';
            document.body.appendChild(tokenInput);
          }
          tokenInput.value = token;

          // Method 3: Store in window for form submission
          (window as any).__recaptchaToken = token;
        }, recaptchaToken);

        logger.info(" reCAPTCHA token injected into form");

        try {
          const securityTokens = await puppeteerPage.evaluate(() => {
            const gatherStorage = (storage: Storage) => {
              const result: Record<string, string | null> = {};
              for (let i = 0; i < storage.length; i++) {
                const key = storage.key(i);
                if (!key) continue;
                if (/forter|token|iovation|blackbox|bb|captcha/i.test(key)) {
                  result[key] = storage.getItem(key);
                }
              }
              return result;
            };

            const windowCandidates: Record<string, any> = {};
            const candidateKeys = [
              "forterToken",
              "_forterToken",
              "forterReference",
              "forterConfig",
              "forterSessionId",
              "io_bb",
              "io_blackbox",
              "Blackbox",
              "iovation",
              "_fingerprintjs",
            ];

            candidateKeys.forEach((key) => {
              const value = (window as any)[key];
              if (value) {
                windowCandidates[key] = value;
              }
            });

            return {
              localStorage: gatherStorage(localStorage),
              sessionStorage: gatherStorage(sessionStorage),
              windowCandidates,
            };
          });

          logger.info(` Security token snapshot: ${JSON.stringify(securityTokens)}`);
        } catch (tokenError: any) {
          logger.warn(`  Could not capture security tokens: ${tokenError.message}`);
        }
      } else {
        logger.warn("  Failed to solve reCAPTCHA, proceeding without token");
      }
    } else {
      logger.warn("  Could not find reCAPTCHA site key, proceeding without solving");
    }
  } catch (error: any) {
    logger.error(` Error solving reCAPTCHA: ${error.message}`);
    logger.warn("  Proceeding with login without CAPTCHA token");
  }

  const loginPromise = UWLoginPage.page
    .waitForResponse(
      (response) => {
        return response.url().includes("https://www.upwork.com/ab/account-security/login"); // Modify this condition based on your needs
      },
      { timeout: NETWORK_TIMEOUT },
      "https://www.upwork.com/ab/account-security/login - call failed - authenticate"
    )
    .then((res) => {
      return res;
    });

  // Click on continue button
  continueButton = await UWLoginPage.getSecondContinueLoginButton();

  // Final delay before submitting - human double-checking
  await delay(getRandomNumberBetweenRange(ONE_SECOND * 2, ONE_SECOND * 4));
  
  logger.info(" Submitting login form...");
  await simulateHumanClick(continueButton, UWLoginPage.page.getPage());

  // Wait for response - but also check for immediate DOM errors
  let response: any;
  let loginResponse: any = {};
  
  try {
    // Wait for the login response with a timeout
    response = await Promise.race([
      loginPromise,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Login response timeout")), NETWORK_TIMEOUT)
      ),
    ]) as any;

    // Get response text first (before trying to parse as JSON)
    const responseText = await response.text();
    logger.info(` Login response text (first 1000 chars): ${responseText.substring(0, 1000)}`);
    
    try {
      loginResponse = JSON.parse(responseText);
      logger.info(` Login response JSON: ${JSON.stringify(loginResponse, null, 2)}`);
      
      // Check for error codes in response
      if (loginResponse?.eventCode) {
        logger.info(` Event code: ${loginResponse.eventCode}`);
      }
      if (loginResponse?.error) {
        logger.warn(`  Login response error: ${JSON.stringify(loginResponse.error)}`);
      }
      if (loginResponse?.captchaCode) {
        logger.info(` Upwork returned captchaCode: ${loginResponse.captchaCode}`);
        logger.info(`  This might indicate a CAPTCHA challenge or verification issue`);
      }
      if (loginResponse?.success === 0) {
        logger.warn(`  Login was not successful (success: 0)`);
      }
    } catch (parseError: any) {
      logger.warn(`  Could not parse login response as JSON: ${parseError.message}`);
      logger.info(` Response is not JSON, treating as text`);
    }
  } catch (responseError: any) {
    logger.error(` Failed to get login response: ${responseError.message}`);
  }

  // Check for DOM-based error messages (network restrictions, technical difficulties)
  /** Check if we failed to authenticate. In this case we retry with a
   *  different proxy
   */
  let error = await checkForAuthenticationErrors(UWLoginPage);

  if (error) {
    puppeteerPage.off("request", loginRequestListener);
    return { statusCode: StatusCodes.OK, errCode: error };
  }

  puppeteerPage.off("request", loginRequestListener);

  if (loginResponse?.eventCode === "wrongPassword") {
    return {
      statusCode: StatusCodes.UNAUTHORIZED,
      errCode: AUTH_ERROR_CODES.AUTH_WRONG_CREDENTIALS,
    };
  }

  return { statusCode: StatusCodes.OK, errCode: undefined };
}

async function checkForAuthenticationErrors(UWLoginPage: UpworkLoginPage) {
  if (await UWLoginPage.checkNetworkRestrictionError()) {
    return AUTH_ERROR_CODES.AUTH_NETWORK_RESTRICTED;
  } else if (await UWLoginPage.checkTechnicalIssuesError()) {
    return AUTH_ERROR_CODES.AUTH_TECH_DIFFICULTIES;
  }

  return;
}
