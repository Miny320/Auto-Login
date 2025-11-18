'use strict'

const { PuppeteerExtraPlugin } = require('puppeteer-extra-plugin')

const { name } = require('../_utils/name')
const helper = require('../replicate-to-worker/helper')

/**
 * Create the safe area to hide utils in window
 */
class Plugin extends PuppeteerExtraPlugin {
  constructor(opts = {}) {
    super(opts)
  }

  get name() {
    return 'stealth/evasions/safe.area-hider'
  }

  async createSafeArea(page) {
    await helper(page).evalulateOn(['NewWorker'], () => {
      self.eba = "LaLu";
    })
    await helper(page).evalulateOn(
      ['NewDocument', 'NewWorker'],
      (utils, { name }) => {
        const safeArea = utils.safeArea()

        safeArea.hiddenKeys = [...safeArea.hiddenKeys ?? [], name]

        const safeAreaHandler = {
          // Make toString() native
          get(target, key) {
            return Reflect.get(target, key)
          },
          apply: function (target, thisArg, args) {
            const result = utils.cache.Reflect.apply(target, thisArg, args)

            if (utils.cache.Array.isArray(result))
              return utils.cache.Array.filter(result, n => !utils.cache.Array.includes(safeArea.hiddenKeys, n))

            if (!result)
              return result;

            for (let key of safeArea.hiddenKeys)
              delete result[key]

            return result;
          }
        }

        utils.replaceWithProxy(Object, 'getOwnPropertyDescriptors', safeAreaHandler)
        utils.replaceWithProxy(Object, 'getOwnPropertyNames', safeAreaHandler)
      }, { name })
  }

  async onPageCreated(page) {
    await this.createSafeArea(page)
  }
}

module.exports = function () {
  return new Plugin()
}