'use strict'

const { PuppeteerExtraPlugin } = require('puppeteer-extra-plugin')

const helper = require('../replicate-to-worker/helper')

/**
 * Set the hardwareConcurrency to 16 (optionally configurable with `hardwareConcurrency`)
 *
 * @see https://arh.antoinevastel.com/reports/stats/osName_hardwareConcurrency_report.html
 *
 * @param {Object} [opts] - Options
 * @param {number} [opts.hardwareConcurrency] - The value to use in `navigator.hardwareConcurrency` (default: `4`)
 */

class Plugin extends PuppeteerExtraPlugin {
  constructor(opts = {}) {
    super(opts)
  }

  get name() {
    return 'stealth/evasions/navigator.hardwareConcurrency'
  }

  get defaults() {
    return {
      hardwareConcurrency: 4
    }
  }

  async onPageCreated(page) {
    await helper(page).evalulateOn(
      ['NewDocument', 'NewWorker'],
      (utils, { opts }) => {
        utils.replaceGetterWithProxy(
          utils.cache.Object.getPrototypeOf(navigator),
          'hardwareConcurrency',
          utils.makeHandler().getterValue(opts.hardwareConcurrency)
        )
      },
      {
        opts: this.opts
      }
    )
  }
}

module.exports = function (pluginConfig) {
  return new Plugin(pluginConfig)
}
