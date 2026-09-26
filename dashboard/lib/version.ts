/** Baked into the bundle at build time; the running server may be newer. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "dev";
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || "local";
