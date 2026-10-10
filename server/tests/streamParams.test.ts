import { describe, expect, it } from "vitest";
import { monitorTransform, parseStreamParams, STREAM_DEFAULTS, streamQuery, typedLength } from "../../client/src/stream/params";

describe("/stream params", () => {
  it("uses defaults when empty", () => {
    expect(parseStreamParams("")).toEqual(STREAM_DEFAULTS);
  });
  it("parses and clamps geometry", () => {
    const p = parseStreamParams("?x=100&y=50.5&w=99999&h=-3&rotate=7&fs=abc&ticker=left&calibrate=1");
    expect(p).toMatchObject({ x: 100, y: 50.5, w: 1920, h: 40, rotate: 7, fs: STREAM_DEFAULTS.fs, ticker: "left", calibrate: true });
  });
  it("only accepts same-origin video paths", () => {
    expect(parseStreamParams("?video=/stream/other.mp4").video).toBe("/stream/other.mp4");
    expect(parseStreamParams("?video=https://evil.example/x.mp4").video).toBe(STREAM_DEFAULTS.video);
    expect(parseStreamParams("?video=//evil.example/x.mp4").video).toBe(STREAM_DEFAULTS.video);
    expect(parseStreamParams("?video=/stream/../../etc").video).toBe(STREAM_DEFAULTS.video);
  });
  it("round-trips through the calibration URL", () => {
    const p = parseStreamParams("?x=812&y=233&w=640&h=380&rotate=-2.5&ry=12&ticker=off");
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
