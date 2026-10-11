import { describe, expect, it } from "vitest";
import { profileFromAccount } from "./account";

describe("the profile filled from the BytNode account", () => {
  const empty = { firstName: "", lastName: "", email: "", bio: "" };

  it("fills what is empty from the account's name and e-mail", () => {
    expect(profileFromAccount(empty, { email: "ada@example.com", name: "Ada King Lovelace", avatarUrl: null })).toEqual({
      firstName: "Ada",
      lastName: "King Lovelace",
      email: "ada@example.com",
      bio: "",
    });
  });

  it("never overwrites what the user typed", () => {
    const typed = { firstName: "Augusta", lastName: "", email: "me@home.org", bio: "Trader" };
    expect(profileFromAccount(typed, { email: "ada@example.com", name: "Ada Lovelace", avatarUrl: null })).toEqual({ ...typed, lastName: "Lovelace" });
  });

  it("an account with no name gives the e-mail only", () => {
    expect(profileFromAccount(empty, { email: "ada@example.com", name: null, avatarUrl: null })).toEqual({ ...empty, email: "ada@example.com" });
  });
});
