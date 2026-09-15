/**
 * The role model, as the two contracts define it.
 *
 * `HBToken` and `IdentityRegistry` are separate `AccessControl` instances, so `DEFAULT_ADMIN_ROLE`
 * on one is **not** `DEFAULT_ADMIN_ROLE` on the other. The deploy script grants both to the same
 * address today (PLAN.md D46), which makes it easy to write a console that quietly assumes they are
 * the same role and then hides `setCountryBlocked` from somebody who can perfectly well send it.
 * They are modelled as five distinct holdings here for that reason.
 *
 * Nothing in this file is a permission check. It decides what the page *shows*; `AccessControl`
 * decides what the chain *accepts*, and the two are allowed to disagree — a stale read here costs
 * a wasted simulation, never an unauthorised write.
 */

import type { Hex } from "viem";

export type RoleId = "token-admin" | "issuer" | "oracle" | "registry-admin" | "registrar";

export type AdminContract = "HBToken" | "IdentityRegistry";

export interface RoleDefinition {
  readonly id: RoleId;
  /** The Solidity constant, verbatim, so it can be grepped in the contract. */
  readonly constant: string;
  readonly contract: AdminContract;
  readonly label: string;
  /** What holding it lets this console do, in one sentence. */
  readonly grants: string;
}

/**
 * `DEFAULT_ADMIN_ROLE` is `bytes32(0)` in OpenZeppelin's `AccessControl`; the other three are
 * `keccak256` of their own name. They are still **read from the contracts** rather than hardcoded
 * here, because a constant that drifts from the deployed bytecode would make this page lie with
 * great confidence. This value exists only so the reads have something to compare against and so a
 * test can pin the encoding.
 */
export const DEFAULT_ADMIN_ROLE: Hex = `0x${"0".repeat(64)}`;

export const ROLES: readonly RoleDefinition[] = [
  {
    id: "token-admin",
    constant: "DEFAULT_ADMIN_ROLE",
    contract: "HBToken",
    label: "Token admin",
    grants: "Force a NAV past the rail, and change the rail width or the subscription minimum.",
  },
  {
    id: "issuer",
    constant: "ISSUER_ROLE",
    contract: "HBToken",
    label: "Issuer",
    grants: "Distribute a coupon, pause and unpause, and mint or burn operational corrections.",
  },
  {
    id: "oracle",
    constant: "ORACLE_ROLE",
    contract: "HBToken",
    label: "Oracle",
    grants: "Set NAV within the rail.",
  },
  {
    id: "registry-admin",
    constant: "DEFAULT_ADMIN_ROLE",
    contract: "IdentityRegistry",
    label: "Registry admin",
    grants: "Block and unblock countries.",
  },
  {
    id: "registrar",
    constant: "REGISTRAR_ROLE",
    contract: "IdentityRegistry",
    label: "Registrar",
    grants:
      "Verify and remove addresses on chain. The server's registrar key holds this one and signs " +
      "approvals; a wallet holding it may also reject a queued request here.",
  },
];

export function getRole(id: RoleId): RoleDefinition {
  const role = ROLES.find((candidate) => candidate.id === id);
  // Unreachable through the exported types; thrown rather than defaulted so a future RoleId that
  // is added to the union but not to ROLES fails loudly in a test instead of rendering blank.
  if (!role) throw new Error(`roles.ts: no definition for role "${id}".`);
  return role;
}

// --------------------------------------------------------------------------- actions

export type ActionId =
  | "queue-approve"
  | "queue-reject"
  | "blocklist"
  | "set-nav"
  | "force-nav"
  | "distribute"
  | "pause"
  | "unpause"
  | "mint"
  | "burn";

export interface AdminActionDefinition {
  readonly id: ActionId;
  readonly label: string;
  /** The call this action sends, or the endpoint when it is not a transaction. */
  readonly call: string;
  /**
   * The role the *connected wallet* must hold. `null` means no wallet role is involved: the
   * registrar worker signs with the server key, so the browser holds nothing at all.
   */
  readonly role: RoleId | null;
  /** Whether a mistake here is expensive enough to demand a typed phrase. */
  readonly destructive: boolean;
}

