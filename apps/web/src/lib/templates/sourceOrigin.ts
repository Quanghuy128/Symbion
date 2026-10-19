import { USER_SOURCE_ID_RE } from "@symbion/core";
import type { TemplateListItem } from "@/data/templates/manifest";

/**
 * isUnverifiedItem — true for items from a user-added source. The daemon
 * stamps `authorOrigin`; the id-shape check is a fail-safe in case the origin
 * is ever missing (the web never ASSERTS trust, it only fails closed).
 */
export function isUnverifiedItem(item: Pick<TemplateListItem, "authorId" | "authorOrigin">): boolean {
  return item.authorOrigin === "user" || USER_SOURCE_ID_RE.test(item.authorId);
}
