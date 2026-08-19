import { match } from "ts-pattern";
import { deriveAccountPasswordHash } from "./api-auth";
import {
  createOrganizationApi,
  createOrganizationCollectionApi,
  deleteOrganizationApi,
  deleteOrganizationCollectionApi,
  getOrganizationInviteeApi,
  inviteOrganizationMemberApi,
  listOrganizationCollectionsApi,
  listOrganizationMembersApi,
  listOrganizationsApi,
  removeOrganizationMemberApi,
  updateOrganizationApi,
  updateOrganizationCollectionApi,
  updateOrganizationMemberApi,
} from "./api-organizations";
import { encryptStr } from "./crypto";
import {
  createOrganizationMaterials,
  wrapOrganizationKey,
} from "./organization-crypto";
import type {
  MemberCollectionAccessEditor,
  OrganizationCollection,
  OrganizationMember,
  OrganizationRemoveTarget,
  OrganizationRenameTarget,
  OrganizationSummary,
} from "./organization-types";
import {
  getOrganizationKey,
  syncVaultData,
  vault,
} from "$lib/stores/vault.svelte";

type MemberRole = "admin" | "manager" | "member";

interface OrganizationManagerState {
  organizations: OrganizationSummary[];
  selected: OrganizationSummary | null;
  members: OrganizationMember[];
  collections: OrganizationCollection[];
  loading: boolean;
  busy: string;
  error: string;
  createOpen: boolean;
  organizationName: string;
  initialCollectionName: string;
  inviteEmail: string;
  inviteRole: MemberRole;
  inviteAccessAll: boolean;
  inviteCollectionIds: string[];
  editingMember: OrganizationMember | null;
  memberRole: MemberRole;
  memberAccessAll: boolean;
  memberCollectionAccess: Record<string, MemberCollectionAccessEditor>;
  collectionName: string;
  deletePassword: string;
  renameTarget: OrganizationRenameTarget | null;
  renameName: string;
  removeTarget: OrganizationRemoveTarget | null;
}

function errorMessage(value: unknown, fallback: string): string {
  return value instanceof Error ? value.message : fallback;
}

