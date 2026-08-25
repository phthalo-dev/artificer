export type DeferredToolCatalog = {
  size: number;
  has(name: string): boolean;
};

export function emptyDeferredCatalog(): DeferredToolCatalog {
  return {
    size: 0,
    has() {
      return false;
    },
  };
}
