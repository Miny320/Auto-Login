/**
 * CAPTCHA Solving Service
 * Handles reCAPTCHA v3 Enterprise using Capmonster and Nextcaptcha APIs
 * 
 * Upwork uses:
 * - reCAPTCHA v3 Enterprise
 * - iovation
 * - forterToken
 * 
 * API Keys provided:
 * - Capmonster: f4b00ffd2829c610c5d86af25f709e72
 * - Nextcaptcha: next_07fd92bab3d0dd47ca2c0de3ae5e0ed8d9
 */

import axios from "axios";
import logger from "../logger";

interface CaptchaSolverConfig {
  capmonsterApiKey?: string;
  nextcaptchaApiKey?: string;
  preferredService?: "capmonster" | "nextcaptcha";
}

interface RecaptchaV3Task {
  type: "RecaptchaV3TaskProxyless" | "RecaptchaV3EnterpriseTaskProxyless";
  websiteURL: string;
  websiteKey: string;
  minScore?: number;
  pageAction?: string;
}

class CaptchaSolver {
  private capmonsterApiKey?: string;
  private nextcaptchaApiKey?: string;
  private preferredService: "capmonster" | "nextcaptcha";

  constructor(config: CaptchaSolverConfig = {}) {
    this.capmonsterApiKey = config.capmonsterApiKey || process.env.CAPMONSTER_API_KEY;
    this.nextcaptchaApiKey = config.nextcaptchaApiKey || process.env.NEXTCAPTCHA_API_KEY;
    this.preferredService = config.preferredService || "nextcaptcha";

    // Default API keys from team
    if (!this.capmonsterApiKey) {
      this.capmonsterApiKey = "f4b00ffd2829c610c5d86af25f709e72";
    }
    if (!this.nextcaptchaApiKey) {
      this.nextcaptchaApiKey = "next_07fd92bab3d0dd47ca2c0de3ae5e0ed8d9";
    }
  }

  /**
   * Solve reCAPTCHA v3 Enterprise using Capmonster
   */
  private async solveWithCapmonster(
    websiteURL: string,
    websiteKey: string,
    minScore: number = 0.3,
    pageAction: string = "login"
  ): Promise<string | null> {
    if (!this.capmonsterApiKey) {
      throw new Error("Capmonster API key not configured");
    }

    try {
      // Create task
      const createTaskResponse = await axios.post("https://api.capmonster.cloud/createTask", {
        clientKey: this.capmonsterApiKey,
        task: {
          type: "RecaptchaV3EnterpriseTaskProxyless",
          websiteURL,
          websiteKey,
          minScore,
          pageAction,
        },
      });

      if (createTaskResponse.data.errorId !== 0) {
        throw new Error(`Capmonster createTask error: ${createTaskResponse.data.errorDescription}`);
      }

      const taskId = createTaskResponse.data.taskId;
      logger.info(`Capmonster task created: ${taskId}`);

      // Poll for result
      let attempts = 0;
      const maxAttempts = 60; // 5 minutes max (5 second intervals)

      while (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds

        const getResultResponse = await axios.post("https://api.capmonster.cloud/getTaskResult", {
          clientKey: this.capmonsterApiKey,
          taskId,
        });

        if (getResultResponse.data.status === "ready") {
          const token = getResultResponse.data.solution.gRecaptchaResponse;
          logger.info(`Capmonster solved reCAPTCHA v3 (score: ${getResultResponse.data.solution.score || "N/A"})`);
          return token;
        }

        if (getResultResponse.data.status === "processing") {
          attempts++;
          continue;
        }

        throw new Error(`Capmonster task failed: ${getResultResponse.data.errorDescription}`);
      }

      throw new Error("Capmonster timeout - task took too long");
    } catch (error: any) {
      logger.error(`Capmonster error: ${error.message}`);
      return null;
    }
  }

