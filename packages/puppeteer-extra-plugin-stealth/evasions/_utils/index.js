/**
 * A set of shared utility functions specifically for the purpose of modifying native browser APIs without leaving traces.
 *
 * Meant to be passed down in puppeteer and used in the context of the page (everything in here runs in NodeJS as well as a browser).
 *
 * Note: If for whatever reason you need to use this outside of `puppeteer-extra`:
 * Just remove the `module.exports` statement at the very bottom, the rest can be copy pasted into any browser context.
 *
 * Alternatively take a look at the `extract-stealth-evasions` package to create a finished bundle which includes these utilities.
 *
 */
const utils = {}

/** !!!!!!!!IMPORTANT!!!!!! */
/** NOTE: safeArea is defined on the fly in evaluateOnNewDocument inside of withUtils.js
 * 
 */
utils.init = () => {
  utils.preloadCache()
  utils.saveLocation()
  utils.storageToString()
  utils.toStringProxy()
  utils.proxyHiddenKey()
}

utils.storageToString = () => {
  const safeArea = utils.safeArea()
  safeArea.toString = []
}

utils.proxyHiddenKey = () => {
  const safeArea = utils.safeArea()
  const hiddenKey = utils.safeAreaKey() + ':proxy'
  safeArea.hiddenKeys = [...safeArea.hiddenKeys ?? [], hiddenKey]
}

utils.protectCallback = (obj, propName) => {
  const hiddenKey = utils.safeAreaKey() + ':proxy'

  if (!utils.cache.Object.hasOwn(obj, hiddenKey))
    utils.cache.Object.defineProperty(obj, hiddenKey, {
      value: {},
      enumerable: false
    })

  if (!utils.cache.Object.hasOwn(obj[hiddenKey], propName))
    obj[hiddenKey][propName] = { calls: 0, total: 0 }

  obj[hiddenKey][propName].total++;

  return callback => function safeCallback() {
    const context = obj[hiddenKey][propName]

    const { sanitize, before, after } = utils.prepareThrow({ context })

    if (context.calls === 0)
      before()

    const doCall = () => {
      // Forward the call to the defined proxy handler
      const result = utils.cache.Reflect.apply(callback, this, arguments || []);
      context.calls--;

      if (context.calls == 0)
        after()

      return result;
    }

    const verifier = substring => ln =>
      utils.cache.String.includes(ln, substring) &&
      utils.cache.String.includes(ln, ' at ')

    const processError = err => {
      const lines =
        utils.cache.Array.slice(
          utils.cache.String.split(err.stack ?? '', "\n"),
          1
        )

      const pos = utils.cache.Array.findIndex(lines, verifier('safeCallback'))
      const first = utils.cache.Array.findIndex(lines, verifier(':'))
      const qty = pos - first + 1

      return { qty, pos }
    }

    const catchError = err => {
      // Stack traces differ per browser, we only support chromium based ones currently
      if (!err || !err.stack || !utils.cache.String.includes(err.stack, ' at ')) {
        throw err
      }

      const { pos, qty } = processError(err)

      // Blacklist the stack equivalent of current call &
      // Re-throw our now sanitized error
      sanitize({
        error: err,
        pos,
        qty,
        lastCall: context.calls-- === 1
      })
    }

    if (++context.calls != context.total)
      return doCall()

    try {
      return doCall()
    } catch (err) {
      while (context.calls > 0)
        catchError(err)

      throw err;
    }
  }
}

/**
 * Wraps a JS Proxy Handler and strips it's presence from error stacks, in case the traps throw.
 *
 * The presence of a JS Proxy can be revealed as it shows up in error stack traces.
 *
 * @param {object} handler - The JS Proxy handler to wrap
 */
