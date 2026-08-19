<script lang="ts">
  import { Copy } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import * as Field from "$lib/components/ui/field/index.js";
  import { Input } from "$lib/components/ui/input/index.js";

  let {
    deleteAccountOpen = $bindable(),
    deleteAccountPassword = $bindable(),
    totpOpen = $bindable(),
    totpKey,
    totpToken = $bindable(),
    disableOpen = $bindable(),
    masterPassword = $bindable(),
    passwordOpen = $bindable(),
    currentPassword = $bindable(),
    newPassword = $bindable(),
    confirmPassword = $bindable(),
    busy,
    onCopy,
    onDeleteAccount,
    onEnableTotp,
    onDisableTotp,
    onChangePassword,
  }: {
    deleteAccountOpen: boolean;
    deleteAccountPassword: string;
    totpOpen: boolean;
    totpKey: string;
    totpToken: string;
    disableOpen: boolean;
    masterPassword: string;
    passwordOpen: boolean;
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
    busy: string;
    onCopy: (value: string) => void;
    onDeleteAccount: () => void;
    onEnableTotp: () => void;
    onDisableTotp: () => void;
    onChangePassword: () => void;
  } = $props();
</script>

<Dialog.Root bind:open={deleteAccountOpen}
  ><Dialog.Content
    ><Dialog.Header
      ><Dialog.Title>永久删除账户</Dialog.Title><Dialog.Description
        >此操作无法撤销。服务器会删除个人保险库及账户数据，并清理附件和 Send
        文件。请输入当前主密码确认。</Dialog.Description
      ></Dialog.Header
    ><Field.Field
      ><Field.Label for="delete-account-password">当前主密码</Field.Label><Input
        id="delete-account-password"
        type="password"
        bind:value={deleteAccountPassword}
        autocomplete="current-password"
      /></Field.Field
    ><Dialog.Footer
      ><Button variant="outline" onclick={() => (deleteAccountOpen = false)}>取消</Button><Button
        variant="destructive"
        onclick={onDeleteAccount}
        disabled={!deleteAccountPassword || busy === "delete-account"}>永久删除</Button
      ></Dialog.Footer
    ></Dialog.Content
  ></Dialog.Root
>

<Dialog.Root bind:open={totpOpen}
  ><Dialog.Content
    ><Dialog.Header
      ><Dialog.Title>设置身份验证器</Dialog.Title><Dialog.Description
        >在身份验证器中手动输入密钥，再填写生成的 6 位验证码。</Dialog.Description
      ></Dialog.Header
    ><Field.Group
      ><Field.Field
        ><Field.Label>密钥</Field.Label>
        <div class="flex gap-2">
          <Input value={totpKey} readonly class="font-mono" /><Button
            variant="outline"
            size="icon"
            onclick={() => onCopy(totpKey)}
            aria-label="复制密钥"><Copy /></Button
          >
        </div></Field.Field
      ><Field.Field
        ><Field.Label for="totp-token">验证码</Field.Label><Input
          id="totp-token"
          bind:value={totpToken}
          inputmode="numeric"
          maxlength={6}
          autocomplete="one-time-code"
        /></Field.Field
      ></Field.Group
    ><Dialog.Footer
      ><Button variant="outline" onclick={() => (totpOpen = false)}>取消</Button><Button
        onclick={onEnableTotp}
        disabled={!/^\d{6}$/.test(totpToken) || busy === "totp-enable"}>启用</Button
      ></Dialog.Footer
    ></Dialog.Content
  ></Dialog.Root
>

<Dialog.Root bind:open={disableOpen}
  ><Dialog.Content
    ><Dialog.Header
      ><Dialog.Title>关闭两步验证</Dialog.Title><Dialog.Description
        >请输入主密码确认。此操作会撤销现有刷新令牌。</Dialog.Description
      ></Dialog.Header
    ><Field.Field
      ><Field.Label for="master-password">主密码</Field.Label><Input
        id="master-password"
        type="password"
        bind:value={masterPassword}
        autocomplete="current-password"
      /></Field.Field
    ><Dialog.Footer
      ><Button variant="outline" onclick={() => (disableOpen = false)}>取消</Button><Button
        variant="destructive"
        onclick={onDisableTotp}
        disabled={!masterPassword || busy === "totp-disable"}>确认关闭</Button
      ></Dialog.Footer
    ></Dialog.Content
  ></Dialog.Root
>

<Dialog.Root bind:open={passwordOpen}
  ><Dialog.Content
    ><Dialog.Header
      ><Dialog.Title>更改主密码</Dialog.Title><Dialog.Description
        >保险库密钥会使用新密码重新加密。完成后需要重新登录所有设备。</Dialog.Description
      ></Dialog.Header
    ><Field.Group
      ><Field.Field
        ><Field.Label for="current-password">当前主密码</Field.Label><Input
          id="current-password"
          type="password"
          bind:value={currentPassword}
          autocomplete="current-password"
        /></Field.Field
      ><Field.Field
        ><Field.Label for="new-password">新主密码</Field.Label><Input
          id="new-password"
          type="password"
          bind:value={newPassword}
          autocomplete="new-password"
        /><Field.Description>至少 12 个字符。</Field.Description></Field.Field
      ><Field.Field
        ><Field.Label for="confirm-password">确认新主密码</Field.Label><Input
          id="confirm-password"
          type="password"
          bind:value={confirmPassword}
          autocomplete="new-password"
        /></Field.Field
      ></Field.Group
    ><Dialog.Footer
      ><Button variant="outline" onclick={() => (passwordOpen = false)}>取消</Button><Button
        variant="destructive"
        onclick={onChangePassword}
        disabled={!currentPassword ||
          newPassword.length < 12 ||
          !confirmPassword ||
          busy === "password"}>更改并退出</Button
      ></Dialog.Footer
    ></Dialog.Content
  ></Dialog.Root
>
