export type RegistryItemRef = {
  namespace: string;
  name: string;
  id: string;
};

const itemRefPattern = /^(?<namespace>@[a-z0-9][a-z0-9-]*)\/(?<name>[a-z0-9][a-z0-9-]*)$/;

export function parseItemRef(value: string): RegistryItemRef | undefined {
  const match = value.match(itemRefPattern);

  if (!match?.groups) {
    return undefined;
  }

  const namespace = match.groups.namespace;
  const name = match.groups.name;

  return {
    namespace,
    name,
    id: `${namespace}/${name}`
  };
}

export function isRegistryRef(value: string): boolean {
  return parseItemRef(value) !== undefined;
}