utils.stripProxyFromErrors = ({ handler = {}, intermediate }, obj, propName) => {
  const handlerSetPrototypeOf = handler.setPrototypeOf

  const newHandler = {
    setPrototypeOf: function (target, proto) {
      const { proxyObj } = intermediate

      if (proto === null)
        throw new utils.cache.TypeError('Cannot convert object to primitive value')

      if (proto === proxyObj)
        throw new utils.cache.TypeError('Cyclic __proto__ value')

      let prototypeOf = proto;
      while ((prototypeOf = utils.cache.Object.getPrototypeOf(prototypeOf)))
        if (prototypeOf === proxyObj)
          throw new utils.cache.TypeError('Cyclic __proto__ value')

      if (handlerSetPrototypeOf)
        return utils.cache.Reflect.call(handlerSetPrototypeOf, handler, target, proto)

      return utils.cache.Reflect.setPrototypeOf(target, proto)
    }
  }

  handler.setPrototypeOf = newHandler.setPrototypeOf

  const protectedCallback = utils.protectCallback(obj, propName)

  // We wrap each trap in the handler in a try/catch and modify the error stack if they throw
  const traps = utils.cache.Object.getOwnPropertyNames(handler)
  traps.forEach(trap => {
    newHandler[trap] = protectedCallback(handler[trap])
  })

  return newHandler
}

/**
 * Strip error lines from stack traces until (and including) a known line the stack.
 *
 * @param {object} err - The error to sanitize
 * @param {string} anchor - The string the anchor line starts with
 */
utils.stripErrorWithAnchor = (err, anchor) => {
  const stackArr = err.stack.split('\n')
  const anchorIndex = stackArr.findIndex(line => line.trim().startsWith(anchor))
  if (anchorIndex === -1) {
    return err // 404, anchor not found
  }
  // Strip everything from the top until we reach the anchor line (remove anchor line as well)
  // Note: We're keeping the 1st line (zero index) as it's unrelated (e.g. `TypeError`)
  stackArr.splice(1, anchorIndex)
  err.stack = stackArr.join('\n')
  return err
}

/**
 * Replace the property of an object in a stealthy way.
 *
 * Note: You also want to work on the prototype of an object most often,
 * as you'd otherwise leave traces (e.g. showing up in Object.getOwnPropertyNames(obj)).
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/defineProperty
 *
 * @example
 * replaceProperty(WebGLRenderingContext.prototype, 'getParameter', { value: "alice" })
 * // or
 * replaceProperty(Object.getPrototypeOf(navigator), 'languages', { get: () => ['en-US', 'en'] })
 *
 * @param {object} obj - The object which has the property to replace
 * @param {string} propName - The property name to replace
 * @param {object} descriptorOverrides - e.g. { value: "alice" }
 */
utils.replaceProperty = (obj, propName, descriptorOverrides = {}) => {
  return utils.cache.Object.defineProperty(obj, propName, {
    // Copy over the existing descriptors (writable, enumerable, configurable, etc)
    ...(utils.cache.Object.getOwnPropertyDescriptor(obj, propName) || {}),
    // Add our overrides (e.g. value, get())
    ...descriptorOverrides
  })
}

utils.saveLocation = () => {
  const safeArea = utils.safeArea()

  if (safeArea.location)
    return;

  safeArea.location = location.href
}

/**
 * Preload a cache of function copies and data.
 *
 * For a determined enough observer it would be possible to overwrite and sniff usage of functions
 * we use in our internal Proxies, to combat that we use a cached copy of those functions.
 *
 * Note: Whenever we add a `Function.prototype.toString` proxy we should preload the cache before,
 * by executing `utils.preloadCache()` before the proxy is applied (so we don't cause recursive lookups).
 *
 * This is evaluated once per execution context (e.g. window)
 */
utils.preloadCache = () => {
  if (utils.cache)
    return

  const prototypeFn = fn => (element, ...args) =>
    Reflect.apply(fn, element, args)

  const createCache = kclass => ({
    ...Object.fromEntries(
      Object
        .getOwnPropertyNames(kclass)
        .map(key => [key, kclass[key]])
    ),
    ...Object.fromEntries(
      Object
        .getOwnPropertyNames(kclass.prototype ?? {})
        .map(key => [key, prototypeFn(kclass.prototype[key])])
    )
  })

  const bind = Function.prototype.bind

  utils.cache = {
    /** Start: Used in our proxies */
    Reflect: {
      ...createCache(Reflect),
      bind: (target, context, ...preArgs) =>
        utils.cache.Reflect.apply(bind, target, [context, ...preArgs]),
      call: (target, context, ...args) =>
        utils.cache.Reflect.apply(target, context, args)
    },
    Array: createCache(Array),
    Object: createCache(Object),
    String: createCache(String),
    Error,
    TypeError,
    /** End: Used in our proxies */
    /* Start: Used in replicate-to-worker */
    fetch,
    location,
    URL,
    Blob,
    /* End: Used in replicate-to-worker */
    // Used in materializeFns
    Function,
    // Used in `makeNativeString`
    nativeToStringStr: Function.toString + '' // => `function toString() { [native code] }`
  }
}

