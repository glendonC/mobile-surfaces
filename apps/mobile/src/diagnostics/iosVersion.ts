// Pure iOS-version floor check, split out of checkSetup.ts so it is
// unit-testable without the react-native `Platform` import. The harness
// requires iOS 17.2+: push-to-start tokens land there (MS012).

export const IOS_FLOOR_MAJOR = 17;
export const IOS_FLOOR_MINOR = 2;

/**
 * True when an iOS version string (e.g. "17.2", "18", "26.1.1") meets the
 * 17.2 floor. A version whose major segment does not parse as a number
 * returns false; an absent minor is treated as 0.
 */
export function meetsIosFloor(version: string): boolean {
  const [majorStr, minorStr = "0"] = version.split(".");
  const major = Number(majorStr);
  const minor = Number(minorStr);
  return (
    Number.isFinite(major) &&
    (major > IOS_FLOOR_MAJOR ||
      (major === IOS_FLOOR_MAJOR && minor >= IOS_FLOOR_MINOR))
  );
}
