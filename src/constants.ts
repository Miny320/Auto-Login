export const NETWORK_TIMEOUT = 2 * 30000;
export const ONE_SECOND = 1000;
export const ONE_MINUTE = 60000;
export const ONE_HOUR = 60 * 60 * 1000;
export const ONE_DAY = ONE_HOUR * 24;
export const ONE_YEAR = ONE_DAY * 365;

export enum UpworkUrlPaths {
  JOBS_BASE = "https://www.upwork.com/jobs",
  ROOMS_URL = "https://www.upwork.com/ab/messages/rooms",
  FREELANCERS_PAGE = "https://www.upwork.com/freelancers/",
  LOGIN_PAGE = "https://www.upwork.com/ab/account-security/login",
  JOB_DETAIL_PAGE_BASE = "https://www.upwork.com/jobs",
}

export enum AUTH_ERROR_CODES {
  AUTH_WRONG_CREDENTIALS = "AUTH_WRONG_CREDENTIALS",
  AUTH_NETWORK_RESTRICTED = "AUTH_NETWORK_RESTRICTED",
  AUTH_TECH_DIFFICULTIES = "AUTH_TECH_DIFFICULTIES",
}