  /**
   * Solve reCAPTCHA v3 Enterprise using Nextcaptcha
   */
  private async solveWithNextcaptcha(
    websiteURL: string,
    websiteKey: string,
    minScore: number = 0.3,
    pageAction: string = "login"
  ): Promise<string | null> {
    if (!this.nextcaptchaApiKey) {
      throw new Error("Nextcaptcha API key not configured");
    }

    try {
      // Nextcaptcha uses a different API format
      const response = await axios.post(
        "https://api.nextcaptcha.com/v1/recaptcha-v3-enterprise",
        {
          websiteURL,
          websiteKey,
          minScore,
          pageAction,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.nextcaptchaApiKey}`,
          },
        }
      );

      if (response.data.success && response.data.token) {
        logger.info(`Nextcaptcha solved reCAPTCHA v3 (score: ${response.data.score || "N/A"})`);
        return response.data.token;
      }

      throw new Error(`Nextcaptcha error: ${response.data.message || "Unknown error"}`);
    } catch (error: any) {
      logger.error(`Nextcaptcha error: ${error.message}`);
      
      // Try alternative Nextcaptcha endpoint format
      try {
        const altResponse = await axios.post(
          "https://api.nextcaptcha.com/createTask",
          {
            clientKey: this.nextcaptchaApiKey,
            task: {
              type: "RecaptchaV3EnterpriseTaskProxyless",
              websiteURL,
              websiteKey,
              minScore,
              pageAction,
            },
          }
        );

        if (altResponse.data.taskId) {
          // Poll for result similar to Capmonster
          const taskId = altResponse.data.taskId;
          let attempts = 0;
          const maxAttempts = 60;

          while (attempts < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 5000));

            const resultResponse = await axios.post("https://api.nextcaptcha.com/getTaskResult", {
              clientKey: this.nextcaptchaApiKey,
              taskId,
            });

            if (resultResponse.data.status === "ready") {
              return resultResponse.data.solution.gRecaptchaResponse;
            }

            attempts++;
          }
        }
      } catch (altError: any) {
        logger.error(`Nextcaptcha alternative endpoint error: ${altError.message}`);
      }

      return null;
    }
  }

  /**
   * Solve reCAPTCHA v3 Enterprise
   * Tries preferred service first, falls back to other service if it fails
   */
  async solveRecaptchaV3Enterprise(
    websiteURL: string,
    websiteKey: string,
    minScore: number = 0.3,
    pageAction: string = "login"
  ): Promise<string | null> {
    logger.info(`Solving reCAPTCHA v3 Enterprise for ${websiteURL}...`);

    // Try preferred service first
    let token: string | null = null;

    if (this.preferredService === "capmonster" && this.capmonsterApiKey) {
      token = await this.solveWithCapmonster(websiteURL, websiteKey, minScore, pageAction);
    } else if (this.preferredService === "nextcaptcha" && this.nextcaptchaApiKey) {
      token = await this.solveWithNextcaptcha(websiteURL, websiteKey, minScore, pageAction);
    }

    // Fallback to other service if preferred failed
    if (!token) {
      if (this.preferredService === "capmonster" && this.nextcaptchaApiKey) {
        logger.info("Falling back to Nextcaptcha...");
        token = await this.solveWithNextcaptcha(websiteURL, websiteKey, minScore, pageAction);
      } else if (this.preferredService === "nextcaptcha" && this.capmonsterApiKey) {
        logger.info("Falling back to Capmonster...");
        token = await this.solveWithCapmonster(websiteURL, websiteKey, minScore, pageAction);
      }
    }

    if (!token) {
      logger.error("Failed to solve reCAPTCHA v3 Enterprise with both services");
    }

    return token;
  }

  /**
   * Extract reCAPTCHA site key from page
   */
  async extractRecaptchaSiteKey(page: any): Promise<string | null> {
    try {
      const siteKey = await page.evaluate(() => {
        // Try to find reCAPTCHA site key in various ways
        const scripts = Array.from(document.querySelectorAll("script"));
        for (const script of scripts) {
          const content = script.textContent || script.innerHTML;
          const match = content.match(/sitekey["\s:=]+([a-zA-Z0-9_-]{40})/i);
          if (match) return match[1];
        }

        // Check data-sitekey attribute
        const recaptchaDiv = document.querySelector('[data-sitekey]');
        if (recaptchaDiv) {
          return recaptchaDiv.getAttribute("data-sitekey");
        }

        // Check for grecaptcha
        if ((window as any).grecaptcha) {
          const widgets = (window as any).grecaptcha.getWidgets();
          if (widgets && widgets.length > 0) {
            return widgets[0].sitekey;
          }
        }

        return null;
      });

      return siteKey;
    } catch (error: any) {
      logger.error(`Failed to extract reCAPTCHA site key: ${error.message}`);
      return null;
    }
  }
}

export default CaptchaSolver;

