import { describe, expect, it } from "vitest";

import {
  ADMIN_ACTIONS,
  DEFAULT_ADMIN_ROLE,
  NO_ROLES_READ,
  ROLES,
  anyRoleUnread,
  getAction,
  getRole,
  heldRoles,
  holdsNothing,
  missingRoleSentence,
  permissionFor,
  type RoleHoldings,
} from "@/components/admin/roles";

const NOTHING_HELD: RoleHoldings = {
  "token-admin": false,
  issuer: false,
  oracle: false,
  "registry-admin": false,
  registrar: false,
};

describe("the role table", () => {
  it("has a definition for every id an action can name", () => {
    for (const action of ADMIN_ACTIONS) {
      if (action.role === null) continue;
      expect(() => getRole(action.role!)).not.toThrow();
    }
  });

  it("keeps the two contracts' admin roles apart", () => {
    const tokenAdmin = getRole("token-admin");
    const registryAdmin = getRole("registry-admin");
    expect(tokenAdmin.constant).toBe(registryAdmin.constant);
    // Same constant, different contract, therefore a different grant. The deploy script gives both
    // to one address today; a console that assumed that would hide setCountryBlocked from someone
    // who can send it.
    expect(tokenAdmin.contract).not.toBe(registryAdmin.contract);
    expect(tokenAdmin.id).not.toBe(registryAdmin.id);
  });

  it("exposes every id exactly once", () => {
    expect(new Set(ROLES.map((role) => role.id)).size).toBe(ROLES.length);
    expect(new Set(ADMIN_ACTIONS.map((action) => action.id)).size).toBe(ADMIN_ACTIONS.length);
  });

  it("pins DEFAULT_ADMIN_ROLE to bytes32(0)", () => {
    expect(DEFAULT_ADMIN_ROLE).toMatch(/^0x0{64}$/);
  });

  it("marks every irreversible action as destructive", () => {
    for (const id of ["force-nav", "distribute", "pause", "unpause", "mint", "burn"] as const) {
      expect(getAction(id).destructive).toBe(true);
    }
    // A NAV inside the rail is the routine daily operation; asking for a typed phrase every day is
    // how a typed phrase stops meaning anything.
    expect(getAction("set-nav").destructive).toBe(false);
  });

  it("throws on an unknown id rather than rendering a blank row", () => {
    expect(() => getRole("nope" as never)).toThrow(/no definition/);
    expect(() => getAction("nope" as never)).toThrow(/no definition/);
  });
});

describe("permissionFor", () => {
  it("is unknown while the read has not landed", () => {
    expect(permissionFor(getAction("burn"), NO_ROLES_READ)).toBe("unknown");
  });

  it("is refused once the chain has answered no", () => {
    expect(permissionFor(getAction("burn"), NOTHING_HELD)).toBe("refused");
  });

  it("is allowed for an action that needs no wallet role", () => {
    expect(permissionFor(getAction("queue-approve"), NOTHING_HELD)).toBe("allowed");
    expect(permissionFor(getAction("queue-approve"), NO_ROLES_READ)).toBe("allowed");
  });

  it("is allowed once the role is held", () => {
    const issuer: RoleHoldings = { ...NOTHING_HELD, issuer: true };
    expect(permissionFor(getAction("burn"), issuer)).toBe("allowed");
    expect(permissionFor(getAction("force-nav"), issuer)).toBe("refused");
  });
});

describe("summarising what a wallet holds", () => {
  it("lists the held roles in table order", () => {
    const holdings: RoleHoldings = { ...NOTHING_HELD, issuer: true, registrar: true };
    expect(heldRoles(holdings).map((role) => role.id)).toEqual(["issuer", "registrar"]);
  });

  it("distinguishes nothing-held from nothing-read", () => {
    expect(holdsNothing(NOTHING_HELD)).toBe(true);
    expect(holdsNothing(NO_ROLES_READ)).toBe(false);
    expect(anyRoleUnread(NO_ROLES_READ)).toBe(true);
    expect(anyRoleUnread(NOTHING_HELD)).toBe(false);
  });
});

describe("missingRoleSentence", () => {
  it("names the role, the contract and the call", () => {
    const sentence = missingRoleSentence(getAction("force-nav"));
    expect(sentence).toContain("DEFAULT_ADMIN_ROLE");
    expect(sentence).toContain("HBToken");
    expect(sentence).toContain("setNAV");
  });

  it("says plainly when the wallet is not the signer at all", () => {
    expect(missingRoleSentence(getAction("queue-approve"))).toContain("server");
  });
});
