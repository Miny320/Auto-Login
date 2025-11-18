const { PuppeteerExtraPlugin } = require("puppeteer-extra-plugin");

/**
 * Create the safe area to prevent utils initializataion all times
 */
class Plugin extends PuppeteerExtraPlugin {
  constructor(opts = {}) {
    super(opts);
  }

  get name() {
    return "stealth/evasions/replicate-to-worker";
  }

  catchError = (err) => { };

  async interceptSession(page) {
    let session = await page.createCDPSession();

    const browserTargetId = page
      ?.browser()
      ?.targets()
      ?.find((target) => target.type() === "browser")?._targetId;

    const { sessionId: browserSessionId } = await session.send("Target.attachToTarget", {
      targetId: browserTargetId,
      flatten: true,
    });

    let browserSession = session?.connection()?.session(browserSessionId);

    await browserSession
      ?.send("Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: true,
        filter: [{ type: "shared_worker", exclude: false }],
      })
      .catch(this.catchError);

    await session
      .send("Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: true,
        filter: [
          { type: "worker", exclude: false },
          { type: "service_worker", exclude: false },
        ],
      })
      .catch(this.catchError);

    const onAttachedToTarget =
      (parentSession) =>
        async ({ sessionId, targetInfo: { type, url } }) => {
          const connection = parentSession.connection();

          const newSession = connection?.session(sessionId);

          const resume = async () => {
            await newSession?.send("Runtime.runIfWaitingForDebugger").catch(this.catchError);
          };

          if (!type.includes("worker")) return await resume();

          await Promise.all([
            newSession?.send("Debugger.enable"),
            newSession?.send("Debugger.setBreakpointByUrl", {
              lineNumber: 0,
              url,
            }),
            resume(),
          ]).catch(this.catchError);

          newSession?.once("Debugger.paused", async () => {
            await newSession.send("Runtime.enable").catch(this.catchError);

            await newSession
              .send("Runtime.evaluate", {
                expression: page.intercepts.join("\n"),
              })
              .catch(this.catchError);

            const callbacks = page.callbacks ?? [];

            await Promise.all(callbacks.map(async (cb) => await cb(newSession))).catch(
              this.catchError
            );

            await Promise.all([
              newSession.send("Debugger.resume"),
              newSession.send("Debugger.disable"),
              resume(),
            ]).catch(this.catchError);
          });
        };

    browserSession?.on("Target.attachedToTarget", onAttachedToTarget(browserSession));
    session.on("Target.attachedToTarget", onAttachedToTarget(session));

    /** Do some clean up */
    page.on("close", () => {
      page.intercepts = [];
      page.callbacks = [];

      browserSession?.removeAllListeners();
      session.removeAllListeners();
      session = null;
      browserSession = null;
    });
  }

  async interceptWorker(page) {
    page.intercepts = [];
    await this.interceptSession(page).catch(this.catchError);
  }

  async onPageCreated(page) {
    await this.interceptWorker(page);
  }
}

module.exports = function () {
  return new Plugin();
};
