import winston from "winston";
import stringify from "json-stringify-safe";

const { timestamp, colorize, errors, printf } = winston.format;

const format = winston.format.combine(
  winston.format((info) => ({ ...info, level: info.level.toUpperCase() }))(),
  colorize(),
  errors({ stack: true }),
  timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  printf(({ timestamp, level, message, stack, ...metadata }) => {
    // Start with timestamp and level
    let log = `${timestamp} [${level}]: ${message}`;

    // If there's a stack trace, append it on a new line
    if (stack) {
      log += `\n\u001b[90m${stack}\u001b[0m`;
    }

    // If there's metadata, append it as a JSON string
    if (Object.keys(metadata).length > 0) {
      log += ` ${stringify(metadata)}`;
    }

    return log;
  })
);

const logger = winston.createLogger({
  level: "info",
  transports: [new winston.transports.Console({ format })],
});

export default logger;
