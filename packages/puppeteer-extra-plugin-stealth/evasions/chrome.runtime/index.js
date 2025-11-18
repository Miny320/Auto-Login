'use strict'

const { PuppeteerExtraPlugin } = require('puppeteer-extra-plugin')

const withUtils = require('../_utils/withUtils')

const STATIC_DATA = require('./staticData.json')

/**
 * Mock the `chrome.runtime` object if not available (e.g. when running headless) and on a secure site.
 */
/** Runtime is not leaked anymore so delete it */
class Plugin extends PuppeteerExtraPlugin {
  constructor(opts = {}) {
    super(opts)
  }

  get name() {
    return 'stealth/evasions/chrome.runtime'
  }

  async onPageCreated(page) {
    await page.evaluateOnNewDocument(() => {
      delete chrome.runtime
    })
  }
}

module.exports = function (pluginConfig) {
  return new Plugin(pluginConfig)
}