export const ADMIN_ACTIONS: readonly AdminActionDefinition[] = [
  {
    id: "queue-approve",
    label: "Approve a queued verification",
    call: "POST /api/verify/process",
    role: null,
    destructive: false,
  },
  {
    id: "queue-reject",
    label: "Reject a queued verification",
    call: "POST /admin/api/queue (signed)",
    role: "registrar",
    destructive: true,
  },
  {
    id: "blocklist",
    label: "Block or unblock a country",
    call: "IdentityRegistry.setCountryBlocked",
    role: "registry-admin",
    destructive: true,
  },
  {
    id: "set-nav",
    label: "Set NAV within the rail",
    call: "HBToken.setNAV(newNav, reportedAUM, false)",
    role: "oracle",
    destructive: false,
  },
  {
    id: "force-nav",
    label: "Force NAV past the rail",
    call: "HBToken.setNAV(newNav, reportedAUM, true)",
    role: "token-admin",
    destructive: true,
  },
  {
    id: "distribute",
    label: "Distribute a coupon",
    call: "HBToken.distributeCoupon(usdcAmount)",
    role: "issuer",
    destructive: true,
  },
  {
    id: "pause",
    label: "Pause the token",
    call: "HBToken.pause()",
    role: "issuer",
    destructive: true,
  },
  {
    id: "unpause",
    label: "Unpause the token",
    call: "HBToken.unpause()",
    role: "issuer",
    destructive: true,
  },
  {
    id: "mint",
    label: "Mint a correction",
    call: "HBToken.mint(to, amount)",
    role: "issuer",
    destructive: true,
  },
  {
    id: "burn",
    label: "Burn a correction",
    call: "HBToken.burn(from, amount)",
    role: "issuer",
    destructive: true,
  },
];

export function getAction(id: ActionId): AdminActionDefinition {
  const action = ADMIN_ACTIONS.find((candidate) => candidate.id === id);
  if (!action) throw new Error(`roles.ts: no definition for action "${id}".`);
  return action;
}

// --------------------------------------------------------------------------- what the wallet holds

/** `true` / `false` once the chain answered; `null` while it has not, or when it cannot be asked. */
export type RoleHoldings = Readonly<Record<RoleId, boolean | null>>;

export const NO_ROLES_READ: RoleHoldings = {
  "token-admin": null,
  issuer: null,
  oracle: null,
  "registry-admin": null,
  registrar: null,
};

export type Permission = "allowed" | "refused" | "unknown";

/**
 * Whether the console should offer an action to this wallet.
 *
 * `unknown` is a third answer on purpose. A read that has not landed is not the same as a role the
 * wallet does not hold, and rendering the second while the first is true is how a console tells
 * somebody they are not an admin a quarter of a second before they turn out to be one.
 */
export function permissionFor(action: AdminActionDefinition, holdings: RoleHoldings): Permission {
  if (action.role === null) return "allowed";
  const held = holdings[action.role];
  if (held === null) return "unknown";
  return held ? "allowed" : "refused";
}

/** Every role the wallet is known to hold, in `ROLES` order. */
export function heldRoles(holdings: RoleHoldings): readonly RoleDefinition[] {
  return ROLES.filter((role) => holdings[role.id] === true);
}

/** True only when every role has been read and none is held. */
export function holdsNothing(holdings: RoleHoldings): boolean {
  return ROLES.every((role) => holdings[role.id] === false);
}

/** True while at least one role is still unread. */
export function anyRoleUnread(holdings: RoleHoldings): boolean {
  return ROLES.some((role) => holdings[role.id] === null);
}

/**
 * The sentence shown in place of an action the wallet cannot send.
 *
 * Deliberately names the role, the contract that defines it and the call, because "you do not have
 * permission" is the least useful thing an operator console can say to somebody who is holding the
 * wrong one of five keys.
 */
export function missingRoleSentence(action: AdminActionDefinition): string {
  if (action.role === null) {
    return `${action.label} needs no role from your wallet: ${action.call} is signed by the server's registrar key.`;
  }
  const role = getRole(action.role);
  return `${action.label} sends ${action.call}, which ${role.contract} restricts to ${role.constant}. Your wallet does not hold it, so the contract would revert AccessControlUnauthorizedAccount.`;
}