/**
 * Utility function to generate a cross-browser `toString` result representing native code.
 *
 * There's small differences: Chromium uses a single line, whereas FF & Webkit uses multiline strings.
 * To future-proof this we use an existing native toString result as the basis.
 *
 * The only advantage we have over the other team is that our JS runs first, hence we cache the result
 * of the native toString result once, so they cannot spoof it afterwards and reveal that we're using it.
 *
 * @example
 * makeNativeString('foobar') // => `function foobar() { [native code] }`
 *
 * @param {string} [name] - Optional function name
 */
utils.makeNativeString = (name = '') => {
  return utils.cache.nativeToStringStr.replace('toString', name || '')
}

utils.toStringProxy = () => {
  const safeArea = utils.safeArea()

  let prototypeOf = {};
  let ourLastPrototypeOf
  while ((prototypeOf = utils.cache.Object.getPrototypeOf(prototypeOf)))
    ourLastPrototypeOf = prototypeOf

  const hiddenKey = utils.safeAreaKey() + ':proxy'

  const handler = {
    apply: function (target, ctx) {
      const itens = [...safeArea.toString]

      return (function intercept() {
        const { proxyObj, str } = itens.pop() ?? {}

        if (!proxyObj ||
          typeof ctx === 'undefined' || ctx === null)
          return utils.cache.Reflect.call(target, ctx)

        // `toString` targeted at our proxied Object detected
        if (ctx === proxyObj)
          // Return the toString representation of our original object if possible
          return str + '' || utils.makeNativeString(proxyObj.name)

        if (ctx === toStringProxy)
          return utils.makeNativeString('toString')

        let isSpecialCase = false;
        let prototypeOf = ctx;
        let lastPrototypeOf;
        while ((prototypeOf = utils.cache.Object.getPrototypeOf(prototypeOf))) {
          if (prototypeOf === proxyObj) {
            isSpecialCase = true
            break;
          }

          lastPrototypeOf = prototypeOf
        }

        if (isSpecialCase) {
          try {
            return utils.cache.Reflect.call(target, ctx)
          } catch (error) {
            const lines = utils.cache.String.split(error.stack ?? '', "\n")
            lines[1] = utils.cache.String.replace(lines[1], 'Object.', 'Function.')
            error.stack = utils.cache.Array.join(lines, "\n")
            throw error;
          }
        }

        const lastToString = lastPrototypeOf[hiddenKey]

        if (ourLastPrototypeOf !== lastPrototypeOf)
          return utils.cache.Reflect.call(lastToString, ctx)

        return intercept()
      })()
    }
  }

  const intermediate = {}
  const toStringProxy = new Proxy(
    Function.prototype.toString,
    utils.stripProxyFromErrors({ handler, intermediate }, Function.prototype, 'toString')
  )
  intermediate.proxyObj = toStringProxy

  utils.redirectToString(toStringProxy, Function.prototype.toString)

  utils.replaceProperty(Function.prototype, 'toString', {
    value: toStringProxy
  })

  utils.cache.Object.defineProperty(ourLastPrototypeOf, hiddenKey, {
    value: toStringProxy,
    enumerable: false
  })
}

/**
 * Helper function to modify the `toString()` result of the provided object.
 *
 * Note: Use `utils.redirectToString` instead when possible.
 *
 * There's a quirk in JS Proxies that will cause the `toString()` result to differ from the vanilla Object.
 * If no string is provided we will generate a `[native code]` thing based on the name of the property object.
 *
 * @example
 * patchToString(WebGLRenderingContext.prototype.getParameter, 'function getParameter() { [native code] }')
 *
 * @param {object} proxyObj - The object for which to modify the `toString()` representation
 * @param {string} str - Optional string used as a return value
 */
