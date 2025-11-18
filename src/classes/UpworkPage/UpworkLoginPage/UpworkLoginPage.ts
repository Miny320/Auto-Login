import { NETWORK_TIMEOUT } from "../../../constants";
import { UpworkPage } from "../UpworkPage";

const LOGIN_PAGE = "Login page";

export class UpworkLoginPage extends UpworkPage {
  /** Username password step */
  async getLoginInput() {
    const loginInput = this.getElement("#login_username");
    await this.page.waitForFunction(() => {
      const input: HTMLInputElement | null = document.querySelector("#login_username");
      return input && !input.disabled;
    });
    return loginInput;
  }

  async checkUsernamePasswordStepError() {
    return this.page.checkElementExists("#input-msg-error");
  }

  async getFirstContinueLoginButton() {
    return this.getElement("#login_password_continue");
  }

  async getLoginPasswordInput() {
    return this.getElement("#login_password");
  }

  async clickRememberMe() {
    await this.page.evaluate(() => {
      const checkbox: HTMLInputElement | null = document.querySelector("#login_rememberme");
      if (!checkbox) throw new Error("Remember me checkbox not found!");

      if (typeof checkbox.checked !== "boolean" || !checkbox.checked) {
        checkbox.click();
      }
    });
  }

  /** This function is needed to reliably wait for the next step after inputting
   * the password.
   */
  async waitForLoginSecondScreen() {
    try {
      await this.page.waitForFunction(() => {
        const currentUrl = window.location.href;
        const onLoginPage = currentUrl.includes("/ab/account-security/login");

        // Many of the newer Upwork pages (nx/ routes) no longer expose __NUXT__
        // but if we are off the login page we are effectively past the login step.
        if (!onLoginPage) {
          return true;
        }

        //@ts-expect-error __NUXT__ is an object when available on legacy pages
        const uwUserId = window?.__NUXT__?.state?.user?.id; // From /freelancers (legacy)
        const button2FA: HTMLButtonElement | null = document.querySelector("button#next_continue"); // 2fa send button
        const securityAnswerInput: HTMLInputElement | null = document.querySelector("#login_answer");

        return (
          typeof uwUserId === "string" ||
          (button2FA && !button2FA.disabled) ||
          (securityAnswerInput && !securityAnswerInput.disabled)
        );
      }, { timeout: NETWORK_TIMEOUT });
    } catch (error) {
      const currentUrl = await this.page.evaluate(() => window.location.href);
      if (currentUrl.includes("/ab/account-security/login")) {
        throw error;
      }
      // Otherwise we navigated away from the login page, so treat it as success.
    }
  }

  /** Security answer */
  async getSecurityQuestionText() {
    const label = await this.getElement('label[for="login_answer"]');
    return label.evaluate((el) => el.textContent);
  }

  async getSecondContinueLoginButton() {
    return this.getElement("#login_control_continue");
  }

  async checkNetworkRestrictionError() {
    return this.page.checkElementExists("#captcha-message");
  }

  async checkTechnicalIssuesError() {
    if (
      (await this.page.checkElementExists("div.login-alert")) &&
      (await this.page.$("div.login-alert"))
    ) {
      const alert = await this.page.$("div.login-alert");
      const errorText = await alert?.evaluate((el) => {
        return el.textContent?.trim() || null;
      });
      return errorText?.toLowerCase()?.includes("due to technical difficulties");
    }
    return null;
  }

  async getSecurityAnswerInput() {
    return this.getElement("#login_answer");
  }

  async checkSecurityAnswerError() {
    return this.page.checkElementExists("#answer-message");
  }

  async waitForSecurityAnswerPassOrError() {
    await this.page.waitForFunction(
      () => {
        //@ts-expect-error __NUXT__ is an object
        const uwUserId = window?.__NUXT__?.state?.user?.id; // From /freelancers
        const answerError: HTMLSpanElement | null = document.querySelector("#answer-message"); // 2fa send button

        return typeof uwUserId === "string" || answerError;
      },
      { timeout: NETWORK_TIMEOUT }
    );
  }

  async clickRememberMeSecurityAnswer() {
    await this.page.evaluate(() => {
      const checkbox: HTMLInputElement | null = document.querySelector("#login_remember");
      if (!checkbox) throw new Error("Remember me checkbox not found!");

      if (typeof checkbox.checked !== "boolean" || !checkbox.checked) {
        checkbox.click();
      }
    });
  }
}
