import { describe, expect, it } from "vitest";
import { lineOpacity, monitorTransform, parseStreamParams, STREAM_DEFAULTS, streamQuery, typedLength } from "../../client/src/stream/params";
import { scheduleFeed, visibleChars, type FeedLine } from "../../client/src/stream/feed";
import { streamKeyOk } from "../streamKey";

describe("/stream params", () => {
  it("uses defaults when empty", () => {
    expect(parseStreamParams("")).toEqual(STREAM_DEFAULTS);
  });
  it("parses and clamps geometry", () => {
    const p = parseStreamParams("?x=100&y=50.5&w=99999&h=-3&rotate=7&fs=abc&ticker=right&calibrate=1");
    expect(p).toMatchObject({ x: 100, y: 50.5, w: 1920, h: 40, rotate: 7, fs: STREAM_DEFAULTS.fs, ticker: "right", calibrate: true });
  });
  it("keeps chat readable on a 1080p stream: font ≥ 22px, at most 8 lines", () => {
    expect(STREAM_DEFAULTS.fs).toBeGreaterThanOrEqual(22);
    expect(parseStreamParams("?fs=12").fs).toBe(22);
    expect(parseStreamParams("?lines=40").lines).toBe(8);
    expect(STREAM_DEFAULTS.lines).toBe(8);
  });
  it("defaults the chat box inside the monitor, inset from his shoulder (right/bottom)", () => {
    const d = STREAM_DEFAULTS;
    // measured screen: x 388–1153, y 378–766; shoulder enters from x≈1060 below y≈630
    expect(d.x).toBeGreaterThan(388);
    expect(d.y).toBeGreaterThan(378);
    expect(d.x + d.w).toBeLessThan(1060);
    expect(d.y + d.h).toBeLessThan(740);
    expect(d.video).toBe("/media/hacker.mp4");
  });
  it("only accepts same-origin video paths", () => {
    expect(parseStreamParams("?video=/stream/other.mp4").video).toBe("/stream/other.mp4");
    expect(parseStreamParams("?video=https://evil.example/x.mp4").video).toBe(STREAM_DEFAULTS.video);
    expect(parseStreamParams("?video=//evil.example/x.mp4").video).toBe(STREAM_DEFAULTS.video);
    expect(parseStreamParams("?video=/stream/../../etc").video).toBe(STREAM_DEFAULTS.video);
  });
  it("round-trips through the calibration URL", () => {
    const p = parseStreamParams("?x=812&y=233&w=640&h=380&rotate=-2.5&ry=12&ticker=off&fs=30&lines=6");
    expect(parseStreamParams(`?${streamQuery(p)}`)).toEqual(p);
  });
  it("builds the monitor transform", () => {
    expect(monitorTransform(parseStreamParams("?rotate=3"))).toBe("rotate(3deg)");
    expect(monitorTransform(parseStreamParams("?rotate=0&ry=10&skewX=2"))).toBe("perspective(1600px) rotateX(0deg) rotateY(10deg) rotate(0deg) skew(2deg, 0deg)");
  });
  it("types replies out character by character", () => {
    expect(typedLength("root access", 0, 30)).toBe(0);
    expect(typedLength("root access", 100, 30)).toBe(3);
    expect(typedLength("root access", 10_000, 30)).toBe(11);
  });
});

describe("/stream monitor feed", () => {
  const L = (key: string, kind: FeedLine["kind"], text: string, liveAt: number | null, cutAt?: number): FeedLine => ({ key, kind, from: kind === "in" ? "@a" : "", text, liveAt, cutAt });
  it("types replies and probes one after another", () => {
    const s = scheduleFeed([L("q", "probe-q", "x".repeat(32), 0), L("a", "probe-a", "y".repeat(32), 0)], 32);
    expect(s[0].startAt).toBe(0);
    expect(s[1].startAt).toBe(1250); // 1s typing + 250ms gap
    expect(visibleChars(s[1], 1000, 32)).toBe(-1);
    expect(visibleChars(s[1], 1750, 32)).toBe(16);
  });
  it("a real message interrupts the probe queue: typing probe is cut, unstarted probe dropped", () => {
    const s = scheduleFeed([L("q", "probe-q", "x".repeat(64), 0, 500), L("a", "probe-a", "y".repeat(64), 0, 500), L("in", "in", "gm", 500), L("out", "out", "logged.", 600)], 32);
    expect(s.map((l) => l.key)).toEqual(["q", "in", "out"]);
    expect(s[0]).toMatchObject({ cut: true, maxLen: 16 });
    expect(s[2].startAt).toBe(600); // the real reply is not queued behind the probe
    expect(visibleChars(s[0], 10_000, 32)).toBe(16);
  });
  it("history lines show whole; finished probes are unaffected by a later cut", () => {
    const s = scheduleFeed([L("h", "out", "old", null), L("q", "probe-q", "abc", 0, 99_999)], 32);
    expect(s[0].startAt).toBeNull();
    expect(s[1].cut).toBe(false);
  });
  it("older lines fade out", () => {
    expect(lineOpacity(0, 8)).toBe(1);
    expect(lineOpacity(3, 8)).toBe(1);
    expect(lineOpacity(7, 8)).toBeLessThan(lineOpacity(5, 8));
    expect(lineOpacity(7, 8)).toBeGreaterThan(0);
  });
});

describe("/stream key", () => {
  it("requires the exact key, and a configured key", () => {
    expect(streamKeyOk("s3cret", "s3cret")).toBe(true);
    expect(streamKeyOk("s3cre", "s3cret")).toBe(false);
    expect(streamKeyOk(undefined, "s3cret")).toBe(false);
    expect(streamKeyOk("", "s3cret")).toBe(false);
    expect(streamKeyOk("anything", undefined)).toBe(false);
  });
});
