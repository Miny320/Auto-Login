/**
 * Cookie Warming - Navigate to various sites before login to build trust
 * This improves reCAPTCHA v3 Enterprise score from 0.1 to 0.7+
 * 
 * Based on findings:
 * - Fresh bot shows 0.1 score
 * - After warming up cookies by navigating sites, score improves to 0.7+
 */

import PageWrapper from "../classes/PageWrapper";
import { delay, getRandomNumberBetweenRange } from "../helpers";
import { ONE_SECOND } from "../constants";
import logger from "../logger";

/**
 * List of sites to visit for cookie warming
 * These are common sites that help build a realistic browsing history
 */
const WARMING_SITES = [
  "https://www.google.com",
  "https://www.youtube.com",
  "https://www.github.com",
  "https://www.stackoverflow.com",
  "https://www.reddit.com",
  "https://www.wikipedia.org",
  "https://www.linkedin.com",
  "https://www.twitter.com",
];

/**
 * Warm up cookies by navigating to various sites
 * This simulates real user behavior and improves reCAPTCHA v3 score
 * 
 * @param page - The page to use for navigation
 * @param numSites - Number of sites to visit (default: 3-5 random)
 * @param minDelay - Minimum delay between navigations in ms
 * @param maxDelay - Maximum delay between navigations in ms
 */
export async function warmUpCookies(
  page: PageWrapper,
  numSites: number = getRandomNumberBetweenRange(3, 5),
  minDelay: number = ONE_SECOND * 2,
  maxDelay: number = ONE_SECOND * 8
): Promise<void> {
  logger.info(`Starting cookie warming - visiting ${numSites} sites...`);

  // Shuffle and select random sites
  const shuffledSites = [...WARMING_SITES].sort(() => Math.random() - 0.5);
  const sitesToVisit = shuffledSites.slice(0, Math.min(numSites, WARMING_SITES.length));

  for (let i = 0; i < sitesToVisit.length; i++) {
    const site = sitesToVisit[i];
    try {
      logger.info(`Warming cookie ${i + 1}/${sitesToVisit.length}: ${site}`);

      // Navigate to site
      await page.goto(site, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      // Simulate human behavior on the page
      const puppeteerPage = page.getPage();
      
      // Random scroll to simulate reading
      const scrollAmount = getRandomNumberBetweenRange(200, 800);
      await puppeteerPage.mouse.wheel({ deltaY: scrollAmount });
      await delay(getRandomNumberBetweenRange(500, 1500));

      // Random mouse movements
      const pageHeight = await puppeteerPage.evaluate(() => window.innerHeight);
      const pageWidth = await puppeteerPage.evaluate(() => window.innerWidth);
      
      for (let j = 0; j < getRandomNumberBetweenRange(1, 3); j++) {
        const randomX = getRandomNumberBetweenRange(pageWidth * 0.2, pageWidth * 0.8);
        const randomY = getRandomNumberBetweenRange(pageHeight * 0.2, pageHeight * 0.8);
        await puppeteerPage.mouse.move(randomX, randomY, {
          steps: getRandomNumberBetweenRange(10, 25),
        });
        await delay(getRandomNumberBetweenRange(300, 800));
      }

      // Wait before next navigation (simulate reading/thinking)
      const waitTime = getRandomNumberBetweenRange(minDelay, maxDelay);
      await delay(waitTime);

      logger.info(`Completed warming for ${site}`);
    } catch (error: any) {
      logger.warn(`Failed to warm cookie for ${site}: ${error.message}`);
      // Continue with next site even if one fails
    }
  }

  logger.info(`Cookie warming completed - visited ${sitesToVisit.length} sites`);
  
  // Final delay before proceeding to login
  await delay(getRandomNumberBetweenRange(ONE_SECOND * 2, ONE_SECOND * 4));
}

/**
 * Quick cookie warming - visits fewer sites for faster execution
 */
export async function quickCookieWarmUp(page: PageWrapper): Promise<void> {
  await warmUpCookies(page, getRandomNumberBetweenRange(2, 3), ONE_SECOND * 1, ONE_SECOND * 3);
}

