require("dotenv").config();
import { StatusCodes } from "http-status-codes";
import PageWrapper from "../classes/PageWrapper";
import { UpworkLoginPage } from "../classes/UpworkPage/UpworkLoginPage/UpworkLoginPage";
import { AUTH_ERROR_CODES, ONE_SECOND, UpworkUrlPaths } from "../constants";
import { delay, getRandomNumberBetweenRange } from "../helpers";
import { handleUsernameAndPassword } from "./usernamePasswordStep";

export default async function authenticate({ username, password, page }: AuthenticateArgs) {
  let status = StatusCodes.OK;
  let code: AUTH_ERROR_CODES | undefined;

  let UWLoginPage!: UpworkLoginPage;

  try {
    const {
      statusCode,
      errCode,
      UWLoginPage: loginPage,
    } = await handleUsernameAndPassword({
      page,
      username,
      password,
    });

    UWLoginPage = loginPage;
    status = statusCode;
    code = errCode;

    if (status === StatusCodes.UNAUTHORIZED) {
      throw new Error("Incorrect password or username");
    }
    // We logged in successfully
    else if (status === StatusCodes.OK && !page.url().includes(UpworkUrlPaths.LOGIN_PAGE)) {
      return { status, code };
    }

    // Without this delay if we navigate, networkidle would always resolve
    await delay(5000);

    if (!page.url().includes("https://www.upwork.com/ab/account-security/login")) {
      return { status, code };
    }

    // Omitted code
  } catch (error) {
    console.log(error);
  } finally {
    /** Wait a couple of seconds to let things close */
    await delay(ONE_SECOND * 2);

    return { status, code };
  }
}

export const waitForNuxtStateUserId = async (UWLoginPage: UpworkLoginPage) => {
  await UWLoginPage.page.waitForFunction(() => {
    //@ts-expect-error __NUXT__ is an object
    const uwUserId = window?.__NUXT__?.state?.user?.id;
    return typeof uwUserId === "string";
  });

  await delay(getRandomNumberBetweenRange(2000, 4000));
};

type AuthenticateArgs = {
  username: string;
  password: string;
  page: PageWrapper;
};
