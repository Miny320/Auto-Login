'use strict'

const { PuppeteerExtraPlugin } = require('puppeteer-extra-plugin')
const helper = require('../replicate-to-worker/helper')

/**
 * Fix WebGL Vendor/Renderer being set to Google in headless mode
 *
 * Example data (Apple Retina MBP 13): {vendor: "Intel Inc.", renderer: "Intel(R) Iris(TM) Graphics 6100"}
 *
 * @param {Object} [opts] - Options
 * @param {string} [opts.vendor] - The vendor string to use (default: `Intel Inc.`)
 * @param {string} [opts.renderer] - The renderer string (default: `Intel Iris OpenGL Engine`)
 */
class Plugin extends PuppeteerExtraPlugin {
  constructor(opts = {}) {
    super(opts);

    /** Set these for Mac OS */
    if (process.platform === 'darwin') {
      opts.vendor = 'Google Inc. (Apple)'
      opts.renderer = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Max, Unspecified Version)'
    }
  }

  get name() {
    return 'stealth/evasions/webgl.vendor'
  }

  /* global WebGLRenderingContext WebGL2RenderingContext */
  async onPageCreated(page) {
    await helper(page).evalulateOn(
      ['NewDocument', 'NewWorker'],
      (utils, opts) => {
        const getParameterProxyHandler = {
          apply: function (target, ctx, args) {
            const param = (args || [])[0]
            const result = utils.cache.Reflect.apply(target, ctx, args)
            // UNMASKED_VENDOR_WEBGL
            if (param === 37445) {
              return opts.vendor || 'Google Inc. (Intel)' // default in headless: Google Inc.
            }
            // UNMASKED_RENDERER_WEBGL
            if (param === 37446) {
              return opts.renderer || 'ANGLE (Intel, Intel(R) HD Graphics 620 (0x00005916) Direct3D11 vs_5_0 ps_5_0, D3D11)' // default in headless: Google SwiftShader
            }
            return result
          }
        }

        // There's more than one WebGL rendering context
        // https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext#Browser_compatibility
        // To find out the original values here: Object.getOwnPropertyDescriptors(WebGLRenderingContext.prototype.getParameter)
        const addProxy = (obj, propName) => {
          utils.replaceWithProxy(obj, propName, getParameterProxyHandler)
        }
        // For whatever weird reason loops don't play nice with Object.defineProperty, here's the next best thing:
        addProxy(WebGLRenderingContext.prototype, 'getParameter')
        addProxy(WebGL2RenderingContext.prototype, 'getParameter')
      }, this.opts)
  }
}

module.exports = function (pluginConfig) {
  return new Plugin(pluginConfig)
}