utils.patchToString = (proxyObj, str = '') => {
  const safeArea = utils.safeArea()
  safeArea.toString.push({ proxyObj, str })
}

/**
 * Make all nested functions of an object native.
 *
 * @param {object} obj
 */
utils.patchToStringNested = (obj = {}) => {
  return utils.execRecursively(obj, ['function'], utils.patchToString)
}

/**
 * Redirect toString requests from one object to another.
 *
 * @param {object} proxyObj - The object that toString will be called on
 * @param {object} obj - The object which toString result we wan to return
 */
utils.redirectToString = (proxyObj, obj) => {
  const fallback = () =>
    obj && obj.name
      ? utils.makeNativeString(obj.name)
      : utils.makeNativeString(proxyObj.name)

  // Return the toString representation of our original object if possible
  const str = obj + '' || fallback()
  utils.patchToString(proxyObj, str)
}

/**
 * All-in-one method to replace a property with a JS Proxy using the provided Proxy handler with traps.
 *
 * Will stealthify these aspects (strip error stack traces, redirect toString, etc).
 * Note: This is meant to modify native Browser APIs and works best with prototype objects.
 *
 * @example
 * replaceWithProxy(WebGLRenderingContext.prototype, 'getParameter', proxyHandler)
 *
 * @param {object} obj - The object which has the property to replace
 * @param {string} propName - The name of the property to replace
 * @param {object} handler - The JS Proxy handler to use
 */
utils.replaceWithProxy = (obj, propName, handler) => {
  const originalObj = obj[propName]

  const intermediate = {}
  const proxyObj = new Proxy(obj[propName], utils.stripProxyFromErrors({ handler, intermediate }, obj, propName))
  intermediate.proxyObj = proxyObj

  utils.replaceProperty(obj, propName, { value: proxyObj })
  utils.redirectToString(proxyObj, originalObj)

  return true
}
/**
 * All-in-one method to replace a getter with a JS Proxy using the provided Proxy handler with traps.
 *
 * @example
 * replaceGetterWithProxy(Object.getPrototypeOf(navigator), 'vendor', proxyHandler)
 *
 * @param {object} obj - The object which has the property to replace
 * @param {string} propName - The name of the property to replace
 * @param {object} handler - The JS Proxy handler to use
 */
utils.replaceGetterWithProxy = (obj, propName, handler) => {
  const fn = utils.cache.Object.getOwnPropertyDescriptor(obj, propName).get
  const fnStr = fn.toString() // special getter function string

  const intermediate = {}
  const proxyObj = new Proxy(fn, utils.stripProxyFromErrors({ handler, intermediate }, obj, propName))
  intermediate.proxyObj = proxyObj

  utils.replaceProperty(obj, propName, { get: proxyObj })
  utils.patchToString(proxyObj, fnStr)

  return true
}

/**
 * All-in-one method to replace a getter and/or setter. Functions get and set
 * of handler have one more argument that contains the native function.
 *
 * @example
 * replaceGetterSetter(HTMLIFrameElement.prototype, 'contentWindow', handler)
 *
 * @param {object} obj - The object which has the property to replace
 * @param {string} propName - The name of the property to replace
 * @param {object} handlerGetterSetter - The handler with get and/or set
 *                                     functions
 * @see https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object/defineProperty#description
 */
utils.replaceGetterSetter = (obj, propName, handlerGetterSetter) => {
  const ownPropertyDescriptor = utils.cache.Object.getOwnPropertyDescriptor(obj, propName)
  const handler = { ...ownPropertyDescriptor }

  if (handlerGetterSetter.get !== undefined) {
    const nativeFn = ownPropertyDescriptor.get
    handler.get = function () {
      return utils.cache.Reflect.call(handlerGetterSetter.get, this, utils.cache.Reflect.bind(nativeFn, this))
    }
    utils.redirectToString(handler.get, nativeFn)
  }

  if (handlerGetterSetter.set !== undefined) {
    const nativeFn = ownPropertyDescriptor.set
    handler.set = function (newValue) {
      utils.cache.Reflect.call(handlerGetterSetter.set, this, newValue, utils.cache.Reflect.bind(nativeFn, this))
    }
    utils.redirectToString(handler.set, nativeFn)
  }

  utils.cache.Object.defineProperty(obj, propName, handler)
}

