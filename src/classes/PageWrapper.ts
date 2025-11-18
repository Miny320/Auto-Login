import {
  ElementHandle,
  EvaluateFunc,
  FrameWaitForFunctionOptions,
  GoToOptions,
  HTTPResponse,
  NodeFor,
  Page,
  WaitForNetworkIdleOptions,
  WaitForOptions,
  WaitForSelectorOptions,
  WaitTimeoutOptions,
} from "puppeteer";
import { delay, getRandomNumberBetweenRange, retry } from "../helpers";
import { NETWORK_TIMEOUT, ONE_SECOND } from "../constants";

export default class PageWrapper {
  public page: Page;
  public logs: string[];
  public disableCaptcha: boolean;
  public lastIssuedCaptcha: number;

  constructor(page: Page, disableCaptcha = false) {
    this.page = page;
    this.logs = [] as string[];
    this.disableCaptcha = disableCaptcha;
    this.lastIssuedCaptcha = -1;
  }

  getPage() {
    return this.page;
  }

  logOperation(log: string) {
    /** If logs get too large, get rid of old ones */
    if (this.logs.length >= 50) {
      this.logs.shift();
    }

    this.logs.push(log);
  }

  dumpLogs() {
    return this.logs.map((log, index) => `${index + 1}: ${log}`).join("\n");
  }

  async goto(
    url: string,
    options: GoToOptions & {
      maxAttempts?: number;
      delayBetweenAttempts?: number;
      namespace?: string;
      useRetry?: boolean;
    } = {},
    customErrorMessage: string = ""
  ): Promise<HTTPResponse | null> {
    this.logOperation(`goto - ${url}`);

    const {
      maxAttempts = 3,
      delayBetweenAttempts = ONE_SECOND * 3,
      useRetry = false,
      ...puppeteerOptions
    } = options;

    const operation = () =>
      this.page.goto(url, {
        timeout: NETWORK_TIMEOUT, // Make it default to avoid navigation errors
        ...puppeteerOptions,
      });

    let response = useRetry
      ? await this._handleErrors(
          () => retry(operation, { maxAttempts, delayBetweenAttempts }),
          customErrorMessage
        )
      : await this._handleErrors(operation, customErrorMessage);

    return response;
  }

  async checkElementExists(selector: string) {
    const element = await this.$(selector);
    return element !== null;
  }

