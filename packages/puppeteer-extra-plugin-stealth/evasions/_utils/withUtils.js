// Import the unique safe area key from the name module.
// This key will be used to store and later retrieve the utils on the global object.
const { name } = require('./name')

// Import the utils object containing all the utility functions.
const utils = require('./index')

/**
 * Wrap a page with utilities.
 *
 * @param {Puppeteer.Page} page - The Puppeteer page instance to augment.
 */
module.exports = page => ({
  /**
   * A replacement for `page.evaluate` that preloads the utilities.
   *
   * @param {Function} mainFunction - The function to run in the browser context.
   * @param {...any} args - Additional arguments to pass to mainFunction.
   */
  evaluate: async function (mainFunction, ...args) {
    return page.evaluate(
      // This function runs in the browser context.
      // It receives an object with _mainFunction (as a string) and safeAreaKey.
      // Additional arguments are collected in _args.
      ({ _mainFunction, safeAreaKey }, ..._args) => {
        // Retrieve the utils object from the safe area stored on window.
        // The safe area was created using the safeAreaKey.
        const utils = window[safeAreaKey].utils


        // const materialize = (code) =>
        //   Function(`
        //     const utils = this;
        //     return ${code}
        //   `).bind(utils)();

        // Materialize (convert from string to executable code) the mainFunction.
        // 'materialize' is assumed to be available in the browser context.
        const mainFunction = materialize(_mainFunction)

        // Execute the materialized mainFunction with the utils object as its first argument,
        // followed by any additional arguments.
        return mainFunction(utils, ..._args) // eslint-disable-line no-eval
      },
      {
        // Pass the mainFunction as a string.
        _mainFunction: mainFunction.toString(),
        // Pass the safe area key, which will be used to retrieve the stored utils.
        safeAreaKey: name
      },
      // Spread any extra arguments to page.evaluate.
      ...args || []
    )
  },

  /**
   * A replacement for `page.evaluateOnNewDocument` that preloads the utilities.
   * This runs before any other script on the page.
   *
   * @param {Function} mainFunction - The function to run in the browser context.
   * @param {...any} args - Additional arguments to pass to mainFunction.
   */
  evaluateOnNewDocument: async function (mainFunction, ...args) {
    return page.evaluateOnNewDocument(
      // This function is injected into the new document context.
      // It receives stringified utilities (_utilsFns), a stringified main function (_mainFunction), and safeAreaKey.
      ({ _utilsFns, _mainFunction, safeAreaKey }, ..._args) => {
        // Initialize an empty object to hold the utilities.
        let utils = {}

        // Define a helper that converts a code string into an executable function.
        // The Function constructor is used with a binding to the 'utils' object so that 'this' points to utils.
        const materialize = (code) =>
          Function(`
            const utils = this;
            return ${code}
          `).bind(utils)()

        // Check if the safe area (a hidden global storage) already exists on the window.
        if (!window[safeAreaKey]) {
          // If it does not exist, iterate over the stringified utilities.
          // For each entry, materialize it (convert it back to a function) and assign it to the local utils object.
          Object
            .entries(_utilsFns)
            .forEach(([key, value]) => {
              utils[key] = materialize(value)
            })

          // Create a non-enumerable property on window using the safeAreaKey,
          // storing an object that contains the utils.
          Object.defineProperty(window, safeAreaKey, {
            value: { utils },
            enumerable: false
          })

          // Define helper functions on utils:
          // safeAreaKey returns the key,
          // safeArea returns the safe area object from window.
          utils.safeAreaKey = () => safeAreaKey
          utils.safeArea = () => window[safeAreaKey]

          // Call utils.init() to perform any further initialization (e.g., caching native methods).
          utils.init()
        } else {
          // If the safe area already exists, simply retrieve the utils from it.
          utils = window[safeAreaKey].utils;
        }

        // Materialize the main function from its string representation.
        const mainFunction = materialize(_mainFunction)

        // Execute the materialized mainFunction with the utils object as the first argument,
        // followed by any additional arguments.
        return mainFunction(utils, ..._args) // eslint-disable-line no-eval
      },
      {
        // Pass the stringified utilities using utils.stringifyFns.
        _utilsFns: utils.stringifyFns(utils),
        // Pass the main function as a string.
        _mainFunction: mainFunction.toString(),
        // Pass the safe area key.
        safeAreaKey: name
      },
      // Spread any extra arguments to page.evaluateOnNewDocument.
      ...args || []
    )
  }
})
