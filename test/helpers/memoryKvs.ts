/** In-memory stand-in for @forge/kvs used by unit tests. */
export function createMemoryKvs() {
  const values = new Map<string, unknown>();
  const secrets = new Map<string, unknown>();
  const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  return {
    values,
    secrets,
    kvs: {
      get: async (key: string) => clone(values.get(key)),
      set: async (key: string, value: unknown) => {
        values.set(key, clone(value));
      },
      delete: async (key: string) => {
        values.delete(key);
      },
      getSecret: async (key: string) => clone(secrets.get(key)),
      setSecret: async (key: string, value: unknown) => {
        secrets.set(key, clone(value));
      },
      deleteSecret: async (key: string) => {
        secrets.delete(key);
      },
      batchGet: async (items: Array<{ key: string }>) => ({
        successfulKeys: items.filter((i) => values.has(i.key)).map((i) => ({ key: i.key, value: clone(values.get(i.key)) })),
        failedKeys: [],
      }),
    },
  };
}