/**
 * All-in-one method to mock a non-existing property with a JS Proxy using the provided Proxy handler with traps.
 *
 * Will stealthify these aspects (strip error stack traces, redirect toString, etc).
 *
 * @example
 * mockWithProxy(chrome.runtime, 'sendMessage', function sendMessage() {}, proxyHandler)
 *
 * @param {object} obj - The object which has the property to replace
 * @param {string} propName - The name of the property to replace or create
 * @param {object} pseudoTarget - The JS Proxy target to use as a basis
 * @param {object} handler - The JS Proxy handler to use
 */
utils.mockWithProxy = (obj, propName, pseudoTarget, handler) => {
  const intermediate = {}
  const proxyObj = new Proxy(pseudoTarget, utils.stripProxyFromErrors({ handler, intermediate }, obj, propName))
  intermediate.proxyObj = proxyObj

  utils.replaceProperty(obj, propName, { value: proxyObj })
  utils.patchToString(proxyObj)

  return true
}

/**
 * All-in-one method to create a new JS Proxy with stealth tweaks.
 *
 * This is meant to be used whenever we need a JS Proxy but don't want to replace or mock an existing known property.
 *
 * Will stealthify certain aspects of the Proxy (strip error stack traces, redirect toString, etc).
 *
 * @example
 * createProxy(navigator.mimeTypes.__proto__.namedItem, proxyHandler) // => Proxy
 *
 * @param {object} pseudoTarget - The JS Proxy target to use as a basis
 * @param {object} handler - The JS Proxy handler to use
 */
utils.createProxy = (pseudoTarget, handler) => {
  const intermediate = {}
  const proxyObj = new Proxy(pseudoTarget, utils.stripProxyFromErrors({ handler, intermediate }, pseudoTarget, 'mocked'))
  intermediate.proxyObj = proxyObj;
  utils.patchToString(proxyObj)

  return proxyObj
}

/**
 * Helper function to split a full path to an Object into the first part and property.
 *
 * @example
 * splitObjPath(`HTMLMediaElement.prototype.canPlayType`)
 * // => {objName: "HTMLMediaElement.prototype", propName: "canPlayType"}
 *
 * @param {string} objPath - The full path to an object as dot notation string
 */
utils.splitObjPath = objPath => ({
  // Remove last dot entry (property) ==> `HTMLMediaElement.prototype`
  objName: objPath.split('.').slice(0, -1).join('.'),
  // Extract last dot entry ==> `canPlayType`
  propName: objPath.split('.').slice(-1)[0]
})

/**
 * Traverse nested properties of an object recursively and apply the given function on a whitelist of value types.
 *
 * @param {object} obj
 * @param {array} typeFilter - e.g. `['function']`
 * @param {Function} fn - e.g. `utils.patchToString`
 */
utils.execRecursively = (obj = {}, typeFilter = [], fn) => {
  function recurse(obj) {
    for (const key in obj) {
      if (obj[key] === undefined) {
        continue
      }
      if (obj[key] && typeof obj[key] === 'object') {
        recurse(obj[key])
      } else {
        if (obj[key] && typeFilter.includes(typeof obj[key])) {
          utils.cache.Reflect.call(fn, this, obj[key])
        }
      }
    }
  }
  recurse(obj)
  return obj
}

/**
 * Everything we run through e.g. `page.evaluate` runs in the browser context, not the NodeJS one.
 * That means we cannot just use reference variables and functions from outside code, we need to pass everything as a parameter.
 *
 * Unfortunately the data we can pass is only allowed to be of primitive types, regular functions don't survive the built-in serialization process.
 * This utility function will take an object with functions and stringify them, so we can pass them down unharmed as strings.
 *
 * We use this to pass down our utility functions as well as any other functions (to be able to split up code better).
 *
 * @see utils.materializeFns
 *
 * @param {object} fnObj - An object containing functions as properties
 */
