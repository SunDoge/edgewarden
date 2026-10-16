/** Management roles do not implicitly grant access to vault contents. */
export function canManageOrganizationMembers(role: string): boolean {
  return role === "owner" || role === "admin";
}

export function canManageOrganizationCollections(member: {
  role: string;
  accessAll: boolean;
}): boolean {
  // Per-collection management grants are not supported yet. A restricted
  // manager may use assigned items, but cannot administer collection structure.
  return (
    canManageOrganizationMembers(member.role) ||
    (member.role === "manager" && member.accessAll)
  );
}
