'use strict'

const { PuppeteerExtraPlugin } = require('puppeteer-extra-plugin')
const helper = require('../replicate-to-worker/helper')

// This plugin not only replaces the navigator.languages getter,
// but also sets up additional properties (like navigator.language)
// and sends DevTools protocol commands to override locale and HTTP headers.
class Plugin extends PuppeteerExtraPlugin {
  constructor(opts = {}) {
    super(opts)
  }

  get name() {
    return 'stealth/evasions/navigator.languages'
  }

  get defaults() {
    return {
      language: '',                // Custom value for navigator.language
      internationalization: '',    // Custom locale override for emulation
      languages: []                // Array override; empty here so that user values replace defaults
    }
  }

  async onPageCreated(page) {
    // Determine languages and locale values: if not provided, fallback to defaults.
    const languages = this.opts.languages.length
      ? this.opts.languages
      : ['en-US', 'en']

    const language = this.opts.language.length
      ? this.opts.language
      : 'en-US'

    const internationalization = this.opts.internationalization.length
      ? this.opts.internationalization
      : 'en-US'

    // Obtain the underlying CDP client from the page.
    const client =
      typeof page._client === 'function' ? page._client() : page._client

    // For any new worker sessions, use the helper to run code there.
    helper(page).onNewWorkerSession(async session => {
      await Promise.all([
        session.send('Emulation.setLocaleOverride', {
          locale: internationalization,
        }),
        session.send('Network.setExtraHTTPHeaders', {
          headers: {
            'Accept-Language': languages.join(',') + ';q=0.9'
          },
        })
      ])
    })

    // For the main page session, send CDP commands to set locale and headers.
    await Promise.all([
      client.send('Network.setExtraHTTPHeaders', {
        headers: {
          'Accept-Language': languages.join(',') + ';q=0.9'
        },
      }),

      // This call is getting triggered twice, so we add a catch
      client.send('Emulation.setLocaleOverride', {
        locale: internationalization,
      })
        .catch(err => {
          const errorMessage = err?.message || String(err);

          // Check if it's the "Another locale override" message
          if (!/Another locale override is already in effect/i.test(errorMessage)) {
            console.error(err);
          }
        }),

      // In addition, inject a script (for both new documents and workers)
      // that replaces the navigator.languages and navigator.language getters.
      helper(page).evalulateOn(
        ['NewDocument', 'NewWorker'],
        (utils, { languages, language }) => {
          // Replace the getter for navigator.languages with a proxy that returns a frozen copy.
          utils.replaceGetterWithProxy(
            utils.cache.Object.getPrototypeOf(navigator),
            'languages',
            utils.makeHandler().getterValue(Object.freeze([...languages])),
          )

          // Also replace the getter for navigator.language.
          utils.replaceGetterWithProxy(
            utils.cache.Object.getPrototypeOf(navigator),
            'language',
            utils.makeHandler().getterValue(language),
          )
        },
        {
          languages,
          language
        }
      )
    ])
  }
}

module.exports = function (pluginConfig) {
  return new Plugin(pluginConfig)
}