utils.stringifyFns = (fnObj = { hello: () => 'world' }) => {
  // Object.fromEntries() ponyfill (in 6 lines) - supported only in Node v12+, modern browsers are fine
  // https://github.com/feross/fromentries
  function fallback(iterable) {
    return [...iterable].reduce((obj, [key, val]) => {
      obj[key] = val
      return obj
    }, {})
  }

  const fromEntries =
    (utils.cache && utils.cache.Object && utils.cache.Object.fromEntries) ||
    Object.fromEntries ||
    fallback

  const entries = (utils.cache && utils.cache.Object && utils.cache.Object.entries) ||
    Object.entries

  return fromEntries(
    entries(fnObj)
      .filter(([_, value]) => typeof value === 'function')
      .map(([key, value]) => [key, value.toString()]) // eslint-disable-line no-eval
  )
}

/**
 * Utility function to reverse the process of `utils.stringifyFns`.
 * Will materialize an object with stringified functions (supports classic and fat arrow functions).
 *
 * @param {object} fnStrObj - An object containing stringified functions as properties
 */
utils.materializeFns = (fnStrObj = { hello: "() => 'world'" }) => {
  return utils.cache.Object.fromEntries(
    utils.cache.Object.entries(fnStrObj).map(([key, value]) => {
      const fn = utils.cache.Function(`return ${value}`)()

      return [key, fn]
    })
  )
}

// Proxy handler templates for re-usability
utils.makeHandler = () => ({
  // Used by simple `navigator` getter evasions
  getterValue: value => ({
    apply(target, ctx, args) {
      // Let's fetch the value first, to trigger and escalate potential errors
      // Illegal invocations like `navigator.__proto__.vendor` will throw here
      utils.cache.Reflect.apply(...arguments)
      return value
    }
  })
})

/**
 * Compare two arrays.
 *
 * @param {array} array1 - First array
 * @param {array} array2 - Second array
 */
utils.arrayEquals = (array1, array2) => {
  if (array1.length !== array2.length) {
    return false
  }
  for (let i = 0; i < array1.length; ++i) {
    if (array1[i] !== array2[i]) {
      return false
    }
  }
  return true
}

/**
 * Cache the method return according to its arguments.
 *
 * @param {Function} fn - A function that will be cached
 */
utils.memoize = fn => {
  const cache = []
  return function (...args) {
    if (!cache.some(c => utils.arrayEquals(c.key, args))) {
      cache.push({ key: args, value: utils.cache.Reflect.apply(fn, this, args) })
    }
    return cache.find(c => utils.arrayEquals(c.key, args)).value
  }
}

utils.prepareThrow = ({ runBefore = false, context = {} } = { context: {} }) => {
  const before = () => {
    const stackTraceLimitBk = utils.cache.Object.getOwnPropertyDescriptor(utils.cache.Error, 'stackTraceLimit')
    context.stackTraceLimitBk = stackTraceLimitBk
    utils.cache.Object.defineProperty(utils.cache.Error, 'stackTraceLimit', { value: Infinity })
  }

  const after = () => {
    if (context.stackTraceLimitBk)
      utils.cache.Object.defineProperty(utils.cache.Error, 'stackTraceLimit', context.stackTraceLimitBk)
    else
      delete utils.cache.Error.stackTraceLimit
  }

  const getMaxQty = () =>
    context.stackTraceLimitBk ?
      context.stackTraceLimitBk.value :
      Infinity

  const sanitize = ({
    error,
    pos = 0,
    qty = 0,
    maxQty,
    lastCall = true
  }) => {
    pos += 1;

    const lines = utils.cache.String.split(error.stack ?? '', "\n")
    utils.cache.Array.splice(lines, pos - qty + 1, qty)

    const filteredLines =
      utils.cache.Array.slice(
        lines,
        0,
        maxQty ? //If has seted, use it
          maxQty + 1 : //+ 1 due the first line is the Error itself
          lastCall ? //If is not seted and is last call, 
            getMaxQty() + 1 : //use getMaxQty()
            Infinity //else Infinity (in process)
      )

    error.stack = utils.cache.Array.join(filteredLines, "\n")

    if (lastCall)
      after()

    return error
  }

  if (runBefore) {
    before()
    return { sanitize, after }
  }

  return { before, after, sanitize }
}

// --
// Stuff starting below this line is NodeJS specific.
// --
module.exports = utils