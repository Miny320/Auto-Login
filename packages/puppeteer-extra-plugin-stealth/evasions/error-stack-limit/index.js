'use strict'

const { PuppeteerExtraPlugin } = require('puppeteer-extra-plugin')

const helper = require('../replicate-to-worker/helper')

/**
 * Create the safe area to prevent utils initializataion all times
 */
class Plugin extends PuppeteerExtraPlugin {
  constructor(opts = {}) {
    super(opts)
  }

  get name() {
    return 'stealth/evasions/error-stack-limit'
  }

  /** Replace the default `window.Error` class */
  async initialize(page) {
    await helper(page).evalulateOn(
      ['NewDocument', 'NewWorker'],
      (utils) => {
        function noop() { }
        utils.cache.Object.defineProperties(noop, utils.cache.Object.getOwnPropertyDescriptors(Error))
        utils.redirectToString(noop, Error)
        const InterceptedError = new Proxy(noop, {
          defineProperty(target, prop, descriptor) {
            const result = utils.cache.Reflect.defineProperty(target, prop, descriptor)
            if (result) {
              descriptor.configurable = true
              utils.cache.Reflect.defineProperty(utils.cache.Error, prop, descriptor)
              return true;
            }

            const { sanitize } = utils.prepareThrow({ runBefore: true })
            throw sanitize({
              error: new TypeError(`Cannot redefine property: ${prop}`),
              qty: 1
            })
          },
          deleteProperty(target, prop) {
            const result = utils.cache.Reflect.deleteProperty(target, prop)
            if (result) {
              utils.cache.Reflect.deleteProperty(utils.cache.Error, prop)
            }
            return result;
          },
          set(target, prop, value) {
            const result = utils.cache.Reflect.set(target, prop, value)
            if (result) {
              utils.cache.Reflect.set(utils.cache.Error, prop, value)
            }
            return result;
          },
          apply(target, _, args){
            const { sanitize } = utils.prepareThrow({ runBefore: true })
            const original = utils.cache.Error(...args)
            const sanitized = sanitize({ error: original, qty: 1 })
            const result = new target()
            const properties = utils.cache.Object.getOwnPropertyDescriptors(sanitized)
            properties.stack.get = utils.cache.Reflect.bind(properties.stack.get, sanitized)
            utils.cache.Object.defineProperties(result, properties)
            return result;
          },
          construct(target, args) {
            const { sanitize } = utils.prepareThrow({ runBefore: true })
            const original = new utils.cache.Error(...args)
            const sanitized = sanitize({ error: original, qty: 1 })
            const result = new target()
            const properties = utils.cache.Object.getOwnPropertyDescriptors(sanitized)
            properties.stack.get = utils.cache.Reflect.bind(properties.stack.get, sanitized)
            utils.cache.Object.defineProperties(result, properties)
            return result;
          }
        })
        utils.redirectToString(InterceptedError, Error)
        Error.prototype.constructor = InterceptedError
        Error = InterceptedError

        const derivated = [
          EvalError,
          RangeError,
          ReferenceError,
          SyntaxError,
          TypeError,
          URIError,
          AggregateError
        ]

        for (let error of derivated) {
          if (error)
            utils.cache.Object.setPrototypeOf(error, InterceptedError)
        }
      })
  }

  async onPageCreated(page) {
    await this.initialize(page)
  }
}

module.exports = function () {
  return new Plugin()
}