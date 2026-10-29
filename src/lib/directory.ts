import type { WaContact, WaGroup } from "./types";

/**
 * Cópia mais recente dos grupos e contatos do WhatsApp, usada para resolver as regras
 * automáticas das listas fora dos componentes (ex.: no motor de campanhas).
 */
export interface Directory {
  groups: WaGroup[];
  contacts: WaContact[];
  groupsLoaded: boolean;
  contactsLoaded: boolean;
}

const directory: Directory = { groups: [], contacts: [], groupsLoaded: false, contactsLoaded: false };

export function setDirectoryGroups(groups: WaGroup[]) {
  directory.groups = groups;
  directory.groupsLoaded = true;
}

export function setDirectoryContacts(contacts: WaContact[]) {
  directory.contacts = contacts;
  directory.contactsLoaded = true;
}

export function getDirectory(): Directory {
  return directory;
}
