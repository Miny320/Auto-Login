'use strict'
const { UAClientHints } = require('ua-client-hints-js')
const { PuppeteerExtraPlugin } = require('puppeteer-extra-plugin')
const { UAParser } = require('ua-parser-js')
const helper = require('../replicate-to-worker/helper')

const defaultHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Sec-CH-UA": "\"Google Chrome\";v=\"131\", \"Chromium\";v=\"131\", \"Not A(Brand\";v=\"24\"",
  "Sec-CH-UA-Arch": "\"x86\"",
  "Sec-CH-UA-Mobile": "?0",
  "Sec-CH-UA-Model": "\"\"",
  "Sec-CH-UA-Platform": "\"Win32\"",
  "Sec-CH-UA-Platform-Version": "\"15.0.0\"",
  "Sec-CH-UA-Full-Version-List": "\"Google Chrome\";v=\"131.0.6778.70\", \"Chromium\";v=\"131.0.6778.70\", \"Not A(Brand\";v=\"24.0.0.0\"",
  "Sec-CH-UA-Bitness": "\"64\"",
  "Sec-CH-UA-Wow64": "?0"
}

/**
 * Fixes the UserAgent info (composed of UA string, Accept-Language, Platform, and UA hints).
 *
 * If you don't provide any values this plugin will default to using the regular UserAgent string (while stripping the headless part).
 * Default language is set to "pt,en", the other settings match the UserAgent string.
 * If you are running on Linux, it will mask the settins to look like Windows. This behavior can be disabled with the `maskLinux` option.
 *
 * By default puppeteer will not set a `Accept-Language` header in headless:
 * It's (theoretically) possible to fix that using either `page.setExtraHTTPHeaders` or a `--lang` launch arg.
 * Unfortunately `page.setExtraHTTPHeaders` will lowercase everything and launch args are not always available. :)
 *
 * In addition, the `navigator.platform` property is always set to the host value, e.g. `Linux` which makes detection very easy.
 *
 * Note: You cannot use the regular `page.setUserAgent()` puppeteer call in your code,
 * as it will reset the language and platform values you set with this plugin.
 *
 * @example
 * const puppeteer = require("puppeteer-extra")
 *
 * const StealthPlugin = require("puppeteer-extra-plugin-stealth")
 * const stealth = StealthPlugin()
 * // Remove this specific stealth plugin from the default set
 * stealth.enabledEvasions.delete("user-agent-override")
 * puppeteer.use(stealth)
 *
 * // Stealth plugins are just regular `puppeteer-extra` plugins and can be added as such
 * const UserAgentOverride = require("puppeteer-extra-plugin-stealth/evasions/user-agent-override")
 * // Define custom UA and locale
 * const ua = UserAgentOverride({ userAgent: "Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1; SV1)", locale: "de-DE,de" })
 * puppeteer.use(ua)
 *
 * @param {Object} [opts] - Options
 * @param {string} [opts.userAgent] - The user agent to use (default: browser.userAgent())
 * @param {string} [opts.locale] - The locale to use in `Accept-Language` header and in `navigator.languages` (default: `en-US,en`)
 *
 */
class Plugin extends PuppeteerExtraPlugin {
  constructor(opts = {
    headers: defaultHeaders
  }) {
    super(opts)
  }

  get name() {
    return 'stealth/evasions/user-agent-override'
  }

  async onPageCreated(page) {
    // Get the raw user agent from the browser if not provided
    let ua = this.opts.userAgent || await page.browser().userAgent()
    // Use this one below for testing
    // let ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";


    // Remove the "Headless" marker if present.
    ua = ua.replace('HeadlessChrome/', 'Chrome/')

    // If we want to mask Linux (and we're not on Android) then change it to Windows.
    if (this.opts.maskLinux !== false && ua.includes('Linux') && !ua.includes('Android')) {
      ua = ua.replace(/\(([^)]+)\)/, '(Windows NT 10.0; Win64; x64)')
    }

    const uaFullVersion = (await page.browser().version()).match(/Chrome\/([\d|.]+)/)[1];
    const uaVersion = ua.includes('Chrome/')
      ? ua.match(/Chrome\/([\d|.]+)/)[1]
      : (uaFullVersion).match(/\/([\d|.]+)/)[1];


