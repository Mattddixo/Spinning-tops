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
      // Only what the app uses: where('key', beginsWith(prefix)), limit, cursor.
      query: () => {
        let prefix = '';
        let limit = 100;
        let offset = 0;
        const builder = {
          where: (_property: 'key', clause: { condition: string; values: string[] }) => {
            if (clause.condition !== 'BEGINS_WITH') throw new Error(`memoryKvs: unsupported condition ${clause.condition}`);
            prefix = clause.values[0];
            return builder;
          },
          limit: (n: number) => {
            limit = n;
            return builder;
          },
          cursor: (c: string) => {
            offset = Number(c);
            return builder;
          },
          getMany: async () => {
            const keys = [...values.keys()].filter((k) => k.startsWith(prefix)).sort();
            const page = keys.slice(offset, offset + limit);
            const next = offset + limit < keys.length ? String(offset + limit) : undefined;
            return { results: page.map((key) => ({ key, value: clone(values.get(key)) })), nextCursor: next };
          },
        };
        return builder;
      },
      batchGet: async (items: Array<{ key: string }>) => ({
        successfulKeys: items.filter((i) => values.has(i.key)).map((i) => ({ key: i.key, value: clone(values.get(i.key)) })),
        failedKeys: [],
      }),
    },
  };
}
