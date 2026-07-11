/* eslint-disable @typescript-eslint/no-unused-vars -- D1 mock matches the production binding signature. */
export const env = {
  DB: {
    prepare(_query) {
      return {
        bind(..._args) {
          return {
            async all() { return []; },
            async first() { return null; },
            async run() { return { success: true }; }
          };
        }
      };
    }
  }
};

export function getCloudflareContext() {
  return { env };
}
