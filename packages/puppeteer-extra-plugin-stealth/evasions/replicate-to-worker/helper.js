const withUtils = require("../_utils/withUtils")
const utils = require("../_utils/index")
const { name } = require("../_utils/name")

const typeHandlers = {
  NewDocument: page => withUtils(page).evaluateOnNewDocument,
  NewWorker: page => async (mainFunction, ...args) => {
    const originalFunction = ({ _utilsFns, _mainFunction, safeAreaKey }, ..._args) => {
      let utils = {}

      const materialize = (code) =>
        Function(`
          const utils = this;
          return ${code}
        `).bind(utils)()

      if (!self[safeAreaKey]) {
        Object
          .entries(_utilsFns)
          .forEach(([key, value]) => {
            utils[key] = materialize(value)
          })

        Object.defineProperty(self, safeAreaKey, {
          value: { utils },
          enumerable: false
        })

        utils.safeAreaKey = () => safeAreaKey

        utils.safeArea = () => self[safeAreaKey]

        utils.init()
      } else {
        utils = self[safeAreaKey].utils;
      }

      const mainFunction = materialize(_mainFunction)

      return mainFunction(utils, ..._args)
    }

    const jsParams = JSON.stringify([
      {
        _utilsFns: utils.stringifyFns(utils),
        _mainFunction: mainFunction.toString(),
        safeAreaKey: name
      },
      ...args || []
    ])

    const fnSource = `
      return () => {
        try {
          const fn = ${originalFunction}
          const params = ${jsParams}

          fn(...params);
        } catch(err){}
      }
    `

    const prepared = Function(fnSource)()

    const fn = `
      (() => {
        const fn = ${prepared}
        fn();
      })();
    `

    page.intercepts = page.intercepts ?? []
    page.intercepts.push(fn)
  }
}

/**
 * Wrap a page with utilities.
 *
 * @param {Puppeteer.Page} page
 */
module.exports = page => ({
  /**
  * Prepare the callback to execute later
  */
  evalulateOn: async (types, ...args) => {
    const promises = types.map(type =>
      typeHandlers[type](page).apply(this, args)
    )

    return Promise.allSettled(promises)
  },
  onNewWorkerSession: callback => {
    if (!page.callbacks)
      page.callbacks = []

    page.callbacks.push(callback)
  }
})