    const architecture = ua.includes('Mac OS X') ? 'arm' : 'x86';
    const bitness = (ua.includes('WOW64') || ua.includes('Win64') || ua.includes("Mac OS X")) ? '64' : '32';

    // Get platform identifier (short or long version)
    const _getPlatform = (extended = false) => {
      if (ua.includes('Mac OS X')) {
        return extended ? 'macOS' : 'MacIntel';
      } else if (ua.includes('Android')) {
        return 'Android';
      } else if (ua.includes('Linux') && !this.opts.maskLinux) {
        return 'Linux';
      } else {
        return extended ? 'Windows' : 'Win32';
      }
    };

    const platform = _getPlatform(false);

    // Extract a platform version from the UA (this is a simple heuristic)
    const _getPlatformVersion = () => {
      if (ua.includes('Mac OS X ')) {
        // Originally it was ua.match(/Mac OS X ([^)]+)/)[1]
        // but for m3 the value seems to be the one below
        return '14.6.1';
      } else if (ua.includes('Android ')) {
        return ua.match(/Android ([^;]+)/)[1]
      } else if (ua.includes('Windows ')) {
        return ua.match(/Windows .*?([\d|.]+);?/)[1] + ".0";
      } else {
        return ''
      }
    }

    const platformVersion = _getPlatformVersion();


    // https://source.chromium.org/chromium/chromium/src/+/main:components/embedder_support/user_agent_utils.cc;l=55-100
    const _getBrands = (majorVersion) => {
      // Convert the major version to a number (seed).
      const seed = parseInt(majorVersion, 10);
      // Generate the three brand/version pairs.
      const greased = getGreasedUserAgentBrandVersion(seed);
      const chromium = { brand: "Chromium", version: String(seed) };
      const chrome = { brand: "Google Chrome", version: String(seed) };
      // Create the base list.
      const brandList = [greased, chromium, chrome];
      // Shuffle the list using a stable permutation based on the seed.
      return shuffleBrandList(brandList, seed);
    }

    const brands = _getBrands(uaVersion);

    const fullVersionList = brands.map(el => {
      const newEl = { ...el };
      if (newEl.brand.includes("Not")) {
        newEl.version += ".0.0.0";
        return newEl;
      }
      newEl.version = uaFullVersion;
      return newEl;
    })


    // Build dynamicHeaders with the same formatting as before.
    const dynamicHeaders = {
      "User-Agent": ua,
      "Sec-CH-UA-Arch": `"\"${architecture}\""`,
      "Sec-CH-UA-Mobile": ua.includes('Android') ? "?1" : "?0",
      "Sec-CH-UA-Model": "\"\"",
      "Sec-CH-UA-Platform-Version": `"\"${platformVersion}\""`,
      "Sec-CH-UA-Bitness": `"\"${bitness}\""`,
      "Sec-CH-UA-Wow64": ua.includes("WOW64") ? "?1" : "?0"
    };

    const headers = { ...dynamicHeaders };

    for (let key in dynamicHeaders)
      headers[key.toLowerCase()] = dynamicHeaders[key]

    // Parse the UA string using UAParser.
    const uap = new UAParser(ua).getResult()

    // Build the UA Client Hints object from dynamic headers.
    const ch = new UAClientHints()
    ch.setValuesFromHeaders(headers)

    const client =
      typeof page._client === 'function' ? page._client() : page._client

    const platformExtended = _getPlatform(true);

    const override = {
      acceptLanguage: this.opts.locale || 'en-US,en',
      userAgentMetadata: { ...ch.getValues(), platform: platformExtended, brands, fullVersion: uaVersion, fullVersionList },
      userAgent: uap.ua
    }