  async checkIfElementIsClickable(element: ElementHandle<Element>): Promise<boolean> {
    this.logOperation(`checkIfElementIsClickable`);

    /** An element is clickable if it meets the following:
     * https://webdriver.io/docs/api/element/isClickable/
     *  the element exists
     *  the element is displayed
     *  the element is not disabled
     *  the element is within the viewport
     *  the element can be scrolled into the viewport
     *  the element's center is not overlapped with another element
     */

    // 1) Check bounding box
    const box = await element.boundingBox();
    // If the bounding box is null or has zero width/height, the element is not truly visible
    if (!box || box.width <= 0 || box.height <= 0) {
      return false;
    }

    // 2) Check if the center of the element is not overlapped
    //    by another element on the page
    const isNotOverlapped = await this.page.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const center = {
        x: (rect.left + rect.right) / 2,
        y: (rect.top + rect.bottom) / 2,
      };
      const topElement = document.elementFromPoint(center.x, center.y);
      // It's "not overlapped" if the element itself is the top element,
      // or the top element is contained within it (e.g., child node).
      return el.isSameNode(topElement) || el.contains(topElement);
    }, element);

    if (!isNotOverlapped) {
      return false;
    }

    // 3) Optional: Check if the element is disabled
    // (This only applies if your element might have a `disabled` attribute.)
    const isNotDisabled = await this.page.evaluate((el) => {
      return el.getAttribute("disabled") === null;
    }, element);

    return isNotDisabled;
  }

  async $(
    selector: string,
    customErrorMessage: string = ""
  ): Promise<ElementHandle<Element> | null> {
    this.logOperation(`$ - ${selector}`);

    return this._handleErrors(() => this.page.$(selector), customErrorMessage);
  }

  async $$(selector: string, customErrorMessage: string = ""): Promise<ElementHandle<Element>[]> {
    this.logOperation(`$$ - ${selector}`);

    return this._handleErrors(() => this.page.$$(selector), customErrorMessage);
  }

  async waitForSelector(
    selector: string,
    options: WaitForSelectorOptions = {},
    customErrorMessage: string = ""
  ): Promise<ElementHandle<NodeFor<string>> | null> {
    this.logOperation(`waitForSelector - ${selector}`);

    return this._handleErrors(
      () => this.page.waitForSelector(selector, options),
      customErrorMessage
    );
  }

  async waitForNavigation(
    options: WaitForOptions = {},
    customErrorMessage: string = ""
  ): Promise<void> {
    this.logOperation(`waitForNavigation`);

    return this._handleErrors(() => this.page.waitForNavigation(options), customErrorMessage);
  }

  async waitForFunction(
    fn: string | EvaluateFunc<[]>,
    options: FrameWaitForFunctionOptions = {},
    customErrorMessage: string = ""
  ): Promise<void> {
    this.logOperation(`waitForFunction - ${fn}`);

    return this._handleErrors(() => this.page.waitForFunction(fn, options), customErrorMessage);
  }

  async waitForResponse(
    predicate: (response: HTTPResponse) => boolean,
    options: WaitTimeoutOptions = {},
    customErrorMessage: string = ""
  ): Promise<HTTPResponse> {
    this.logOperation(`waitForResponse`);

    return this._handleErrors(
      () => this.page.waitForResponse(predicate, options),
      customErrorMessage
    );
  }

  async waitForNetworkIdle(
    options: WaitForNetworkIdleOptions = {},
    customErrorMessage: string = ""
  ): Promise<void> {
    this.logOperation(`waitForNetworkIdle`);

    return this._handleErrors(() => this.page.waitForNetworkIdle(options), customErrorMessage);
  }

  async evaluate<T>(
    pageFunction: (...args: any[]) => T | Promise<T>,
    ...args: any[]
  ): Promise<Awaited<T> | Awaited<T>> {
    this.logOperation(`evaluate`);

    return this._handleErrors(() => this.page.evaluate(pageFunction, ...args));
  }

  async goBack(
    options: WaitForOptions = {},
    customErrorMessage: string = ""
  ): Promise<HTTPResponse | null> {
    this.logOperation(`goBack`);

    return this._handleErrors(() => this.page.goBack(options), customErrorMessage);
  }

  /** Puppeteer does not free up resources from a closed page
   *  unless we first navigate to about:blank. Before doing this we
   *  were experiencing crashes due to sudden cpu and memory spikes
   *  https://github.com/puppeteer/puppeteer/issues/1490
   */
  async close(
    options: { runBeforeUnload?: boolean } = {},
    customErrorMessage: string = ""
  ): Promise<void> {
    this.logOperation(`close`);

    // TODO: To be removed after investigation completed
    try {
      const url = await this.page.url();
    } catch (error) {}

    return this._handleErrors(async () => {
      await this.page.goto(`about:blank`);
      await delay(ONE_SECOND * 2);

      return this.page.close(options);
    }, customErrorMessage);
  }

  async goToBlank() {
    return await this.page.goto(`about:blank`);
  }

  async simulateHumanType({
    element,
    inputString,
    isShiftEnter,
  }: {
    element: ElementHandle<Element>;
    inputString: string;
    isShiftEnter?: boolean;
  }) {
    this.logOperation(`simulateHumanType`);

    const randomDelay = getRandomNumberBetweenRange(80, 90);

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
        await this.page?.keyboard.down("Shift");
        await this.page?.keyboard.press("Enter");
        await this.page?.keyboard.press("Enter");
        await this.page?.keyboard.up("Shift");
      }
    }
  }

  async simulateHumanClick(element: ElementHandle<Element>) {
    this.logOperation(`simulateHumanClick`);

    await element.hover();
    await delay(getRandomNumberBetweenRange(200, 250));
    await element.click();
  }

  async simulateHumanClearAllInput(element: ElementHandle<Element>) {
    this.logOperation(`simulateHumanClearAllInput`);

    await element.hover();
    await element.focus();
    await delay(1500);
    await element.click({ clickCount: 3 }); // Triple-click to select all text
    await delay(1500);
    await this.page.keyboard.press("Backspace");
  }

  async simulateHumanScrollingDown() {
    /** Scroll a random amount down to show human behavior */
    let intervals = getRandomNumberBetweenRange(1, 4);
    for (let index = 0; index < intervals; index++) {
      const randomDeltaY = getRandomNumberBetweenRange(200, 400);
      // Simulate smoother scrolling
      const numberOfSteps = 50;
      const deltaYPerStep = randomDeltaY / numberOfSteps; // Smaller value for finer, smoother scrolling
      for (let i = 0; i < numberOfSteps; i++) {
        await this.page.mouse.wheel({ deltaY: deltaYPerStep });
        await delay(100); // Small delay to mimic human scrolling speed
      }

      await delay(getRandomNumberBetweenRange(ONE_SECOND, ONE_SECOND * 2));
    }
  }

  async scrollIntoViewSmoothly(
    element: ElementHandle<Element>,
    block: ScrollLogicalPosition = "center"
  ) {
    this.logOperation(`scrollIntoViewSmoothly`);

    return await this.page.evaluate(
      (el, block) => {
        el.scrollIntoView({ behavior: "smooth", block });
      },
      element,
      block
    );
  }

  url(): string {
    this.logOperation(`url`);

    return this.page.url();
  }

  private async _handleErrors(fn: () => Promise<any>, customErrorMessage?: string): Promise<any> {
    try {
      return await fn();
    } catch (error: any) {
      console.log(error);
      throw new Error(error + (customErrorMessage ? ` ${customErrorMessage}` : ""));
    }
  }
}
