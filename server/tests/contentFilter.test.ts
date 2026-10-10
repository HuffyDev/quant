import { describe, expect, it } from "vitest";
import { filterPublicText, looksLikeMinor } from "../services/contentFilter";

describe("content filter", () => {
  it.each([
    "buy now before it moons",
    "this will pump hard",
    "easy 10x from here",
    "price target $1",
    "check https://example.com",
    "go to babybrain.fun",
    "gm #solana",
    "not financial advice but",
    "email me at a@b.co",
    "🚀🚀🚀",
    "x".repeat(281),
  ])("blocks %s", (t) => expect(filterPublicText(t).ok).toBe(false));

  it.each(["hi", "someone sold 9 sol of me. why", "proof on site", "i learned what wagmi means today", "treasury at 9.6 sol. guardian says wait."])(
    "allows %s",
    (t) => expect(filterPublicText(t).ok).toBe(true),
  );

  it("flags likely minors", () => {
    expect(looksLikeMinor("im 13 and my mom doesnt know")).toBe(true);
    expect(looksLikeMinor("im in 8th grade lol")).toBe(true);
    expect(looksLikeMinor("i am 34 years old")).toBe(false);
  });
});