    helper(page).evalulateOn(
      ['NewDocument', 'NewWorker'],
      (utils, { brands, fullVersionList, userAgent, architecture, bitness, platform, platformExtended, platformVersion, }) => {
        utils.replaceGetterWithProxy(
          utils.cache.Object.getPrototypeOf(navigator),
          'userAgent',
          utils.makeHandler().getterValue(userAgent)
        );

        const appVersion = navigator.userAgent.replace(/^Mozilla\//, '');
        utils.replaceGetterWithProxy(
          utils.cache.Object.getPrototypeOf(navigator),
          'appVersion',
          utils.makeHandler().getterValue(appVersion)
        );



        utils.replaceGetterWithProxy(
          utils.cache.Object.getPrototypeOf(navigator),
          'platform',
          utils.makeHandler().getterValue(platform)
        )

        const getBrands = () =>
          brands.map(brand => ({ ...brand }))

        const getFullVersionList = () =>
          fullVersionList.map(brand => ({ ...brand }))

        const uaFullVersion = fullVersionList
          .find(({ brand }) => brand === 'Google Chrome')
          .version


        utils.replaceWithProxy(
          NavigatorUAData.prototype,
          'getHighEntropyValues',
          {
            get(target, key) {
              return utils.cache.Reflect.get(target, key)
            },
            apply: function (target, thisArg, args) {
              return utils.cache.Reflect
                .apply(target, thisArg, args)
                .then(res => {
                  if (res.brands)
                    res.brands = getBrands()

                  /** We need to copy over all the values or Shared and Service workers
                   *  won't have the copy for some reason.
                   */
                  if (res.fullVersionList)
                    res.fullVersionList = getFullVersionList()

                  if (res.uaFullVersion)
                    res.uaFullVersion = uaFullVersion;

                  /** Use the extended version */
                  if (res.platform)
                    res.platform = platformExtended;

                  if (res.architecture)
                    res.architecture = architecture;

                  if (res.bitness)
                    res.bitness = bitness;

                  if (res.platformVersion)
                    res.platformVersion = platformVersion;

                  return res;
                })
            }
          }
        )
      },
      {
        brands,
        fullVersionList,
        userAgent: uap.ua,
        architecture,
        bitness,
        platform,
        platformExtended,
        platformVersion
      }
    )

    helper(page).onNewWorkerSession(async session => {
      await Promise.all([
        session.send('Emulation.setUserAgentOverride', override),
        session.send('Network.setUserAgentOverride', override)
      ])
    })

    await Promise.all([
      client.send('Emulation.setUserAgentOverride', override),
      client.send('Network.setUserAgentOverride', override)
    ])
  }
}

const defaultExport = opts => new Plugin(opts)

module.exports = defaultExport



/**
 * Generates the greased (fake) brand/version pair using the given seed.
 * Mimics Chromium’s approach using a fixed list of grease characters and versions.
 *
 * @param {number} seed - The major version number as a seed.
 * @param {string} [outputVersionType='major'] - (Unused here, but could be "full" to adjust formatting.)
 * @returns {{brand: string, version: string}}
 */
function getGreasedUserAgentBrandVersion(seed, outputVersionType = 'major') {
  const greaseyChars = [" ", "(", ":", "-", ".", "/", ")", ";", "=", "?", "_"];
  const greasedVersions = ["8", "99", "24"];
  // Pick two characters from the greaseyChars array based on the seed.
  const char1 = greaseyChars[seed % greaseyChars.length];
  const char2 = greaseyChars[(seed + 1) % greaseyChars.length];
  // Construct the fake brand string.
  const greasedBrand = `Not${char1}A${char2}Brand`;
  // Use the seed to pick one of the fixed version numbers.
  const version = greasedVersions[seed % greasedVersions.length];
  return { brand: greasedBrand, version };
}

/**
 * Shuffles a list of brand/version pairs using a fixed permutation determined by the seed.
 *
 * @param {Array<Object>} brandList - Array of brand/version objects.
 * @param {number} seed - The major version number as a seed.
 * @returns {Array<Object>} - The shuffled brand list.
 */
function shuffleBrandList(brandList, seed) {
  // For three elements, there are 6 possible orders.
  const orders = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0]
  ];
  const order = orders[seed % orders.length];
  const shuffled = [];
  for (let i = 0; i < order.length; i++) {
    shuffled[order[i]] = brandList[i];
  }
  return shuffled;
}