export function createOrganizationManager() {
  const state = $state<OrganizationManagerState>({
    organizations: [],
    selected: null,
    members: [],
    collections: [],
    loading: true,
    busy: "",
    error: "",
    createOpen: false,
    organizationName: "",
    initialCollectionName: "默认集合",
    inviteEmail: "",
    inviteRole: "member",
    inviteAccessAll: true,
    inviteCollectionIds: [],
    editingMember: null,
    memberRole: "member",
    memberAccessAll: true,
    memberCollectionAccess: {},
    collectionName: "",
    deletePassword: "",
    renameTarget: null,
    renameName: "",
    removeTarget: null,
  });

  function collectionsFor(organizationId: string) {
    return vault.collections.filter(
      (item) => item.organizationId === organizationId,
    );
  }

  async function loadSelected() {
    if (!state.selected) {
      state.members = [];
      state.collections = [];
      return;
    }
    const canManage = ["owner", "admin", "manager"].includes(
      state.selected.role,
    );
    const [collectionResult, memberResult] = await Promise.all([
      listOrganizationCollectionsApi(state.selected.id),
      canManage ? listOrganizationMembersApi(state.selected.id) : null,
    ]);
    state.collections = collectionResult.data;
    state.members = memberResult?.data ?? [];
  }

  async function load() {
    state.loading = true;
    try {
      state.organizations = (await listOrganizationsApi()).data ?? [];
      const selectedId = state.selected?.id;
      state.selected = selectedId
        ? (state.organizations.find((item) => item.id === selectedId) ??
          state.organizations[0] ??
          null)
        : (state.organizations[0] ?? null);
      await loadSelected();
    } catch (caught) {
      state.error = errorMessage(caught, "加载组织失败");
    } finally {
      state.loading = false;
    }
  }

  async function select(organization: OrganizationSummary) {
    state.selected = organization;
    await loadSelected();
  }

  async function create() {
    if (
      !vault.profile?.publicKey ||
      !state.organizationName.trim() ||
      !state.initialCollectionName.trim()
    )
      return;
    state.busy = "create";
    try {
      const materials = await createOrganizationMaterials(
        vault.profile.publicKey,
        state.initialCollectionName.trim(),
      );
      await createOrganizationApi({
        name: state.organizationName.trim(),
        collectionName: materials.encryptedCollectionName,
        key: materials.wrappedMemberKey,
        publicKey: materials.publicKey,
        encryptedPrivateKey: materials.encryptedPrivateKey,
      });
      state.createOpen = false;
      state.organizationName = "";
      await syncVaultData();
      await load();
    } catch (caught) {
      state.error = errorMessage(caught, "创建组织失败");
    } finally {
      state.busy = "";
    }
  }

  async function inviteMember() {
    if (!state.selected || !state.inviteEmail.trim()) return;
    const organizationKey = getOrganizationKey(state.selected.id);
    if (!organizationKey) {
      state.error = "组织密钥不可用，请重新同步并解锁";
      return;
    }
    state.busy = "invite";
    try {
      const invitee = await getOrganizationInviteeApi(
        state.selected.id,
        state.inviteEmail.trim(),
      );
      if (!state.inviteAccessAll && !state.inviteCollectionIds.length)
        throw new Error("受限成员至少需要选择一个集合");
      await inviteOrganizationMemberApi(state.selected.id, {
        email: invitee.email,
        role: state.inviteRole,
        accessAll: state.inviteAccessAll,
        collections: state.inviteAccessAll
          ? []
          : state.inviteCollectionIds.map((id) => ({
              id,
              readOnly: false,
              hidePasswords: false,
            })),
        key: await wrapOrganizationKey(organizationKey, invitee.publicKey),
      });
      state.inviteEmail = "";
      state.inviteAccessAll = true;
      state.inviteCollectionIds = [];
      state.members = (
        await listOrganizationMembersApi(state.selected.id)
      ).data;
    } catch (caught) {
      state.error = errorMessage(caught, "添加成员失败");
    } finally {
      state.busy = "";
    }
  }

  function editMember(member: OrganizationMember) {
    state.editingMember = member;
    state.memberRole = member.role === "owner" ? "admin" : member.role;
    state.memberAccessAll = Boolean(member.accessAll);
    state.memberCollectionAccess = Object.fromEntries(
      collectionsFor(state.selected?.id ?? "").map((collection) => {
        const current = member.collections.find(
          (item) => item.id === collection.id,
        );
        return [
          collection.id,
          {
            selected: Boolean(current),
            readOnly: Boolean(current?.readOnly),
            hidePasswords: Boolean(current?.hidePasswords),
          },
        ];
      }),
    );
  }

  async function saveMember() {
    if (!state.selected || !state.editingMember) return;
    const selectedCollections = Object.entries(state.memberCollectionAccess)
      .filter(([, access]) => access.selected)
      .map(([id, access]) => ({
        id,
        readOnly: access.readOnly,
        hidePasswords: access.hidePasswords,
      }));
    if (!state.memberAccessAll && !selectedCollections.length) {
      state.error = "受限成员至少需要选择一个集合";
      return;
    }
    state.busy = "member";
    try {
      await updateOrganizationMemberApi(
        state.selected.id,
        state.editingMember.id,
        {
          role: state.memberRole,
          accessAll: state.memberAccessAll,
          collections: state.memberAccessAll ? [] : selectedCollections,
        },
      );
      state.editingMember = null;
      state.members = (
        await listOrganizationMembersApi(state.selected.id)
      ).data;
      await syncVaultData();
    } catch (caught) {
      state.error = errorMessage(caught, "更新成员失败");
    } finally {
      state.busy = "";
    }
  }

  async function addCollection() {
    if (!state.selected || !state.collectionName.trim()) return;
    const organization = state.selected;
    const key = getOrganizationKey(organization.id);
    if (!key) return;
    state.busy = "collection";
    try {
      await createOrganizationCollectionApi(
        organization.id,
        await encryptStr(state.collectionName.trim(), key.encKey, key.macKey),
      );
      state.collectionName = "";
      await syncVaultData();
      state.collections = collectionsFor(organization.id);
    } catch (caught) {
      state.error = errorMessage(caught, "创建集合失败");
    } finally {
      state.busy = "";
    }
  }

  function openRenameOrganization() {
    if (!state.selected) return;
    state.renameTarget = { kind: "organization", id: state.selected.id };
    state.renameName = state.selected.name;
  }

  function openRenameCollection(
    collection: Pick<OrganizationCollection, "id" | "name">,
  ) {
    state.renameTarget = { kind: "collection", id: collection.id };
    state.renameName = collection.name;
  }

  async function saveRename() {
    if (!state.selected || !state.renameTarget || !state.renameName.trim())
      return;
    const organization = state.selected;
    const target = state.renameTarget;
    const name = state.renameName.trim();
    try {
      await match(target)
        .with({ kind: "organization" }, () =>
          updateOrganizationApi(organization.id, name),
        )
        .with({ kind: "collection" }, async ({ id }) => {
          const key = getOrganizationKey(organization.id);
          if (!key) throw new Error("组织密钥不可用");
          await updateOrganizationCollectionApi(
            organization.id,
            id,
            await encryptStr(name, key.encKey, key.macKey),
          );
        })
        .exhaustive();
      state.renameTarget = null;
      await syncVaultData();
      if (target.kind === "organization") await load();
      else state.collections = collectionsFor(organization.id);
    } catch (caught) {
      state.error = errorMessage(caught, "重命名失败");
    }
  }

  async function removeMember(member: Pick<OrganizationMember, "id">) {
    if (!state.selected) return;
    await removeOrganizationMemberApi(state.selected.id, member.id);
    state.members = state.members.filter((item) => item.id !== member.id);
  }

  async function removeCollection(
    collection: Pick<OrganizationCollection, "id">,
  ) {
    if (!state.selected) return;
    const organization = state.selected;
    await deleteOrganizationCollectionApi(organization.id, collection.id);
    await syncVaultData();
    state.collections = collectionsFor(organization.id);
  }

  async function confirmRemove() {
    if (!state.removeTarget) return;
    const target = state.removeTarget;
    state.removeTarget = null;
    await match(target)
      .with({ kind: "member" }, ({ id }) => removeMember({ id }))
      .with({ kind: "collection" }, ({ id }) => removeCollection({ id }))
      .exhaustive();
  }

  async function removeOrganization() {
    if (!state.selected || !state.deletePassword || !vault.profile) return;
    state.busy = "delete-org";
    try {
      await deleteOrganizationApi(
        state.selected.id,
        await deriveAccountPasswordHash(
          vault.profile.email,
          state.deletePassword,
        ),
      );
      state.deletePassword = "";
      state.selected = null;
      await syncVaultData();
      await load();
    } catch (caught) {
      state.error = errorMessage(caught, "删除组织失败");
    } finally {
      state.busy = "";
    }
  }

  return {
    state,
    load,
    select,
    collectionsFor,
    create,
    inviteMember,
    editMember,
    saveMember,
    addCollection,
    openRenameOrganization,
    openRenameCollection,
    saveRename,
    confirmRemove,
    removeOrganization,
  };
}
