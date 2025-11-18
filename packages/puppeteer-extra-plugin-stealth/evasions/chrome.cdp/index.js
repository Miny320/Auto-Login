'use strict'

const { PuppeteerExtraPlugin } = require('puppeteer-extra-plugin')
const helper = require('../replicate-to-worker/helper')

/**
 * Dont print objects in console
 */
class Plugin extends PuppeteerExtraPlugin {
  constructor(opts = {}) {
    super(opts)
  }

  get name() {
    return 'stealth/evasions/chrome.cdp'
  }

  async onPageCreated(page) {
    await helper(page).evalulateOn(
      ['NewDocument', 'NewWorker'],
      utils => {
        const noopFnProperty = () => ({
          get(target, key) {
            return utils.cache.Reflect.get(target, key)
          },
          apply: function (target, thisArg, args) {
            const toLog = utils.cache.Array.filter(args, arg =>
              utils.cache.Array.includes(['number', 'string'], typeof arg))

            return utils.cache.Reflect.apply(target, thisArg, toLog)
          }
        })

        const keys = ['debug', 'error', 'info', 'log', 'warn', 'dir', 'dirxml', 'table', 'trace', 'group', 'groupCollapsed', 'groupEnd', 'clear', 'count', 'countReset', 'assert', 'profile', 'profileEnd', 'time', 'timeLog', 'timeEnd', 'timeStamp', 'createTask']
          .filter(key => console[key])

        keys.forEach(key => {
          utils.replaceWithProxy(
            console,
            key,
            noopFnProperty()
          )
        })

        const contextHandler = {
          get(target, key) {
            return Reflect.get(target, key)
          },
          apply: function (target, thisArg, args) {
            const result = utils.cache.Reflect.apply(target, thisArg, args)

            keys.forEach(key => {
              utils.replaceWithProxy(
                result,
                key,
                noopFnProperty()
              )
            })

            return result
          }
        }

        utils.replaceWithProxy(
          console,
          'context',
          contextHandler
        )
      }
    )
  }
}

module.exports = function (pluginConfig) {
  return new Plugin(pluginConfig)
}