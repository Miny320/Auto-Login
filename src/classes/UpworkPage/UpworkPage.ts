import { ElementHandle, WaitForSelectorOptions } from "puppeteer";
import PageWrapper from "../PageWrapper";

export class UpworkPage {
  public page: PageWrapper;

  constructor(page: PageWrapper) {
    this.page = page;
  }

  async getElement(selector: string, options: WaitForSelectorOptions & ExtraOptions = {}) {
    const element = options?.baseElement
      ? await options.baseElement.waitForSelector(selector, { visible: true, ...options })
      : await this.page.waitForSelector(selector, { visible: true, ...options });

    if (!element) {
      throw new Error(`Element with selector ${selector} not found!`);
    }

    if (options?.debug) {
      console.log(`Element with selector ${selector} found `);
    }

    return element;
  }

  async getCurrentYPosition() {
    return await this.page.evaluate(() => window.scrollY);
  }

  async getDeltaYFromElement(element: ElementHandle<Element>) {
    const currentY = await this.getCurrentYPosition();
    const box = await element.boundingBox();
    const elementTopViewport = box!.y;
    const elementTopDocument = currentY + elementTopViewport;
    const viewportHeight = await this.page.evaluate(() => window.innerHeight);
    const targetScrollY = elementTopDocument - viewportHeight / 2; // Center the element in the viewport

    const deltaY = targetScrollY - currentY;

    return deltaY;
  }
}

type ExtraOptions = {
  baseElement?: ElementHandle<Element>;
  debug?: boolean;
  customErrorMsg?: string;
};
