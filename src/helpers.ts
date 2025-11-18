///// PUPPETTER HELPERS ///////
import os from "os";
import { ConsoleMessage, ElementHandle, Page } from "puppeteer";
import logger from "./logger";

// Max 2 secs, min 0.5 secs
export const simulateHumanType = async ({
  element,
  inputString,
  isShiftEnter,
  page,
}: {
  element: ElementHandle<Element>;
  inputString: string;
  isShiftEnter?: boolean;
  page?: Page;
}) => {
  const randomDelay = getRandomNumberBetweenRange(80, 120);

  if (!isShiftEnter) {
    await element.hover();
    await element.focus();
    await delay(200);
    await element.type(inputString, { delay: randomDelay });
    return;
  }

  // We need to split the string into different lines.
  // Then press shift enter for each one
  const inputLines = inputString.split(/\r?\n/)?.filter((line) => line.trim() !== "");
  while (inputLines.length > 0) {
    const input = inputLines.shift()!;

    await element.type(input, { delay: randomDelay });

    // Add a new line with shift or do nothing if final input
    if (inputLines.length === 0) continue;
    else {
      await delay(getRandomNumberBetweenRange(200, 250));
      await page?.keyboard.down("Shift");
      await page?.keyboard.press("Enter");
      await page?.keyboard.press("Enter");
      await page?.keyboard.up("Shift");
    }
  }
};

export const simulateHumanClick = async (element: ElementHandle<Element>, page?: Page) => {
  // Get element position
  const box = await element.boundingBox();
  if (!box) {
    // Fallback to simple click if no bounding box
    await element.hover();
    await delay(getRandomNumberBetweenRange(200, 250));
    await element.click();
    return;
  }

  if (page) {
    // Move mouse to a random point near the element first (human-like approach)
    const randomOffsetX = getRandomNumberBetweenRange(-10, 10);
    const randomOffsetY = getRandomNumberBetweenRange(-10, 10);
    await page.mouse.move(
      box.x + box.width / 2 + randomOffsetX,
      box.y + box.height / 2 + randomOffsetY,
      { steps: getRandomNumberBetweenRange(5, 15) }
    );
    await delay(getRandomNumberBetweenRange(100, 200));
  }

  // Hover over the element
  await element.hover();
  await delay(getRandomNumberBetweenRange(200, 400)); // Longer delay before click
  
  // Click with slight random movement
  if (page && box) {
    const clickX = box.x + box.width / 2 + getRandomNumberBetweenRange(-2, 2);
    const clickY = box.y + box.height / 2 + getRandomNumberBetweenRange(-2, 2);
    await page.mouse.click(clickX, clickY, { delay: getRandomNumberBetweenRange(50, 150) });
  } else {
    await element.click();
  }
};

export const simulateHumanClearAllInput = async ({
  element,
  page,
}: {
  element: ElementHandle<Element>;
  page: Page;
}) => {
  await element.hover();
  await element.focus();
  await delay(1500);
  await element.click({ clickCount: 3 }); // Triple-click to select all text
  await delay(1500);
  await page.keyboard.press("Backspace");
};

export const scrollIntoViewSmoothly = async (
  element: ElementHandle<Element>,
  page: Page,
  block: ScrollLogicalPosition = "center"
) => {
  return await page.evaluate(
    (el, block) => {
      el.scrollIntoView({ behavior: "smooth", block });
    },
    element,
    block
  );
};

// This needs a try/catch of its own since asynchronous
export const consoleListener = async (e: ConsoleMessage) => {
  try {
    const args = await Promise.all(e.args().map((a) => a.jsonValue()));
    console.log(...args);
  } catch (error) {
    console.log(error);
  }
};

///// OTHER HELPERS ////////
export const getRandomNumberBetweenRange = (min: number, max: number) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

export const delay = (timeInMilliseconds: number) => {
  return new Promise((resolve) => setTimeout(resolve, timeInMilliseconds));
};

export const deepClone = <T>(data: T) => {
  return JSON.parse(JSON.stringify(data)) as T;
};

export const getCurrentOS = () => {
  return os.platform();
};

/** Function for retrying async methods */
export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  configs: {
    maxAttempts: number;
    delayBetweenAttempts: number;
    namespace?: string;
  }
): Promise<T> {
  let attempt = 0;
  let lastError: any;
  const { maxAttempts, delayBetweenAttempts, namespace } = configs;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      logger.error(`${namespace ? `${namespace} - ` : ""}Attempt ${attempt} failed:`, error);

      if (attempt < maxAttempts && delayBetweenAttempts > 0) {
        await delay(delayBetweenAttempts);
      }
    }
  }

  throw new Error(lastError);
}
